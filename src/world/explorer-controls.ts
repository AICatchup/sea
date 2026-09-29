import * as THREE from 'three';
import type { AdventureState, GroundSampler, TravelMode, WorldDestination } from './contracts.ts';
import { BOAT_MIN_DEPTH, clampWorld, findNearbyLand, findNearbyWater, footSegmentClear, groundHeight,
  isNavigableWater, planWaterRoute, pointDistance, waterSegmentClear, type NavigationPoint } from './navigation.ts';

const EYE_HEIGHT = 1.72;
const SURFACE_EYE = 0.34;
const MAX_DIVE_DEPTH = 60;
const MANUAL_BOAT_SPEED = 12;
const VOYAGE_SPEED = 200;
const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));
const angleDifference = (a: number, b: number): number => Math.atan2(Math.sin(a - b), Math.cos(a - b));
const editable = (target: EventTarget | null): boolean => {
  if (!target || !('tagName' in target)) return false;
  const element = target as HTMLElement;
  return /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(element.tagName) || element.isContentEditable
    || Boolean(element.closest?.('[contenteditable="true"]'));
};

/** Owns input and simulation only; the renderer reads the mutable state each frame. */
export class ExplorerControls {
  readonly state: AdventureState;
  private readonly canvas: HTMLCanvasElement;
  private readonly ground: GroundSampler;
  private readonly destinations: WorldDestination[];
  private readonly spawn: THREE.Vector3;
  private readonly anchor: THREE.Vector3;
  private readonly doc: Document;
  private readonly listeners: [EventTarget, string, EventListener][] = [];
  private readonly keys = new Set<string>();
  private readonly originalTouchAction: string;
  private readonly originalTabIndex: number;
  private padX = 0;
  private padForward = 0;
  private padVertical = 0;
  private targetYaw = 0;
  private targetPitch = -0.035;
  private boatVelocity = 0;
  private jumpVelocity = 0;
  private jumpRequested = false;
  private autoAscent = false;
  private pointerId: number | null = null;
  private pointerX = 0;
  private pointerY = 0;
  private lastLookTime = -100;
  private lastTime = 0;
  private route: NavigationPoint[] = [];
  private waypoint = 0;
  private disposed = false;

  constructor(canvas: HTMLCanvasElement, ground: GroundSampler, destinations: WorldDestination[], spawn: THREE.Vector3) {
    this.canvas = canvas; this.ground = ground; this.destinations = destinations; this.spawn = spawn.clone();
    this.doc = canvas.ownerDocument;
    const tomari = destinations.find(destination => destination.id === 'tomari');
    const anchor = findNearbyWater(ground, tomari ?? spawn, BOAT_MIN_DEPTH, 500);
    this.anchor = new THREE.Vector3(anchor?.x ?? spawn.x, 0, anchor?.z ?? spawn.z);
    this.state = { mode: 'walk', position: spawn.clone(), yaw: 0, pitch: this.targetPitch,
      speed: 0, oxygen: 1, depth: 0, boatPosition: this.anchor.clone(), boatYaw: tomari?.heading ?? 0,
      voyageTarget: null, voyageRemaining: 0, message: '泊海岸へようこそ。ドラッグで見回し、WASD・矢印キーで移動します。' };
    this.originalTouchAction = canvas.style.touchAction;
    this.originalTabIndex = canvas.tabIndex;
    canvas.style.touchAction = 'none';
    if (canvas.tabIndex < 0) canvas.tabIndex = 0;
    this.bind(canvas, 'pointerdown', this.onPointerDown);
    this.bind(canvas, 'pointermove', this.onPointerMove);
    this.bind(canvas, 'pointerup', this.onPointerUp);
    this.bind(canvas, 'pointercancel', this.onPointerUp);
    this.bind(canvas, 'lostpointercapture', this.onPointerUp);
    const window = this.doc.defaultView;
    if (window) {
      this.bind(window, 'keydown', this.onKeyDown);
      this.bind(window, 'keyup', this.onKeyUp);
      this.bind(window, 'blur', this.resetInput);
      this.bind(window, 'pointerup', this.onPointerUp);
      this.bind(window, 'pointercancel', this.onPointerUp);
    }
    this.bind(this.doc, 'visibilitychange', this.onVisibilityChange);
  }

