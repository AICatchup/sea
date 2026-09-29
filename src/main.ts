import './style.css';
import { Ocean, type Quality } from './ocean/renderer';
import { presets, type PresetName } from './ocean/presets';
import { SurfAudio } from './audio';

function element<T extends HTMLElement>(id: string): T {
  const result = document.getElementById(id);
  if (!result) throw new Error(`Missing element: ${id}`);
  return result as T;
}

const sound = new SurfAudio();
const abort = new AbortController();
const events = { signal: abort.signal };
let ocean: Ocean;
let activePreset: PresetName = 'golden';
let windTimer = 0;
let toastTimer = 0;

function showError(message: string): void {
  element('unsupported').hidden = false;
  element('error-detail').textContent = message;
  element('loading').classList.add('done');
  element('interface').style.visibility = 'hidden';
}

function toast(message: string): void {
  const toastElement = element('toast');
  clearTimeout(toastTimer);
  toastElement.textContent = message;
  toastElement.classList.add('visible');
  toastTimer = window.setTimeout(() => toastElement.classList.remove('visible'), 3000);
}

function updateRanges(): void {
  const wind = element<HTMLInputElement>('wind');
  const swell = element<HTMLInputElement>('swell');
  wind.value = ocean.wind.toString();
  swell.value = ocean.swell.toString();
  for (const input of [wind, swell]) {
    const fraction = (Number(input.value) - Number(input.min)) / (Number(input.max) - Number(input.min));
    input.style.setProperty('--fill', `${fraction * 100}%`);
  }
  element('wind-value').innerHTML = `${ocean.wind.toFixed(1)} <small>m/s</small>`;
  element('swell-value').innerHTML = `${ocean.swell.toFixed(1)} <small>×</small>`;
}

function togglePause(): void {
  ocean.paused = !ocean.paused;
  const button = element('pause');
  button.setAttribute('aria-pressed', String(ocean.paused));
  button.setAttribute('aria-label', ocean.paused ? '再生する' : '一時停止する');
  element('pause-label').textContent = ocean.paused ? '波を再生' : 'ひと休み';
}

function toggleImmersive(): void {
  const immersive = document.body.classList.toggle('immersed');
  element('interface').inert = immersive;
  element('leave-immersive').hidden = !immersive;
  element('immersive').setAttribute('aria-pressed', String(immersive));
  if (immersive) element('leave-immersive').focus({ preventScroll: true });
  else element('immersive').focus({ preventScroll: true });
}

try {
  ocean = new Ocean(element<HTMLCanvasElement>('ocean'));
  Object.defineProperty(window, '__sea', { get: () => ocean.diagnostics, configurable: true });
  updateRanges();
  requestAnimationFrame(() => element('loading').classList.add('done'));
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) togglePause();
  const panel = element('environment');
  const heading = element('environment-toggle');
  function setPanel(collapsed: boolean): void {
    panel.classList.toggle('collapsed', collapsed);
    heading.setAttribute('aria-expanded', String(!collapsed));
    heading.querySelector('.panel-symbol')!.textContent = collapsed ? '+' : '−';
  }
  if (window.innerWidth <= 550) setPanel(true);
  heading.addEventListener('click', () => setPanel(!panel.classList.contains('collapsed')), events);
  document.querySelectorAll<HTMLButtonElement>('[data-preset]').forEach(button => {
    button.addEventListener('click', () => {
      clearTimeout(windTimer);
      activePreset = button.dataset.preset as PresetName;
      ocean.setPreset(activePreset);
      sound.setWind(ocean.wind);
      document.querySelectorAll<HTMLButtonElement>('[data-preset]').forEach(item => {
        const selected = item === button;
        item.classList.toggle('active', selected);
        item.setAttribute('aria-pressed', String(selected));
      });
      element('scene-label').textContent = presets[activePreset].label;
      updateRanges();
    }, events);
  });
  element<HTMLInputElement>('wind').addEventListener('input', event => {
    const input = event.target as HTMLInputElement;
    const value = Number(input.value);
    element('wind-value').innerHTML = `${value.toFixed(1)} <small>m/s</small>`;
    input.style.setProperty('--fill', `${(value - 2) / 16 * 100}%`);
    clearTimeout(windTimer);
    windTimer = window.setTimeout(() => { ocean.setWind(value); sound.setWind(value); }, 90);
  }, events);
  element<HTMLInputElement>('swell').addEventListener('input', event => {
    const input = event.target as HTMLInputElement;
    ocean.setSwell(Number(input.value));
    element('swell-value').innerHTML = `${ocean.swell.toFixed(1)} <small>×</small>`;
    input.style.setProperty('--fill', `${(ocean.swell - 0.3) / 1.7 * 100}%`);
  }, events);
  element<HTMLSelectElement>('quality').addEventListener('change', event => {
    ocean.setQuality((event.target as HTMLSelectElement).value as Quality);
  }, events);
  element('reset-view').addEventListener('click', () => { ocean.resetView(); toast('水平線に、戻りました。'); }, events);
  element('pause').addEventListener('click', togglePause, events);
  element('immersive').addEventListener('click', toggleImmersive, events);
  element('leave-immersive').addEventListener('click', toggleImmersive, events);
  element<HTMLButtonElement>('sound').addEventListener('click', async event => {
    const button = event.currentTarget as HTMLButtonElement;
    button.disabled = true;
    try {
      const enabled = await sound.toggle();
      button.setAttribute('aria-pressed', String(enabled));
      button.setAttribute('aria-label', enabled ? '波の音をオフにする' : '波の音をオンにする');
      toast(enabled ? '波の音を、そっと。' : '波の音を止めました。');
    } catch { toast('音を再生できませんでした。もう一度お試しください。'); }
    finally { button.disabled = false; }
  }, events);
  element<HTMLButtonElement>('capture').addEventListener('click', async event => {
    const button = event.currentTarget as HTMLButtonElement;
    button.disabled = true;
    try {
      const image = await ocean.capture();
      if (!image) throw new Error('No capture');
      const url = URL.createObjectURL(image);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `sea-${activePreset}-${new Date().toISOString().replace(/[:.]/g, '-')}.png`;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 10000);
      toast('この瞬間の海を、保存しました。');
    } catch { toast('写真を保存できませんでした。もう一度お試しください。'); }
    finally { button.disabled = false; }
  }, events);
  document.addEventListener('keydown', event => {
    if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
    const target = event.target as HTMLElement;
    if (target.closest('input,select,textarea,[contenteditable=true]')) return;
    if (target.id === 'leave-immersive') return;
    if (event.key.toLowerCase() === 'h') toggleImmersive();
    if (event.code === 'Space' && !target.closest('button,a')) { event.preventDefault(); togglePause(); }
  }, events);
  // Escape / H also works after the immersive exit button receives focus.
  element('leave-immersive').addEventListener('keydown', event => {
    if (event.key === 'Escape' || event.key.toLowerCase() === 'h') { event.preventDefault(); toggleImmersive(); }
  }, events);
  document.addEventListener('visibilitychange', () => void sound.setVisible(!document.hidden).catch(() => {}), events);
  window.addEventListener('ocean-error', event => showError((event as CustomEvent<string>).detail), events);
  if (import.meta.hot) {
    import.meta.hot.dispose(() => {
      clearTimeout(windTimer); clearTimeout(toastTimer);
      abort.abort(); ocean.dispose(); sound.dispose();
    });
  }
} catch (error) {
  console.error(error);
  showError(error instanceof Error ? error.message : '海を描画できませんでした。ページを再読み込みしてください。');
}
