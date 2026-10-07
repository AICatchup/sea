import './activity.css';
import type {ActivitySession} from '../activities/session.ts';
import type {AdventureState} from '../world/contracts.ts';
import type {ControlSettings} from '../input/control-settings.ts';
export class ActivityUI{
 private root=document.createElement('section');private title=document.createElement('strong');private detail=document.createElement('p');private meter=document.createElement('meter');private button=document.createElement('button');private hint=document.createElement('small');
 constructor(private activity:ActivitySession,private controls:ControlSettings,activate:()=>void){
  this.root.className='activity-hud';this.root.setAttribute('aria-label','海でのアクティビティ');this.meter.min=0;this.meter.max=1;this.meter.low=.25;this.meter.high=.78;this.meter.optimum=.5;this.meter.setAttribute('aria-label','糸の張力 / ボードのバランス');this.button.onclick=activate;this.root.append(this.title,this.detail,this.meter,this.button,this.hint);document.body.append(this.root);
 }
 update(s:AdventureState,blocked:boolean):void{
  const a=this.activity,label=a.hint(s);this.root.hidden=!label&&a.tool==='none';this.button.disabled=blocked||!label;
  this.button.textContent=`${this.controls.primary('activity')} · ${label||'道具を使う'}`;this.meter.hidden=a.tool==='none';
  if(a.tool==='rod'){const f=a.fishing.snapshot();this.title.textContent=f.phase==='caught'&&f.catch?`${f.catch.species} · ${f.catch.lengthCm} cm`:'波間の釣り';this.detail.textContent=f.phase==='reeling'?`取り込み ${Math.round(f.progress*100)}% · 張りすぎたら緩めよう`:f.message;this.meter.value=f.tension;this.hint.textContent=`${this.controls.primary('interact')} 竿をしまう · ${a.catches}匹 / 最長 ${a.bestFish||'—'}cm`;}
  else if(a.tool==='board'){this.title.textContent=a.surf.phase==='riding'?'波に乗る':'新島のサーフィン';this.detail.textContent=`${a.surfOutput?.hint??'ボードを持って、波打ち際へ。'} · ${a.surf.rideDistance.toFixed(1)}m`;this.meter.value=a.surf.balance;this.hint.textContent=`${this.controls.primary('forward')} パドル · ${this.controls.primary('left')}/${this.controls.primary('right')} ターン · ${this.controls.primary('interact')} ボードを置く`;}
  else{this.title.textContent=s.mode==='boat'?'船上で、ひと息':'海で遊ぶ';this.detail.textContent=label.includes('サーフ')?'ボードを抱えて浜から海へ。動く波をつかもう。':'水面へ投げ、浮きが沈んだら合わせよう。';this.hint.textContent=label.includes('サーフ')?'ボードを持って歩き、そのまま海へ入れます。':'移動や操船を再開すると、釣りは中断します。';}
 }
 dispose(){this.button.onclick=null;this.root.remove();}
}
