import type {createCaptureGate} from './capture-exclusivity';
import type {Ocean} from '../ocean/renderer';
import type {SceneCaptureHost} from './scene-capture';
import {captureSoundtrack} from '../audio/capture-soundtrack';
import type {SoundscapeFrame} from '../audio/soundscape-state';

/** Developer UI for bounded, actual game frames on simulation time. */
export function mountWaveRecording(ocean:Ocean,host:SceneCaptureHost,gate:ReturnType<typeof createCaptureGate>):()=>void {
  // This explicit diagnostic page waits for its capture button. Avoid running
  // an unobserved coastal simulation while preparing/exporting evidence.
  host.setPaused(true);
  const panel=document.createElement('section');panel.setAttribute('aria-label','波の収録検証');
  Object.assign(panel.style,{position:'fixed',bottom:'48px',right:'16px',zIndex:'1000',padding:'12px',background:'#102c39ed',color:'white',font:'13px sans-serif',maxWidth:'320px'});
  const button=document.createElement('button');button.textContent='波を18秒収録（音付き素材）';
  const cancel=document.createElement('button');cancel.textContent='収録を中止';cancel.disabled=true;
  const views=[
    {label:'沖側の比較視点',x:5922,z:-923.918,yaw:2.2142974,pitch:-.12,eye:2.4},
    {label:'水際から砕波を見る',x:5898,z:-923.918,yaw:2.2142974,pitch:-.10,eye:2.4},
    {label:'横から巻き込みを見る',x:5900,z:-957,yaw:Math.PI,pitch:-.10,eye:3.2},
    {label:'波頭と着水を近くで見る',x:5922,z:-940,yaw:Math.PI,pitch:-.10,eye:2.4},
  ];
  const view=document.createElement('select');view.setAttribute('aria-label','波の検証視点');
  views.forEach((pose,i)=>{const option=document.createElement('option');option.value=String(i);option.textContent=pose.label;view.append(option);});
  const setView=()=>{const p=views[view.selectedIndex]??views[0];host.viewpoint(p.x,p.z,p.yaw,p.pitch,'walk',0,p.eye);};
  const paired=document.createElement('input');paired.type='checkbox';
  const pairedLabel=document.createElement('label');pairedLabel.append(paired,' 同時刻の材質比較も保存');
  const status=document.createElement('p');status.setAttribute('role','status');status.textContent='ゲームを最大1/60秒ずつ進め、24fpsで保存。実時間性能の測定ではありません。';
  panel.append(view,pairedLabel,button,cancel,status);document.body.append(panel);
  const save=async(data:unknown,name:string,label:string)=>{
    const body=JSON.stringify(data);
    // Opt-in local QA sink avoids putting large recordings on a full system
    // drive. The separately started helper owns the destination directory.
    if(import.meta.env.DEV&&['127.0.0.1','localhost'].includes(location.hostname)&&new URLSearchParams(location.search).get('capturestore')==='1'){
      const response=await fetch('http://127.0.0.1:5201/recordings',{method:'POST',headers:{'Content-Type':'application/json'},body});
      if(!response.ok)throw new Error(`収録保存に失敗しました (${response.status})`);
      const receipt=await response.json();const saved=document.createElement('p');saved.textContent=`保存済み: ${receipt.file}`;panel.append(saved);return;
    }
    const url=URL.createObjectURL(new Blob([body],{type:'application/json'}));
    const link=document.createElement('a');link.href=url;link.download=name;link.textContent=label;panel.append(link);link.click();setTimeout(()=>URL.revokeObjectURL(url),120000);
  };
  let stopped=false,busy=false,disposed=false;cancel.onclick=()=>{stopped=true;};
  const inspect=document.createElement('button');inspect.textContent='14秒地点を比較撮影';panel.append(inspect);
  inspect.onclick=()=>{void gate.run(async()=>{
    if(busy||disposed)return;busy=true;stopped=false;button.disabled=true;inspect.disabled=true;view.disabled=true;cancel.disabled=false;
    let before:ReturnType<typeof host.readState>|undefined;
    try{
      await ocean.ready;before=host.readState();host.visualLock(true);host.setPaused(true);host.setQuality('high');host.setPreset('typhoon');
      setView();ocean.setObservationClock(0);
      const started=performance.now();
      for(let i=0;i<140;i++){
        if(stopped||disposed)throw new Error('比較撮影を中止しました。');
        if(document.hidden)throw new Error('非表示になったため比較撮影を中止しました。');
        if(performance.now()-started>12*60*1000)throw new Error('比較撮影時間の上限に達しました。');
        await ocean.advanceObservation(.1);status.textContent=`比較準備 ${((i+1)/10).toFixed(1)} / 14秒`;await new Promise(resolve=>setTimeout(resolve,0));
      }
      const jpeg=ocean.renderStaticSnapshot('image/jpeg');
      const points=[.35,.40,.45,.50,.55,.60,.65,.70,.75,.80,.85].map(y=>({x:.5,y}));
      const impactComparison=ocean.compareBreakingSurface();
      const data={jpeg,impactComparison,diagnostics:ocean.diagnostics,optics:ocean.probeWaterContact(points)};
      await save(data,'sea-wave-comparison.json','比較画像と診断を保存');
      status.textContent='14秒地点の画像と光学診断を保存しました。';
    }catch(error){status.textContent=error instanceof Error?error.message:String(error);}
    finally{if(before&&!disposed)host.restoreState(before);busy=false;button.disabled=false;inspect.disabled=false;view.disabled=false;cancel.disabled=true;}
  }).catch(error=>{status.textContent=String(error);});};
  const record=async()=>{
    if(busy||disposed)return;busy=true;stopped=false;button.disabled=true;inspect.disabled=true;view.disabled=true;cancel.disabled=false;
    let before:ReturnType<typeof host.readState>|undefined;
    const fps=24,duration=18,comparison=paired.checked;
    const frames:{jpeg:string;beforeJpeg?:string;time:number;spray:unknown;shore:unknown}[]=[],audio:SoundscapeFrame[]=[];
    try {
      await ocean.ready;before=host.readState();host.visualLock(true);host.setPaused(true);
      host.setQuality('high');host.setPreset('typhoon');
      setView();ocean.setObservationClock(0);
      const started=performance.now();let bytes=0;
      for(let i=0;i<=duration*fps;i++){
        if(stopped||disposed)throw new Error('収録を中止しました。');
        if(document.hidden)throw new Error('非表示になったため収録を中止しました。');
        if(performance.now()-started>15*60*1000)throw new Error('収録時間の上限に達しました。');
        if(i)await ocean.advanceObservation(1/fps);
        const pair=comparison?ocean.compareBreakingSurface():null,jpeg=pair?.afterJpeg??ocean.renderStaticSnapshot('image/jpeg');bytes+=jpeg.length+(pair?.beforeJpeg.length??0);
        if(bytes>160*1024*1024)throw new Error('収録メモリの上限に達しました。');
        const d=ocean.diagnostics;
        frames.push({jpeg,...pair?{beforeJpeg:pair.beforeJpeg}:{},time:d.time,spray:{rollerActive:d.spray.rollerActive,frontEvents:d.spray.frontEvents,lipActive:d.spray.lipActive,lipImpacts:d.spray.lipImpacts,whitewaterEmitted:d.spray.whitewaterEmitted,geometryAudit:d.spray.geometryAudit},shore:d.shoreSolver});
        audio.push(ocean.soundFrame(1/fps));
        status.textContent=`収録 ${(i/fps).toFixed(1)} / 18秒 · ${i+1}フレーム · 砕波 ${d.spray.lipImpacts}回`;
        await new Promise(resolve=>setTimeout(resolve,0));
      }
      status.textContent='同じゲーム音声を映像の時刻で合成しています。';
      const wav=await captureSoundtrack(audio,duration+1/fps);
      await save({fps,simulationStep:1/60,realtime:false,comparison:comparison?'material toggles at identical physical state; geometry fixes remain enabled':false,view:views[view.selectedIndex].label,pose:host.readState(),frames,wav,audioFrames:audio},'sea-wave-recording.json','音付き収録素材を保存');
      status.textContent=`${frames.length}フレームと音声を保存しました。実画面と動画で見た目を確認してください。`;
    }catch(error){status.textContent=error instanceof Error?error.message:String(error);}
    finally{if(before&&!disposed)host.restoreState(before);frames.length=0;audio.length=0;busy=false;button.disabled=false;inspect.disabled=false;view.disabled=false;cancel.disabled=true;}
  };
  button.onclick=()=>{void gate.run(record).catch(error=>{status.textContent=error instanceof Error?error.message:String(error);});};
  return()=>{disposed=true;stopped=true;panel.remove();};
}
