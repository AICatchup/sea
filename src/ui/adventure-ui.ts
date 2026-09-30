import './adventure.css';
import type { AdventureCallbacks, AdventureState, MapOutline, PlaceableKind, TravelMode, WorldDestination } from '../world/contracts';

const icons = {
  walk: '<path d="m10 5 3 1 2 5 4 2m-9-7-3 6-4 2m7-3-1 5-4 5m5-5 4 2 2 4"/><circle cx="12" cy="3" r="1.4"/>',
  swim: '<path d="m4 10 6-5 5 5m-5-5 4-2m-9 13c2-3 4 3 7 0s5 3 7 0M3 20c2-3 4 3 7 0s5 3 7 0"/><circle cx="18" cy="8" r="2"/>',
  dive: '<path d="m4 13 7-3 6 4 4-1M9 11 5 7m9 5-3 6-5 1m5-1 4 3"/><circle cx="19" cy="8" r="2"/><circle cx="20" cy="3" r=".6"/>',
  boat: '<path d="m3 13 3 6h12l3-6H3Zm3 0 2-5h8l2 5M12 8V4M3 22c2-3 4 3 7 0s5 3 7 0"/>',
  map: '<path d="m3 5 6-2 6 2 6-2v16l-6 2-6-2-6 2V5Zm6-2v16m6-14v16"/>',
  place: '<path d="M12 5v14M5 12h14"/>',
  home: '<path d="m4 11 8-7 8 7M6 10v10h12V10m-9 10v-6h6v6"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  undo: '<path d="m8 5-5 5 5 5M3 10h11a6 6 0 0 1 0 12"/>',
  chair: '<path d="M7 3v11h12M7 10H4v10m3-6-2 7m11-7 2 7M8 6h8v8"/>',
  umbrella: '<path d="M3 11a9 9 0 0 1 18 0H3Zm9-9v17a3 3 0 0 0 6 0M12 3c-4 3-4 5-4 8m4-8c4 3 4 5 4 8"/>',
  buoy: '<circle cx="12" cy="11" r="6"/><path d="M12 5V2M6 11h12M3 20c2-3 4 3 7 0s5 3 7 0"/>',
  tank: '<rect x="7" y="5" width="10" height="16" rx="4"/><path d="M10 5V2h4v3M7 10h10M7 17h10m10-7h2v8"/>',
  rock: '<path d="m3 17 4-8 7-5 5 5 2 9-8 3-10-4Zm4-8 6 5 6-5m-6 5v7"/>',
  pine: '<path d="m12 2-6 8h3l-6 8h18l-6-8h3l-6-8Zm0 16v4"/>',
  up: '<path d="m6 14 6-6 6 6"/>',
  down: '<path d="m6 10 6 6 6-6"/>',
  left: '<path d="m14 6-6 6 6 6"/>',
  right: '<path d="m10 6 6 6-6 6"/>',
};