  private bind(target: EventTarget, type: string, listener: EventListener): void {
    target.addEventListener(type, listener);
    this.listeners.push([target, type, listener]);
  }

  private onPointerDown: EventListener = event => {
    const pointer = event as PointerEvent;
    if (this.disposed || pointer.button !== 0 || this.pointerId !== null) return;
    this.pointerId = pointer.pointerId; this.pointerX = pointer.clientX; this.pointerY = pointer.clientY;
    this.canvas.focus({ preventScroll: true });
    try { this.canvas.setPointerCapture(pointer.pointerId); } catch { /* Some embedded browsers omit capture. */ }
    pointer.preventDefault();
  };

  private onPointerMove: EventListener = event => {
    const pointer = event as PointerEvent;
    if (pointer.pointerId !== this.pointerId) return;
    this.targetYaw -= (pointer.clientX - this.pointerX) * 0.004;
    this.targetPitch = clamp(this.targetPitch - (pointer.clientY - this.pointerY) * 0.004, -1.35, 1.35);
    this.pointerX = pointer.clientX; this.pointerY = pointer.clientY; this.lastLookTime = this.lastTime;
    pointer.preventDefault();
  };

  private onPointerUp: EventListener = event => {
    const pointer = event as PointerEvent;
    if (pointer.pointerId !== this.pointerId) return;
    this.releasePointer();
  };

  private releasePointer(): void {
    const id = this.pointerId;
    this.pointerId = null;
    if (id !== null) {
      try { if (this.canvas.hasPointerCapture(id)) this.canvas.releasePointerCapture(id); } catch { /* Capture may already be lost. */ }
    }
  }

  private onKeyDown: EventListener = event => {
    const key = event as KeyboardEvent;
    if (this.disposed || editable(key.target) || key.metaKey || key.altKey) return;
    if (!/^(Key[WASDCE]|Arrow(Up|Down|Left|Right)|Space|Shift(Left|Right)|Control(Left|Right))$/.test(key.code)) return;
    if (key.code === 'KeyE' && !key.repeat) this.boardOrLeave();
    if (key.code === 'Space' && !key.repeat && this.state.mode === 'walk') this.jumpRequested = true;
    this.keys.add(key.code);
    key.preventDefault();
  };

  private onKeyUp: EventListener = event => {
    const key = event as KeyboardEvent;
    if (this.keys.delete(key.code) && !editable(key.target)) key.preventDefault();
  };

  private onVisibilityChange: EventListener = event => { if (this.doc.hidden) this.resetInput(event); };
  private resetInput: EventListener = () => {
    this.keys.clear(); this.padX = 0; this.padForward = 0; this.padVertical = 0;
    this.boatVelocity = 0; this.jumpRequested = false; this.releasePointer();
    this.state.speed = 0;
  };

  setMove(x: number, forward: number): void {
    this.padX = Number.isFinite(x) ? clamp(x, -1, 1) : 0;
    this.padForward = Number.isFinite(forward) ? clamp(forward, -1, 1) : 0;
  }

  setVertical(direction: number): void {
    this.padVertical = Number.isFinite(direction) ? clamp(direction, -1, 1) : 0;
    if (this.padVertical > 0 && this.state.mode === 'walk') this.jumpRequested = true;
  }

  private input(): { x: number; forward: number; vertical: number; running: boolean } {
    const held = (...codes: string[]): number => codes.some(code => this.keys.has(code)) ? 1 : 0;
    let x = clamp(this.padX + held('KeyD', 'ArrowRight') - held('KeyA', 'ArrowLeft'), -1, 1);
    let forward = clamp(this.padForward + held('KeyW', 'ArrowUp') - held('KeyS', 'ArrowDown'), -1, 1);
    const length = Math.hypot(x, forward);
    if (length > 1) { x /= length; forward /= length; }
    return { x, forward, vertical: clamp(this.padVertical + held('Space') - held('KeyC', 'ControlLeft', 'ControlRight'), -1, 1),
      running: Boolean(held('ShiftLeft', 'ShiftRight')) };
  }

