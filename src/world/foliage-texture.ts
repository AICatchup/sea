export interface ColourMip { width:number; height:number; data:Uint8Array; }
const toLinear=(v:number)=>{const c=v/255;return c<=.04045?c/12.92:((c+.055)/1.055)**2.4;};
const toByte=(v:number)=>Math.round(255*Math.max(0,Math.min(1,v<=.0031308?v*12.92:1.055*v**(1/2.4)-.055)));

/** Extend leaf colour into invisible atlas padding, retaining a separate alpha mask. */
function extendColour(data:Uint8Array,weights:Float32Array,width:number,height:number):void{
  const count=width*height,queue=new Int32Array(count),seen=new Uint8Array(count);let head=0,tail=0;
  for(let i=0;i<count;i++)if(weights[i*4+3]>0){seen[i]=1;queue[tail++]=i;}
  while(head<tail){const i=queue[head++],x=i%width,y=Math.floor(i/width);
    for(const j of [x>0?i-1:-1,x+1<width?i+1:-1,y>0?i-width:-1,y+1<height?i+width:-1]){
      if(j<0||seen[j])continue;seen[j]=1;queue[tail++]=j;
      data[j*4]=data[i*4];data[j*4+1]=data[i*4+1];data[j*4+2]=data[i*4+2];
    }
  }
}

/** Linear-light alpha-weighted photo colour mips. Geometry and alpha coverage are unchanged. */
export function leafColourMips(rgba:Uint8Array|Uint8ClampedArray,alpha:Uint8Array|Uint8ClampedArray,width:number,height:number,retainOpacity=false):ColourMip[]{
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||rgba.length!==width*height*4||alpha.length!==rgba.length)throw new Error('Matching finite RGBA atlas dimensions required');
  let weights=new Float32Array(width*height*4);
  for(let i=0;i<width*height;i++){const a=alpha[i*4+1]/255;weights[i*4+3]=a;for(let c=0;c<3;c++)weights[i*4+c]=toLinear(rgba[i*4+c])*a;}
  const base=new Uint8Array(rgba);extendColour(base,weights,width,height);const result:ColourMip[]=[{width,height,data:base}];
  while(width>1||height>1){const w=Math.max(1,Math.floor(width/2)),h=Math.max(1,Math.floor(height/2));const next=new Float32Array(w*h*4),data=new Uint8Array(w*h*4);
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      const i=(y*w+x)*4,x0=Math.floor(x*width/w),x1=Math.floor((x+1)*width/w),y0=Math.floor(y*height/h),y1=Math.floor((y+1)*height/h),samples=(x1-x0)*(y1-y0);
      for(let py=y0;py<y1;py++)for(let px=x0;px<x1;px++){const p=(py*width+px)*4;for(let c=0;c<4;c++)next[i+c]+=weights[p+c]/samples;}
      const a=next[i+3];for(let c=0;c<3;c++)data[i+c]=a>0?toByte(next[i+c]/a):0;data[i+3]=retainOpacity?Math.round(a*255):255;
    }
    extendColour(data,next,w,h);result.push({width:w,height:h,data});weights=next;width=w;height=h;
  }
  return result;
}