function icon(name: keyof typeof icons): string {
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${icons[name]}</svg>`;
}

function text(element: HTMLElement, value: string): void {
  if (element.textContent !== value) element.textContent = value;
}

interface HeldControl { x: number; forward: number; vertical: number; }

/** Small scene controls. World input and camera input stay with the world controller. */
export class AdventureUI {
  private readonly root = document.createElement('section');
  private readonly abort = new AbortController();
  private readonly visibilityObserver: MutationObserver;
  private readonly interaction: HTMLButtonElement;
  private readonly staminaMeter: HTMLMeterElement;
  private readonly destinationButtons = new Map<string, HTMLButtonElement>();
  private readonly placePanel: HTMLElement;
  private readonly voyagePanel: HTMLElement;
  private readonly placeToggle: HTMLButtonElement;
  private readonly voyageToggle: HTMLButtonElement;
  private readonly undo: HTMLButtonElement;
  private readonly count: HTMLElement;
  private readonly diveHud: HTMLElement;
  private readonly depth: HTMLElement;
  private readonly air: HTMLElement;
  private readonly airMeter: HTMLMeterElement;
  private readonly verticalControls: HTMLElement;
  private readonly journey: HTMLElement;
  private readonly journeyLabel: HTMLElement;
  private readonly journeyPercent: HTMLElement;
  private readonly journeyProgress: HTMLProgressElement;
  private readonly message: HTMLElement;
  private readonly map: HTMLCanvasElement;
  private readonly locationName:HTMLElement;
  private readonly locationIsland:HTMLElement;
  private readonly held = new Map<string, HeldControl>();
  private readonly destinationById: Map<string, WorldDestination>;
  private readonly mapBounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  private lastUpdate = -Infinity;
  private lastMapUpdate = -Infinity;
  private mode: TravelMode | null = null;
  private placedCount = -1;
  private target: string | null = null;
  private voyageStartDistance = 1;
  private lastMessage = '';
  private messageTimer = 0;
  private disposed = false;

  constructor(
    private readonly callbacks: AdventureCallbacks,
    destinations: WorldDestination[],
    private readonly mapOutlines: MapOutline[],
  ) {
    this.destinationById = new Map(destinations.map(destination => [destination.id, destination]));
    const points = [[0, 0], ...mapOutlines.flatMap(outline => outline.points), ...destinations.map(destination => [destination.x, destination.z])];
    this.mapBounds = {
      minX: Math.min(...points.map(point => point[0])), maxX: Math.max(...points.map(point => point[0])),
      minZ: Math.min(...points.map(point => point[1])), maxZ: Math.max(...points.map(point => point[1])),
    };
    this.root.className = 'adventure-ui';
    this.root.setAttribute('aria-label', '泊海水浴場での過ごし方');
    this.root.innerHTML = `
      <div class="adventure-heading">
        <div class="adventure-location"><span>式根島</span><h1>泊海水浴場</h1></div>
        <div class="adventure-actions">
          <button type="button" data-action="place" aria-expanded="false" aria-controls="adventure-place-panel">${icon('place')}<span>ものを置く</span></button>
          <button type="button" data-action="voyage" aria-expanded="false" aria-controls="adventure-voyage-panel">${icon('map')}<span>地図</span></button>

        </div>
      </div>
      <section id="adventure-place-panel" class="adventure-popover adventure-place-panel" role="dialog" aria-labelledby="adventure-place-title" hidden>
        <div class="adventure-panel-heading"><h2 id="adventure-place-title">浜に、海に。</h2><button type="button" data-close="place" aria-label="配置の一覧を閉じる">${icon('close')}</button></div>
        <p class="adventure-panel-note">目の前に、ひとつ置きます。</p>
        <div class="adventure-place-grid" role="group" aria-label="置くもの"></div>
        <div class="adventure-placement-footer"><span data-count>0 個</span><button type="button" data-action="undo" disabled>${icon('undo')}<span>ひとつ戻す</span></button></div>
      </section>
      <section id="adventure-voyage-panel" class="adventure-popover adventure-voyage-panel" role="dialog" aria-labelledby="adventure-voyage-title" hidden>
        <div class="adventure-panel-heading"><h2 id="adventure-voyage-title">次は、どの島へ。</h2><button type="button" data-close="voyage" aria-label="島の地図を閉じる">${icon('close')}</button></div>
        <canvas class="adventure-map" role="img" aria-label="島の輪郭、目的地、現在地を示す地図"></canvas>
        <div class="adventure-map-key"><span><i></i>現在地</span><span><i></i>目的地</span></div>
        <div class="adventure-destinations" role="group" aria-label="船の行き先"></div>
        <p class="adventure-map-note">船に乗ったら、行き先を選んで出航。沖の長い航海は約17倍の時間圧縮。</p>
        <a class="adventure-reference" href="https://www.google.com/maps/search/?api=1&query=34.3359808,139.2117451" target="_blank" rel="noopener noreferrer">実際の泊海水浴場を地図で見る <span aria-hidden="true">↗</span></a>
        <a class="adventure-reference" href="https://maps.gsi.go.jp/development/demtile.html" target="_blank" rel="noopener noreferrer">地形：国土地理院の標高タイルを加工して作成</a>
      </section>
      <div class="adventure-reticle" aria-hidden="true"></div>
      <button type="button" class="adventure-interaction" hidden><kbd>E</kbd><span></span></button>
      <div class="adventure-stamina"><span>体力</span><meter data-stamina min="0" max="1" value="1" aria-label="体力"></meter></div>
      <div class="adventure-dive-hud" hidden><div><span>深さ</span><strong data-depth>0.0 m</strong></div><div><span>空気</span><strong data-air>100%</strong><meter min="0" max="100" low="25" high="45" optimum="100" value="100" aria-label="空気の残り"></meter></div></div>
      <div class="adventure-journey" hidden><div><span class="adventure-journey-label">船で移動中</span><span data-percent>0%</span></div><progress max="1" value="0" aria-label="島への移動"></progress></div>
      <div class="adventure-message" role="status" aria-live="polite" hidden></div>
      <div class="adventure-touch-pad" role="group" aria-label="移動"><span class="adventure-touch-label">移動</span><button type="button" data-direction="forward" aria-label="前へ進む">${icon('up')}</button><button type="button" data-direction="left" aria-label="左へ進む">${icon('left')}</button><button type="button" data-direction="back" aria-label="後ろへ進む">${icon('down')}</button><button type="button" data-direction="right" aria-label="右へ進む">${icon('right')}</button></div>
      <div class="adventure-touch-vertical" role="group" aria-label="水中で上下へ移動" hidden><button type="button" data-direction="up" aria-label="水面へ上がる">${icon('up')}<span>上へ</span></button><button type="button" data-direction="down" aria-label="深く潜る">${icon('down')}<span>下へ</span></button></div>`;
    const find = <T extends HTMLElement>(selector: string): T => this.root.querySelector<T>(selector)!;
    this.locationName=find('.adventure-location h1');this.locationIsland=find('.adventure-location span');
    this.interaction = find('.adventure-interaction');
    this.staminaMeter = find('[data-stamina]');
    this.interaction.addEventListener('click', () => this.callbacks.interact?.(), { signal: this.abort.signal });
    this.placePanel = find('#adventure-place-panel');
    this.voyagePanel = find('#adventure-voyage-panel');
    this.placeToggle = find('[data-action="place"]');
    this.voyageToggle = find('[data-action="voyage"]');
    this.undo = find('[data-action="undo"]');
    this.count = find('[data-count]');
    this.diveHud = find('.adventure-dive-hud');
    this.depth = find('[data-depth]');
    this.air = find('[data-air]');
    this.airMeter = find('.adventure-dive-hud meter');
    this.verticalControls = find('.adventure-touch-vertical');
    this.journey = find('.adventure-journey');
    this.journeyLabel = find('.adventure-journey-label');
    this.journeyPercent = find('[data-percent]');
    this.journeyProgress = find('progress');
    this.message = find('.adventure-message');
    this.map = find<HTMLCanvasElement>('.adventure-map');
    const events = { signal: this.abort.signal };
    this.placeToggle.addEventListener('click', () => this.togglePanel('place'), events);
    this.voyageToggle.addEventListener('click', () => this.togglePanel('voyage'), events);
    this.undo.addEventListener('click', () => this.callbacks.undo(), events);
    this.root.querySelectorAll<HTMLButtonElement>('[data-close]').forEach(button => {
      button.addEventListener('click', () => this.closePanels(true), events);
    });
    const items: [PlaceableKind, string][] = [['chair', '椅子'], ['umbrella', 'パラソル'], ['buoy', '浮き'], ['tank', 'タンク'], ['rock', '岩'], ['pine', '松']];
    const grid = find('.adventure-place-grid');
    items.forEach(([kind, label]) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.place = kind;
      button.innerHTML = `${icon(kind)}<span>${label}</span>`;
      button.addEventListener('click', () => this.callbacks.place(kind), events);
      grid.append(button);
    });
    const destinationList = find('.adventure-destinations');
    destinations.forEach(destination => {
      const button = document.createElement('button');
      button.type = 'button';
      button.setAttribute('aria-pressed', 'false');
      const name = document.createElement('span');
      name.textContent = destination.label;
      const island = document.createElement('small');
      island.textContent = destination.island;
      const arrow = document.createElement('span');
      arrow.className = 'adventure-destination-arrow';
      arrow.textContent = '→';
      arrow.setAttribute('aria-hidden', 'true');
      button.append(name, island, arrow);
      button.addEventListener('click', () => {
        this.closePanels(false);
        this.clearHeld();
        this.callbacks.navigate(destination.id);
      }, events);
      destinationList.append(button);
      this.destinationButtons.set(destination.id, button);
    });
    if (!destinations.length) text(destinationList, '行き先を準備しています。');
    const directions: Record<string, HeldControl> = {
      forward: { x: 0, forward: 1, vertical: 0 }, back: { x: 0, forward: -1, vertical: 0 },
      left: { x: -1, forward: 0, vertical: 0 }, right: { x: 1, forward: 0, vertical: 0 },
      up: { x: 0, forward: 0, vertical: 1 }, down: { x: 0, forward: 0, vertical: -1 },
    };
    this.root.querySelectorAll<HTMLButtonElement>('[data-direction]').forEach(button => {
      const control = directions[button.dataset.direction!];
      button.addEventListener('pointerdown', event => {
        if (event.button !== 0) return;
        event.preventDefault();
        button.setPointerCapture(event.pointerId);
        this.held.set(`pointer-${event.pointerId}`, control);
        button.classList.add('is-held');
        this.sendHeld();
      }, events);
      const release = (event: PointerEvent) => {
        this.held.delete(`pointer-${event.pointerId}`);
        button.classList.remove('is-held');
        this.sendHeld();
      };
      button.addEventListener('pointerup', release, events);
      button.addEventListener('pointercancel', release, events);
      button.addEventListener('lostpointercapture', release, events);
      button.addEventListener('keydown', event => {
        if (event.code !== 'Space' && event.key !== 'Enter') return;
        event.preventDefault();
        this.held.set(`key-${button.dataset.direction}`, control);
        button.classList.add('is-held');
        this.sendHeld();
      }, events);
      const releaseKey = () => {
        this.held.delete(`key-${button.dataset.direction}`);
        button.classList.remove('is-held');
        this.sendHeld();
      };
      button.addEventListener('keyup', event => {
        if (event.code === 'Space' || event.key === 'Enter') releaseKey();
      }, events);
      button.addEventListener('blur', releaseKey, events);
    });
    this.root.addEventListener('pointerdown', event => event.stopPropagation(), events);
    this.root.addEventListener('keydown', event => {
      if (event.key === 'Escape' && (!this.placePanel.hidden || !this.voyagePanel.hidden)) {
        event.preventDefault();
        this.closePanels(true);
      }
      if (event.key !== 'Tab' && event.key.toLowerCase() !== 'h') event.stopPropagation();
    }, events);
    document.addEventListener('pointerdown', event => {
      if (!this.root.contains(event.target as Node)) this.closePanels(false);
    }, events);
    window.addEventListener('blur', () => this.clearHeld(), events);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.clearHeld();
    }, events);
    document.body.append(this.root);
    document.body.classList.add('adventure-ready');
    const syncVisibility = () => {
      const unavailable = document.getElementById('unsupported')?.hidden === false;
      this.root.inert = document.body.classList.contains('immersed') || unavailable;
      this.root.classList.toggle('is-unavailable', unavailable);
      if (this.root.inert) { this.clearHeld(); this.closePanels(false); }
    };
    this.visibilityObserver = new MutationObserver(syncVisibility);
    this.visibilityObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    const unsupported = document.getElementById('unsupported');
    if (unsupported) this.visibilityObserver.observe(unsupported, { attributes: true, attributeFilter: ['hidden'] });
    syncVisibility();
  }

  update(state: AdventureState, placedCount: number): void {
    if (this.disposed) return;
    const now = performance.now();
    if (now - this.lastUpdate < 200 && this.mode === state.mode && this.target === state.voyageTarget && this.placedCount === placedCount && this.lastMessage === state.message) return;
    this.lastUpdate = now;
    let nearest:WorldDestination|undefined,distance=Infinity;
    for(const destination of this.destinationById.values()){
      const candidate=Math.hypot(state.position.x-destination.x,state.position.z-destination.z);
      if(candidate<distance){distance=candidate;nearest=destination;}
    }
    text(this.locationIsland,distance<650?nearest?.island??'伊豆諸島':'伊豆諸島');
    text(this.locationName,distance<650?nearest?.label??'海の旅':'島のあいだ');
    if (this.mode !== state.mode) {
      this.mode = state.mode;
      this.root.dataset.mode = state.mode;
      this.diveHud.hidden = state.mode !== 'dive' && state.mode !== 'swim';
      this.verticalControls.hidden = state.mode !== 'dive' && state.mode !== 'swim';
    }
    if (this.placedCount !== placedCount) {
      this.placedCount = placedCount;
      text(this.count, `${placedCount} 個`);
      this.undo.disabled = placedCount <= 0;
    }
    const label = state.interactionLabel ?? '';
    this.interaction.hidden = !label;
    this.interaction.disabled = state.avatarAction === 'climb';
    text(this.interaction.querySelector('span')!, label);
    this.staminaMeter.value = state.stamina ?? 1;
    this.destinationButtons.forEach(button => { button.disabled = state.mode !== 'boat' || state.avatarAction === 'climb'; });
    if (state.mode === 'dive' || state.mode === 'swim') {
      text(this.depth, `${Math.max(0, state.depth).toFixed(1)} m`);
      const air = Math.round(Math.max(0, Math.min(1, state.oxygen)) * 100);
      text(this.air, `${air}%`);
      if (this.airMeter.value !== air) this.airMeter.value = air;
      this.diveHud.classList.toggle('is-low-air', air < 25);
    }
    if (this.target !== state.voyageTarget) {
      this.target = state.voyageTarget;
      this.voyageStartDistance = Math.max(1, state.voyageRemaining);
      this.journey.hidden = this.target === null;
      this.destinationButtons.forEach((button, id) => button.setAttribute('aria-pressed', String(id === this.target)));
    }
    if (this.target !== null) {
      const destination = this.destinationById.get(this.target);
      const progress = Math.round(Math.max(0, Math.min(1, 1 - state.voyageRemaining / this.voyageStartDistance)) * 100);
      text(this.journeyLabel, `${destination?.label ?? '島'}へ`);
      text(this.journeyPercent, `${progress}%`);
      if (this.journeyProgress.value !== progress / 100) this.journeyProgress.value = progress / 100;
    }
    if (this.lastMessage !== state.message) {
      this.lastMessage = state.message;
      clearTimeout(this.messageTimer);
      text(this.message, state.message);
      this.message.hidden = !state.message;
      if (state.message) this.messageTimer = window.setTimeout(() => { this.message.hidden = true; }, 4500);
    }
    if (!this.voyagePanel.hidden && !this.root.inert && now - this.lastMapUpdate >= 200) {
      this.drawMap(state);
      this.lastMapUpdate = now;
    }
  }

  private togglePanel(panel: 'place' | 'voyage'): void {
    const target = panel === 'place' ? this.placePanel : this.voyagePanel;
    const show = target.hidden;
    this.closePanels(false);
    if (!show) return;
    this.clearHeld();
    target.hidden = false;
    (panel === 'place' ? this.placeToggle : this.voyageToggle).setAttribute('aria-expanded', 'true');
    this.root.classList.add('has-panel');
    target.querySelector<HTMLButtonElement>('[data-place], .adventure-destinations button')?.focus({ preventScroll: true });
    this.lastUpdate = -Infinity;
    this.lastMapUpdate = -Infinity;
  }

  private closePanels(returnFocus: boolean): void {
    const opener = !this.placePanel.hidden ? this.placeToggle : !this.voyagePanel.hidden ? this.voyageToggle : null;
    this.placePanel.hidden = true;
    this.voyagePanel.hidden = true;
    this.placeToggle.setAttribute('aria-expanded', 'false');
    this.voyageToggle.setAttribute('aria-expanded', 'false');
    this.root.classList.remove('has-panel');
    if (returnFocus) opener?.focus({ preventScroll: true });
  }

  private sendHeld(): void {
    let x = 0, forward = 0, vertical = 0;
    this.held.forEach(control => { x += control.x; forward += control.forward; vertical += control.vertical; });
    const length = Math.max(1, Math.hypot(x, forward));
    this.callbacks.move(x / length, forward / length);
    this.callbacks.vertical(Math.max(-1, Math.min(1, vertical)));
  }

  private clearHeld(): void {
    if (!this.held.size) return;
    this.held.clear();
    this.root.querySelectorAll('.is-held').forEach(button => button.classList.remove('is-held'));
    this.sendHeld();
  }

  private drawMap(state: AdventureState): void {
    const context = this.map.getContext('2d');
    if (!context) return;
    const width = this.map.clientWidth || 320;
    const height = this.map.clientHeight || 196;
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    if (this.map.width !== Math.round(width * ratio) || this.map.height !== Math.round(height * ratio)) {
      this.map.width = Math.round(width * ratio);
      this.map.height = Math.round(height * ratio);
    }
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);
    const position = state.mode === 'boat' ? state.boatPosition : state.position;
    const minX = Math.min(this.mapBounds.minX, position.x), maxX = Math.max(this.mapBounds.maxX, position.x);
    const minZ = Math.min(this.mapBounds.minZ, position.z), maxZ = Math.max(this.mapBounds.maxZ, position.z);
    const scale = Math.min((width - 52) / Math.max(100, maxX - minX), (height - 42) / Math.max(100, maxZ - minZ));
    const project = (x: number, z: number): [number, number] => [width / 2 + (x - (minX + maxX) / 2) * scale, height / 2 + (z - (minZ + maxZ) / 2) * scale];
    context.lineWidth = 1;
    context.strokeStyle = 'rgba(204,235,230,.09)';
    for (let x = 20; x < width; x += 40) { context.beginPath(); context.moveTo(x, 0); context.lineTo(x, height); context.stroke(); }
    for (let y = 20; y < height; y += 40) { context.beginPath(); context.moveTo(0, y); context.lineTo(width, y); context.stroke(); }
    context.fillStyle = 'rgba(158,185,156,.55)';
    context.strokeStyle = 'rgba(218,228,185,.6)';
    this.mapOutlines.forEach(outline => {
      if (!outline.points.length) return;
      context.beginPath();
      outline.points.forEach(([x, z], index) => { const point = project(x, z); if (!index) context.moveTo(...point); else context.lineTo(...point); });
      context.closePath(); context.fill(); context.stroke();
    });
    const target = this.target ? this.destinationById.get(this.target) : undefined;
    if (target) {
      context.strokeStyle = 'rgba(239,214,158,.7)';
      context.setLineDash([3, 5]);
      context.beginPath(); context.moveTo(...project(position.x, position.z)); context.lineTo(...project(target.x, target.z)); context.stroke();
      context.setLineDash([]);
    }
    context.font = '10px "Noto Sans JP", sans-serif';
    context.textBaseline = 'middle';
    this.destinationById.forEach(destination => {
      const [x, y] = project(destination.x, destination.z);
      const selected = destination.id === this.target;
      context.fillStyle = selected ? '#f3d89c' : '#bcd6c7';
      context.beginPath(); context.arc(x, y, selected ? 4 : 3, 0, Math.PI * 2); context.fill();
      const label = destination.island;
      const labelWidth = context.measureText(label).width;
      const labelX = x + 9 + labelWidth > width - 8 ? x - labelWidth - 9 : x + 9;
      context.fillStyle = 'rgba(3,24,33,.82)';
      context.fillRect(labelX - 3, y - 8, labelWidth + 6, 16);
      context.fillStyle = selected ? '#f3d89c' : '#e0e9da';
      context.fillText(label, labelX, y);
    });
    const [x, y] = project(position.x, position.z);
    context.fillStyle = 'rgba(155,238,238,.2)';
    context.beginPath(); context.arc(x, y, 10, 0, Math.PI * 2); context.fill();
    context.fillStyle = '#a7f0ec';
    context.strokeStyle = '#103c48'; context.lineWidth = 2;
    context.beginPath(); context.arc(x, y, 4, 0, Math.PI * 2); context.fill(); context.stroke();
    context.fillStyle = 'rgba(231,239,222,.8)';
    context.textAlign = 'center'; context.fillText('北', width - 18, 17);
    context.strokeStyle = 'rgba(231,239,222,.65)'; context.lineWidth = 1;
    context.beginPath(); context.moveTo(width - 18, 28); context.lineTo(width - 18, 39); context.moveTo(width - 21, 31); context.lineTo(width - 18, 28); context.lineTo(width - 15, 31); context.stroke();
    context.textAlign = 'left';
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clearHeld();
    clearTimeout(this.messageTimer);
    this.abort.abort();
    this.visibilityObserver.disconnect();
    this.root.remove();
    document.body.classList.remove('adventure-ready');
  }
}