  private cancelVoyage(message?: string): void {
    this.route = []; this.waypoint = 0; this.state.voyageTarget = null; this.state.voyageRemaining = 0;
    if (message) this.state.message = message;
  }

  setMode(mode: TravelMode): void {
    if (this.disposed || !['walk', 'swim', 'dive', 'boat'].includes(mode)) return;
    if (mode === this.state.mode) return;
    if (mode === 'boat') {
      let point: NavigationPoint = this.state.boatPosition;
      if (pointDistance(this.state.position, point) > 250 || !isNavigableWater(this.ground, point)) {
        const water = findNearbyWater(this.ground, this.state.position);
        if (!water) { this.state.message = '近くに船を浮かべられる水深がありません。海岸へ戻ってください。'; return; }
        point = water; this.state.boatPosition.set(point.x, 0, point.z);
      }
      this.cancelVoyage(); this.state.mode = 'boat'; this.boatVelocity = 0;
      this.state.position.set(point.x, 1.9, point.z); this.targetYaw = this.state.boatYaw;
      this.targetPitch = -0.08; this.state.depth = 0;
      this.state.message = '海岸から船に乗りました。W/Sで加減速、A/Dで舵取り。Eで下船できます。';
      return;
    }
    if (mode === 'walk') {
      let land: NavigationPoint | null = null;
      const arrival = this.destinations.find(destination => destination.id === this.state.voyageTarget);
      if (arrival?.landingX !== undefined && arrival.landingZ !== undefined) {
        const point = { x: arrival.landingX, z: arrival.landingZ };
        if (pointDistance(point, this.state.position) < 90) land = findNearbyLand(this.ground, point, 12);
      }
      land ??= findNearbyLand(this.ground, this.state.position);
      if (!land) { this.state.message = '近くに上陸できる浜がありません。岸へ近づくか「泊海岸へ戻る」を選んでください。'; return; }
      this.cancelVoyage(); this.state.mode = 'walk'; this.jumpVelocity = 0; this.autoAscent = false;
      this.state.position.set(land.x, groundHeight(this.ground, land.x, land.z) + EYE_HEIGHT, land.z);
      this.state.depth = 0; this.state.speed = 0;
      this.state.message = '浜に上陸しました。WASDで歩く、Shiftで走る、Spaceでジャンプ。';
      return;
    }
    const previousMode = this.state.mode;
    const point = findNearbyWater(this.ground, this.state.position, mode === 'dive' ? 3 : 0.6);
    if (!point) { this.state.message = mode === 'dive' ? '近くに潜れる水深がありません。海岸や船から海へ入りましょう。' : '近くに泳げる海がありません。海岸へ移動してください。'; return; }
    this.cancelVoyage(); this.boatVelocity = 0; this.jumpVelocity = 0; this.state.mode = mode;
    const y = mode === 'dive' ? Math.max(-2.2, groundHeight(this.ground, point.x, point.z) + 1) : SURFACE_EYE;
    this.state.position.set(point.x, y, point.z); this.state.depth = Math.max(0, -y); this.state.speed = 0;
    this.autoAscent = false;
    this.state.message = mode === 'dive'
      ? '近くの海へ入りました。見ている方向へ泳ぎ、Spaceで浮上、C / Ctrlで潜降。最大水深60m。'
      : previousMode === 'boat' ? '船のそばへ下船しました。WASDで泳ぎ、Eで船へ戻れます。' : '近くの海へ入りました。WASDで泳ぎ、潜水を選ぶと海底を探検できます。';
  }

  private boardOrLeave(): void {
    if (this.state.mode === 'boat') {
      const land = findNearbyLand(this.ground, this.state.boatPosition, 24);
      if (land) this.setMode('walk');
      else {
        this.setMode('swim');
        const away = { x: this.state.boatPosition.x - Math.cos(this.state.boatYaw) * 3.8,
          z: this.state.boatPosition.z - Math.sin(this.state.boatYaw) * 3.8 };
        if (isNavigableWater(this.ground, away, 0.6, 0.45)) this.state.position.set(away.x, SURFACE_EYE, away.z);
      }
    } else if (pointDistance(this.state.position, this.state.boatPosition) < 18 && this.state.position.y > -2.5) this.setMode('boat');
    else this.state.message = '船へ近づいてEで乗船できます。海岸の「船に乗る」からも乗船できます。';
  }

