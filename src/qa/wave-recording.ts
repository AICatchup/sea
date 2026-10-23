import type {createCaptureGate} from './capture-exclusivity';
import type {Ocean} from '../ocean/renderer';
import type {SceneCaptureHost} from './scene-capture';
import {captureSoundtrack} from '../audio/capture-soundtrack';
import type {SoundscapeFrame} from '../audio/soundscape-state';

/** Developer UI for bounded, actual game frames on simulation time. */
export function mountWaveRecording(ocean:Ocean,host:SceneCaptureHost,gate:ReturnType<typeof createCaptureGate>):()=>void {
  const panel=document.createElement('section');panel.setAttribute('aria-label','波の収録検証');
  Object.assign(panel.style,{position:'fixed',bottom:'48px',right:'16px',zIndex:'1000',padding:'12px',background:'#102c39ed',color:'white',font:'13px sans-serif',maxWidth:'320px'});
  const button=document.createElement('button');button.textContent='波を18秒収録（音付き素材）';
  const cancel=document.createElement('button');cancel.textContent='収録を中止';cancel.disabled=true;
  const status=document.createElement('p');status.setAttribute('role','status');status.textContent='ゲームを1/60秒ずつ進め、10fpsで保存。実時間性能の測定ではありません。';
  panel.append(button,cancel,status);document.body.append(panel);
  let stopped=false,busy=false,disposed=false;cancel.onclick=()=>{stopped=true;};
  const record=async()=>{
    if(busy)return;busy=true;stopped=false;button.disabled=true;cancel.disabled=false;
    let before:ReturnType<typeof host.readState>|undefined;
    const frames:{jpeg:string;time:number;spray:unknown;shore:unknown}[]=[],audio:SoundscapeFrame[]=[];
    try {
      await ocean.ready;before=host.readState();host.visualLock(true);host.setPaused(true);
      host.setQuality('high');host.setPreset('typhoon');
      host.viewpoint(5922,-923.918,2.2142974,-.12,'walk',0,2.4);ocean.setObservationClock(0);
      const started=performance.now();let bytes=0;
      for(let i=0;i<=180;i++){
        if(stopped)throw new Error('収録を中止しました。');
        if(document.hidden)throw new Error('非表示になったため収録を中止しました。');
        if(performance.now()-started>15*60*1000)throw new Error('収録時間の上限に達しました。');
        if(i)await ocean.advanceObservation(.1);
        const jpeg=ocean.renderStaticSnapshot('image/jpeg');bytes+=jpeg.length;
        if(bytes>160*1024*1024)throw new Error('収録メモリの上限に達しました。');
        const d=ocean.diagnostics;
        frames.push({jpeg,time:d.time,spray:{frontEvents:d.spray.frontEvents,lipActive:d.spray.lipActive,lipImpacts:d.spray.lipImpacts,whitewaterEmitted:d.spray.whitewaterEmitted,geometryAudit:d.spray.geometryAudit},shore:d.shoreSolver});
        audio.push(ocean.soundFrame(i?.1:1/60));
        status.textContent=`収録 ${(i/10).toFixed(1)} / 18秒 · ${i+1}フレーム · 砕波 ${d.spray.lipImpacts}回`;
        await new Promise(resolve=>setTimeout(resolve,0));
      }
      status.textContent='同じゲーム音声を映像の時刻で合成しています。';
      const wav=await captureSoundtrack(audio,18.1);
      const blob=new Blob([JSON.stringify({fps:10,simulationStep:1/60,realtime:false,pose:host.readState(),frames,wav,audioFrames:audio})],{type:'application/json'});
      const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download='sea-wave-recording.json';link.textContent='音付き収録素材を保存';
      panel.append(link);link.click();setTimeout(()=>URL.revokeObjectURL(url),120000);
      status.textContent='181フレームと音声を保存しました。実画面と動画で見た目を確認してください。';
    }catch(error){status.textContent=error instanceof Error?error.message:String(error);}
    finally{if(before&&!disposed)host.restoreState(before);frames.length=0;audio.length=0;busy=false;button.disabled=false;cancel.disabled=true;}
  };
  button.onclick=()=>{void gate.run(record).catch(error=>{status.textContent=error instanceof Error?error.message:String(error);});};
  return()=>{disposed=true;stopped=true;panel.remove();};
}
