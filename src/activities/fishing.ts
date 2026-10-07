/** Local game simulation; species/size are seeded fiction, not measured ecology. */
export type FishingPhase = 'idle' | 'casting' | 'waiting' | 'bite' | 'reeling' | 'caught' | 'escaped';
export interface FishingPoint { x: number; y: number; z: number }
export interface FishingWaterTarget extends FishingPoint { isWater: boolean; groundY?: number }
export interface FishingFrame {
  player: FishingPoint;
  /** Radians: zero north (-Z), positive turns toward east (+X). */
  yaw: number;
  mode: 'walk' | 'boat';
  speed: number;
  voyageActive?: boolean;
  boarding?: boolean;
  /** Caller supplies a sampled water surface and optional ground height. */
  waterTarget?: FishingWaterTarget | null;
}
export interface FishingInput { cast?: boolean; interact?: boolean; reelHeld?: boolean; pressure?: number }
export interface FishingCatch { species: string; lengthCm: number }
export interface FishingSnapshot {
  phase: FishingPhase; canCast: boolean; floatPosition: FishingPoint | null;
  lineEndpoint: FishingPoint | null; progress: number; tension: number;
  catch: FishingCatch | null; cooldown: number; message: string; hint: string;
  reeling: boolean;
}
const finitePoint = (p: FishingPoint) => Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z);
const copy = (p: FishingPoint): FishingPoint => ({x:p.x,y:p.y,z:p.z});
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi,n));
const distance = (a: FishingPoint,b: FishingPoint) => Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
function eligible(frame: FishingFrame): boolean {
  const t=frame.waterTarget;
  if (!finitePoint(frame.player) || !Number.isFinite(frame.yaw) || !Number.isFinite(frame.speed) || frame.speed<0 || frame.speed>=0.9 || frame.voyageActive || frame.boarding || !t || !finitePoint(t) || !t.isWater) return false;
  if (frame.mode!=='walk' && frame.mode!=='boat') return false;
  if (t.groundY!==undefined && (!Number.isFinite(t.groundY) || t.groundY>=t.y-0.1)) return false;
  const dx=t.x-frame.player.x,dz=t.z-frame.player.z,r=Math.hypot(dx,dz);
  return r>=2 && r<=18 && Math.abs(t.y-frame.player.y)<=8 && (dx*Math.sin(frame.yaw)-dz*Math.cos(frame.yaw))/r>=0.7;
}

export function createFishing(seed=1) {
  let rng=Number.isFinite(seed)?seed>>>0:1;
  const random=()=>{rng=(Math.imul(rng,1664525)+1013904223)>>>0;return rng/4294967296;};
  let phase:FishingPhase='idle', elapsed=0, cooldown=0, progress=0,tension=0,over=0,slack=0;
  let origin:FishingPoint|null=null,target:FishingPoint|null=null,mode:'walk'|'boat'='walk';
  let fish:FishingCatch|null=null,landed:FishingCatch|null=null,wait=0,fishOffset=0,reeling=false,canCast=false;
  let message='水面に向かって竿を投げられます。';
  const finish=(next:'caught'|'escaped',text:string)=>{phase=next;elapsed=0;cooldown=2;reeling=false;message=text;if(next==='caught')landed=fish;};
  const snapshot=():FishingSnapshot=>{
    let floatPosition:FishingPoint|null=target?copy(target):null;
    if (phase==='casting' && target && origin) {
      const t=clamp(elapsed/0.7,0,1);
      floatPosition={x:origin.x+(target.x-origin.x)*t,y:origin.y+(target.y-origin.y)*t+3*Math.sin(Math.PI*t),z:origin.z+(target.z-origin.z)*t};
    }
    if(phase==='idle'||phase==='escaped')floatPosition=null;
    return {phase,canCast,floatPosition,lineEndpoint:floatPosition?copy(floatPosition):null,progress,tension,catch:landed?{...landed}:null,cooldown,message,reeling,
      hint:phase==='bite'?'今！ 操作で針を掛ける':phase==='reeling'?'操作で巻く／緩める。張力が高ければ緩める':phase==='waiting'?'浮きが沈むまで待つ':cooldown>0?'竿を整えています':canCast?'操作で投げる':'水面を正面にして止まる'};
  };
  const update=(dt:number,frame:FishingFrame,input:FishingInput={}):FishingSnapshot=>{
    // Paused, stale or corrupt frames cannot consume input or advance deadlines.
    if(!Number.isFinite(dt)||dt<=0||dt>1)return snapshot();
    canCast=eligible(frame)&&cooldown<=0;
    const active=phase==='casting'||phase==='waiting'||phase==='bite'||phase==='reeling';
    if(active && (!finitePoint(frame.player)||!Number.isFinite(frame.speed)||frame.speed<0||frame.speed>=0.9||frame.voyageActive||frame.boarding||frame.mode!==mode||!origin||distance(frame.player,origin)>2)) {
      finish('escaped','移動したため釣りを中断しました。');canCast=false;return snapshot();
    }
    if((input.cast || (input.interact && (phase==='idle'||phase==='caught'||phase==='escaped'))) && canCast && !active) {
      origin=copy(frame.player);target=copy(frame.waterTarget!);mode=frame.mode;phase='casting';elapsed=0;progress=0;tension=0;over=0;slack=0;landed=null;reeling=false;
      wait=2.5+random()*4;fishOffset=random()*Math.PI*2;
      fish={species:['アジ','サバ','メバル'][Math.floor(random()*3)]!,lengthCm:Math.round(15+random()*30)};message='浮きを投げています。';canCast=false;
    } else if(input.interact && phase==='bite') {phase='reeling';elapsed=0;tension=0.3;reeling=true;message='掛かった！ 張力を見ながら巻き上げる。';}
    else if(input.interact && phase==='reeling')reeling=!reeling;
    if(phase==='reeling' && input.reelHeld!==undefined)reeling=input.reelHeld;
    // Small internal steps keep thresholds stable across ordinary render frame rates.
    let remaining=dt;
    while(remaining>1e-9){const step=Math.min(remaining,1/60);remaining-=step;cooldown=Math.max(0,cooldown-step);elapsed+=step;
      if(phase==='casting'&&elapsed>=0.7){phase='waiting';elapsed=0;message='浮きの動きを待っています。';}
      else if(phase==='waiting'&&elapsed>=wait){phase='bite';elapsed=0;message='浮きが沈んだ！';}
      else if(phase==='bite'&&elapsed>=1.8)finish('escaped','針を掛けるのが遅れ、魚が逃げました。');
      else if(phase==='reeling'){
        const pressure=Number.isFinite(input.pressure)?clamp(input.pressure!, -1,1):0;
        const pull=0.055+0.055*(1+Math.sin(elapsed*2.3+fishOffset));
        tension=clamp(tension+step*(pull+(reeling?0.14:-0.32)+pressure*0.035),0,1);
        progress=clamp(progress+step*(reeling?0.115:-0.012),0,1);
        over=tension>=0.92?over+step:Math.max(0,over-step*2);
        slack=tension<=0.03?slack+step:0;
        if(over>=0.65)finish('escaped','張力が強すぎて糸が切れました。');
        else if(slack>=2.5||elapsed>=45)finish('escaped','糸が緩み、魚が逃げました。');
        else if(progress>=1)finish('caught',`${fish!.species}を釣り上げました！`);
      }
    }
    canCast=eligible(frame)&&cooldown<=0&&(phase==='idle'||phase==='caught'||phase==='escaped');
    return snapshot();
  };
  return {update,snapshot};
}
