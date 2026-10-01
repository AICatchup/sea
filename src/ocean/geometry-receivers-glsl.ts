/** WebGL2 (GLSL3 or Three's GLSL1 compatibility prefix) packed receiver traversal. */
export const receiverTraceGLSL = /* glsl */ `
uniform sampler2D receiverNodes;
uniform sampler2D receiverTLAS;
uniform sampler2D receiverTriangles;
uniform sampler2D receiverInstances;
uniform int receiverTextureWidth;
uniform int receiverRoot;
uniform int receiverAvailable;
vec4 receiverRead(sampler2D source, int address) { return texelFetch(source, ivec2(address % receiverTextureWidth, address / receiverTextureWidth), 0); }
bool receiverBox(vec3 o, vec3 d, vec3 lo, vec3 hi, float limit) {
  float nearT=0.0, farT=limit;
  for(int axis=0;axis<3;axis++) {
    if(abs(d[axis])<1e-20) { if(o[axis]<lo[axis] || o[axis]>hi[axis]) return false; }
    else { float a=(lo[axis]-o[axis])/d[axis], b=(hi[axis]-o[axis])/d[axis]; nearT=max(nearT,min(a,b)); farT=min(farT,max(a,b)); }
  }
  return farT>=nearT;
}
bool traceReceiver(vec3 origin, vec3 unitWorldRay, float maxDistance, out vec3 hitWorld, out vec3 normalWorld, out vec2 uv, out int materialId, out vec3 vertexColor) {
  hitWorld=vec3(0.0); normalWorld=vec3(0.0); uv=vec2(0.0); materialId=-1; vertexColor=vec3(1.0);
  if(receiverAvailable==0 || receiverRoot<0 || maxDistance<=0.0) return false;
  float closest=maxDistance; bool found=false;
  int topStack[48]; int topSize=1; topStack[0]=receiverRoot;
  while(topSize>0) {
    int node=topStack[--topSize]; vec4 lo=receiverRead(receiverTLAS,node*3), hi=receiverRead(receiverTLAS,node*3+1), info=receiverRead(receiverTLAS,node*3+2);
    if(!receiverBox(origin,unitWorldRay,lo.xyz,hi.xyz,closest)) continue;
    if(int(info.y)==0) { topStack[topSize++]=int(lo.w); topStack[topSize++]=int(hi.w); continue; }
    for(int leaf=0;leaf<8;leaf++) {
      if(leaf>=int(info.y)) break;
      int instance=(int(info.x)+leaf)*8;
      mat4 inverseWorld=mat4(receiverRead(receiverInstances,instance),receiverRead(receiverInstances,instance+1),receiverRead(receiverInstances,instance+2),receiverRead(receiverInstances,instance+3));
      mat3 normalMatrix=mat3(receiverRead(receiverInstances,instance+4).xyz,receiverRead(receiverInstances,instance+5).xyz,receiverRead(receiverInstances,instance+6).xyz);
      vec3 o=(inverseWorld*vec4(origin,1.0)).xyz, d=(inverseWorld*vec4(unitWorldRay,0.0)).xyz;
      int stack[48]; int size=1; stack[0]=int(receiverRead(receiverInstances,instance+7).x);
      while(size>0) {
        int bn=stack[--size]; vec4 bl=receiverRead(receiverNodes,bn*3), bh=receiverRead(receiverNodes,bn*3+1), bi=receiverRead(receiverNodes,bn*3+2);
        if(!receiverBox(o,d,bl.xyz,bh.xyz,closest)) continue;
        if(int(bi.y)==0) { stack[size++]=int(bl.w); stack[size++]=int(bh.w); continue; }
        for(int triangle=0;triangle<8;triangle++) {
          if(triangle>=int(bi.y)) break;
          int address=(int(bi.x)+triangle)*12;
          vec4 a=receiverRead(receiverTriangles,address); vec3 b=receiverRead(receiverTriangles,address+1).xyz,c=receiverRead(receiverTriangles,address+2).xyz;
          vec3 e1=b-a.xyz,e2=c-a.xyz,p=cross(d,e2); float determinant=dot(e1,p);
          if(abs(determinant)<1e-10) continue;
          vec3 offset=o-a.xyz; float u=dot(offset,p)/determinant; vec3 q=cross(offset,e1); float v=dot(d,q)/determinant, distance=dot(e2,q)/determinant;
          if(u<0.0 || v<0.0 || u+v>1.0 || distance<1e-5 || distance>=closest) continue;
          float w=1.0-u-v; closest=distance; found=true; hitWorld=origin+unitWorldRay*distance; materialId=int(a.w);
          normalWorld=normalize(normalMatrix*(receiverRead(receiverTriangles,address+3).xyz*w+receiverRead(receiverTriangles,address+4).xyz*u+receiverRead(receiverTriangles,address+5).xyz*v));
          if(dot(normalWorld,unitWorldRay)>0.0) normalWorld=-normalWorld;
          uv=receiverRead(receiverTriangles,address+6).xy*w+receiverRead(receiverTriangles,address+7).xy*u+receiverRead(receiverTriangles,address+8).xy*v;
          vertexColor=receiverRead(receiverTriangles,address+9).xyz*w+receiverRead(receiverTriangles,address+10).xyz*u+receiverRead(receiverTriangles,address+11).xyz*v;
        }
      }
    }
  }
  return found;
}
`;
