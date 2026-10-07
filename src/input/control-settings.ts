export const CONTROL_ACTIONS = {
  forward: '前進 / 船の加速', back: '後退 / 船の減速', left: '左へ / 左に舵を切る', right: '右へ / 右に舵を切る',
  rise: 'ジャンプ / 浮上', descend: '潜降', sprint: '走る', interact: '調べる / 船の乗り降り',
  map: '地図', journal: '調査ノート', pause: '波の一時停止', immersive: '画面の表示 / 非表示', settings: '操作設定',
} as const;
export type ControlAction = keyof typeof CONTROL_ACTIONS;
export const ACTIONS = Object.keys(CONTROL_ACTIONS) as ControlAction[];
export type KeyBindings = Record<ControlAction, readonly [string, string]>;
export interface ControlPreferences { sensitivity: number; invertX: boolean; invertY: boolean; bindings: KeyBindings; }
export interface SettingsStorage { getItem(key: string): string | null; setItem(key: string, value: string): void; }
export const CONTROLS_STORAGE_KEY = 'sea.controls.v1';
const DEFAULT_BINDINGS: KeyBindings = {
  forward: ['KeyW', 'ArrowUp'], back: ['KeyS', 'ArrowDown'], left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'],
  rise: ['Space', ''], descend: ['KeyC', ''], sprint: ['ShiftLeft', ''], interact: ['KeyE', ''],
  map: ['KeyM', ''], journal: ['KeyJ', ''], pause: ['KeyP', ''], immersive: ['KeyH', ''], settings: ['KeyO', ''],
};
export const normalizeKey = (code: string): string => code === 'ShiftRight' ? 'ShiftLeft' : code === 'ControlRight' ? 'ControlLeft' : code;
export const isBindableKey = (code: string): boolean => /^(Key[A-Z]|Digit[0-9]|Arrow(Up|Down|Left|Right)|Space|ShiftLeft|BracketLeft|BracketRight|Minus|Equal|Comma|Period|Slash|Semicolon|Quote|Backquote|Backslash)$/.test(code);
const isActionKey = (action: ControlAction, code: string): boolean => isBindableKey(code)
  && (!['map', 'journal', 'pause', 'immersive', 'settings'].includes(action) || !/^(Space|Arrow|Shift|Control)/.test(code));
