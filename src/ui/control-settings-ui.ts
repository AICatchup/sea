import './control-settings.css';
import { ACTIONS, CONTROL_ACTIONS, ControlSettings, isTextInput, keyLabel, type ControlAction } from '../input/control-settings.ts';

/** Native modal focus and Escape handling keep binding keys out of the world. */
export class ControlSettingsUI {
  private readonly dialog = document.createElement('dialog');
  private readonly abort = new AbortController();
  private readonly unsubscribe: () => void;
  private waiting: { action: ControlAction; slot: 0 | 1 } | null = null;
  private readonly status: HTMLElement;
  constructor(private readonly settings: ControlSettings, private readonly onModal: (open: boolean) => void) {
    this.dialog.className = 'control-settings';
    this.dialog.setAttribute('aria-labelledby', 'control-settings-title');
    this.dialog.innerHTML = `<header><div><small>自分に合う操作で、海へ。</small><h2 id="control-settings-title">操作設定</h2></div><button type="button" data-close aria-label="操作設定を閉じる">×</button></header>
      <div class="control-settings-body">
        <section aria-labelledby="look-settings-title"><h3 id="look-settings-title">視点</h3>
          <label class="sensitivity-label" for="look-sensitivity">マウス・ドラッグ感度 <output for="look-sensitivity"></output></label>
          <input id="look-sensitivity" type="range" min="0.2" max="3" step="0.05" />
          <div class="sensitivity-scale"><span>ゆっくり</span><span>すばやく</span></div>
          <label class="invert-option"><input type="checkbox" data-invert="invertX" />左右を反転</label>
          <label class="invert-option"><input type="checkbox" data-invert="invertY" />上下を反転</label>
          <p>通常は、右に動かすと右を向きます。クリックして見回し、Escでマウスを解放。タッチでは画面をドラッグ。</p>
        </section>
        <section aria-labelledby="binding-settings-title"><h3 id="binding-settings-title">キー割り当て</h3>
          <p>変更するキーを押して、新しいキーを入力。Escで取消、Backspace / Deleteで解除。Shiftは左右共通。Ctrl・Alt・⌘はブラウザ操作用です。</p>
          <div class="binding-head"><span>操作</span><span>キー 1</span><span>キー 2</span></div>
          <div class="binding-list"></div>
        </section>
      </div>
      <footer><p data-status role="status" aria-live="polite"></p><div><button type="button" data-reset>標準に戻す</button><button type="button" data-done>海へ戻る</button></div><small data-save></small></footer>`;
    this.status = this.dialog.querySelector('[data-status]')!;
    const events = { signal: this.abort.signal };
    const list = this.dialog.querySelector('.binding-list')!;
    for (const action of ACTIONS) {
      const row = document.createElement('div'); row.className = 'binding-row';
      const label = document.createElement('span'); label.textContent = CONTROL_ACTIONS[action]; row.append(label);
      for (const slot of [0, 1] as const) {
        const button = document.createElement('button'); button.type = 'button';
        button.dataset.binding = action; button.dataset.slot = String(slot);
        button.addEventListener('click', () => {
          this.waiting = { action, slot }; this.sync();
          this.status.textContent = `「${CONTROL_ACTIONS[action]}」に使うキーを押してください。Escで取消。`;
        }, events);
        row.append(button);
      }
      list.append(row);
    }
    const sensitivity = this.dialog.querySelector<HTMLInputElement>('#look-sensitivity')!;
    sensitivity.addEventListener('input', () => { this.waiting = null; this.settings.setLook({ sensitivity: Number(sensitivity.value) }); }, events);
    this.dialog.querySelectorAll<HTMLInputElement>('[data-invert]').forEach(input => input.addEventListener('change', () => {
      this.waiting = null; this.settings.setLook({ [input.dataset.invert!]: input.checked });
    }, events));
    for (const selector of ['[data-close]', '[data-done]']) this.dialog.querySelector(selector)!.addEventListener('click', () => this.close(), events);
    this.dialog.querySelector('[data-reset]')!.addEventListener('click', () => {
      this.waiting = null; this.settings.reset(); this.status.textContent = '感度・反転・すべてのキーを標準に戻しました。';
    }, events);
    this.dialog.addEventListener('keydown', event => {
      event.stopPropagation();
      if (this.waiting) {
        if (event.code === 'Tab') { this.waiting = null; this.sync(); this.status.textContent = 'キーの変更を取り消しました。'; return; }
        event.preventDefault();
        if (event.repeat || event.isComposing) return;
        if (event.code === 'Escape') { this.waiting = null; this.sync(); this.status.textContent = 'キーの変更を取り消しました。'; return; }
        if (event.metaKey || event.altKey || (event.ctrlKey && !event.code.startsWith('Control'))) {
          this.status.textContent = '組み合わせではなく、キーを1つ押してください。'; return;
        }
        const { action, slot } = this.waiting;
        const error = this.settings.rebind(action, slot, /^(Backspace|Delete)$/.test(event.code) ? '' : event.code);
        if (error) { this.status.textContent = error; return; }
        this.waiting = null; this.sync(); this.status.textContent = `「${CONTROL_ACTIONS[action]}」を ${this.settings.label(action)} に設定しました。`;
      } else if (!event.repeat && !event.ctrlKey && !event.metaKey && !event.altKey && !isTextInput(event.target) && this.settings.matches('settings', event.code)) {
        event.preventDefault(); this.close();
      }
    }, events);
    this.dialog.addEventListener('close', () => {
      this.waiting = null; this.onModal(false); document.getElementById('ocean')?.focus({ preventScroll: true });
    }, events);
    this.dialog.addEventListener('pointerdown', event => event.stopPropagation(), events);
    document.body.append(this.dialog);
    this.unsubscribe = settings.subscribe(() => this.sync()); this.sync();
  }
  get isOpen(): boolean { return this.dialog.open; }
  open(): void {
    if (this.dialog.open) return;
    if (document.pointerLockElement) document.exitPointerLock?.();
    this.status.textContent = '変更はすぐに反映されます。'; this.waiting = null; this.sync();
    this.onModal(true); this.dialog.showModal();
  }
  close(): void { this.dialog.close(); }
  private sync(): void {
    const value = this.settings.value, range = this.dialog.querySelector<HTMLInputElement>('#look-sensitivity')!;
    range.value = String(value.sensitivity); range.style.setProperty('--fill', `${(value.sensitivity - .2) / 2.8 * 100}%`);
    this.dialog.querySelector('output')!.textContent = `${value.sensitivity.toFixed(2)} ×`;
    this.dialog.querySelectorAll<HTMLInputElement>('[data-invert]').forEach(i => { i.checked = value[i.dataset.invert as 'invertX' | 'invertY']; });
    this.dialog.querySelectorAll<HTMLButtonElement>('[data-binding]').forEach(button => {
      const action = button.dataset.binding as ControlAction, slot = Number(button.dataset.slot) as 0 | 1;
      const pending = this.waiting?.action === action && this.waiting.slot === slot;
      button.textContent = pending ? 'キーを入力…' : keyLabel(value.bindings[action][slot]);
      button.setAttribute('aria-label', `${CONTROL_ACTIONS[action]} · キー ${slot + 1} · ${button.textContent}`);
      button.setAttribute('aria-pressed', String(pending));
    });
    this.dialog.querySelector('[data-save]')!.textContent = this.settings.saveStatus === 'saved' ? 'このブラウザに自動保存' : this.settings.saveStatus === 'session' ? 'この確認セッション内の設定' : '保存を利用できません。この画面では設定が有効です。';
  }
  dispose(): void { this.close(); this.onModal(false); this.unsubscribe(); this.abort.abort(); this.dialog.remove(); }
}
