import * as THREE from 'three';
import type { AdventureState, GroundSampler, TravelMode, WorldDestination } from './contracts.ts';
import { PLAYER_DIMENSIONS } from './contracts.ts';
import { ROUTE_MIN_DEPTH, ROUTE_RADIUS, clampWorld, findNearbyWater, footSegmentClear, groundHeight,
  isNavigableWater, planWaterRoute, pointDistance, waterSegmentClear, type NavigationPoint } from './navigation.ts';

const EYE_HEIGHT = PLAYER_DIMENSIONS.eyeHeight;
const SURFACE_EYE = 0.34;
const MAX_DIVE_DEPTH = 60;
const MANUAL_BOAT_SPEED = 12;
const VOYAGE_SPEED = MANUAL_BOAT_SPEED * 17;
const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));
const angleDifference = (a: number, b: number): number => Math.atan2(Math.sin(a - b), Math.cos(a - b));
const approach = (value: number, target: number, maximum: number): number => value + clamp(target - value, -maximum, maximum);
const editable = (target: EventTarget | null): boolean => {
  if (!target || !('tagName' in target)) return false;
  const element = target as HTMLElement;
  return /^(INPUT|TEXTAREA|SELECT|BUTTON|A)$/.test(element.tagName) || element.isContentEditable
    || Boolean(element.closest?.('[contenteditable="true"]'));
};
interface MotionInput { x: number; forward: number; vertical: number; running: boolean; }
interface Boarding { from: THREE.Vector3; to: THREE.Vector3; elapsed: number; duration: number; leaving: boolean; }

