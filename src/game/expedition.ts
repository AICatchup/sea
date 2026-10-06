import type {AdventureState,GroundSampler,WorldDestination} from '../world/contracts.ts';
import {waterSegmentClear} from '../world/navigation.ts';

export type Gear='air'|'fins'|'bag';
export interface Point {x:number;y:number;z:number;}
export interface Find extends Point {id:string;name:string;note:string;value:number;depth:number;groundY:number;kind:'note'|'glass'|'case'|'cylinder';}
export interface ExpeditionMap {camp:Point;finds:Find[];destinations:WorldDestination[];course:Point[];}
export interface SaveStore {getItem(key:string):string|null;setItem(key:string,value:string):void;}
export const SAVE_KEY='sea.expedition.v1';
export const GEAR:Record<Gear,{name:string;cost:number;description:string}>={
 air:{name:'大容量タンク',cost:4,description:'潜っていられる時間が45%長くなる。'},
 fins:{name:'軽量フィン',cost:3,description:'泳ぐ速さが18%上がる。'},
 bag:{name:'回収バッグ',cost:3,description:'一度に持てる記録が3個から5個になる。'},
};
const distance=(a:Point,b:Point)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
const horizontal=(a:{x:number;z:number},b:{x:number;z:number})=>Math.hypot(a.x-b.x,a.z-b.z);
const unique=(a:unknown,allowed:Set<string>):string[]=>Array.isArray(a)?[...new Set(a.filter((x):x is string=>typeof x==='string'&&allowed.has(x)))].slice(0,32):[];
export function createExpeditionMap(ground:GroundSampler,destinations:WorldDestination[]):ExpeditionMap {
 const at=(x:number,z:number,height=.25):Point&{groundY:number}=>{const groundY=ground.heightAt(x,z);return {x,z,y:groundY+height,groundY};};
 const finds:Find[]=[
  {id:'notebook',name:'漂着した調査ノート',note:'潮に流された調査機材を探して、浜の拠点へ届けよう。',value:0,depth:0,kind:'note',...at(-41,19)},
  {id:'glass',name:'波打ち際のシーグラス',note:'角が丸くなるまで、波に磨かれた小さなかけら。',value:1,depth:0,kind:'glass',...at(-47,6)},
  {id:'compass',name:'浅瀬の方位計',note:'潮だまりの底に残っていた防水ケース。',value:1,depth:0,kind:'case',...at(-65,-14)},
  {id:'camera',name:'沈んだ観測カメラ',note:'黄色いケースが目印。水面から少し潜って探そう。',value:2,depth:1,kind:'case',...at(-114,-91,.35)},
  {id:'logger',name:'入り江の観測ロガー',note:'少し深い砂地に、海の記録が眠っている。',value:2,depth:2,kind:'cylinder',...at(-120,-105,.35)},
  {id:'capsule',name:'岩場の記録カプセル',note:'水深約8mの岩場へ。空気の残量を見ながら、ゆっくり近づこう。',value:3,depth:4,kind:'cylinder',...at(-139,-111,.45)},
  {id:'reef-case',name:'沖の標本ケース',note:'回収したものは拠点で記録。荷物が一杯なら一度戻ろう。',value:3,depth:4,kind:'case',...at(-156,-133,.35)},
 ];
 for(const [id,name] of [['nakanoura','中の浦の漂流便'],['niijima','新島の航海日誌'],['secret','シークレットの記録筒']] as const){
  const d=destinations.find(p=>p.id===id);if(d?.landingX!==undefined&&d.landingZ!==undefined)finds.push({id:'shore-'+id,name,note:'海を渡って見つけた、次の島の記録。泊の浜へ持ち帰ろう。',value:3,depth:0,kind:'cylinder',...at(d.landingX,d.landingZ,.35)});
 }
 const course=[[-126,-102],[-139,-120],[-161,-145],[-136,-158],[-116,-127],[-126,-102]].map(([x,z])=>({x,y:.7,z}));
 const usable=course.slice(1).every((p,i)=>waterSegmentClear(ground,course[i],p,1.5,4));
 return {camp:at(-33,29,.72),finds:finds.filter(f=>Number.isFinite(f.y)),destinations,course:usable?course:[]};
}

