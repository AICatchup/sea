import './style.css';
import {Raycaster,Vector2} from 'three';
import { inspectBodyHands } from './qa/body-inspection';
import {inspectCurrentHelmContact} from './qa/helm-contact-inspection.ts';
import {inspectBoatCloth} from './qa/boat-cloth-inspection.ts';
import {inspectFlatCaustics} from './qa/caustic-flat-control.ts';
import {inspectShoreTransport} from './qa/shore-transport-probe.ts';
import {inspectShoreIncident} from './qa/shore-incident-probe.ts';
import {inspectSandMoisture} from './qa/sand-moisture-inspection.ts';
import {inspectFoamStructure} from './qa/foam-structure-inspection.ts';
import {inspectGpuSkinOnDevice} from './qa/gpu-skinned-browser-check.ts';
import {inspectGpuSkinLifecycle} from './qa/gpu-skinned-lifecycle.ts';
import {createCaptureGate} from './qa/capture-exclusivity.ts';
import { Ocean, type Quality } from './ocean/renderer';
import {ExpeditionUI} from './ui/expedition-ui';
import {ActivityUI} from './ui/activity-ui.ts';
import { presets, type PresetName } from './ocean/presets';
import { SurfAudio } from './audio';
import { AdventureUI } from './ui/adventure-ui';
import { captureNamed, captureMatrix, CAPTURE_PROFILES, type CaptureState, type SceneCaptureHost } from './qa/scene-capture';
import { experienceOptions } from './qa/experience-options';
import { ControlSettings, isTextInput, type SettingsStorage } from './input/control-settings.ts';
import { ControlSettingsUI } from './ui/control-settings-ui.ts';

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
let expeditionUI:ExpeditionUI;
let controlSettingsUI: ControlSettingsUI;
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
  // Capture sessions must never overwrite the player's preferences.
  let controlsStorage: SettingsStorage | undefined;
  if(new URLSearchParams(location.search).get('capture')!=='1') {
    controlsStorage={getItem:key=>localStorage.getItem(key),setItem:(key,value)=>localStorage.setItem(key,value)};
  }
  const controls = new ControlSettings(controlsStorage);
  ocean = new Ocean(element<HTMLCanvasElement>('ocean'),controls);
  const view=experienceOptions(location.search).view;
  // camera=third opens in the over-the-shoulder view (V toggles it during play).
  if(new URLSearchParams(location.search).get('camera')==='third')ocean.viewCamera.toggle();
  if(view==='dive')ocean.adventure.viewpoint(-145,-113,-.45,-.28,'dive',4.5);
  if(view==='reef')ocean.adventure.viewpoint(-140,-110,-.5,-.42,'dive',5);
  if(view==='lookout')ocean.adventure.viewpoint(-25,36,-.52,-.25);
  if(view==='shore')ocean.adventure.viewpoint(-42,9,-.56,-.24);
  if(view==='cliff')ocean.adventure.viewpoint(-86,-22,-1.6,.10);
  const coastalView=CAPTURE_PROFILES.find(profile=>profile.name===view&&(view==='habushi-front'||view==='secret'));
  if(coastalView){const p=coastalView.pose;ocean.adventure.viewpoint(p.x,p.z,p.yaw,p.pitch,p.mode,p.depth);}
  if(import.meta.env.DEV&&new URLSearchParams(location.search).get('view')==='secret-north')ocean.adventure.viewpoint(5867.738324909292,-986.7159855658878,.2470509620848015,-.049045010375976736);
  const focus = () => element('ocean').focus({ preventScroll: true });
  const openPanels = new Set<string>();
  const modal = (name:string,open:boolean) => {
    const wasBlocked=openPanels.size>0;
    if(open)openPanels.add(name);else openPanels.delete(name);
    if(wasBlocked!==(openPanels.size>0))ocean.adventure.setInputBlocked(openPanels.size>0);
  };
  adventureUI = new AdventureUI({
    panel:open=>modal('map',open),
    interact: () => { ocean.adventure.interact(); focus(); },
    navigate: id => { ocean.adventure.navigate(id); focus(); },
    place: kind => { ocean.place(kind); focus(); },
    undo: () => { ocean.undoPlacement(); focus(); },
    move: (x, forward) => ocean.adventure.setMove(x, forward),
    vertical: direction => ocean.adventure.setVertical(direction),
  }, ocean.world.destinations, ocean.world.mapOutlines,controls);
  expeditionUI=new ExpeditionUI(ocean.expedition,{map:()=>adventureUI.openMap(),cue:()=>sound.cue(),modal:open=>{if(open)adventureUI.close();modal('journal',open);}},controls);
  controlSettingsUI=new ControlSettingsUI(controls,open=>modal('settings',open));
  const activityUI=new ActivityUI(ocean.activities,controls,()=>{ocean.adventure.useActivity();focus();});
  const revealUI=()=>{if(document.body.classList.contains('immersed'))toggleImmersive();};
  const openControls=()=>{revealUI();adventureUI.close();expeditionUI.close();controlSettingsUI.open();};
  element('controls-open').addEventListener('click',openControls,events);
  const syncControlHints=()=>{
    const move=['forward','left','back','right'].map(a=>controls.primary(a as 'forward'|'left'|'back'|'right')).join(' / ');
    const hint=`${move} で移動 · ${controls.primary('rise')} 跳ぶ・浮上 / ${controls.primary('descend')} 潜る · ${controls.primary('interact')} 調べる · ${controls.primary('map')} 地図`;
    document.querySelector<HTMLElement>('.interaction-hint')!.textContent=hint;
    element('ocean').setAttribute('aria-label',`式根島の泊海水浴場。クリックで見回す、Escでマウスを解放。${hint}。${controls.primary('settings')}で操作設定。`);
    element('controls-open').title=`操作設定 · ${controls.label('settings')}`;
    element('immersive').title=`画面の表示 / 非表示 · ${controls.label('immersive')}`;
    element('leave-immersive').querySelector('span')!.textContent=controls.primary('immersive');
  };
  const unsubscribeHints=controls.subscribe(syncControlHints);syncControlHints();
  let previousSoundStamp=performance.now();
  const updateUI = () => {
    if (disposed) return;
    adventureUI.update(ocean.adventure.state, ocean.assets.placedCount);
    expeditionUI.update(ocean.adventure.state);
    activityUI.update(ocean.adventure.state,ocean.adventure.inputBlocked);
    const soundStamp=performance.now();sound.setFrame(ocean.soundFrame((soundStamp-previousSoundStamp)/1000));previousSoundStamp=soundStamp;
    uiFrame = requestAnimationFrame(updateUI);
  };
  uiFrame = requestAnimationFrame(updateUI);
  sound.setWind(ocean.wind);
  Object.defineProperty(window, '__sea', { get: () => ocean.diagnostics, configurable: true });
  if(import.meta.env.DEV)Object.defineProperty(window,'__seaOptics',{value:()=>ocean.probeOptics(),configurable:true});
  if(import.meta.env.DEV)Object.defineProperty(window,'__seaHelm',{value:()=>inspectCurrentHelmContact(ocean),configurable:true});
  if(import.meta.env.DEV)Object.defineProperty(window,'__seaBoatCloth',{value:async()=>{await ocean.ready;return inspectBoatCloth(ocean);},configurable:true});
  const captureOnly=new URLSearchParams(location.search).get('capture')==='1';
  const capturePNG=async():Promise<string|null>=>{
    const blob=await ocean.capture();if(!blob)return null;
    return await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(reader.error);reader.readAsDataURL(blob);});
  };
  type SavedCapture=CaptureState&{wind:number;swell:number;eyeY:number;oxygen:number;stamina:number;action:typeof ocean.adventure.state.avatarAction};
  const captureHost:SceneCaptureHost={
    readDiagnostics:()=>{const d=ocean.diagnostics;const ray=new Raycaster();const surfaceProbes=new URLSearchParams(location.search).get('cliffcover')==='1'?[-.25,0,.25].map(x=>{ray.setFromCamera(new Vector2(x,-.4),ocean.camera);const h=ray.intersectObject(ocean.world.group,true)[0];return h?{name:h.object.name,point:h.point.toArray(),floor:ocean.world.heightAt(h.point.x,h.point.z)}:null;}):undefined;return JSON.parse(JSON.stringify({time:d.time,frames:d.frames,draws:d.draws,triangles:d.triangles,foliage:d.foliage,worldSolids:d.worldSolids,surfaceProbes}));},
    ready:ocean.ready,
    readState(){
      const d=ocean.diagnostics,s=ocean.adventure.state;
      if(!captureOnly||s.mode==='boat'||s.voyageTarget||s.speed>.01||(s.boardingProgress??0)>0)throw new Error('Use a dedicated idle QA instance with capture=1');
      return {pose:{x:s.position.x,z:s.position.z,yaw:s.yaw,pitch:s.pitch,mode:s.mode,depth:s.depth},
        camera:[...ocean.camera.position.toArray(),...ocean.camera.quaternion.toArray()],fov:ocean.camera.fov,width:d.resolution[0],height:d.resolution[1],
        quality:d.quality,preset:d.preset,paused:d.paused,locked:d.visualCaptureLocked,hidden:document.hidden,disposed,
        wind:d.wind,swell:d.swell,eyeY:s.position.y,oxygen:s.oxygen,stamina:s.stamina??1,action:s.avatarAction} as SavedCapture;
    },
    restoreState(raw){
      const s=raw as SavedCapture,p=s.pose;
      ocean.setPreset(s.preset as PresetName);ocean.setWind(s.wind);ocean.setSwell(s.swell);ocean.setQuality(s.quality as Quality);ocean.paused=s.paused;
      ocean.adventure.viewpoint(p.x,p.z,p.yaw,p.pitch,p.mode,p.depth);
      ocean.adventure.state.position.y=s.eyeY;ocean.adventure.state.oxygen=s.oxygen;ocean.adventure.state.stamina=s.stamina;ocean.adventure.state.avatarAction=s.action;
      if(s.fov!==undefined){ocean.camera.fov=s.fov;ocean.camera.updateProjectionMatrix();}
      ocean.visualCaptureLocked=s.locked;
    },
    setQuality:q=>ocean.setQuality(q as Quality),setPreset:p=>{if(!(p in presets))throw new Error('Unknown capture preset');ocean.setPreset(p as PresetName);},
    setPaused:p=>{ocean.paused=p;},visualLock:p=>{ocean.visualCaptureLocked=p;},
    viewpoint(x,z,yaw,pitch,mode,depth,eyeY){
      ocean.adventure.viewpoint(x,z,yaw,pitch,mode,depth);ocean.adventure.state.viewOffset?.set(0,0,0);
      if(eyeY!==undefined){
        if(!Number.isFinite(eyeY)||eyeY<=ocean.world.heightAt(x,z)+.08||eyeY>200)throw new Error('Aligned camera must be finite and above the actual terrain');
        const state=ocean.adventure.state,surface=state.position.y+state.depth;
        state.position.y=eyeY;if(mode!=='walk')state.depth=Math.max(0,surface-eyeY);
      }
      ocean.adventure.state.avatarAction=mode==='dive'?'dive':mode==='swim'?'swim':'idle';
      ocean.adventure.state.immersion=mode==='walk'?Math.max(0,Math.min(1,(1.64-ocean.adventure.state.position.y)/1.64)):1;
    },
    capturePixels:capturePNG,
    nextFrame:()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))),
  };
  // Development-only observation/replay seam. It uses the same controller input
  // as the touch controls; bookmarks are QA starts, never normal travel actions.
  let crestSeriesBusy=false;
  if(import.meta.env.DEV)Object.defineProperty(window,'__seaQA',{configurable:true,value:{
    async captureMirrorComparison(pose:{x:number;z:number;yaw:number;pitch:number;eyeY:number;mode:'walk'|'dive'},name='reflection'){
      if(!captureOnly||![pose.x,pose.z,pose.yaw,pose.pitch,pose.eyeY].every(Number.isFinite)||Math.abs(pose.x)>7000||Math.abs(pose.z)>4000||!['walk','dive'].includes(pose.mode))throw new Error('Dedicated bounded reflection observation required');
      await ocean.ready;const before=captureHost.readState(),clock=ocean.diagnostics.time,wasEnabled=ocean.setReflectionCulling(false);
      try{
        captureHost.visualLock(true);captureHost.setPaused(true);captureHost.setQuality('high');captureHost.setPreset('day');
        captureHost.viewpoint(pose.x,pose.z,pose.yaw,pose.pitch,pose.mode,0,pose.eyeY);ocean.setObservationClock(34);
        // End each group after the non-shadow reflection at frame phase 9,
        // so an accepted ON image actually contains a culled reflection.
        while(ocean.frames%12!==0)ocean.renderStaticSnapshot();
        for(let i=0;i<12;i++)ocean.renderStaticSnapshot();
        const captures=[];
        for(const [label,enabled] of [['off-first',false],['off-repeat',false],['on',true],['off-last',false]] as const){
          ocean.setReflectionCulling(enabled);let png='';const frames=[];
          for(let i=0;i<12;i++){png=ocean.renderStaticSnapshot();const d=ocean.diagnostics;frames.push({frame:d.frames,draws:d.draws,triangles:d.triangles,cull:d.reflectionCulling});}
          captures.push({label,enabled,png,frames});
        }
        return{name,pose,captures,state:captureHost.readState(),scope:'Paused same-build off/off/on/off. Complete 12-frame shadow/reflection cadence; no FPS or normal input acceptance.'};
      }finally{
        ocean.setReflectionCulling(wasEnabled);
        try{ocean.setObservationClock(clock);captureHost.restoreState(before);captureHost.visualLock(true);captureHost.setPaused(true);ocean.renderStaticSnapshot();}
        finally{captureHost.restoreState(before);}
      }
    },
    async captureStaticCoast(pose:{x:number;z:number;yaw:number;pitch:number;eyeY:number},name='static-coast',diagnostic:'normal'|'no-shadow'='normal',probes:readonly{x:number;y:number}[]=[]) {
      const tomari=pose.x>=-350&&pose.x<=350&&pose.z>=-300&&pose.z<=200;
      const niijima=pose.x>=5400&&pose.x<=6500&&pose.z>=-3500&&pose.z<=200;
      if(!captureOnly||![pose.x,pose.z,pose.yaw,pose.pitch,pose.eyeY].every(Number.isFinite)||(!tomari&&!niijima))throw new Error('Bounded dedicated coast observation required');
      if(!['normal','no-shadow'].includes(diagnostic)||probes.length>16||probes.some(p=>![p.x,p.y].every(Number.isFinite)||p.x<0||p.x>1||p.y<0||p.y>1))throw new Error('Bounded static diagnostic and probes required');
      await ocean.ready;const before=captureHost.readState(),clock=ocean.diagnostics.time;
      const receivers:{mesh:import('three').Mesh;receive:boolean}[]=[];
      if(diagnostic==='no-shadow')ocean.scene.traverse(object=>{if((object as import('three').Mesh).isMesh){const mesh=object as import('three').Mesh;receivers.push({mesh,receive:mesh.receiveShadow});mesh.receiveShadow=false;}});
      try{
        captureHost.visualLock(true);captureHost.setPaused(true);captureHost.setQuality('high');captureHost.setPreset('day');
        captureHost.viewpoint(pose.x,pose.z,pose.yaw,pose.pitch,'walk',0,pose.eyeY);ocean.setObservationClock(34);
        // Cover complete 3-frame reflection and 4-frame shadow cadences after
        // moving the observation camera, regardless of its initial frame phase.
        let png='';for(let i=0;i<12;i++)png=ocean.renderStaticSnapshot();
        return{png,metadata:{name,pose,diagnostic,state:captureHost.readState(),time:ocean.diagnostics.time,materials:ocean.diagnostics.niijimaMaterials,topography:ocean.diagnostics.topography,foliage:ocean.diagnostics.foliage,draws:ocean.diagnostics.draws,triangles:ocean.diagnostics.triangles,terrain:probes.map(p=>({point:p,hits:ocean.probeFoliage(p.x*2-1,1-p.y*2,false,true)})),scope:'Explicit paused same-engine WebGL observation. No realtime FPS, input, walking or travel acceptance.'}};
      }finally{
        for(const r of receivers)r.mesh.receiveShadow=r.receive;
        try{ocean.setObservationClock(clock);captureHost.restoreState(before);captureHost.visualLock(true);captureHost.setPaused(true);ocean.renderStaticSnapshot();}
        finally{captureHost.restoreState(before);}
      }
    },
    async captureCoastPose(pose:{x:number;z:number;yaw:number;pitch:number;eyeY:number},name='coast',probes:readonly{x:number;y:number}[]=[],diagnostic:'normal'|'no-water'|'no-shadow'|'no-shore'='normal'){
      if(!captureOnly||![pose.x,pose.z,pose.yaw,pose.pitch,pose.eyeY].every(Number.isFinite)||pose.x<5400||pose.x>6500||pose.z< -3500||pose.z>200)throw new Error('Dedicated bounded coast QA pose required');
      await ocean.ready;const before=captureHost.readState(),clock=ocean.diagnostics.time;
      const savedShore=ocean.getShoreCandidateEnabled();if(diagnostic==='no-shore')ocean.setShoreCandidateEnabled(false);
      const savedWater=ocean.waterScene.children.map(object=>({object,visible:object.visible})),savedReceivers:{object:import('three').Mesh;receive:boolean}[]=[];
      if(diagnostic==='no-water')for(const entry of savedWater)entry.object.visible=false;
      if(diagnostic==='no-shadow')ocean.scene.traverse(object=>{if((object as import('three').Mesh).isMesh){const mesh=object as import('three').Mesh;savedReceivers.push({object:mesh,receive:mesh.receiveShadow});mesh.receiveShadow=false;}});
      try{captureHost.visualLock(true);captureHost.setPaused(true);captureHost.setQuality('high');captureHost.setPreset('day');
        captureHost.viewpoint(pose.x,pose.z,pose.yaw,pose.pitch,'walk',0,pose.eyeY);ocean.setObservationClock(34);
        for(let i=0;i<28;i++)await captureHost.nextFrame();const png=await capturePNG();if(!png)throw new Error('Coast capture failed');
        return{png,metadata:{name,pose,state:captureHost.readState(),time:ocean.diagnostics.time,coastConfidence:ocean.world.niijimaCoast.dem.coastConfidence,collision:ocean.diagnostics.collision,water:probes.length?ocean.probeWaterContact(probes):null,terrain:probes.map(p=>({point:p,hits:ocean.probeFoliage(p.x*2-1,1-p.y*2,false,true)})),scope:'Developer camera checkpoint, identical frozen FFT time; visual comparison, not travel or a surveyed camera pose'}};
      }finally{ocean.setShoreCandidateEnabled(savedShore);for(const entry of savedWater)entry.object.visible=entry.visible;for(const entry of savedReceivers)entry.object.receiveShadow=entry.receive;try{ocean.setObservationClock(clock);}finally{captureHost.restoreState(before);}}
    },
    audioDiagnostics:()=>sound.diagnostics,
    activities:()=>ocean.activities.diagnostics,
    async recordAudio(milliseconds:number){const blob=await sound.record(milliseconds);return await new Promise<string>((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result));r.onerror=()=>reject(r.error);r.readAsDataURL(blob);});},
    async captureSandComparison(name:string){
      const profile=CAPTURE_PROFILES.find(p=>p.name===name);if(!profile)throw new Error('Unknown sand comparison view');
      await ocean.ready;const before=captureHost.readState(),original=ocean.world.sandAppearance.value,clock=ocean.diagnostics.time,variants=[];
      try{
        captureHost.visualLock(true);captureHost.setPaused(true);captureHost.setQuality('high');captureHost.setPreset('day');
        const p=profile.pose;captureHost.viewpoint(p.x,p.z,p.yaw,p.pitch,p.mode,p.depth);ocean.setObservationClock(34);
        for(const blend of [0,1,0]){
          ocean.world.sandAppearance.value=blend;
          for(let i=0;i<24;i++)await captureHost.nextFrame();
          const png=await capturePNG();if(!png)throw new Error('Sand comparison capture failed');
          const d=ocean.diagnostics;
          variants.push({png,metadata:{name,blend,state:captureHost.readState(),time:d.time,draws:d.draws,triangles:d.triangles,collision:d.collision,worldSolids:d.worldSolids,programs:d.programs}});
        }
        return {variants,scope:'Same camera/time/sun/sky and meshes; shared sand reflectance only; authored palette target, no field measurement or Human acceptance'};
      }finally{ocean.world.sandAppearance.value=original;try{ocean.setObservationClock(clock);}finally{captureHost.restoreState(before);}}
    },
    viewpoint:(x:number,z:number,yaw:number,pitch:number,mode:'walk'|'swim'|'dive'='walk',depth=4)=>ocean.adventure.viewpoint(x,z,yaw,pitch,mode,depth),
    async moveFor(x:number,forward:number,vertical:number,milliseconds:number){
      ocean.adventure.setMove(x,forward);ocean.adventure.setVertical(vertical);
      try{await new Promise(resolve=>setTimeout(resolve,Math.max(0,Math.min(5000,milliseconds))));}
      finally{ocean.adventure.setMove(0,0);ocean.adventure.setVertical(0);}
      return ocean.diagnostics;
    },
    interact:()=>ocean.adventure.interact(),navigate:(id:string)=>ocean.adventure.navigate(id),
    ground:(x:number,z:number)=>ocean.world.heightAt(x,z),
    foliageAt:(x:number,y:number)=>ocean.probeFoliage(x,y),
    objectAt:(x:number,y:number)=>ocean.probeFoliage(x,y,false),
    terrainAt:(x:number,y:number)=>ocean.probeFoliage(x/window.innerWidth*2-1,1-y/window.innerHeight*2,false,true),
    depthSamples:(points:readonly{x:number;y:number}[])=>ocean.probeDepthSamples(points),
    waterSamples:(points:readonly{x:number;y:number}[])=>ocean.probeWaterContact(points),
    farWaveFilter:(enabled:boolean)=>{const old=ocean.uniforms.uFarWaveFilter.value;ocean.uniforms.uFarWaveFilter.value=enabled?1:0;return old;},
    foamFilm:(enabled:boolean)=>{const old=ocean.uniforms.uFoamFilm.value;ocean.uniforms.uFoamFilm.value=enabled?1:0;return old;},
    inspectBodyHands:()=>inspectBodyHands(ocean),
    inspectGeometryReceivers:()=>ocean.inspectGeometryReceivers(),
    inspectSkinnedReceivers:()=>ocean.inspectSkinnedReceivers(),
    geometryRefraction:(enabled:boolean)=>ocean.setGeometryRefraction(enabled),
    async inspectGpuSkin(){
      await ocean.ready;const before=captureHost.readState();
      try{captureHost.visualLock(true);captureHost.setPaused(true);return inspectGpuSkinOnDevice(ocean.renderer);}
      finally{captureHost.restoreState(before);}
    },
    inspectGpuSkinLifecycle:()=>inspectGpuSkinLifecycle(),
    async captureGateFinish(){
      await ocean.ready;const before=captureHost.readState(),variants=[];
      let previous=true;
      try{
        captureHost.visualLock(true);captureHost.setPaused(true);captureHost.setQuality('high');captureHost.setPreset('day');
        // Two perspectives of the same physically walkable landmark, not travel.
        for(const pose of [{x:5855,z:-4503.84,yaw:Math.PI/2,pitch:.18},{x:5856,z:-4516,yaw:1.95,pitch:.32}]){
          captureHost.viewpoint(pose.x,pose.z,pose.yaw,pose.pitch,'walk');
          for(const enabled of [false,true,false]){
            const old=ocean.world.habushiGate.setPhotographicFinish(enabled);
            if(!variants.length)previous=old;
            for(let i=0;i<8;i++)await captureHost.nextFrame();
            variants.push({pose,enabled,png:await capturePNG(),metadata:{camera:captureHost.readState().camera,gate:ocean.world.habushiGate.diagnostics}});
          }
        }
        return {variants,scope:'Generic CC0 photographed plaster finish, two frozen actual 3D perspectives. Original site paint and precise dimensions are not measured; not travel or Human proof'};
      }finally{ocean.world.habushiGate.setPhotographicFinish(previous);captureHost.restoreState(before);}
    },
    async inspectBodyComparison(){
      await ocean.ready;const before=captureHost.readState();const {FirstPersonBody:OriginalBody}=await import('./qa/legacy-body.ts');const original=new OriginalBody();
      try{
        captureHost.visualLock(true);captureHost.setPaused(true);await captureHost.nextFrame();
        const copyPose=(old:import('three').Object3D,current:import('three').Object3D)=>{
          if(old.type!==current.type||old.name!==current.name||old.children.length!==current.children.length)throw new Error('Body pose graph changed; aligned comparison unavailable');
          old.position.copy(current.position);old.quaternion.copy(current.quaternion);old.scale.copy(current.scale);old.visible=current.visible;
          old.children.forEach((node,index)=>copyPose(node,current.children[index]));
        };copyPose(original.group,ocean.body.group);original.group.updateMatrixWorld(true);
        return {original:inspectBodyHands(ocean,original.group,.32),candidate:inspectBodyHands(ocean),scope:'Original cce15ff anatomy/skin vs current; same borrowed environment, copied bone pose and studio cameras. Actual old/new wet responses; isolated asset comparison, not gameplay/photo/Human proof'};
      }finally{original.dispose();captureHost.restoreState(before);}
    },
    inspectFlatCaustics:()=>inspectFlatCaustics(ocean.renderer),
    async inspectShoreTransport(){
      await ocean.ready;const before=captureHost.readState();
      try{captureHost.visualLock(true);captureHost.setPaused(true);return await inspectShoreTransport(ocean.renderer);}
      finally{captureHost.restoreState(before);}
    },
    fishMotion:()=>({time:ocean.diagnostics.time,fish:ocean.marine.inspectFishMotion()}),
    bodyVisible:(visible:boolean)=>{ocean.body.group.visible=visible;},
    cliffSkinVisible:(visible:boolean)=>{
      const skin=ocean.world.group.getObjectByName('Tomari jointed rhyolite ledges and fissures');
      if(!skin)throw new Error('Cliff skin unavailable');const previous=skin.visible;skin.visible=visible;return previous;
    },
    breakerEnabled:(enabled:boolean)=>ocean.setBreakerCandidateEnabled(enabled),
    shoreEnabled:(enabled:boolean)=>ocean.setShoreCandidateEnabled(enabled),
    reflectionOverscan:(scale:number)=>ocean.setReflectionOverscan(scale),
    inspectShoreIncident:()=>inspectShoreIncident(ocean.renderer),
    inspectShoreForcing:()=>inspectShoreIncident(ocean.renderer,true),
    async inspectSandMoisture(){
      await ocean.ready;const before=captureHost.readState();
      try{captureHost.visualLock(true);captureHost.setPaused(true);return inspectSandMoisture(ocean.renderer);}
      finally{captureHost.restoreState(before);}
    },
    async inspectFoamStructure(){
      await ocean.ready;const before=captureHost.readState();
      try{captureHost.visualLock(true);captureHost.setPaused(true);return inspectFoamStructure(ocean.renderer);}
      finally{captureHost.restoreState(before);}
    },
    shoreState:()=>ocean.probeShoreState(),
    whitewaterSites:()=>ocean.probeWhitewaterSites(),
    visualLock:(locked:boolean)=>{ocean.visualCaptureLocked=locked;},
    capturePixels:capturePNG,
    captureNamed:(name:string)=>{const profile=CAPTURE_PROFILES.find(p=>p.name===name);if(!profile)throw new Error('Unknown capture view');return captureNamed(captureHost,profile,{quality:'high',preset:'day',width:1280,height:720,timeoutMs:30000,warmupFrames:30});},
    captureAligned:(name:string,eyeY:number)=>{const profile=CAPTURE_PROFILES.find(p=>p.name===name);if(!profile||!Number.isFinite(eyeY))throw new Error('Known view and finite reference eye height required');return captureNamed(captureHost,{...profile,pose:{...profile.pose,eyeY},provenance:'QA bookmark with absolute eye height pinned to an earlier actual capture; no surveyed pose or travel proof'},{quality:'high',preset:'day',width:1280,height:720,timeoutMs:30000,warmupFrames:30});},
    async captureLeafComparison(name:string,kind:'alpha'|'colour'='alpha'){
      if(kind!=='alpha'&&kind!=='colour')throw new Error('Known leaf comparison kind required');
      await ocean.ready;const profile=CAPTURE_PROFILES.find(p=>p.name===name);if(!profile)throw new Error('Unknown leaf comparison');
      const before=captureHost.readState(),variants=[];
      try{
        captureHost.visualLock(true);captureHost.setPaused(true);captureHost.setQuality('high');captureHost.setPreset('day');
        const p=profile.pose;captureHost.viewpoint(p.x,p.z,p.yaw,p.pitch,p.mode,p.depth);
        for(const index of [0,1,2]){
          const alpha=index===1?.18:.38,saved=kind==='alpha'?ocean.setLeafAlphaThreshold(alpha):ocean.setLeafColourMips(index===1);
          try{for(let i=0;i<20;i++)await captureHost.nextFrame();const png=await capturePNG();if(!png)throw new Error('No foliage PNG');variants.push({png,metadata:{kind,alpha:kind==='alpha'?alpha:undefined,colourMips:kind==='colour'?index===1:undefined,state:captureHost.readState(),time:ocean.diagnostics.time,materials:saved.size}});}
          finally{if(kind==='alpha')ocean.restoreLeafAlphaThreshold(saved as Map<import('three').MeshStandardMaterial,number>);else ocean.restoreLeafColourMips(saved as Map<import('three').MeshStandardMaterial,import('three').Texture|null>);}
        }
        return {variants,scope:'Frozen pose/time/instances/geometry/light; only requested leaf alpha cutoff or alpha-weighted photo colour mip chain changed; no travel or local botany proof'};
      }finally{captureHost.restoreState(before);}
    },
    async observeFishMotion(seconds=30){
      if(!Number.isFinite(seconds)||seconds<1||seconds>40)throw new Error('Fish observation is bounded to 1..40 seconds');
      await ocean.ready;const before=captureHost.readState(),samples=[];
      try{
        captureHost.visualLock(true);captureHost.setPaused(false);
        const start=performance.now();
        do{await new Promise(resolve=>requestAnimationFrame(resolve));samples.push({wallSeconds:(performance.now()-start)/1000,time:ocean.diagnostics.time,fish:ocean.marine.inspectFishMotion()});}
        while(performance.now()-start<seconds*1000);
        return {samples,provenance:'Actual requestAnimationFrame observations of the normal retained CPU poses during rendering; no fabricated simulation steps or GPU-buffer readback; not real animal behaviour or Human proof'};
      }finally{captureHost.restoreState(before);}
    },
    async captureOpticalComparison(name:string){
      await ocean.ready;const profile=CAPTURE_PROFILES.find(p=>p.name===name);if(!profile)throw new Error('Unknown optical comparison');
      const before=captureHost.readState(),previous=ocean.setSnellRay(false),variants=[];
      try{
        captureHost.visualLock(true);captureHost.setQuality('high');captureHost.setPreset('day');const p=profile.pose;captureHost.viewpoint(p.x,p.z,p.yaw,p.pitch,p.mode,p.depth);
        captureHost.setPaused(false);await new Promise(resolve=>setTimeout(resolve,3000));captureHost.setPaused(true);
        const points=[.4,.6,.8].flatMap(x=>[.4,.5,.6,.7].map(y=>({x,y})));
        for(const enabled of [false,true,false]){
          ocean.setSnellRay(enabled);for(let i=0;i<8;i++)await captureHost.nextFrame();
          const intervals=[];let last=await new Promise<number>(resolve=>requestAnimationFrame(resolve));
          for(let i=0;i<24;i++){const now=await new Promise<number>(resolve=>requestAnimationFrame(resolve));intervals.push(now-last);last=now;}
          const png=await capturePNG();if(!png)throw new Error('No optical PNG');
          variants.push({png,metadata:{enabled,state:captureHost.readState(),time:ocean.diagnostics.time,probe:ocean.probeWaterContact(points),frameIntervalsMs:intervals}});
        }
        return {variants,scope:'One frozen camera, FFT, caustic state and light; straight screen ray vs Snell ray to visible scene-depth receiver. Missing/offscreen/hidden receivers retain legacy; bounded screen-space approximation, not full geometry ray tracing or movement/Human proof'};
      }finally{ocean.setSnellRay(previous);captureHost.restoreState(before);}
    },
    async captureTerrainPose(name:string,eyeY:number,time=34,look?:{yaw:number;pitch:number}){
      await ocean.ready;const profile=CAPTURE_PROFILES.find(p=>p.name===name);if(!profile||!Number.isFinite(eyeY))throw new Error('Known terrain view and actual finite eye height required');
      if(look&&(!Number.isFinite(look.yaw)||!Number.isFinite(look.pitch)||Math.abs(look.pitch)>1.35))throw new Error('Finite bounded comparison look required');
      const before=captureHost.readState(),clock=ocean.diagnostics.time;
      try{
        captureHost.visualLock(true);captureHost.setPaused(true);captureHost.setQuality('high');captureHost.setPreset('day');
        const p=profile.pose;captureHost.viewpoint(p.x,p.z,look?.yaw??p.yaw,look?.pitch??p.pitch,p.mode,p.depth,eyeY);ocean.setObservationClock(time);
        for(let i=0;i<20;i++)await captureHost.nextFrame();const png=await capturePNG();if(!png)throw new Error('No terrain PNG');
        const state=captureHost.readState();if(state.width!==1280||state.height!==720)throw new Error(`Comparison dimensions ${state.width}x${state.height}; expected 1280x720`);
        const diagnostic=ocean.diagnostics;
        return {png,metadata:{name,state,time:diagnostic.time,topography:diagnostic.topography,foliage:diagnostic.foliage,draws:diagnostic.draws,triangles:diagnostic.triangles,scope:'Separate fully initialized terrain instances, aligned actual camera and FFT time; current-pose render counters before restoration; static terrain/foliage comparison only, no identical fish/solver histories or movement/Human proof'}};
      }finally{try{ocean.setObservationClock(clock);}finally{captureHost.restoreState(before);}}
    },
    async captureFrozenFrames(name:string,eyeY:number,time=34){
      await ocean.ready;const profile=CAPTURE_PROFILES.find(p=>p.name===name);if(!profile)throw new Error('Known view required');
      const before=captureHost.readState(),clock=ocean.diagnostics.time,frames=[];
      try{
        captureHost.visualLock(true);captureHost.setPaused(true);captureHost.setQuality('high');captureHost.setPreset('day');
        const p=profile.pose;captureHost.viewpoint(p.x,p.z,p.yaw,p.pitch,p.mode,p.depth,eyeY);ocean.setObservationClock(time);
        for(let i=0;i<12;i++)await captureHost.nextFrame();
        for(let i=0;i<6;i++){
          const png=await capturePNG();if(!png)throw new Error('No frozen frame');
          frames.push({png,metadata:{state:captureHost.readState(),time:ocean.diagnostics.time,frame:ocean.diagnostics.frames}});
        }
        return {frames,scope:'One frozen camera and simulation clock over successive actual render frames; diagnostic cadence only, not movement proof'};
      }finally{try{ocean.setObservationClock(clock);}finally{captureHost.restoreState(before);}}
    },
    async captureWaterDiagnostic(name:string,time=34.016666666666666,exerciseResize=false){
      await ocean.ready;const profile=CAPTURE_PROFILES.find(p=>p.name===name);if(!profile||!Number.isFinite(time))throw new Error('Known water diagnostic view and finite time required');
      const before=captureHost.readState(),clock=ocean.diagnostics.time,reflection=ocean.setReflectionSampling(true),variants=[];
      try{
        captureHost.visualLock(true);captureHost.setPaused(true);captureHost.setQuality('high');captureHost.setPreset('day');
        const p=profile.pose;captureHost.viewpoint(p.x,p.z,p.yaw,p.pitch,p.mode,p.depth);ocean.setObservationClock(time);
        if(exerciseResize)for(const quality of ['medium','high'] as const){
          while(ocean.diagnostics.frames%3!==1)await captureHost.nextFrame();
          captureHost.setQuality(quality);for(let i=0;i<6;i++)await captureHost.nextFrame();
        }
        for(const enabled of [true,false,true]){
          ocean.setReflectionSampling(enabled);for(let i=0;i<36;i++)await captureHost.nextFrame();
          const png=await capturePNG();if(!png)throw new Error('No water diagnostic image');
          const state=captureHost.readState(),frame=ocean.diagnostics.frames;
          const probe=profile.pose.mode==='dive'?{available:false,reason:'Parameter probes apply to the above-water branch only'}:ocean.probeWaterContact([{x:.46,y:.47},{x:.60,y:.50},{x:.75,y:.57},{x:.53,y:.60}]);
          variants.push({png,metadata:{enabled,state,frame,time:ocean.diagnostics.time,exerciseResize,probe,reflectionTarget:ocean.probeReflectionTarget()}});
        }
        return {variants,scope:'One frozen camera and clock; only planar-reflection sampling changes. Normal/Fresnel/path probes isolate water optics; no gameplay or photo-quality claim'};
      }finally{ocean.setReflectionSampling(reflection);ocean.setObservationClock(clock);captureHost.restoreState(before);}
    },
    async captureGeometryComparison(name:string,look?:{x?:number;z?:number;yaw?:number;pitch?:number;mode?:'walk'|'swim'|'dive';depth?:number},probePoints?:readonly{x:number;y:number}[]){
      await ocean.ready;const profile=CAPTURE_PROFILES.find(p=>p.name===name);if(!profile)throw new Error('Known geometry view required');
      const before=captureHost.readState(),previous=ocean.getGeometryRefraction(),variants=[];
      try{
        captureHost.visualLock(true);captureHost.setQuality('high');captureHost.setPreset('day');const p=profile.pose;
        const x=look?.x??p.x,z=look?.z??p.z,yaw=look?.yaw??p.yaw,pitch=look?.pitch??p.pitch,depth=look?.depth??p.depth,mode=look?.mode??p.mode;
        if(![x,z,yaw,pitch,depth??0].every(Number.isFinite)||Math.abs(pitch)>1.35||(depth??0)<0||(depth??0)>100||!['walk','swim','dive'].includes(mode))throw new Error('Finite bounded geometry comparison pose required');
        captureHost.viewpoint(x,z,yaw,pitch,mode,depth);
        captureHost.setPaused(false);await new Promise(resolve=>setTimeout(resolve,3000));captureHost.setPaused(true);await ocean.prepareGeometryReceivers();
        const points=probePoints??[.4,.6,.8].flatMap(x=>[.4,.5,.6,.7].map(y=>({x,y})));
        if(points.length>16||points.some(p=>![p.x,p.y].every(Number.isFinite)||p.x<0||p.x>1||p.y<0||p.y>1))throw new Error('At most16 finite normalized receiver probes required');
        for(const enabled of [false,true,false]){
          await ocean.setGeometryRefraction(enabled);for(let i=0;i<8;i++)await captureHost.nextFrame();
          const intervals=[];let last=await new Promise<number>(resolve=>requestAnimationFrame(resolve));for(let i=0;i<24;i++){const now=await new Promise<number>(resolve=>requestAnimationFrame(resolve));intervals.push(now-last);last=now;}
          const png=await capturePNG();if(!png)throw new Error('No geometry PNG');variants.push({png,metadata:{enabled,state:captureHost.readState(),time:ocean.diagnostics.time,probe:ocean.probeWaterContact(points),receiver:ocean.probeGeometryReceivers(),frameIntervalsMs:intervals}});
        }
        return {variants,scope:'Frozen actual camera/FFT/instance poses/light; legacy screen receiver vs opaque and posed-body triangle BVH + barycentric bed. Filtered photographed maps, sand wet response and measured diffuse SH; custom-material/specular-IBL parity and Human/travel proof remain unmet'};
      }finally{try{await ocean.setGeometryRefraction(previous);}finally{captureHost.restoreState(before);}}
    },
    async observeGeometryMotion(){
      await ocean.ready;const before=captureHost.readState(),previous=ocean.getGeometryRefraction();
      const variants=[],environments=[];
      try{
        await ocean.setGeometryRefraction(true);
        for(const name of Object.keys(presets) as PresetName[]){
          ocean.setPreset(name);
          for(let i=0;i<8;i++)await captureHost.nextFrame();
          environments.push({requested:name,receiver:ocean.probeGeometryReceivers().irradiance});
        }
        ocean.setPreset('day');
        for(const enabled of [false,true]){
          captureHost.restoreState(before);captureHost.viewpoint(-42,9,-.56,-1.1,'walk');
          captureHost.visualLock(false);captureHost.setPaused(false);captureHost.setQuality('high');captureHost.setPreset('day');
          await ocean.setGeometryRefraction(enabled);
          for(let i=0;i<8;i++)await captureHost.nextFrame();
          const samples=[];let last=performance.now();const started=last;
          ocean.adventure.setMove(0,1);
          while(performance.now()-started<12000){
            await new Promise(resolve=>requestAnimationFrame(resolve));
            const now=performance.now();samples.push({elapsedMs:now-started,frameMs:now-last,position:ocean.adventure.state.position.toArray(),camera:ocean.camera.position.toArray(),adventure:JSON.parse(JSON.stringify(ocean.diagnostics.adventure)),skin:ocean.probeGeometryReceivers().skinned});last=now;
          }
          ocean.adventure.setMove(0,0);const png=await capturePNG();
          variants.push({enabled,samples,png,receiver:ocean.probeGeometryReceivers()});
        }
        return {environments,variants,shaderWarmupFrames:8,scope:'Two controller-input movement observations from one shared QA start per variant after shader warmup; moving-pose CPU/GPU frame workload, not native input, complete travel, or Human acceptance'};
      }finally{
        ocean.adventure.setMove(0,0);ocean.adventure.setVertical(0);
        try{await ocean.setGeometryRefraction(previous);}finally{captureHost.restoreState(before);}
      }
    },
    captureAt:(x:number,z:number,yaw:number,pitch:number,mode:'walk'|'swim'|'dive'='walk',depth=4,eyeY?:number)=>{
      if(![x,z,yaw,pitch,depth].every(Number.isFinite)||depth<0||depth>100||!['walk','swim','dive'].includes(mode))throw new Error('Finite capture pose required');
      if(eyeY!==undefined&&!Number.isFinite(eyeY))throw new Error('Finite comparison eye height required');
      return captureNamed(captureHost,{name:'custom',pose:{x,z,yaw,pitch,mode,depth,eyeY},provenance:'Authored developer comparison camera; no travel or surveyed camera claim'},{quality:'high',preset:'day',width:1280,height:720,timeoutMs:30000,warmupFrames:30});
    },
    async captureLive(name:string,milliseconds=6000,wind=8.5,swell=1,look?:{yaw:number;pitch:number;x?:number;z?:number;mode?:'walk'|'swim'|'dive';depth?:number},compareBreaker=false,compareShore=false,compareContact=false,compareLight=false,compareFoam=false){
      await ocean.ready;const before=captureHost.readState(),profile=CAPTURE_PROFILES.find(p=>p.name===name);if(!profile)throw new Error('Unknown capture view');
      const previousLight=ocean.getCausticResolution();
      try{
        captureHost.visualLock(true);captureHost.setQuality('high');captureHost.setPreset('day');
        ocean.setWind(Math.max(0,Math.min(18,wind)));ocean.setSwell(Math.max(.5,Math.min(1.5,swell)));
        const p=profile.pose,yaw=look&&Number.isFinite(look.yaw)?look.yaw:p.yaw,pitch=look&&Number.isFinite(look.pitch)?Math.max(-1.35,Math.min(1.35,look.pitch)):p.pitch;
        const x=Number.isFinite(look?.x)?look!.x!:p.x,z=Number.isFinite(look?.z)?look!.z!:p.z;
        const mode=look?.mode&&['walk','swim','dive'].includes(look.mode)?look.mode:p.mode;
        const depth=Number.isFinite(look?.depth)?Math.max(0,Math.min(100,look!.depth!)):p.depth;
        captureHost.viewpoint(x,z,yaw,pitch,mode,depth);captureHost.setPaused(false);
        await new Promise(resolve=>setTimeout(resolve,Math.max(2000,Math.min(15000,milliseconds))));
        captureHost.setPaused(true);await captureHost.nextFrame();await captureHost.nextFrame();
        const state=captureHost.readState(),png=await capturePNG();if(!png)throw new Error('No live capture');
        let pngWithoutWhitewater:string|null=null,pngWithoutSurfaceFoam:string|null=null,pngFoamFilm:string|null=null;
        if(compareFoam){
          const visible=ocean.setWhitewaterVisible(false),hidden=ocean.uniforms.uHideSurfaceFoam.value,film=ocean.uniforms.uFoamFilm.value;
          try{
            for(let i=0;i<6;i++)await captureHost.nextFrame();pngWithoutWhitewater=await capturePNG();
            ocean.uniforms.uFoamFilm.value=1;for(let i=0;i<6;i++)await captureHost.nextFrame();pngFoamFilm=await capturePNG();ocean.uniforms.uFoamFilm.value=film;
            ocean.uniforms.uHideSurfaceFoam.value=1;for(let i=0;i<6;i++)await captureHost.nextFrame();pngWithoutSurfaceFoam=await capturePNG();
          }finally{ocean.uniforms.uHideSurfaceFoam.value=hidden;ocean.uniforms.uFoamFilm.value=film;ocean.setWhitewaterVisible(visible);}
        }
        const shoreSolver=ocean.diagnostics.shoreSolver;
        const shoreState=compareShore?ocean.probeShoreState():null;
        const crestProbe=compareBreaker?ocean.probeCrestDriver():null;
        let pngWithoutShore:string|null=null;
        if(compareShore){
          try{ocean.setShoreCandidateEnabled(false);await captureHost.nextFrame();await captureHost.nextFrame();pngWithoutShore=await capturePNG();}
          finally{ocean.setShoreCandidateEnabled(true);}
        }
        let pngWithoutBreaker:string|null=null;
        if(compareBreaker){
          const enabled=ocean.getBreakerCandidateEnabled();
          try{ocean.setBreakerCandidateEnabled(false);await captureHost.nextFrame();await captureHost.nextFrame();pngWithoutBreaker=await capturePNG();}
          finally{ocean.setBreakerCandidateEnabled(enabled);}
        }
        const contactProbe=compareContact?ocean.probeWaterContact([{x:840/1280,y:400/720},{x:800/1280,y:405/720},{x:750/1280,y:415/720},{x:650/1280,y:430/720}]):null;
        let pngWithoutContact:string|null=null;
        let pngWithoutWetNormal:string|null=null,legacyNormalProbe:ReturnType<typeof ocean.probeWaterContact>|null=null;
        if(compareContact){
          const wetStencil=ocean.uniforms.uWetStencil.value;
          try{ocean.uniforms.uWetStencil.value=0;await captureHost.nextFrame();await captureHost.nextFrame();pngWithoutWetNormal=await capturePNG();legacyNormalProbe=ocean.probeWaterContact([{x:840/1280,y:400/720},{x:800/1280,y:405/720},{x:750/1280,y:415/720},{x:650/1280,y:430/720}]);}
          finally{ocean.uniforms.uWetStencil.value=wetStencil;}
          const enabled=ocean.uniforms.uPointwiseContact.value;
          try{ocean.uniforms.uPointwiseContact.value=0;await captureHost.nextFrame();await captureHost.nextFrame();pngWithoutContact=await capturePNG();}
          finally{ocean.uniforms.uPointwiseContact.value=enabled;}
        }
        const lightComparison=[];
        if(compareLight)for(const density of [256,512,256] as const){
          ocean.setCausticResolution(density);
          for(let i=0;i<8;i++)await captureHost.nextFrame();
          const intervals:number[]=[];let last=await new Promise<number>(resolve=>requestAnimationFrame(resolve));
          for(let i=0;i<32;i++){const now=await new Promise<number>(resolve=>requestAnimationFrame(resolve));intervals.push(now-last);last=now;}
          const image=await capturePNG();if(!image)throw new Error('No frozen light capture');
          lightComparison.push({png:image,metadata:{density,photons:density*density,time:ocean.diagnostics.time,state:captureHost.readState(),optics:ocean.probeOptics(),frameIntervalsMs:intervals,timingScope:'Actual browser RAF wall intervals for whole scene, not isolated GPU timer-query time'}});
        }
        return {png,pngWithoutWhitewater,pngWithoutSurfaceFoam,pngFoamFilm,pngWithoutBreaker,pngWithoutShore,pngWithoutContact,pngWithoutWetNormal,contactProbe,legacyNormalProbe,crestProbe,lightComparison,metadata:{...state,name,provenance:look?'QA bookmark position with an explicit alternate look; not a surveyed camera':profile.provenance,evidence:'visual-only after live wave update',movementVerified:false,humanAccepted:false,time:ocean.diagnostics.time,spray:ocean.diagnostics.spray,shoreSolver,shoreState,foamComparison:compareFoam?'Frozen state: all foam, whitewater pool hidden, both pool and surface-shader foam hidden':null,shoreComparison:compareShore?'Frozen FFT time, finite-volume state and existing particle history, camera and environment; solved surface on/off':null,breakerComparison:compareBreaker?'Frozen FFT time, camera and environment; supplemental shell on/off only':null,contactComparison:compareContact?'Frozen FFT/solver/particles/camera/light; pointwise contact vs historical FFT-origin clip only':null,lightComparison:compareLight?'One frozen camera/FFT/solver/time/environment; legacy256->fine512->legacy256, caustic history reset only':null}};
      }finally{try{ocean.setCausticResolution(previousLight);}finally{captureHost.restoreState(before);}}
    },
    async captureTemporal(name:string,stops:number[]=[0,3,6,12],wind=8.5,swell=1,look?:{x?:number;z?:number;yaw?:number;pitch?:number;mode?:'walk'|'swim'|'dive';depth?:number},startClock?:number,probes:readonly{x:number;y:number}[]=[],compareSand=false,compareFoam=false){
      if(stops.length<1||stops.length>6||stops[0]!==0||stops.some((t,i)=>!Number.isFinite(t)||t<0||t>20||(i>0&&t<=stops[i-1])))throw new Error('Ordered capture stops 0..20 seconds required');
      await ocean.ready;const before=captureHost.readState(),profile=CAPTURE_PROFILES.find(p=>p.name===name);if(!profile)throw new Error('Unknown temporal capture view');
      if(startClock!==undefined&&(!Number.isFinite(startClock)||startClock<0||startClock>86400))throw new Error('Finite bounded QA clock required');
      const clock=ocean.diagnostics.time,frames=[];
      try{
        captureHost.visualLock(true);captureHost.setQuality('high');captureHost.setPreset('day');ocean.setWind(Math.max(2,Math.min(18,wind)));ocean.setSwell(Math.max(.3,Math.min(2,swell)));
        const p=profile.pose;captureHost.viewpoint(Number.isFinite(look?.x)?look!.x!:p.x,Number.isFinite(look?.z)?look!.z!:p.z,Number.isFinite(look?.yaw)?look!.yaw!:p.yaw,Number.isFinite(look?.pitch)?Math.max(-1.35,Math.min(1.35,look!.pitch!)):p.pitch,look?.mode??p.mode,Number.isFinite(look?.depth)?Math.max(0,Math.min(100,look!.depth!)):p.depth);captureHost.setPaused(true);await captureHost.nextFrame();
        if(startClock!==undefined){ocean.setObservationClock(startClock);await captureHost.nextFrame();}
        for(let i=0;i<stops.length;i++){
          if(i){captureHost.setPaused(false);await new Promise(resolve=>setTimeout(resolve,(stops[i]-stops[i-1])*1000));captureHost.setPaused(true);}
          await captureHost.nextFrame();const png=await capturePNG();if(!png)throw new Error('No temporal capture');
          frames.push({png,metadata:{...captureHost.readState(),name,requestedSeconds:stops[i],time:ocean.diagnostics.time,spray:{...ocean.diagnostics.spray},shoreSolver:ocean.diagnostics.shoreSolver,sandMoisture:ocean.diagnostics.sandMoisture,provenance:'One QA camera, preset and spectrum initialization; continuous solver/particle history, no inter-frame restore; not travel or surveyed conditions',humanAccepted:false}});
        }
        const visible=ocean.setWhitewaterVisible(false);
        try{
          await captureHost.nextFrame();await captureHost.nextFrame();const pngWithoutWhitewater=await capturePNG(),contactProbe=probes.length?ocean.probeWaterContact(probes):null;
          let pngWithoutSurfaceFoam:string|null=null;
          const foamComparison=[];
          if(compareFoam){
            const hidden=ocean.uniforms.uHideSurfaceFoam.value;ocean.uniforms.uHideSurfaceFoam.value=1;
            try{await captureHost.nextFrame();await captureHost.nextFrame();pngWithoutSurfaceFoam=await capturePNG();}
            finally{ocean.uniforms.uHideSurfaceFoam.value=hidden;}
            const structure=ocean.uniforms.uFoamStructure.value;
            try{
              ocean.setWhitewaterVisible(visible);
              for(const value of [0,1,0]){
                ocean.uniforms.uFoamStructure.value=value;for(let i=0;i<8;i++)await captureHost.nextFrame();
                const intervals:number[]=[];let last=await new Promise<number>(resolve=>requestAnimationFrame(resolve));
                for(let i=0;i<30;i++){const now=await new Promise<number>(resolve=>requestAnimationFrame(resolve));intervals.push(now-last);last=now;}
                foamComparison.push({png:await capturePNG(),metadata:{structure:value,time:ocean.diagnostics.time,state:captureHost.readState(),shore:ocean.probeShoreState(),frameIntervalsMs:intervals,scope:'Frozen FFT/SWE/camera/light/foam history; one material uniform only, whole-frame RAF timing'}});
              }
              ocean.setWhitewaterVisible(false);ocean.uniforms.uHideSurfaceFoam.value=1;
              for(const value of [0,1]){ocean.uniforms.uFoamStructure.value=value;await captureHost.nextFrame();await captureHost.nextFrame();foamComparison.push({png:await capturePNG(),metadata:{structure:value,surfaceHidden:true,time:ocean.diagnostics.time,scope:'No surface foam and no pool; must remain identical'}});}
            }finally{ocean.uniforms.uFoamStructure.value=structure;ocean.uniforms.uHideSurfaceFoam.value=hidden;ocean.setWhitewaterVisible(false);}
          }
          let pngLegacySand:string|null=null;
          if(compareSand){
            ocean.setWhitewaterVisible(visible);const enabled=ocean.setSandMemoryEnabled(false);
            try{await captureHost.nextFrame();await captureHost.nextFrame();pngLegacySand=await capturePNG();}
            finally{ocean.setSandMemoryEnabled(enabled);}
          }
          return {frames,pngWithoutWhitewater,pngWithoutSurfaceFoam,foamComparison,pngLegacySand,contactProbe,whitewaterComparison:'Frozen same solver, particles, camera and light; pool first hidden, then surface foam hidden when requested',sandComparison:compareSand?'Same final camera/FFT/SWE/particles/light; only old vs new sand material response':null};
        }
        finally{ocean.setWhitewaterVisible(visible);}
      }finally{try{if(startClock!==undefined){captureHost.setPaused(true);ocean.setObservationClock(clock);}}finally{captureHost.restoreState(before);}}
    },
    async captureCrestSeries(name:string,seconds=12,interval=.2,wind=14,swell=1.3,look?:{x:number;z:number;yaw:number;pitch:number;mode?:'walk'|'swim'|'dive';depth?:number},compareTracked=false,compareBackfaces=false){
      if(crestSeriesBusy)throw new Error('Crest series already in flight');
      if(!Number.isFinite(seconds)||seconds<=0||seconds>12||!Number.isFinite(interval)||interval<.2||interval>2||Math.ceil(seconds/interval)+1>64)throw new Error('Bounded crest series: 0..12 seconds, interval .2..2 seconds, at most64 samples');
      if(!Number.isFinite(wind)||!Number.isFinite(swell)||wind<0||wind>18||swell<.5||swell>1.5)throw new Error('Finite bounded wind/swell required');
      if(look&&(![look.x,look.z,look.yaw,look.pitch,look.depth??0].every(Number.isFinite)||Math.abs(look.pitch)>1.35||(look.depth??0)<0||(look.depth??0)>100||!['walk','swim','dive'].includes(look.mode??'walk')))throw new Error('Finite bounded capture pose required');
      const profile=CAPTURE_PROFILES.find(p=>p.name===name);if(!profile)throw new Error('Unknown crest series view');
      let before:CaptureState|undefined;const samples=[];
      let initialPNG:string|null=null,finalPNG:string|null=null;
      const activeComparisons=[];let largestRadius=0;
      crestSeriesBusy=true;
      try{
        // Acquire before the first await, including an already-resolved ready.
        await ocean.ready;before=captureHost.readState();
        captureHost.visualLock(true);captureHost.setQuality('high');captureHost.setPreset('day');ocean.setWind(wind);ocean.setSwell(swell);
        const p=look??profile.pose;captureHost.viewpoint(p.x,p.z,p.yaw,p.pitch,p.mode??'walk',p.depth);captureHost.setPaused(false);
        // One initialization and warmup; never reset solver or particle history between samples.
        await new Promise(resolve=>setTimeout(resolve,3000));
        const started=performance.now(),count=Math.ceil(seconds/interval)+1;
        for(let i=0;i<count;i++){
          const requestedSeconds=Math.min(seconds,i*interval);
          await new Promise(resolve=>setTimeout(resolve,Math.max(0,started+requestedSeconds*1000-performance.now())));
          captureHost.setPaused(true);await captureHost.nextFrame();
          const probe=ocean.probeCrestDriver(true);if(!probe?.available)throw new Error('Expanded crest probe requires the opt-in breaker and float render-target support');
          samples.push({requestedSeconds,wallSeconds:(performance.now()-started)/1000,time:ocean.diagnostics.time,state:captureHost.readState(),probe});
          if(compareTracked&&'fronts' in probe&&Array.isArray(probe.fronts)&&activeComparisons.length<3){
            const radius=Math.max(...probe.fronts.map(p=>p.shape[1]));
            if(radius>largestRadius+.02){
              largestRadius=radius;const enabled=ocean.getBreakerCandidateEnabled(),bodyVisible=ocean.body.group.visible;
              const frames=[];
              try{
                ocean.body.group.visible=false;
                for(const show of [false,true,false]){
                  ocean.setBreakerCandidateEnabled(show);await captureHost.nextFrame();await captureHost.nextFrame();
                  frames.push({enabled:show,png:await capturePNG()});
                }
              }finally{ocean.body.group.visible=bodyVisible;ocean.setBreakerCandidateEnabled(enabled);}
              let backfacesPNG:string|null=null;
              if(compareBackfaces){
                const previous=ocean.setBreakerBackfaces(true);ocean.body.group.visible=false;ocean.setBreakerCandidateEnabled(true);
                try{await captureHost.nextFrame();await captureHost.nextFrame();backfacesPNG=await capturePNG();}
                finally{ocean.setBreakerBackfaces(previous);ocean.body.group.visible=bodyVisible;ocean.setBreakerCandidateEnabled(enabled);}
              }
              activeComparisons.push({sampleIndex:i,time:ocean.diagnostics.time,radius,frames,backfacesPNG,scope:'Frozen same FFT/SWE/front state/camera/light; only sheet visibility changes. Body hidden for this diagnostic and restored. Optional fourth image enables backfaces of the same closed geometry.'});
            }
          }
          if(i===0)initialPNG=await capturePNG();if(i===count-1)finalPNG=await capturePNG();
          captureHost.setPaused(false);
        }
        return {samples,initialPNG,finalPNG,activeComparisons,provenance:'One QA pose/preset/spectrum initialization; continuous solved history, paused only for observations; actual simulation/wall timestamps recorded. No travel, surveyed conditions or Human proof.',compressionEvidence:'Named GPU channels; interpret only valid domain/stencil samples. Invalid samples are not physical zeros.'};
      }finally{try{if(before)captureHost.restoreState(before);}finally{crestSeriesBusy=false;}}
    },
    captureMatrix:()=>captureMatrix(captureHost,{quality:'high',preset:'day',width:1280,height:720,timeoutMs:45000,warmupFrames:30}),
  }});
  if(import.meta.env.DEV){
    const api=(window as unknown as {__seaQA:Record<string,(...args:unknown[])=>Promise<unknown>>}).__seaQA;
    const gate=createCaptureGate();
    for(const name of ['captureMirrorComparison','captureStaticCoast','captureCoastPose','captureSandComparison','captureNamed','captureAligned','captureAt','captureLive','captureTemporal','captureCrestSeries','captureMatrix','capturePixels','captureLeafComparison','observeFishMotion','captureOpticalComparison','captureTerrainPose','captureFrozenFrames','captureWaterDiagnostic','captureGeometryComparison','observeGeometryMotion','captureGateFinish','inspectBodyComparison','inspectShoreTransport','inspectGpuSkin','inspectGpuSkinLifecycle','inspectSandMoisture','inspectFoamStructure']){
      const original=api[name];api[name]=(...args)=>gate.run(()=>original(...args));
    }
  }
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
      button.setAttribute('aria-label', enabled ? '環境音をオフにする' : '環境音をオンにする');
      toast(enabled ? '風と水、動きに合わせた海の音。' : '環境音を止めました。');
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
    if (event.defaultPrevented || event.repeat || event.isComposing || event.ctrlKey || event.metaKey || event.altKey || !available) return;
    if(controlSettingsUI.isOpen)return;
    if(expeditionUI.isOpen){
      if(controls.matches('journal',event.code)&&!isTextInput(event.target)){event.preventDefault();expeditionUI.close();}
      return;
    }
    if(event.code==='Escape'&&adventureUI.isPanelOpen){event.preventDefault();adventureUI.close();return;}
    if (event.key === 'Escape' && document.body.classList.contains('immersed')) {
      event.preventDefault();
      toggleImmersive();
      return;
    }
    if (isTextInput(event.target)) return;
    if(controls.matches('settings',event.code)){event.preventDefault();openControls();}
    else if(controls.matches('map',event.code)){event.preventDefault();revealUI();queueMicrotask(()=>adventureUI.toggleMap());}
    else if(controls.matches('journal',event.code)){event.preventDefault();revealUI();queueMicrotask(()=>expeditionUI.open());}
    else if(controls.matches('immersive',event.code)){event.preventDefault();toggleImmersive();}
    else if(controls.matches('pause',event.code)){event.preventDefault();togglePause();}
    else if(controls.matches('view',event.code)){event.preventDefault();toast(ocean.viewCamera.toggle()==='third'?'三人称視点':'一人称視点');}
  }, { ...events, capture: true });
  document.addEventListener('visibilitychange', () => void sound.setVisible(!document.hidden && available).catch(() => {}), events);
  window.addEventListener('ocean-error', event => showError((event as CustomEvent<string>).detail), events);
  if (import.meta.hot) {
    import.meta.hot.dispose(() => {
      disposed = true;
      clearTimeout(windTimer); clearTimeout(toastTimer);
      cancelAnimationFrame(uiFrame); controlSettingsUI.dispose();unsubscribeHints();adventureUI.dispose();expeditionUI.dispose();
      activityUI.dispose();
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
