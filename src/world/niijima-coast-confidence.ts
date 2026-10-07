import {NIIJIMA_COAST_CONFIDENCE as source,NIIJIMA_COARSE_SEA_CELLS} from './niijima-coast-confidence.generated.ts';
/** A source-resolution seam repair, not a new measured shoreline or depth map.
 * Exact original bytes are required. The immutable generated raster is retained.
 * DEM5 samples and inland missing coverage are never altered by this patch.
 */
export function reconcileNiijimaCoast(values:Int16Array,grid:{width:number;height:number;minX:number;minZ:number;maxX:number;maxZ:number}):{compatible:boolean;removed:number}{
  const {width,height}=grid;
  if(width!==source.width||height!==source.height||values.length!==width*height)return{compatible:false,removed:0};
  const registered=[grid.minX-source.minX,grid.minZ-source.minZ,
    grid.maxX-(source.minX+source.dx*(width-1)),grid.maxZ-(source.minZ+source.dz*(height-1))];
  if(registered.some(value=>!Number.isFinite(value)||Math.abs(value)>1e-6))return{compatible:false,removed:0};
  let hash=2166136261;
  for(const value of values){hash=Math.imul(hash^(value&255),16777619);hash=Math.imul(hash^((value>>>8)&255),16777619);}
  if((hash>>>0)!==source.originalGridFnv1a)return{compatible:false,removed:0};
  // Validate the entire patch before making any change.
  if(NIIJIMA_COARSE_SEA_CELLS.some(([index,expected])=>values[index]!==expected))return{compatible:false,removed:0};
  for(const[index]of NIIJIMA_COARSE_SEA_CELLS)values[index]=-32768;
  return{compatible:true,removed:NIIJIMA_COARSE_SEA_CELLS.length};
}