interface Saved {version:1;notebook:boolean;cargo:string[];banked:string[];stamps:string[];gear:Gear[];captain:boolean;bestRace:number|null;}
export interface GameNotice {serial:number;title:string;detail:string;kind:'find'|'bank'|'gear'|'stamp'|'race'|'info'|'camp';}
export interface GameTarget extends Point {id:string;name:string;kind:'find'|'camp'|'boat'|'landing'|'race';}
export interface Race {next:number;elapsed:number;previous:{x:number;z:number};}

/** Progress is driven by real proximity and controller state, never a UI checklist tick. */
export class Expedition {
 private saved:Saved={version:1,notebook:false,cargo:[],banked:[],stamps:[],gear:[],captain:false,bestRace:null};
 private serial=0;
 private tracked:string|null=null;
 private landingDwell=new Map<string,number>();
 readonly map:ExpeditionMap;
 notice:GameNotice|null=null;
 race:Race|null=null;
 revision=0;
 saveStatus:'saved'|'session'|'unavailable'='session';
 private readonly ground:GroundSampler;
 private readonly store?:SaveStore;
 constructor(map:ExpeditionMap,ground:GroundSampler,store?:SaveStore){
  this.map=map;this.ground=ground;this.store=store;
  if(store)try{const raw=store.getItem(SAVE_KEY);if(raw&&raw.length<20000)this.restore(JSON.parse(raw));this.saveStatus='saved';}catch{this.saveStatus='unavailable';}
 }
 private restore(value:unknown):void {
  if(!value||typeof value!=='object'||(value as {version?:number}).version!==1)return;
  const s=value as Partial<Saved>,ids=new Set(this.map.finds.filter(f=>f.id!=='notebook').map(f=>f.id));
  this.saved.notebook=s.notebook===true;
  this.saved.banked=unique(s.banked,ids);
  this.saved.cargo=unique(s.cargo,ids).filter(id=>!this.saved.banked.includes(id)).slice(0,5);
  this.saved.stamps=unique(s.stamps,new Set(this.map.destinations.map(d=>d.id)));
  this.saved.captain=s.captain===true;
  this.saved.bestRace=typeof s.bestRace==='number'&&Number.isFinite(s.bestRace)&&s.bestRace>=10&&s.bestRace<=720?s.bestRace:null;
  for(const gear of unique(s.gear,new Set(Object.keys(GEAR))) as Gear[])if(this.credits>=GEAR[gear].cost)this.saved.gear.push(gear);
  // Preserve recovered items from a save even if a previous bag upgrade is malformed.
 }
 get cargo(){return [...this.saved.cargo];}
 get banked(){return [...this.saved.banked];}
 get stamps(){return [...this.saved.stamps];}
 get notebook(){return this.saved.notebook;}
 get captain(){return this.saved.captain;}
 get bestRace(){return this.saved.bestRace;}
 get capacity(){return this.hasGear('bag')?5:3;}
 get credits(){return this.saved.banked.reduce((n,id)=>n+(this.map.finds.find(f=>f.id===id)?.value??0),0)+this.saved.stamps.length*2+(this.saved.bestRace!==null?2:0)-this.saved.gear.reduce((n,id)=>n+GEAR[id].cost,0);}
 get rank(){return !this.notebook?'海の散歩人':this.stamps.length>=this.map.destinations.length&&this.banked.length>=this.map.finds.length-1?'島々の探検家':this.stamps.length>=3?'島を巡る調査員':this.banked.length>=4?'海底の探検家':'入り江の調査員';}
 hasGear(id:Gear){return this.saved.gear.includes(id);}
 found(id:string){return id==='notebook'?this.notebook:this.saved.cargo.includes(id)||this.saved.banked.includes(id);}
 track(id:string|null):void{this.tracked=id;this.revision++;}
 private announce(title:string,detail:string,kind:GameNotice['kind']='info'):void{this.notice={serial:++this.serial,title,detail,kind};this.revision++;}
 private persist():void{this.revision++;if(this.store)try{this.store.setItem(SAVE_KEY,JSON.stringify(this.saved));this.saveStatus='saved';}catch{this.saveStatus='unavailable';}}
 get snapshot():Saved{return JSON.parse(JSON.stringify(this.saved));}
 private visible(from:Point,to:Point):boolean {
  for(let i=1;i<8;i++){const t=i/8,x=from.x+(to.x-from.x)*t,z=from.z+(to.z-from.z)*t,y=from.y+(to.y-from.y)*t;if(this.ground.heightAt(x,z)>y+.06)return false;}
  return true;
 }
 context(state:AdventureState):{id:string;label:string}|null {
  if(state.mode==='boat'||state.avatarAction==='climb')return null;
  if(state.mode==='walk'&&distance(state.position,this.map.camp)<3.2)return {id:'camp',label:this.cargo.length?`拠点に ${this.cargo.length} 個届ける`:'調査拠点をひらく'};
  let nearest:Find|undefined,best=Infinity;
  for(const f of this.map.finds){
   if(this.found(f.id)||(!this.notebook&&f.id!=='notebook')||state.depth<f.depth)continue;
   const d=distance(state.position,f);if(d>2.8||d>=best)continue;
   const facing=((f.x-state.position.x)*Math.sin(state.yaw)*Math.cos(state.pitch)+(f.y-state.position.y)*Math.sin(state.pitch)-(f.z-state.position.z)*Math.cos(state.yaw)*Math.cos(state.pitch))/Math.max(.001,d);
   if(facing<.5||!this.visible(state.position,f))continue;
   best=d;nearest=f;
  }
  return nearest?{id:nearest.id,label:nearest.id==='notebook'?'調査ノートを読む':this.cargo.length>=this.capacity?'バッグが一杯です — 拠点へ戻ろう':`${nearest.name}を回収`}:null;
 }
 interact(state:AdventureState):boolean {
  const action=this.context(state);if(!action)return false;
  if(action.id==='camp'){
   const count=this.saved.cargo.length;
   for(const id of this.saved.cargo)if(!this.saved.banked.includes(id))this.saved.banked.push(id);
   this.saved.cargo=[];this.tracked=null;this.persist();
   this.announce(count?`${count} 個の海の記録を届けた`:'おかえりなさい',count?'調査ポイントで装備を整えよう。':'次の目的地と装備を選べます。',count?'bank':'camp');return true;
  }
  const find=this.map.finds.find(f=>f.id===action.id)!;
  if(find.id==='notebook'){this.saved.notebook=true;this.announce('海の調査が始まった',find.note,'find');}
  else if(this.cargo.length>=this.capacity){this.announce('バッグが一杯です','泊の浜の調査拠点に持ち帰ると、空きができます。');return true;}
  else{this.saved.cargo.push(find.id);this.announce(find.name,`${find.note}　持ち物 ${this.cargo.length}/${this.capacity}`,'find');}
  if(this.tracked===find.id)this.tracked=null;this.persist();return true;
 }
 buy(id:Gear,state:AdventureState):boolean {
  if(!Object.prototype.hasOwnProperty.call(GEAR,id)||this.hasGear(id))return false;
  if(state.mode!=='walk'||distance(state.position,this.map.camp)>=3.2){this.announce('装備は浜の拠点で','泊の調査ボックスへ戻って整えましょう。');return false;}
  if(this.credits<GEAR[id].cost){this.announce('調査ポイントが足りません','回収品を届けたり、新しい浜に上陸すると増えます。');return false;}
  this.saved.gear.push(id);this.persist();this.announce(`${GEAR[id].name}を装備`,GEAR[id].description,'gear');return true;
 }
 update(dt:number,state:AdventureState):void {
  if(!Number.isFinite(dt)||dt<=0)return;dt=Math.min(dt,.12);
  if(!this.notebook)return;
  if(state.mode==='boat'&&state.avatarAction!=='climb'&&!this.saved.captain){this.saved.captain=true;this.persist();this.announce('はじめての出航','地図で次の島へ。操船チャレンジにも挑戦できます。','stamp');}
  for(const d of this.map.destinations){
   if(this.saved.stamps.includes(d.id)||d.landingX===undefined||d.landingZ===undefined)continue;
   const onLand=state.mode==='walk'&&state.grounded!==false&&horizontal(state.position,{x:d.landingX,z:d.landingZ})<28;
   const dwell=onLand?(this.landingDwell.get(d.id)??0)+dt:0;this.landingDwell.set(d.id,dwell);
   if(dwell>=1.5){this.saved.stamps.push(d.id);this.persist();this.announce(`${d.label}の訪問スタンプ`,'自分の足で浜に上陸。調査ポイント +2','stamp');}
  }
  if(this.race){
   if(state.mode!=='boat'||state.avatarAction==='climb'||state.voyageTarget){this.race=null;this.announce('操船チャレンジを中断','スタートのブイへ戻れば、何度でも挑戦できます。');return;}
   this.race.elapsed+=dt;const target=this.map.course[this.race.next],from=this.race.previous,to=state.boatPosition;
   if(horizontal(from,to)>Math.max(2,dt*16)||this.race.elapsed>720){this.race=null;this.announce('チャレンジを終了','スタートのブイへ戻って、もう一度挑戦できます。');return;}
   if(segmentDistance(from,to,target)<6){
    this.race.next++;
    if(this.race.next>=this.map.course.length){const elapsed=this.race.elapsed,best=this.saved.bestRace;this.saved.bestRace=best===null?elapsed:Math.min(best,elapsed);this.race=null;this.persist();this.announce(best===null||elapsed<best?'ベストタイム更新！':'操船チャレンジ完走',`${elapsed.toFixed(1)} 秒${best===null?' · 調査ポイント +2':''}`,'race');return;}
    this.announce(`ブイ ${this.race.next-1}/${this.map.course.length-1} 通過`,'次の黄色いブイへ。','race');
   }
   this.race.previous={x:to.x,z:to.z};
  }
 }
 startRace(state:AdventureState):boolean {
  if(!this.notebook||!this.map.course.length||state.mode!=='boat'||state.avatarAction==='climb'||state.voyageTarget||horizontal(state.boatPosition,this.map.course[0])>12){this.announce('船でスタート地点へ','泊の船着き場のブイ付近で、船を手動操船できる状態にしてください。');return false;}
  this.race={next:1,elapsed:0,previous:{x:state.boatPosition.x,z:state.boatPosition.z}};this.tracked=null;this.announce('操船チャレンジ、スタート','5つのブイを順番に通過。W/Sで加減速、A/Dで舵取り。','race');return true;
 }
 target(state:AdventureState):GameTarget|null {
  if(this.race){const p=this.map.course[this.race.next];return {...p,id:'race',name:`次のブイ ${this.race.next}/${this.map.course.length-1}`,kind:'race'};}
  const select=(id:string):GameTarget|null=>{
   if(id==='camp')return {...this.map.camp,id,name:'泊の調査拠点',kind:'camp'};
   if(id==='boat')return {...state.boatPosition,id,name:'入り江の船',kind:'boat'};
   if(id==='race-start'&&this.map.course.length)return {...this.map.course[0],id,name:'操船チャレンジのスタート',kind:'race'};
   const f=this.map.finds.find(p=>p.id===id&&!this.found(p.id));if(f)return {...f,kind:'find'};
   const d=this.map.destinations.find(p=>p.id===id);return d?.landingX!==undefined&&d.landingZ!==undefined?{x:d.landingX,y:this.ground.heightAt(d.landingX,d.landingZ)+1,z:d.landingZ,id,name:d.label,kind:'landing'}:null;
  };
  if(this.tracked){const target=select(this.tracked);if(target)return target;this.tracked=null;}
  if(!this.notebook)return select('notebook');
  if(this.cargo.length>=2||this.cargo.includes('capsule')||this.cargo.some(id=>id.startsWith('shore-')))return select('camp');
  // Arriving early at another beach is a valid branch of the adventure. Do
  // not keep pointing kilometres back to Tomari while its local find is here.
  const local=this.map.finds.filter(f=>f.id.startsWith('shore-')&&!this.found(f.id)&&horizontal(state.position,f)<300)
   .sort((a,b)=>horizontal(state.position,a)-horizontal(state.position,b))[0];
  if(local)return select(local.id);
  if(this.banked.length<2)return select(['glass','compass','camera'].find(id=>!this.found(id))??'camp');
  if(!this.found('capsule'))return select(!this.found('camera')?'camera':!this.found('logger')?'logger':'capsule');
  if(!this.saved.captain&&state.mode!=='boat')return select('boat');
  const unexplored=this.map.destinations.find(d=>!this.saved.stamps.includes(d.id)&&d.id!=='tomari');
  if(unexplored)return select(unexplored.id);
  return select(this.map.finds.find(f=>!this.found(f.id))?.id??'camp');
 }
 objective(state:AdventureState):{target:GameTarget|null;title:string;detail:string}{
  const target=this.target(state);
  if(target?.id.startsWith('shore-'))return {target,title:'島で見つける海の記録',detail:state.mode==='boat'
   ?'船が停まったらEではしごを降り、浜の目印へ。近づいてEで回収しよう。'
   :'この浜にも海の記録がある。目印に近づき、見下ろしてEで回収しよう。'};
  if(target?.id==='camp'&&this.cargo.length)return {target,title:'回収した記録を届けよう',detail:
   state.mode==='walk'&&distance(state.position,this.map.camp)<3.2?'Eで調査ボックスへ届けよう。記録がポイントに変わる。'
   :state.mode==='boat'?'地図から泊海水浴場へ帰航し、浜の調査ボックスへ届けよう。'
   :horizontal(state.position,this.map.camp)>300?'船へ戻って泊海水浴場へ。回収した記録を浜の調査ボックスへ届けよう。'
   :'泊の浜の調査ボックスへ。近づいてEで回収した記録を届けよう。'};
  return {target,...this.chapter};
 }
 get chapter(){return !this.notebook?{title:'01 / 浜から始まる物語',detail:'浜の調査ノートを探そう。近づいて見下ろし、Eで読む。'}:this.banked.length<2?{title:'02 / はじめての回収',detail:'浅瀬で2つ見つけたら、泊の調査拠点へ届けよう。'}:!this.banked.includes('capsule')?{title:'03 / 海底の記録',detail:'装備を整え、岩場の記録カプセルを持ち帰ろう。'}:this.stamps.length<this.map.destinations.length?{title:'04 / 島々をつなぐ航海',detail:'船に乗り、地図を開いて次の島へ。浜に上陸するとスタンプが増える。'}:{title:'05 / 海の探検家',detail:'残りの記録を探したり、操船のベストタイムに挑戦しよう。'};}
}

export function segmentDistance(a:{x:number;z:number},b:{x:number;z:number},p:{x:number;z:number}):number {
 const x=b.x-a.x,z=b.z-a.z,t=Math.max(0,Math.min(1,((p.x-a.x)*x+(p.z-a.z)*z)/Math.max(1e-9,x*x+z*z)));
 return Math.hypot(p.x-a.x-x*t,p.z-a.z-z*t);
}