  navigate(destinationId: string): void {
    if (this.disposed) return;
    const destination = this.destinations.find(point => point.id === destinationId);
    if (!destination) { this.state.message = '指定された行き先が見つかりません。'; return; }
    if (this.state.mode !== 'boat') this.setMode('boat');
    if (this.state.mode !== 'boat') return;
    const target = findNearbyWater(this.ground, destination, BOAT_MIN_DEPTH, 180);
    if (!target) { this.state.message = `${destination.label}付近に安全な到着水域がありません。`; return; }
    const route = planWaterRoute(this.ground, this.state.boatPosition, target);
    if (route.error) { this.cancelVoyage(`${destination.label}への出航を見送りました。${route.error}`); return; }
    if (route.distance < 7) { this.cancelVoyage(`${destination.label}に到着しています。Eで下船できます。`); return; }
    this.route = route.points; this.waypoint = 1; this.boatVelocity = Math.max(0, this.boatVelocity);
    this.state.voyageTarget = destination.id; this.state.voyageRemaining = route.distance;
    this.state.message = `${destination.label}へ出航。ゲーム内の海上移動を約17倍速にしています。WASDで手動操船に戻ります。`;
  }

  home(): void {
    if (this.disposed) return;
    this.resetInput(new Event('reset'));
    this.cancelVoyage(); this.state.mode = 'walk'; this.state.position.copy(this.spawn);
    this.state.boatPosition.copy(this.anchor); this.state.boatYaw = this.destinations.find(destination => destination.id === 'tomari')?.heading ?? 0;
    this.targetYaw = 0; this.targetPitch = -0.035; this.state.yaw = 0; this.state.pitch = this.targetPitch;
    this.state.depth = 0; this.state.oxygen = 1; this.jumpVelocity = 0; this.autoAscent = false;
    this.state.message = '泊海岸へ戻りました。浜から海へ歩いて入り、潜水や船の旅を楽しめます。';
  }

  update(delta: number, time: number): void {
    if (this.disposed || this.doc.hidden || !Number.isFinite(delta) || delta <= 0) return;
    this.lastTime = Number.isFinite(time) ? time : this.lastTime;
    const dt = Math.min(delta, 0.12);
    const smoothing = 1 - Math.exp(-dt * 15);
    this.state.yaw += angleDifference(this.targetYaw, this.state.yaw) * smoothing;
    this.state.pitch += (this.targetPitch - this.state.pitch) * smoothing;
    const input = this.input();
    if (this.state.voyageTarget && (Math.abs(input.x) + Math.abs(input.forward) > 0.05)) {
      this.boatVelocity = Math.min(this.boatVelocity, MANUAL_BOAT_SPEED);
      this.cancelVoyage('手動操船に戻りました。W/Sで加減速、A/Dで舵取り。');
    }
    const steps = Math.ceil(dt / 0.025);
    for (let step = 0; step < steps; step++) {
      if (this.state.mode === 'boat') this.updateBoat(dt / steps, input.x, input.forward);
      else this.updatePerson(dt / steps, input);
    }
    this.state.boatPosition.y = Math.sin(this.lastTime * 1.13) * 0.13 + Math.sin(this.lastTime * 2.31 + 0.8) * 0.055;
    if (this.state.mode === 'boat') this.state.position.set(this.state.boatPosition.x, this.state.boatPosition.y + 1.9, this.state.boatPosition.z);
    this.state.depth = this.state.mode === 'dive' ? Math.max(0, -this.state.position.y) : 0;
    this.state.oxygen = clamp(this.state.oxygen, 0, 1);
  }

