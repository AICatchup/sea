import './activity.css';
import type {ActivitySession} from '../activities/session.ts';
import type {AdventureState} from '../world/contracts.ts';
import type {ControlSettings} from '../input/control-settings.ts';
const setText=(element:HTMLElement,value:string)=>{if(element.textContent!==value)element.textContent=value;};
export class ActivityUI{
 private root=document.createElement('section');private title=document.createElement('strong');private detail=document.createElement('p');private meter=document.createElement('meter');private button=document.createElement('button');private hint=document.createElement('small');
 constructor(private activity:ActivitySession,private controls:ControlSettings,activate:()=>void){
  this.root.className='activity-hud';this.root.setAttribute('aria-label','海でのアクティビティ');this.meter.min=0;this.meter.max=1;this.meter.low=.25;this.meter.high=.78;this.meter.optimum=.5;this.meter.setAttribute('aria-label','糸の張力 / ボードのバランス');this.button.onclick=activate;this.root.append(this.title,this.detail,this.meter,this.button,this.hint);document.body.append(this.root);
 }
 update(s:AdventureState,blocked:boolean):void{
  const a=this.activity,label=a.hint(s);const hidden=!label&&a.tool==='none';if(this.root.hidden!==hidden)this.root.hidden=hidden;if(hidden)return;
  const disabled=blocked||!label;if(this.button.disabled!==disabled)this.button.disabled=disabled;
  setText(this.button,`${this.controls.primary('activity')} · ${label||'道具を使う'}`);const meterHidden=a.tool==='none';if(this.meter.hidden!==meterHidden)this.meter.hidden=meterHidden;
  if(a.tool==='rod'){const f=a.fishing.snapshot();setText(this.title,f.phase==='caught'&&f.catch?`${f.catch.species} · ${f.catch.lengthCm} cm`:'波間の釣り');setText(this.detail,f.phase==='reeling'?`取り込み ${Math.round(f.progress*100)}% · 張りすぎたら緩めよう`:f.message);if(this.meter.value!==f.tension)this.meter.value=f.tension;setText(this.hint,`${this.controls.primary('interact')} 竿をしまう · ${a.catches}匹 / 最長 ${a.bestFish||'—'}cm`);}
  else if(a.tool==='board'){setText(this.title,a.surf.phase==='riding'?'波に乗る':'新島のサーフィン');setText(this.detail,`${a.surfOutput?.hint??'ボードを持って、波打ち際へ。'} · ${a.surf.rideDistance.toFixed(1)}m`);if(this.meter.value!==a.surf.balance)this.meter.value=a.surf.balance;setText(this.hint,`${this.controls.primary('forward')} パドル · ${this.controls.primary('left')}/${this.controls.primary('right')} ターン · ${this.controls.primary('interact')} ボードを置く`);}
  else{setText(this.title,s.mode==='boat'?'船上で、ひと息':'海で遊ぶ');setText(this.detail,label.includes('サーフ')?'ボードを抱えて浜から海へ。動く波をつかもう。':'水面へ投げ、浮きが沈んだら合わせよう。');setText(this.hint,label.includes('サーフ')?'ボードを持って歩き、そのまま海へ入れます。':'移動や操船を再開すると、釣りは中断します。');}
 }
 dispose(){this.button.onclick=null;this.root.remove();}
}
