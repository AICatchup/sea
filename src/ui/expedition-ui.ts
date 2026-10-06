import './expedition.css';
import type {AdventureState} from '../world/contracts.ts';
import {Expedition,GEAR,type Gear} from '../game/expedition.ts';

const setText=(element:Element,value:string)=>{if(element.textContent!==value)element.textContent=value;};
export class ExpeditionUI {
 private root=document.createElement('section');
 private dialog=document.createElement('dialog');
 private abort=new AbortController();
 private visibility:MutationObserver;
 private state:AdventureState|null=null;
 private lastUpdate=-Infinity;
 private lastRevision=-1;
 private noticeSerial=0;
 private toastTimer=0;
 private section='journey';
 private disposed=false;
 private mapAfterClose=false;
 private find=(selector:string)=>this.root.querySelector<HTMLElement>(selector)!;
 constructor(private game:Expedition,private callbacks:{map:()=>void;cue:()=>void}){
  const events={signal:this.abort.signal};
  this.root.className='expedition-ui';this.root.setAttribute('aria-label','海の調査');
  this.root.innerHTML=`<aside class="expedition-hud">
   <button class="expedition-open" type="button"><span>海の調査ノート</span><kbd>J</kbd></button>
   <div class="expedition-objective"><small data-chapter></small><strong data-target></strong>
    <p data-hint></p><div class="expedition-bearing"><span data-arrow aria-hidden="true">↑</span><span data-distance></span><span data-height></span></div>
    <div class="expedition-counters"><span data-cargo></span><span data-points></span></div>
    <p class="expedition-air-warning" hidden>空気が少なくなっています。Spaceで水面へ。</p>
    <div class="expedition-race" hidden><b data-time></b><span data-race-gates></span></div>
   </div></aside><div class="expedition-toast" role="status" aria-live="polite" hidden><strong></strong><span></span></div>`;
  this.dialog.className='expedition-journal';this.dialog.setAttribute('aria-labelledby','expedition-title');
  this.dialog.innerHTML=`<header><div><small data-rank>海の散歩人</small><h2 id="expedition-title">海の調査ノート</h2></div><button type="button" data-close aria-label="調査ノートを閉じる">×</button></header>
   <nav aria-label="調査ノートのページ"><button type="button" data-page="journey">冒険</button><button type="button" data-page="finds">発見</button><button type="button" data-page="gear">装備</button><button type="button" data-page="sailing">操船</button></nav>
   <div class="expedition-pages"></div><footer><span data-save></span><button type="button" data-map>航海の地図を開く ↗</button></footer>`;
  this.root.append(this.dialog);document.body.append(this.root);
  this.find('.expedition-open').addEventListener('click',()=>this.open(),events);
  this.dialog.querySelector('[data-close]')!.addEventListener('click',()=>this.dialog.close(),events);
  this.dialog.querySelector('[data-map]')!.addEventListener('click',()=>{this.mapAfterClose=true;this.dialog.close();},events);
  this.dialog.addEventListener('close',()=>{document.body.classList.remove('expedition-journal-open');if(this.mapAfterClose){this.mapAfterClose=false;this.callbacks.map();}else document.getElementById('ocean')?.focus({preventScroll:true});},events);
  this.dialog.addEventListener('keydown',event=>{if(event.code==='KeyJ'){event.preventDefault();this.dialog.close();}event.stopPropagation();},events);
  this.dialog.addEventListener('click',event=>{
   const button=(event.target as HTMLElement).closest<HTMLButtonElement>('button');if(!button||!this.state)return;
   if(button.dataset.page){this.section=button.dataset.page;this.renderJournal();}
   if(button.dataset.track){this.game.track(button.dataset.track);this.dialog.close();}
   if(button.dataset.gear){this.game.buy(button.dataset.gear as Gear,this.state);this.renderJournal();}
   if(button.dataset.race!==undefined){if(this.game.startRace(this.state))this.dialog.close();}
  },events);
  window.addEventListener('keydown',event=>{
   if(event.code!=='KeyJ'||event.repeat||event.ctrlKey||event.metaKey||event.altKey||this.root.inert||(event.target as HTMLElement)?.closest?.('input,textarea,select,[contenteditable=true]'))return;
   event.preventDefault();this.dialog.open?this.dialog.close():this.open();
  },events);
  this.root.addEventListener('pointerdown',event=>event.stopPropagation(),events);
  const sync=()=>{const hidden=document.body.classList.contains('immersed')||document.getElementById('unsupported')?.hidden===false;this.root.inert=hidden;this.root.classList.toggle('is-hidden',hidden);if(hidden&&this.dialog.open)this.dialog.close();};
  this.visibility=new MutationObserver(sync);this.visibility.observe(document.body,{attributes:true,attributeFilter:['class']});const unsupported=document.getElementById('unsupported');if(unsupported)this.visibility.observe(unsupported,{attributes:true,attributeFilter:['hidden']});sync();
 }
 open():void{
  if(this.disposed||this.root.inert||this.dialog.open)return;
  if(document.pointerLockElement)document.exitPointerLock?.();
  document.body.classList.add('expedition-journal-open');this.renderJournal();this.dialog.showModal();
 }
 update(state:AdventureState):void{
  if(this.disposed)return;this.state=state;const now=performance.now();if(now-this.lastUpdate<160&&this.lastRevision===this.game.revision)return;this.lastUpdate=now;
  const chapter=this.game.objective(state),target=chapter.target,race=this.game.race;
  setText(this.find('[data-chapter]'),race?'入り江の操船チャレンジ':chapter.title);setText(this.find('[data-target]'),target?.name??'海の探検を続けよう');
  setText(this.find('[data-hint]'),race?'黄色いブイの間を順番に通ろう。曲がる手前で減速すると操船しやすくなります。':chapter.detail);
  setText(this.find('[data-cargo]'),`持ち物 ${this.game.cargo.length}/${this.game.capacity}`);setText(this.find('[data-points]'),`${this.game.credits} pt`);
  if(target){
   const dx=target.x-state.position.x,dz=target.z-state.position.z,distance=Math.hypot(dx,dz);
   const angle=Math.atan2(Math.sin(Math.atan2(dx,-dz)-state.yaw),Math.cos(Math.atan2(dx,-dz)-state.yaw));
   this.find('[data-arrow]').style.transform=`rotate(${angle*180/Math.PI}deg)`;
   setText(this.find('[data-distance]'),distance<1000?`${Math.round(distance)} m`:`${(distance/1000).toFixed(1)} km`);
   setText(this.find('[data-height]'),target.y<-.5?`水深 約${(-target.y).toFixed(1)} m`:distance<3?'近くを見回そう':'');
  }
  this.find('.expedition-air-warning').hidden=state.mode!=='dive'||state.oxygen>=.28;
  this.find('.expedition-race').hidden=!race;
  if(race){setText(this.find('[data-time]'),`${race.elapsed.toFixed(1)} s`);setText(this.find('[data-race-gates]'),`${race.next-1}/${this.game.map.course.length-1} ブイ`);}
  const notice=this.game.notice;
  if(notice&&notice.serial!==this.noticeSerial){
   this.noticeSerial=notice.serial;const toast=this.find('.expedition-toast');setText(toast.querySelector('strong')!,notice.title);setText(toast.querySelector('span')!,notice.detail);toast.hidden=false;
   clearTimeout(this.toastTimer);this.toastTimer=window.setTimeout(()=>{toast.hidden=true;},6500);
   if(['find','bank','gear','stamp','race'].includes(notice.kind))this.callbacks.cue();
   if(notice.kind==='camp'){this.section='gear';this.open();}
  }
  if(this.dialog.open&&this.lastRevision!==this.game.revision)this.renderJournal();
  this.lastRevision=this.game.revision;
 }
 private renderJournal():void{
  const g=this.game,container=this.dialog.querySelector('.expedition-pages')!,restoreFocus=container.contains(document.activeElement);container.replaceChildren();
  setText(this.dialog.querySelector('[data-rank]')!,`${g.rank} · ${g.credits} pt`);
  this.dialog.querySelectorAll<HTMLButtonElement>('[data-page]').forEach(b=>b.setAttribute('aria-current',String(b.dataset.page===this.section)));
  setText(this.dialog.querySelector('[data-save]')!,g.saveStatus==='saved'?'進行はこのブラウザに自動保存':g.saveStatus==='session'?'このセッションの冒険':'保存を利用できません。今の冒険は続けられます。');
  const card=(title:string,body:string,tag?:string)=>{
   const article=document.createElement('article');article.className='expedition-card';
   if(tag){const small=document.createElement('small');small.textContent=tag;article.append(small);}
   const h=document.createElement('h3');h.textContent=title;const p=document.createElement('p');p.textContent=body;article.append(h,p);container.append(article);return article;
  };
  const action=(parent:Element,label:string,attribute:string,value='',disabled=false)=>{const b=document.createElement('button');b.type='button';b.textContent=label;b.dataset[attribute]=value;b.disabled=disabled;parent.append(b);return b;};
  if(this.section==='journey'){
   const objective=this.state?g.objective(this.state):g.chapter;
   card(objective.title,objective.detail,'今の目標');
   card('海の記録を、つなごう。','浜に流れ着いた調査ノート。浅瀬の小さな発見から、岩場の記録、そして次の島へ。回収品を泊の拠点へ届けると装備を強化できます。');
   const base=card('泊の調査拠点',`記録済み ${g.banked.length}/${g.map.finds.length-1} · 持ち物 ${g.cargo.length}/${g.capacity}`);
   action(base,'拠点を目印にする','track','camp');action(base,'船を目印にする','track','boat');
   const passport=card('島のパスポート',`浜に上陸した場所 ${g.stamps.length}/${g.map.destinations.length}`);
   for(const d of g.map.destinations)action(passport,`${g.stamps.includes(d.id)?'✓':'○'} ${d.label}`,'track',d.id);
  }else if(this.section==='finds'){
   for(const f of g.map.finds){const status=g.banked.includes(f.id)?'記録済み':g.cargo.includes(f.id)?'バッグの中':g.found(f.id)?'発見済み':'未発見';const c=card(f.name,f.note,status);if(!g.found(f.id))action(c,'この手がかりを追う','track',f.id,!g.notebook&&f.id!=='notebook');}
  }else if(this.section==='gear'){
   card('次の潜水に備える',`回収品を届けたり、島に上陸するとポイントが増えます。装備は泊の調査拠点のそばで変更します。現在 ${g.credits} pt`);
   for(const id of Object.keys(GEAR) as Gear[]){const gear=GEAR[id],c=card(gear.name,gear.description,`${gear.cost} pt`);action(c,g.hasGear(id)?'装備済み':`${gear.cost} pt で装備する`,'gear',id,g.hasGear(id)||g.credits<gear.cost);}
   action(card('拠点へ戻る','荷物はなくなりません。ゆっくり戻って整えましょう。'),'拠点を目印にする','track','camp');
  }else{
   const c=card('入り江の操船チャレンジ','船でスタートの2本のブイの間へ。黄色く示されたブイを順番に5つ通過し、スタートへ戻ろう。自動航海を切り、手動で挑戦します。',g.bestRace===null?'初回完走 +2 pt':`自己ベスト ${g.bestRace.toFixed(1)} 秒`);
   action(c,'スタートを目印にする','track','race-start',!g.map.course.length);
   action(c,g.race?'最初から挑戦する':'チャレンジ開始','race','',!g.notebook||!g.map.course.length);
   card('操作のコツ','Wで加速、Sで減速・後退。A/Dで舵取り。手前で少し減速すると、ブイを曲がりやすくなります。泳いで通過しても記録にはなりません。');
  }
  if(restoreFocus)this.dialog.querySelector<HTMLButtonElement>(`[data-page="${this.section}"]`)?.focus({preventScroll:true});
 }
 dispose():void{if(this.disposed)return;this.disposed=true;clearTimeout(this.toastTimer);this.abort.abort();this.visibility.disconnect();if(this.dialog.open)this.dialog.close();this.root.remove();document.body.classList.remove('expedition-journal-open');}
}