export function keyLabel(code: string): string {
  const labels: Record<string, string> = { ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Space: 'Space', ShiftLeft: 'Shift', ControlLeft: 'Ctrl', BracketLeft: '[', BracketRight: ']', Minus: '-', Equal: '=', Comma: ',', Period: '.', Slash: '/', Semicolon: ';', Quote: "'", Backquote: '`', Backslash: '\\' };
  return labels[normalizeKey(code)] ?? (code.replace(/^(Key|Digit)/, '') || '未設定');
}
function snapshot(value: ControlPreferences): ControlPreferences {
  const bindings = Object.fromEntries(ACTIONS.map(a => [a, Object.freeze([...value.bindings[a]])])) as KeyBindings;
  return Object.freeze({ ...value, bindings: Object.freeze(bindings) });
}
export function defaultControls(): ControlPreferences { return snapshot({ sensitivity: 1, invertX: false, invertY: false, bindings: DEFAULT_BINDINGS }); }
/** Old, corrupt or conflicting saves cannot steal another action's binding. */
export function parseControls(raw: string | null): ControlPreferences {
  const fallback = defaultControls();
  if (!raw) return fallback;
  try {
    const data = JSON.parse(raw);
    if (data?.version !== 1 || !data.bindings || typeof data.bindings !== 'object') return fallback;
    const seen = new Set<string>();
    const bindings = {} as KeyBindings;
    for (const action of ACTIONS) {
      const pair = data.bindings[action];
      if (!Array.isArray(pair) || pair.length !== 2 || pair.some(k => typeof k !== 'string')) return fallback;
      const keys = pair.map(normalizeKey) as [string, string];
      for (const key of keys) {
        if (!key) continue;
        if (!isActionKey(action, key) || seen.has(key)) return fallback;
        seen.add(key);
      }
      // Every action must retain at least one way to invoke it.
      if (!keys.some(Boolean)) return fallback;
      bindings[action] = keys;
    }
    return snapshot({ bindings, sensitivity: typeof data.sensitivity === 'number' && Number.isFinite(data.sensitivity) ? Math.max(.2, Math.min(3, data.sensitivity)) : 1,
      invertX: data.invertX === true, invertY: data.invertY === true });
  } catch { return fallback; }
}
export function isTextInput(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  return Boolean(element?.isContentEditable || element?.closest?.('input,textarea,select,[contenteditable="true"]'));
}
/** Shared by the controller, shortcuts and visible hints. No browser globals in the store. */
export class ControlSettings {
  private current = defaultControls();
  private readonly listeners = new Set<() => void>();
  private readonly storage?: SettingsStorage;
  saveStatus: 'saved' | 'session' | 'unavailable' = 'session';
  constructor(storage?: SettingsStorage) {
    this.storage = storage;
    if (storage) {
      try { this.current = parseControls(storage.getItem(CONTROLS_STORAGE_KEY)); this.saveStatus = 'saved'; }
      catch { this.saveStatus = 'unavailable'; }
    }
  }
  get value(): ControlPreferences { return this.current; }
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  matches(action: ControlAction, code: string): boolean { return Boolean(code) && this.current.bindings[action].includes(normalizeKey(code)); }
  label(action: ControlAction): string { return this.current.bindings[action].filter(Boolean).map(keyLabel).join(' / '); }
  primary(action: ControlAction): string { return keyLabel(this.current.bindings[action].find(Boolean) ?? ''); }
  hint(text: string): string { return text.replace(/\{([a-z]+)\}/g, (token, action: string) => ACTIONS.includes(action as ControlAction) ? this.primary(action as ControlAction) : token); }
  look(dx: number, dy: number): { yaw: number; pitch: number } {
    const s = this.current, factor = .0028 * s.sensitivity;
    return { yaw: (Number.isFinite(dx) ? dx : 0) * factor * (s.invertX ? -1 : 1),
      pitch: (Number.isFinite(dy) ? dy : 0) * factor * (s.invertY ? 1 : -1) };
  }
  setLook(patch: Partial<Pick<ControlPreferences, 'sensitivity' | 'invertX' | 'invertY'>>): void {
    const next = { ...this.current, ...patch };
    next.sensitivity = Number.isFinite(next.sensitivity) ? Math.max(.2, Math.min(3, next.sensitivity)) : this.current.sensitivity;
    this.commit(next);
  }
  rebind(action: ControlAction, slot: 0 | 1, rawCode: string): string | null {
    const code = normalizeKey(rawCode), pair = [...this.current.bindings[action]] as [string, string];
    if (code && !isActionKey(action, code)) return 'この操作には文字・数字などのキーを選んでください。画面操作やブラウザのキーは使用できません。';
    for (const other of ACTIONS) for (let i = 0; i < 2; i++) {
      if (code && (other !== action || i !== slot) && this.current.bindings[other][i] === code)
        return `${keyLabel(code)} は「${CONTROL_ACTIONS[other]}」に設定済みです。先にその割り当てを変更してください。`;
    }
    pair[slot] = code;
    if (!pair.some(Boolean)) return '少なくとも1つのキーを残してください。';
    this.commit({ ...this.current, bindings: { ...this.current.bindings, [action]: pair } });
    return null;
  }
  reset(): void { this.commit(defaultControls()); }
  private commit(value: ControlPreferences): void {
    this.current = snapshot(value);
    if (this.storage) {
      try { this.storage.setItem(CONTROLS_STORAGE_KEY, JSON.stringify({ version: 1, ...this.current })); this.saveStatus = 'saved'; }
      catch { this.saveStatus = 'unavailable'; }
    }
    this.listeners.forEach(listener => listener());
  }
}
