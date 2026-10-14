/** A water parcel keeps its emission state; later crest movement cannot bend
 * its flight. This is a kinematic sheet, not a volume-conserving fluid solver. */
export interface CrestEmission {time:number;x:number;y:number;z:number}
export interface WaterParcel {x:number;y:number;z:number;vy:number}
export function flyWaterParcel(emission:CrestEmission,now:number,vx:number,vz:number,up:number,out:WaterParcel={x:0,y:0,z:0,vy:0}):WaterParcel {
  const t=Math.max(0,now-emission.time);
  out.x=emission.x+vx*t;out.y=emission.y+up*t-4.905*t*t;out.z=emission.z+vz*t;out.vy=up-9.81*t;return out;
}

/** Bounded chronological history; interpolate emission state, never the
 * ballistic endpoint. A frame's history is shared by all rows of its sheet. */
export class CrestHistory {
  private points:CrestEmission[]=[];
  reset(point:CrestEmission):void {this.points=[{...point}];}
  record(point:CrestEmission):void {
    const last=this.points.at(-1);
    if(last&&point.time<=last.time)return;
    this.points.push({...point});
    while(this.points.length>512||(this.points.length>2&&this.points[1].time<point.time-2.5))this.points.shift();
  }
  sample(time:number,out:CrestEmission={time:0,x:0,y:0,z:0}):CrestEmission {
    const first=this.points[0];
    if(!first)throw new Error('Crest history has not been initialized');
    if(time<=first.time)return Object.assign(out,first,{time});
    for(let i=this.points.length-1;i>0;i--){
      const a=this.points[i-1],b=this.points[i];
      if(time>=a.time){const f=Math.min(1,(time-a.time)/(b.time-a.time));out.time=time;out.x=a.x+(b.x-a.x)*f;out.y=a.y+(b.y-a.y)*f;out.z=a.z+(b.z-a.z)*f;return out;}
    }
    return Object.assign(out,first,{time});
  }
}
