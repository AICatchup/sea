import './style.css';
import { Ocean, type Quality } from './ocean/renderer';
import { presets, type PresetName } from './ocean/presets';
import { SurfAudio } from './audio';
import { AdventureUI } from './ui/adventure-ui';

function element<T extends HTMLElement>(id: string): T {
  const result = document.getElementById(id);
  if (!result) throw new Error(`Missing element: ${id}`);
  return result as T;
}

const sound = new SurfAudio();
const abort = new AbortController();
const events = { signal: abort.signal };
let ocean: Ocean;
let activePreset: PresetName = 'day';
let adventureUI: AdventureUI;
let uiFrame = 0;
let windTimer = 0;
let toastTimer = 0;
let disposed = false;
let available = true;
const photoUrls = new Map<string, number>();

function showError(message: string): void {
  available = false;
  void sound.setVisible(false).catch(() => {});
  document.body.classList.remove('immersed');
  element('leave-immersive').hidden = true;
  element('interface').inert = true;
  element('unsupported').hidden = false;
  element('error-detail').textContent = message;
  element('loading').classList.add('done');
  element('interface').style.visibility = 'hidden';
}

function toast(message: string): void {
  if (disposed) return;
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
  element('swell-value').innerHTML = `${ocean.swell.toFixed(2)} <small>×</small>`;
}

function togglePause(): void {
  ocean.paused = !ocean.paused;
  void sound.setPaused(ocean.paused).catch(() => {});
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
  if (immersive) element('ocean').focus({ preventScroll: true });
  else element('immersive').focus({ preventScroll: true });
}

