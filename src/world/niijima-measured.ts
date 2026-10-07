import {NIIJIMA_NATIVE_SURVEY as data} from './niijima-survey-native.generated.ts';
import type {MeasuredGrid} from './measured-grid-patch.ts';

/** Retain the provider's native sample topology. Storage precision and local
 * numerical registration do not establish centimetre survey accuracy. */
export class MeasuredNiijimaTile {
  readonly grid:MeasuredGrid;
  readonly bounds:{minX:number;maxX:number;minZ:number;maxZ:number};
  readonly diagnostics={id:data.id,source:data.catalogue,sourceTiles:data.sourceTiles,nativeGridSpacingMetres:.25,
    nativeSamples:data.width*data.height,numericalComparison:data.numericalComparison,
    datumTransformAccuracyMetres:data.datumTransformAccuracyMetres,centimetreAccuracyEstablished:false};
  constructor(){
    const raw=Uint8Array.from(atob(data.heightsCentimetres),c=>c.charCodeAt(0));
    if(raw.length!==data.width*data.height*2)throw new Error('Native measured Niijima grid is incomplete');
    const view=new DataView(raw.buffer),heights=new Float32Array(data.width*data.height),valid=new Uint8Array(heights.length);
    for(let i=0;i<heights.length;i++){const value=view.getInt16(i*2,true);if(value!==-32768){heights[i]=value*.01;valid[i]=1;}}
    this.grid={width:data.width,height:data.height,heights,valid,origin:data.origin,column:data.column,row:data.row};
    const points=[[0,0],[data.width-1,0],[0,data.height-1],[data.width-1,data.height-1]].map(([i,j])=>({x:data.origin.x+data.column.x*i+data.row.x*j,z:data.origin.z+data.column.z*i+data.row.z*j}));
    this.bounds={minX:Math.min(...points.map(p=>p.x)),maxX:Math.max(...points.map(p=>p.x)),minZ:Math.min(...points.map(p=>p.z)),maxZ:Math.max(...points.map(p=>p.z))};
  }
}