/** One embodied traveller: movement state follows the local ground, water and vessel. */
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
  private readonly velocity = new THREE.Vector3();
  private padX = 0;
  private padForward = 0;
  private padVertical = 0;
  private targetYaw = 0;
  private targetPitch = -0.035;
  private boatVelocity = 0;
  private jumpRequested = false;
  private autoAscent = false;
  private pointerId: number | null = null;
  private pointerX = 0;
  private pointerY = 0;
  private lastLookTime = -100;
  private lastTime = 0;
  private route: NavigationPoint[] = [];
  private waypoint = 0;
  private boarding: Boarding | null = null;
  private waterHeightSampler: (x: number, z: number) => number = () => 0;
  private disposed = false;

  constructor(canvas: HTMLCanvasElement, ground: GroundSampler, destinations: WorldDestination[], spawn: THREE.Vector3) {
    this.canvas = canvas; this.ground = ground; this.destinations = destinations; this.spawn = spawn.clone();
    this.doc = canvas.ownerDocument;
    const tomari = destinations.find(destination => destination.id === 'tomari');
    // Find an actual mooring close to the beach, with the same corridor clearance as voyages.
    const anchor = findNearbyWater(ground, spawn, ROUTE_MIN_DEPTH + .3, 500, ROUTE_RADIUS);
    this.anchor = new THREE.Vector3(anchor?.x ?? tomari?.x ?? spawn.x, 0, anchor?.z ?? tomari?.z ?? spawn.z);
    this.targetYaw = tomari?.heading ?? 0;
    this.state = { mode: 'walk', position: spawn.clone(), yaw: this.targetYaw, pitch: this.targetPitch,
      speed: 0, oxygen: 1, depth: 0, boatPosition: this.anchor.clone(), boatYaw: tomari?.heading ?? 0,
      voyageTarget: null, voyageRemaining: 0, stamina: 1, grounded: true, immersion: 0,
      gaitPhase: 0, viewOffset: new THREE.Vector3(), velocity: this.velocity, interactionLabel: '',
      boardingProgress: 0, avatarAction: 'idle', boatPitch: 0, boatRoll: 0,
      message: '浜から歩いて海へ。画面をクリックして見回し、WASDで歩く、Spaceでジャンプ。' };
    this.originalTouchAction = canvas.style.touchAction; this.originalTabIndex = canvas.tabIndex;
    canvas.style.touchAction = 'none'; if (canvas.tabIndex < 0) canvas.tabIndex = 0;
    this.bind(canvas, 'pointerdown', this.onPointerDown);
    this.bind(canvas, 'pointermove', this.onPointerMove);
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) this.bind(canvas, type, this.onPointerUp);
    const window = this.doc.defaultView;
    if (window) {
      this.bind(window, 'keydown', this.onKeyDown); this.bind(window, 'keyup', this.onKeyUp);
      this.bind(window, 'blur', this.resetInput);
      this.bind(window, 'pointerup', this.onPointerUp); this.bind(window, 'pointercancel', this.onPointerUp);
    }
    this.bind(this.doc, 'mousemove', this.onLockedMove);
    this.bind(this.doc, 'pointerlockchange', this.onPointerLockChange);
    this.bind(this.doc, 'visibilitychange', this.onVisibilityChange);
    this.updateInteraction();
  }

  private bind(target: EventTarget, type: string, listener: EventListener): void {
    target.addEventListener(type, listener); this.listeners.push([target, type, listener]);
  }
  private onPointerDown: EventListener = event => {
    const pointer = event as PointerEvent;
    if (this.disposed || pointer.button !== 0 || this.pointerId !== null) return;
    this.canvas.focus({ preventScroll: true });
    if (this.doc.pointerLockElement === this.canvas) return;
    this.pointerId = pointer.pointerId; this.pointerX = pointer.clientX; this.pointerY = pointer.clientY;
    try { this.canvas.setPointerCapture(pointer.pointerId); } catch { /* Drag also works without capture. */ }
    if (pointer.pointerType !== 'touch' && typeof this.canvas.requestPointerLock === 'function') {
      try {
        const request = this.canvas.requestPointerLock();
        // Embedded browsers may reject lock; the active drag remains available.
        if (request && typeof request.catch === 'function') void request.catch(() => {});
      } catch { /* Keep drag fallback. */ }
    }
    pointer.preventDefault();
  };
  private look(dx: number, dy: number): void {
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;
    this.targetYaw -= dx * 0.0028;
    this.targetPitch = clamp(this.targetPitch - dy * 0.0028, -1.4, 1.4);
    this.lastLookTime = this.lastTime;
  }
  private onPointerMove: EventListener = event => {
    const pointer = event as PointerEvent;
    if (this.doc.pointerLockElement === this.canvas || pointer.pointerId !== this.pointerId) return;
    this.look(pointer.clientX - this.pointerX, pointer.clientY - this.pointerY);
    this.pointerX = pointer.clientX; this.pointerY = pointer.clientY; pointer.preventDefault();
  };
  private onLockedMove: EventListener = event => {
    if (this.disposed || this.doc.pointerLockElement !== this.canvas) return;
    const pointer = event as MouseEvent; this.look(pointer.movementX, pointer.movementY);
  };
  private onPointerLockChange: EventListener = () => {
    if (this.doc.pointerLockElement === this.canvas) this.releasePointer();
    else this.resetInput(new Event('unlock'));
  };
  private onPointerUp: EventListener = event => {
    if ((event as PointerEvent).pointerId === this.pointerId) this.releasePointer();
  };
  private releasePointer(): void {
    const id = this.pointerId; this.pointerId = null;
    if (id !== null) {
      try { if (this.canvas.hasPointerCapture(id)) this.canvas.releasePointerCapture(id); } catch { /* Already released. */ }
    }
  }
  private onKeyDown: EventListener = event => {
    const key = event as KeyboardEvent;
    if (this.disposed) return;
    if (key.code === 'Escape') {
      this.resetInput(event);
      if (this.doc.pointerLockElement === this.canvas) this.doc.exitPointerLock?.();
      return;
    }
    if (editable(key.target) || key.metaKey || key.altKey || (key.ctrlKey && !key.code.startsWith('Control'))) return;
    if (!/^(Key[WASDCE]|Arrow(Up|Down|Left|Right)|Space|Shift(Left|Right)|Control(Left|Right))$/.test(key.code)) return;
    if (key.code === 'KeyE' && !key.repeat) this.interact();
    if (key.code === 'Space' && !key.repeat && this.state.grounded && this.state.mode === 'walk') this.jumpRequested = true;
    this.keys.add(key.code); key.preventDefault();
  };
  private onKeyUp: EventListener = event => {
    const key = event as KeyboardEvent; if (this.keys.delete(key.code) && !editable(key.target)) key.preventDefault();
  };
  private onVisibilityChange: EventListener = event => { if (this.doc.hidden) this.resetInput(event); };
  private resetInput: EventListener = () => {
    this.keys.clear(); this.padX = 0; this.padForward = 0; this.padVertical = 0;
    this.velocity.set(0, 0, 0); this.boatVelocity = 0; this.jumpRequested = false; this.releasePointer();
    this.state.speed = 0;
  };
  setMove(x: number, forward: number): void {
    this.padX = Number.isFinite(x) ? clamp(x, -1, 1) : 0;
    this.padForward = Number.isFinite(forward) ? clamp(forward, -1, 1) : 0;
  }
  setVertical(direction: number): void {
    const previous = this.padVertical;
    this.padVertical = Number.isFinite(direction) ? clamp(direction, -1, 1) : 0;
    if (previous <= 0 && this.padVertical > 0 && this.state.grounded && this.state.mode === 'walk') this.jumpRequested = true;
  }
  /** Bind to the rendered water's CPU sampler; invalid samples safely use mean sea level. */
  setWaterHeightSampler(sampler: (x: number, z: number) => number): void { this.waterHeightSampler = sampler; }
  private waterAt(x: number, z: number): number {
    const y = this.waterHeightSampler(x, z); return Number.isFinite(y) ? clamp(y, -4, 4) : 0;
  }
  private input(): MotionInput {
    const held = (...codes: string[]): number => codes.some(code => this.keys.has(code)) ? 1 : 0;
    let x = clamp(this.padX + held('KeyD', 'ArrowRight') - held('KeyA', 'ArrowLeft'), -1, 1);
    let forward = clamp(this.padForward + held('KeyW', 'ArrowUp') - held('KeyS', 'ArrowDown'), -1, 1);
    const length = Math.hypot(x, forward); if (length > 1) { x /= length; forward /= length; }
    return { x, forward, vertical: clamp(this.padVertical + held('Space') - held('KeyC', 'ControlLeft', 'ControlRight'), -1, 1),
      running: Boolean(held('ShiftLeft', 'ShiftRight')) };
  }
  private cancelVoyage(message?: string): void {
    this.route = []; this.waypoint = 0; this.state.voyageTarget = null; this.state.voyageRemaining = 0;
    if (message) this.state.message = message;
  }

  /** Legacy API follows physical interactions; mode changes never relocate the traveller. */
  setMode(mode: TravelMode): void {
    if (mode === 'boat' && this.state.mode !== 'boat') this.interact();
    else if (this.state.mode === 'boat' && mode !== 'boat') this.interact();
    else if (mode === 'dive' && groundHeight(this.ground, this.state.position.x, this.state.position.z) < -1.5) this.setVertical(-1);
  }
  private boardingPoint(side = 1, distance = 1.7): THREE.Vector3 {
    const boat = this.state.boatPosition, yaw = this.state.boatYaw;
    return new THREE.Vector3(boat.x + Math.cos(yaw) * distance * side, this.waterAt(boat.x, boat.z) + SURFACE_EYE,
      boat.z + Math.sin(yaw) * distance * side);
  }
  private boatEye(): THREE.Vector3 {
    return new THREE.Vector3(.48, 1.45, .89)
      .applyEuler(new THREE.Euler(this.state.boatPitch ?? 0, -this.state.boatYaw, this.state.boatRoll ?? 0))
      .add(this.state.boatPosition);
  }
  private canBoard(): boolean {
    if (this.boarding || this.state.mode === 'boat' || !isNavigableWater(this.ground, this.state.boatPosition)) return false;
    const p = this.state.position, surface = this.waterAt(p.x, p.z);
    return p.y > surface - 0.7 && p.y < surface + 3 && Math.min(pointDistance(p, this.boardingPoint()),
      pointDistance(p, this.boardingPoint(-1))) < 2.2;
  }
  private clearsBoat(point: NavigationPoint): boolean {
    if (!isNavigableWater(this.ground, this.state.boatPosition)) return true;
    const boat = this.state.boatPosition, yaw = this.state.boatYaw;
    if (this.state.position.y < boat.y - .85 || this.state.position.y - EYE_HEIGHT > boat.y + 1.15) return true;
    const envelope = (p: NavigationPoint): number => {
      const dx = p.x - boat.x, dz = p.z - boat.z;
      const side = Math.cos(yaw) * dx + Math.sin(yaw) * dz;
      const along = -Math.sin(yaw) * dx + Math.cos(yaw) * dz;
      return (side / (1.1 + PLAYER_DIMENSIONS.radius)) ** 2 + (along / (2.8 + PLAYER_DIMENSIONS.radius)) ** 2;
    };
    // Let an explicit diagnostic start inside the hull escape; ordinary swimming meets its sides.
    return envelope(point) >= 1 || envelope(point) > envelope(this.state.position);
  }
  /** E/touch interaction uses the vessel in this world, with a visible climbing interval. */
  interact(): void {
    if (this.disposed || this.boarding) return;
    if (this.state.mode === 'boat') {
      if (this.state.voyageTarget || Math.abs(this.boatVelocity) > 0.9) {
        this.state.message = '船を停めてから、舷側のはしごで下船できます。'; return;
      }
      let target: THREE.Vector3 | null = null;
      for (const side of [1, -1]) {
        const point = this.boardingPoint(side, 2.35);
        const floor = groundHeight(this.ground, point.x, point.z);
        const water = this.waterAt(point.x, point.z);
        if (floor > water + 0.7 || !Number.isFinite(floor)) continue;
        point.y = floor >= water - 1.3 ? floor + EYE_HEIGHT : water + SURFACE_EYE;
        target = point; break;
      }
      if (!target) { this.state.message = '舷側の足元が塞がっています。少し沖へ移動してください。'; return; }
      this.boarding = { from: this.state.position.clone(), to: target, elapsed: 0, duration: 1.35, leaving: true };
      this.state.message = 'はしごを降りて、船のすぐそばの海へ。';
    } else if (this.canBoard()) {
      this.velocity.set(0, 0, 0); this.boatVelocity = 0;
      this.boarding = { from: this.state.position.clone(), to: this.boatEye(),
        elapsed: 0, duration: 1.6, leaving: false };
      this.state.message = '舷側のはしごをつかんで乗船しています。';
    } else this.state.message = '海に浮かぶ船の舷側へ近づいて、Eで乗船できます。';
    this.updateInteraction();
  }
  navigate(destinationId: string): void {
    if (this.disposed) return;
    const destination = this.destinations.find(point => point.id === destinationId);
    if (!destination) { this.state.message = '指定された行き先が見つかりません。'; return; }
    if (this.state.mode !== 'boat' || this.boarding) { this.state.message = '船に乗ってから、地図で行き先を選んでください。'; return; }
    const target = findNearbyWater(this.ground, destination, ROUTE_MIN_DEPTH, 180, ROUTE_RADIUS);
    if (!target) { this.state.message = `${destination.label}付近に安全な到着水域がありません。`; return; }
    const route = planWaterRoute(this.ground, this.state.boatPosition, target);
    if (route.error) { this.cancelVoyage(`${destination.label}への出航を見送りました。${route.error}`); return; }
    if (route.distance < 7) { this.cancelVoyage(`${destination.label}に到着しています。Eで下船できます。`); return; }
    this.route = route.points; this.waypoint = 1; this.boatVelocity = Math.max(0, this.boatVelocity);
    this.state.voyageTarget = destination.id; this.state.voyageRemaining = route.distance;
    this.state.message = `${destination.label}へ出航。沖の長い航海は約17倍の時間圧縮。WASDで手動操船に戻ります。`;
  }
  /** Reset/bookmarks exist for diagnostics; normal play never calls them. */
  home(): void {
    if (this.disposed) return;
    this.resetInput(new Event('reset')); this.cancelVoyage(); this.boarding = null;
    this.state.mode = 'walk'; this.state.position.copy(this.spawn); this.state.boatPosition.copy(this.anchor);
    this.state.boatYaw = this.destinations.find(destination => destination.id === 'tomari')?.heading ?? 0;
    this.targetYaw = this.state.boatYaw; this.targetPitch = -0.035;
    this.state.yaw = this.targetYaw; this.state.pitch = this.targetPitch;
    this.state.depth = 0; this.state.oxygen = 1; this.state.stamina = 1; this.state.boardingProgress = 0;
    this.autoAscent = false; this.state.viewOffset?.set(0, 0, 0); this.updateInteraction();
  }
  recenterLook(): void {
    this.targetPitch = -0.035;
    if (this.state.mode === 'boat') this.targetYaw = this.state.boatYaw;
  }
  /** Named scenic entries are explicit QA/bookmark starting points. */
  viewpoint(x: number, z: number, yaw: number, pitch: number, mode: TravelMode = 'walk', depth = 4): void {
    if (this.disposed || ![x, z, yaw, pitch, depth].every(Number.isFinite)) return;
    this.resetInput(new Event('reset')); this.cancelVoyage(); this.boarding = null; this.autoAscent = false;
    const bottom = groundHeight(this.ground, x, z), water = this.waterAt(x, z);
    this.state.mode = mode; this.state.position.set(x, mode === 'dive' ? Math.max(bottom + .75, water - depth)
      : mode === 'swim' ? water + SURFACE_EYE : bottom + EYE_HEIGHT, z);
    this.targetYaw = yaw; this.state.yaw = yaw; this.targetPitch = clamp(pitch, -1.4, 1.4); this.state.pitch = this.targetPitch;
    this.state.depth = Math.max(0, water - this.state.position.y); this.state.oxygen = 1;
    this.state.grounded = mode === 'walk'; this.state.boardingProgress = 0; this.updateInteraction();
  }

  update(delta: number, time: number, ambientPaused = false): void {
    if (this.disposed || this.doc.hidden || !Number.isFinite(delta) || delta <= 0) return;
    this.lastTime = Number.isFinite(time) ? time : this.lastTime;
    const dt = Math.min(delta, .12), smoothing = 1 - Math.exp(-dt * 20);
    this.state.yaw += angleDifference(this.targetYaw, this.state.yaw) * smoothing;
    this.state.pitch += (this.targetPitch - this.state.pitch) * smoothing;
    const input = this.input();
    if (this.state.voyageTarget && Math.abs(input.x) + Math.abs(input.forward) > .05) {
      this.boatVelocity = Math.min(this.boatVelocity, MANUAL_BOAT_SPEED);
      this.cancelVoyage('手動操船に戻りました。W/Sで加減速、A/Dで舵取り。');
    }
    this.updateBoatFloat(dt);
    const steps = Math.ceil(dt / .02);
    for (let step = 0; step < steps; step++) {
      if (this.boarding) this.updateBoarding(dt / steps);
      else if (this.state.mode === 'boat') this.updateBoat(dt / steps, input.x, input.forward);
      else this.updatePerson(dt / steps, input, ambientPaused ? 0 : dt / steps);
    }
    if (this.state.mode === 'boat' && !this.boarding) this.state.position.copy(this.boatEye());
    this.state.depth = Math.max(0, this.waterAt(this.state.position.x, this.state.position.z) - this.state.position.y);
    this.state.oxygen = clamp(this.state.oxygen, 0, 1);
    this.state.stamina = clamp(this.state.stamina ?? 1, 0, 1);
    this.updateInteraction();
  }
  private updateBoatFloat(dt: number): void {
    const boat = this.state.boatPosition, yaw = this.state.boatYaw;
    const bow = this.waterAt(boat.x + Math.sin(yaw) * 2.4, boat.z - Math.cos(yaw) * 2.4);
    const stern = this.waterAt(boat.x - Math.sin(yaw) * 2.4, boat.z + Math.cos(yaw) * 2.4);
    const port = this.waterAt(boat.x - Math.cos(yaw) * .95, boat.z - Math.sin(yaw) * .95);
    const starboard = this.waterAt(boat.x + Math.cos(yaw) * .95, boat.z + Math.sin(yaw) * .95);
    const smooth = 1 - Math.exp(-dt * 4);
    boat.y += ((bow + stern + port + starboard) / 4 - boat.y) * smooth;
    this.state.boatPitch = (this.state.boatPitch ?? 0) + (clamp(Math.atan2(bow - stern, 4.8), -.24, .24) - (this.state.boatPitch ?? 0)) * smooth;
    this.state.boatRoll = (this.state.boatRoll ?? 0) + (clamp(Math.atan2(starboard - port, 1.9), -.28, .28) - (this.state.boatRoll ?? 0)) * smooth;
  }
  private updateBoarding(dt: number): void {
    const motion = this.boarding!; motion.elapsed += dt;
    const progress = clamp(motion.elapsed / motion.duration, 0, 1), t = progress * progress * (3 - 2 * progress);
    const before = this.state.position.clone();
    if (!motion.leaving) motion.to.copy(this.boatEye());
    this.state.position.lerpVectors(motion.from, motion.to, t);
    this.state.position.y += Math.sin(progress * Math.PI) * .27;
    this.velocity.copy(this.state.position).sub(before).divideScalar(dt);
    this.state.boardingProgress = progress; this.state.avatarAction = 'climb'; this.state.grounded = false;
    this.state.speed = this.velocity.length();
    if (progress >= 1) {
      this.boarding = null; this.velocity.set(0, 0, 0); this.state.speed = 0; this.state.boardingProgress = 0;
      const floor = groundHeight(this.ground, motion.to.x, motion.to.z), water = this.waterAt(motion.to.x, motion.to.z);
      this.state.mode = motion.leaving ? floor >= water - 1.3 ? 'walk' : 'swim' : 'boat';
      this.state.message = motion.leaving ? '船のすぐそばへ下りました。泳いで浜へ進めます。'
        : '乗船しました。W/Sで加減速、A/Dで舵取り。地図から島へ出航できます。';
      this.state.avatarAction = motion.leaving ? 'swim' : 'helm'; this.targetYaw = this.state.boatYaw;
    }
  }
  private updateInteraction(): void {
    this.state.interactionLabel = this.boarding ? 'はしごを移動中' : this.state.mode === 'boat'
      ? this.state.voyageTarget || Math.abs(this.boatVelocity) > .9 ? '' : '船から降りる' : this.canBoard() ? '船に乗る' : '';
  }
  private updateBoat(dt: number, steer: number, throttle: number): void {
    const boat = this.state.boatPosition;
    if (this.state.voyageTarget && this.waypoint < this.route.length) {
      const target = this.route[this.waypoint], distance = pointDistance(boat, target);
      if (distance < .3) {
        boat.x = target.x; boat.z = target.z;
        this.state.voyageRemaining = Math.max(0, this.state.voyageRemaining - distance); this.waypoint++;
        if (this.waypoint >= this.route.length) this.finishVoyage(); return;
      }
      const heading = Math.atan2(target.x - boat.x, -(target.z - boat.z));
      this.state.boatYaw += angleDifference(heading, this.state.boatYaw) * Math.min(1, dt * 4);
      if (this.lastTime - this.lastLookTime > 3) this.targetYaw += angleDifference(heading, this.targetYaw) * Math.min(1, dt * 3);
      // Shore passages remain physical steering speed; compression rises gradually offshore.
      const shoreSpeed = (this.waypoint === 1 && pointDistance(boat, this.route[0]) < 55)
        || (this.waypoint === this.route.length - 1 && distance < 70) ? MANUAL_BOAT_SPEED : VOYAGE_SPEED;
      this.boatVelocity = approach(this.boatVelocity, shoreSpeed, dt * (shoreSpeed > this.boatVelocity ? 38 : 65));
      const travel = Math.min(distance, this.boatVelocity * dt);
      const next = { x: boat.x + (target.x - boat.x) / distance * travel, z: boat.z + (target.z - boat.z) / distance * travel };
      if (!waterSegmentClear(this.ground, boat, next)) {
        this.boatVelocity = 0; this.cancelVoyage('航路の浅瀬を検出して停船しました。沖へ向けて手動操船してください。');
      } else {
        boat.x = next.x; boat.z = next.z; this.state.voyageRemaining = Math.max(0, this.state.voyageRemaining - travel);
        if (travel >= distance - .01) this.waypoint++;
        if (this.waypoint >= this.route.length) this.finishVoyage();
      }
    } else {
      const oldYaw = this.state.boatYaw;
      this.state.boatYaw += steer * dt * .82 * (.18 + Math.min(1, Math.abs(this.boatVelocity) / MANUAL_BOAT_SPEED) * .82);
      this.targetYaw += this.state.boatYaw - oldYaw;
      this.boatVelocity += throttle * dt * 4.2;
      this.boatVelocity *= Math.exp(-dt * (Math.abs(throttle) > .05 ? .11 : .55));
      this.boatVelocity = clamp(this.boatVelocity, -3.2, MANUAL_BOAT_SPEED);
      if (Math.abs(this.boatVelocity) < .02) this.boatVelocity = 0;
      const next = clampWorld({ x: boat.x + Math.sin(this.state.boatYaw) * this.boatVelocity * dt,
        z: boat.z - Math.cos(this.state.boatYaw) * this.boatVelocity * dt });
      if (waterSegmentClear(this.ground, boat, next)) { boat.x = next.x; boat.z = next.z; }
      else { this.boatVelocity = 0; this.state.message = '浅瀬で停船しました。W/SとA/Dで沖側へ向きを変えてください。'; }
    }
    this.state.speed = Math.abs(this.boatVelocity); this.state.avatarAction = 'helm'; this.state.grounded = true;
    this.state.immersion = 0; this.state.viewOffset?.set(0, 0, 0);
    this.velocity.set(Math.sin(this.state.boatYaw) * this.boatVelocity, 0, -Math.cos(this.state.boatYaw) * this.boatVelocity);
    this.state.oxygen = Math.min(1, this.state.oxygen + dt * .08);
  }
  private finishVoyage(): void {
    const label = this.destinations.find(destination => destination.id === this.state.voyageTarget)?.label ?? '目的地';
    this.boatVelocity = 0; this.state.speed = 0;
    this.cancelVoyage(`${label}の海岸付近へ到着しました。Eで船のそばへ下り、泳いで浜へ進めます。`);
  }
  private updatePerson(dt: number, input: MotionInput, resourceDelta: number): void {
    const p = this.state.position, water = this.waterAt(p.x, p.z);
    const floorBefore = groundHeight(this.ground, p.x, p.z);
    const previous = this.state.mode;
    const swimming = floorBefore < water - 1.3 && p.y < water + .64;
    const immersion = clamp((water - (p.y - EYE_HEIGHT)) / EYE_HEIGHT, 0, 1);
    const running = input.running && (this.state.stamina ?? 1) > .12 && Math.hypot(input.x, input.forward) > .05;
    const speed = swimming ? running ? 3.2 : 2.1 : (running ? 4.7 : 1.85) * (1 - immersion * .46);
    const pitchedForward = input.forward * (swimming ? Math.cos(this.state.pitch) : 1);
    const targetX = (Math.cos(this.state.yaw) * input.x + Math.sin(this.state.yaw) * pitchedForward) * speed;
    const targetZ = (Math.sin(this.state.yaw) * input.x - Math.cos(this.state.yaw) * pitchedForward) * speed;
    const acceleration = swimming ? 3.2 : this.state.grounded ? 9 : 2;
    this.velocity.x = approach(this.velocity.x, targetX, acceleration * dt);
    this.velocity.z = approach(this.velocity.z, targetZ, acceleration * dt);
    const next = clampWorld({ x: p.x + this.velocity.x * dt, z: p.z + this.velocity.z * dt });
    const canMove = (point: NavigationPoint): boolean => {
      if (!this.clearsBoat(point)) return false;
      const footY=p.y-EYE_HEIGHT;
      if(this.ground.bodySegmentBlocked?.({x:p.x,y:footY,z:p.z},{x:point.x,y:footY,z:point.z},PLAYER_DIMENSIONS.radius,PLAYER_DIMENSIONS.height))return false;
      const floor = groundHeight(this.ground, point.x, point.z);
      if (swimming) return Number.isFinite(floor) && floor + .55 < p.y;
      return [[0, 0], [PLAYER_DIMENSIONS.radius, 0], [-PLAYER_DIMENSIONS.radius, 0], [0, PLAYER_DIMENSIONS.radius], [0, -PLAYER_DIMENSIONS.radius]]
        .every(([dx, dz]) => footSegmentClear(this.ground, { x: p.x + dx, z: p.z + dz }, { x: point.x + dx, z: point.z + dz }));
    };
    if (canMove(next)) { p.x = next.x; p.z = next.z; }
    else {
      if (canMove({ x: next.x, z: p.z })) p.x = next.x; else this.velocity.x = 0;
      if (canMove({ x: p.x, z: next.z })) p.z = next.z; else this.velocity.z = 0;
    }
    const floor = groundHeight(this.ground, p.x, p.z), surface = this.waterAt(p.x, p.z);
    const inDeepWater = floor < surface - 1.3 && p.y < surface + .64;
    if (inDeepWater) {
      this.jumpRequested = false; this.state.grounded = false;
      if (this.state.oxygen <= .18) this.autoAscent = true;
      const directionalY = input.forward * Math.sin(this.state.pitch) * speed;
      let targetY: number;
      if (this.autoAscent) targetY = 1.8;
      else if (Math.abs(input.vertical) > .05 || Math.abs(directionalY) > .25) targetY = input.vertical * 1.85 + directionalY;
      else if (p.y >= surface - .4) targetY = (surface + SURFACE_EYE - p.y) * 3;
      else targetY = .08; // Slight positive buoyancy; neutral swimming never drops a frame-sized metre.
      this.velocity.y = approach(this.velocity.y, targetY, 4.8 * dt);
      p.y += this.velocity.y * dt;
      const minimum = Math.max(surface - MAX_DIVE_DEPTH, floor + .75), maximum = surface + SURFACE_EYE;
      if (p.y < minimum) { p.y = minimum; this.velocity.y = Math.max(0, this.velocity.y); }
      if (p.y > maximum) { p.y = maximum; this.velocity.y = Math.min(0, this.velocity.y); }
      this.state.mode = p.y < surface - .28 ? 'dive' : 'swim';
      if (p.y < surface - .28) {
        this.state.oxygen -= resourceDelta * (this.autoAscent ? .001 : .006 + Math.max(0, surface - p.y) * .00007);
        if (this.autoAscent) this.state.message = '空気が少なくなったため、ゆっくり自動浮上しています。';
      } else {
        this.state.oxygen = Math.min(1, this.state.oxygen + resourceDelta * .085);
        if (this.autoAscent && p.y >= surface + .2) this.autoAscent = false;
      }
    } else {
      this.state.mode = 'walk';
      const standingY = floor + EYE_HEIGHT;
      if (this.jumpRequested && this.state.grounded) { this.velocity.y = 4.7; this.state.grounded = false; }
      this.jumpRequested = false;
      this.velocity.y -= 9.81 * dt; p.y += this.velocity.y * dt;
      if (p.y <= standingY) { p.y = standingY; this.velocity.y = 0; this.state.grounded = true; }
      else this.state.grounded = false;
      this.state.oxygen = Math.min(1, this.state.oxygen + resourceDelta * .085); this.autoAscent = false;
    }
    if (previous !== this.state.mode) this.state.message = this.state.mode === 'walk' ? '足が浜に着きました。歩いて海岸を探検できます。'
      : this.state.mode === 'dive' ? '水中へ。見ている方向へ泳ぎ、Spaceで浮上、Cで潜降。'
      : '海に浮かんでいます。WASDで泳ぎ、Cでゆっくり潜れます。';
    this.state.immersion = clamp((surface - (p.y - EYE_HEIGHT)) / EYE_HEIGHT, 0, 1);
    this.state.speed = Math.hypot(this.velocity.x, this.velocity.z);
    this.state.stamina = (this.state.stamina ?? 1) + resourceDelta * (running ? -.08 : .055);
    const walking = this.state.mode === 'walk' && this.state.grounded && this.state.speed > .12;
    if (walking) this.state.gaitPhase = (this.state.gaitPhase ?? 0) + this.state.speed * dt * 3.8;
    const gait = this.state.gaitPhase ?? 0;
    const bob = walking ? (running ? .025 : .016) * Math.min(1, this.state.speed) : 0;
    const offset = this.state.viewOffset!;
    const ease = 1 - Math.exp(-dt * 9);
    offset.x += (Math.sin(gait) * bob * .4 - offset.x) * ease;
    offset.y += (Math.cos(gait * 2) * bob - offset.y) * ease;
    offset.z = 0;
    this.state.avatarAction = this.state.mode === 'dive' ? 'dive' : this.state.mode === 'swim' ? 'swim'
      : walking ? running ? 'run' : 'walk' : 'idle';
  }
  dispose(): void {
    if (this.disposed) return;
    this.resetInput(new Event('reset'));
    if (this.doc.pointerLockElement === this.canvas) this.doc.exitPointerLock?.();
    this.disposed = true;
    for (const [target, type, listener] of this.listeners) target.removeEventListener(type, listener);
    this.listeners.length = 0; this.canvas.style.touchAction = this.originalTouchAction; this.canvas.tabIndex = this.originalTabIndex;
  }
}