try {
  ocean = new Ocean(element<HTMLCanvasElement>('ocean'));
  const view=new URLSearchParams(location.search).get('view');
  if(view==='dive')ocean.adventure.viewpoint(-145,-113,-.45,-.28,'dive',4.5);
  if(view==='reef')ocean.adventure.viewpoint(-140,-110,-.5,-.42,'dive',5);
  if(view==='lookout')ocean.adventure.viewpoint(-25,36,-.52,-.25);
  if(view==='shore')ocean.adventure.viewpoint(-42,9,-.56,-.24);
  if(view==='cliff')ocean.adventure.viewpoint(-86,-22,-1.6,.10);
  const focus = () => element('ocean').focus({ preventScroll: true });
  adventureUI = new AdventureUI({
    interact: () => { ocean.adventure.interact(); focus(); },
    navigate: id => { ocean.adventure.navigate(id); focus(); },
    place: kind => { ocean.place(kind); focus(); },
    undo: () => { ocean.undoPlacement(); focus(); },
    move: (x, forward) => ocean.adventure.setMove(x, forward),
    vertical: direction => ocean.adventure.setVertical(direction),
  }, ocean.world.destinations, ocean.world.mapOutlines);
  const updateUI = () => {
    if (disposed) return;
    adventureUI.update(ocean.adventure.state, ocean.assets.placedCount);
    uiFrame = requestAnimationFrame(updateUI);
  };
  uiFrame = requestAnimationFrame(updateUI);
  sound.setWind(ocean.wind);
  Object.defineProperty(window, '__sea', { get: () => ocean.diagnostics, configurable: true });
  if(import.meta.env.DEV)Object.defineProperty(window,'__seaOptics',{value:()=>ocean.probeOptics(),configurable:true});
  // Development-only observation/replay seam. It uses the same controller input
  // as the touch controls; bookmarks are QA starts, never normal travel actions.
  if(import.meta.env.DEV)Object.defineProperty(window,'__seaQA',{configurable:true,value:{
    viewpoint:(x:number,z:number,yaw:number,pitch:number,mode:'walk'|'swim'|'dive'='walk',depth=4)=>ocean.adventure.viewpoint(x,z,yaw,pitch,mode,depth),
    async moveFor(x:number,forward:number,vertical:number,milliseconds:number){
      ocean.adventure.setMove(x,forward);ocean.adventure.setVertical(vertical);
      try{await new Promise(resolve=>setTimeout(resolve,Math.max(0,Math.min(5000,milliseconds))));}
      finally{ocean.adventure.setMove(0,0);ocean.adventure.setVertical(0);}
      return ocean.diagnostics;
    },
    interact:()=>ocean.adventure.interact(),navigate:(id:string)=>ocean.adventure.navigate(id),
    ground:(x:number,z:number)=>ocean.world.heightAt(x,z),
  }});
  updateRanges();
  void ocean.ready.then(() => {
    if (!disposed) requestAnimationFrame(() => element('loading').classList.add('done'));
  });
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  if (reducedMotion.matches) togglePause();
  reducedMotion.addEventListener('change', event => {
    if (event.matches && !ocean.paused) togglePause();
  }, events);
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
    element('swell-value').innerHTML = `${ocean.swell.toFixed(2)} <small>×</small>`;
    input.style.setProperty('--fill', `${(ocean.swell - 0.3) / 1.7 * 100}%`);
  }, events);
  element<HTMLSelectElement>('quality').addEventListener('change', event => {
    ocean.setQuality((event.target as HTMLSelectElement).value as Quality);
  }, events);
  element('reset-view').addEventListener('click', () => { ocean.adventure.recenterLook(); focus(); }, events);
  element('home').addEventListener('click', () => { ocean.adventure.recenterLook(); focus(); }, events);
  element('pause').addEventListener('click', togglePause, events);
  element('immersive').addEventListener('click', toggleImmersive, events);
  element('leave-immersive').addEventListener('click', toggleImmersive, events);
  element<HTMLButtonElement>('sound').addEventListener('click', async event => {
    const button = event.currentTarget as HTMLButtonElement;
    button.disabled = true;
    try {
      const enabled = await sound.toggle();
      if (disposed) return;
      button.setAttribute('aria-pressed', String(enabled));
      button.setAttribute('aria-label', enabled ? '波の音をオフにする' : '波の音をオンにする');
      toast(enabled ? '波の音を、そっと。' : '波の音を止めました。');
    } catch { toast('音を再生できませんでした。もう一度お試しください。'); }
    finally { if (!disposed) button.disabled = false; }
  }, events);
  element<HTMLButtonElement>('capture').addEventListener('click', async event => {
    const button = event.currentTarget as HTMLButtonElement;
    button.disabled = true;
    let timeout = 0;
    let cancelCapture: (() => void) | undefined;
    try {
      const image = await Promise.race([
        ocean.capture(),
        new Promise<null>(resolve => {
          timeout = window.setTimeout(() => resolve(null), 8000);
          cancelCapture = () => resolve(null);
          abort.signal.addEventListener('abort', cancelCapture, { once: true });
        }),
      ]);
      if (disposed) return;
      if (!image) throw new Error('No capture');
      const url = URL.createObjectURL(image);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `sea-${activePreset}-${new Date().toISOString().replace(/[:.]/g, '-')}.png`;
      document.body.append(anchor);
      photoUrls.set(url, window.setTimeout(() => {
        URL.revokeObjectURL(url);
        photoUrls.delete(url);
      }, 10000));
      try { anchor.click(); } finally { anchor.remove(); }
      toast('この瞬間の海を、保存しました。');
    } catch { toast('写真を保存できませんでした。もう一度お試しください。'); }
    finally {
      clearTimeout(timeout);
      if (cancelCapture) abort.signal.removeEventListener('abort', cancelCapture);
      if (!disposed) button.disabled = false;
    }
  }, events);
  document.addEventListener('keydown', event => {
    if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
    const target = event.target as HTMLElement;
    if (event.key === 'Escape' && document.body.classList.contains('immersed')) {
      event.preventDefault();
      toggleImmersive();
      return;
    }
    if (target.closest('input,select,textarea') || target.isContentEditable) return;
    if (event.key.toLowerCase() === 'h') { event.preventDefault(); toggleImmersive(); }
    if (event.code === 'KeyP' && !target.closest('button,a')) { event.preventDefault(); togglePause(); }
  }, events);
  document.addEventListener('visibilitychange', () => void sound.setVisible(!document.hidden && available).catch(() => {}), events);
  window.addEventListener('ocean-error', event => showError((event as CustomEvent<string>).detail), events);
  if (import.meta.hot) {
    import.meta.hot.dispose(() => {
      disposed = true;
      clearTimeout(windTimer); clearTimeout(toastTimer);
      cancelAnimationFrame(uiFrame); adventureUI.dispose();
      abort.abort(); ocean.dispose(); sound.dispose();
      photoUrls.forEach((timer, url) => { clearTimeout(timer); URL.revokeObjectURL(url); });
      photoUrls.clear();
      document.body.classList.remove('immersed');
      element('interface').inert = false;
      element('leave-immersive').hidden = true;
    });
  }
} catch (error) {
  console.error(error);
  showError(error instanceof Error ? error.message : '海を描画できませんでした。ページを再読み込みしてください。');
}