  private updateBoat(dt: number, steer: number, throttle: number): void {
    const boat = this.state.boatPosition;
    if (this.state.voyageTarget && this.waypoint < this.route.length) {
      const target = this.route[this.waypoint];
      const distance = pointDistance(boat, target);
      if (distance < 0.3) {
        boat.x = target.x; boat.z = target.z;
        this.state.voyageRemaining = Math.max(0, this.state.voyageRemaining - distance);
        this.waypoint++;
        if (this.waypoint >= this.route.length) this.finishVoyage();
        return;
      }
      const heading = Math.atan2(target.x - boat.x, -(target.z - boat.z));
      this.state.boatYaw += angleDifference(heading, this.state.boatYaw) * Math.min(1, dt * 4);
      if (this.lastTime - this.lastLookTime > 3) this.targetYaw += angleDifference(heading, this.targetYaw) * Math.min(1, dt * 3);
      // The vessel slows inside departure/arrival waters before time compression builds offshore.
      const shoreSpeed = this.waypoint === 1 && distance < 100 || this.waypoint === this.route.length - 1 && distance < 100 ? 34 : VOYAGE_SPEED;
      this.boatVelocity = Math.min(shoreSpeed, this.boatVelocity + dt * 38);
      const travel = Math.min(distance, this.boatVelocity * dt);
      const next = { x: boat.x + (target.x - boat.x) / distance * travel, z: boat.z + (target.z - boat.z) / distance * travel };
      if (!waterSegmentClear(this.ground, boat, next)) {
        this.boatVelocity = 0; this.cancelVoyage('航路の浅瀬を検出して停船しました。沖へ向けて手動操船してください。');
      } else {
        boat.x = next.x; boat.z = next.z;
        this.state.voyageRemaining = Math.max(0, this.state.voyageRemaining - travel);
        if (travel >= distance - 0.01) this.waypoint++;
        if (this.waypoint >= this.route.length) this.finishVoyage();
      }
    } else {
      const oldYaw = this.state.boatYaw;
      this.state.boatYaw += steer * dt * 0.82 * (0.3 + Math.min(1, Math.abs(this.boatVelocity) / MANUAL_BOAT_SPEED) * 0.7);
      this.targetYaw += this.state.boatYaw - oldYaw;
      this.boatVelocity += throttle * dt * 4.2;
      this.boatVelocity *= Math.exp(-dt * (Math.abs(throttle) > 0.05 ? 0.11 : 0.55));
      this.boatVelocity = clamp(this.boatVelocity, -3.2, MANUAL_BOAT_SPEED);
      if (Math.abs(this.boatVelocity) < 0.02) this.boatVelocity = 0;
      const next = clampWorld({ x: boat.x + Math.sin(this.state.boatYaw) * this.boatVelocity * dt,
        z: boat.z - Math.cos(this.state.boatYaw) * this.boatVelocity * dt });
      if (waterSegmentClear(this.ground, boat, next)) { boat.x = next.x; boat.z = next.z; }
      else { this.boatVelocity = 0; this.state.message = '浅瀬で停船しました。W/SとA/Dで沖側へ向きを変えてください。'; }
    }
    this.state.speed = Math.abs(this.boatVelocity);
    this.state.oxygen = Math.min(1, this.state.oxygen + dt * 0.08);
  }

  private finishVoyage(): void {
    const label = this.destinations.find(destination => destination.id === this.state.voyageTarget)?.label ?? '目的地';
    this.boatVelocity = 0; this.state.speed = 0;
    this.cancelVoyage(`${label}の海岸付近へ到着しました。Eで泳いで下船、浜へ近づくと上陸できます。`);
  }

