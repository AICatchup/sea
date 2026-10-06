export const gpuSkinnedCommon = `
precision highp float;
precision highp int;
uniform int width;
vec4 fetch(sampler2D t,int i){return texelFetch(t,ivec2(i%width,i/width),0);}
int address(){return int(gl_FragCoord.y)*width+int(gl_FragCoord.x);}
`;
export const gpuSkinFragment = gpuSkinnedCommon + `
uniform sampler2D sourceData,bones,worlds,normals;
uniform int vertices;
out vec4 result;
void main(){int a=address(),v=a/2;if(v>=vertices){result=vec4(0);return;}
vec4 p=fetch(sourceData,v*5),n=fetch(sourceData,v*5+1),ids=fetch(sourceData,v*5+2),weights=fetch(sourceData,v*5+3),meta=fetch(sourceData,v*5+4);
mat4 s=mat4(0);for(int j=0;j<4;j++){int b=int(ids[j]);s+=mat4(fetch(bones,b*4),fetch(bones,b*4+1),fetch(bones,b*4+2),fetch(bones,b*4+3))*weights[j];}
int surface=int(meta.x);int w=surface*4;mat4 world=mat4(fetch(worlds,w),fetch(worlds,w+1),fetch(worlds,w+2),fetch(worlds,w+3));
if(a%2==0){vec4 q=world*vec4((s*vec4(p.xyz,1)).xyz,1);result=vec4(q.xyz/q.w,0);}
else{int k=surface*3;mat3 nm=mat3(fetch(normals,k).xyz,fetch(normals,k+1).xyz,fetch(normals,k+2).xyz);vec3 q=nm*(s*vec4(n.xyz,0)).xyz;float len=length(q);result=vec4(len>0.?q/len:vec3(0),0);}}
`;
export const gpuPackFragment = gpuSkinnedCommon + `
uniform sampler2D previous,vertexData,triangles,nodeData,visibility;
uniform int triangleOffset,totalTexels,depth,materials;
out vec4 result;
vec3 pointAt(int triangle,int corner){int v=int(fetch(triangles,triangle*2)[corner]);return fetch(vertexData,v*2).xyz;}
void main(){int a=address();result=fetch(previous,a);if(a>=totalTexels){result=vec4(0);return;}
if(a>=triangleOffset){if(depth!=0)return;int ti=(a-triangleOffset)/12,c=(a-triangleOffset)%12;vec4 tr=fetch(triangles,ti*2),meta=fetch(triangles,ti*2+1);
if(c<6){int v=int(tr[c%3]);result=fetch(vertexData,v*2+(c/3));if(c==0)result.w=fetch(visibility,int(tr.w)*materials+int(meta.x)).x>.5?meta.x:-1.;}return;}
int ni=a/3,component=a%3;vec4 nd=fetch(nodeData,ni*2),extra=fetch(nodeData,ni*2+1);if(component==2){result=vec4(nd.zw,0,0);return;}if(int(extra.x)!=depth)return;
vec3 lo=vec3(3.402823e38),hi=-lo;if(nd.w>0.){for(int j=0;j<8;j++){if(j>=int(nd.w))break;for(int k=0;k<3;k++){vec3 p=pointAt(int(nd.z)+j,k);lo=min(lo,p);hi=max(hi,p);}}// Relative Float32 outward margin, plus 10 micrometers.
vec3 margin=max(abs(lo),abs(hi))*0.00000024+vec3(.00001);lo-=margin;hi+=margin;
}else{vec4 l0=fetch(previous,int(nd.x)*3),l1=fetch(previous,int(nd.x)*3+1),r0=fetch(previous,int(nd.y)*3),r1=fetch(previous,int(nd.y)*3+1);lo=min(l0.xyz,r0.xyz);hi=max(l1.xyz,r1.xyz);}
result=component==0?vec4(lo,nd.x):vec4(hi,nd.y);}
`;
export const gpuComposeFragment = gpuSkinnedCommon + `
uniform sampler2D prefixData,skinData;
uniform int prefixTexels,skinTexels;
out vec4 result;
void main(){int a=address();result=a<prefixTexels?fetch(prefixData,a):a<prefixTexels+skinTexels?fetch(skinData,a-prefixTexels):vec4(0);}
`;