  private updatePerson(dt: number, input: { x: number; forward: number; vertical: number; running: boolean }): void {
    const position = this.state.position;
    const beforeX = position.x, beforeY = position.y, beforeZ = position.z;
    const mode = this.state.mode;
    const speed = mode === 'walk' ? input.running ? 9 : 5 : mode === 'swim' ? input.running ? 4.8 : 3 : input.running ? 3.4 : 2.6;
    const forward = input.forward * (mode === 'dive' ? Math.cos(this.state.pitch) : 1);
    const dx = (Math.cos(this.state.yaw) * input.x + Math.sin(this.state.yaw) * forward) * speed * dt;
    const dz = (Math.sin(this.state.yaw) * input.x - Math.cos(this.state.yaw) * forward) * speed * dt;
    const next = clampWorld({ x: position.x + dx, z: position.z + dz });
    const canMove = (point: NavigationPoint): boolean => {
      if (mode === 'walk') return footSegmentClear(this.ground, position, point);
      const ground = groundHeight(this.ground, point.x, point.z);
      if (mode === 'dive') return ground + 0.85 <= position.y;
      return ground <= -0.25 || footSegmentClear(this.ground, position, point);
    };
    if (canMove(next)) { position.x = next.x; position.z = next.z; }
    else {
      const xOnly = { x: next.x, z: position.z }, zOnly = { x: position.x, z: next.z };
      if (canMove(xOnly)) position.x = xOnly.x;
      if (canMove(zOnly)) position.z = zOnly.z;
    }
    const floor = groundHeight(this.ground, position.x, position.z);
    if (mode === 'walk') {
      const eye = floor + EYE_HEIGHT;
      if (this.jumpRequested && position.y <= eye + 0.08) this.jumpVelocity = 5.1;
      this.jumpRequested = false;
      this.jumpVelocity -= dt * 14;
      position.y += this.jumpVelocity * dt;
      if (position.y < eye) { position.y = eye; this.jumpVelocity = 0; }
      if (floor < -0.55 && position.y < 1.8) {
        this.state.mode = 'swim'; position.y = SURFACE_EYE; this.jumpVelocity = 0;
        this.state.message = '海へ入りました。泳ぐか、潜水を選んで海底へ進めます。';
      }
      this.state.oxygen = Math.min(1, this.state.oxygen + dt * 0.08);
    } else if (mode === 'swim') {
      position.y = SURFACE_EYE + Math.sin(this.lastTime * 1.8) * 0.035;
      this.state.oxygen = Math.min(1, this.state.oxygen + dt * 0.085);
      if (floor > -0.3) {
        this.state.mode = 'walk'; position.y = floor + EYE_HEIGHT;
        this.state.message = '浜へ上がりました。WASDで歩く、Shiftで走る、Spaceでジャンプ。';
      } else if (input.vertical < -0.1 && floor < -2) {
        this.state.mode = 'dive'; position.y = -0.8;
        this.state.message = '潜水を始めました。Spaceで浮上、C / Ctrlで潜降。酸素に気をつけて探検しましょう。';
      }
    } else {
      if (this.state.oxygen <= 0.18) this.autoAscent = true;
      const vertical = this.autoAscent ? 1.8 : input.vertical * 2.1 + input.forward * Math.sin(this.state.pitch) * speed;
      position.y = clamp(position.y + vertical * dt, Math.max(-MAX_DIVE_DEPTH, floor + 0.85), SURFACE_EYE);
      if (position.y > -0.4) {
        this.state.oxygen = Math.min(1, this.state.oxygen + dt * 0.085);
        if (this.autoAscent || position.y >= SURFACE_EYE - 0.03) {
          this.state.mode = 'swim'; position.y = SURFACE_EYE; this.autoAscent = false;
          this.state.message = '水面へ戻りました。酸素を回復しながら泳げます。';
        }
      } else {
        this.state.oxygen -= dt * (this.autoAscent ? 0.001 : 0.005 + Math.max(0, -position.y) * 0.000055);
        if (this.autoAscent) this.state.message = '酸素が少なくなったため、ゆっくり自動浮上しています。';
        else if (this.state.oxygen < 0.3) this.state.message = '酸素が少なくなっています。Spaceで水面へ戻りましょう。';
      }
    }
    this.state.speed = Math.hypot(position.x - beforeX, position.z - beforeZ, mode === 'dive' ? position.y - beforeY : 0) / dt;
  }

  dispose(): void {
    if (this.disposed) return;
    this.resetInput(new Event('reset'));
    this.disposed = true;
    for (const [target, type, listener] of this.listeners) target.removeEventListener(type, listener);
    this.listeners.length = 0;
    this.canvas.style.touchAction = this.originalTouchAction;
    this.canvas.tabIndex = this.originalTabIndex;
  }
}
