/** Requires receiverDynamic sampler, receiverRead and receiverBox from receiver bridge. */
export const skinnedReceiverTraceGLSL = /* glsl */ `
uniform int skinnedDataOffset;
uniform int skinnedRoot;
uniform int skinnedAvailable;
uniform int skinnedTriangleOffset;
bool traceSkinnedReceiver(vec3 origin, vec3 unitWorldRay, float maxDistance, out vec3 hitWorld, out vec3 normalWorld, out vec2 uv, out int materialId, out vec3 vertexColor, out vec3 tangentWorld, out vec3 bitangentWorld) {
  hitWorld=vec3(0.0); normalWorld=vec3(0.0); uv=vec2(0.0); materialId=-1; vertexColor=vec3(1.0); tangentWorld=vec3(1.0,0.0,0.0); bitangentWorld=vec3(0.0,1.0,0.0);
  if(skinnedAvailable==0 || skinnedRoot<0 || maxDistance<=0.0) return false;
  float closest=maxDistance; bool found=false; int stack[48]; int size=1; stack[0]=skinnedRoot;
  while(size>0) {
    int node=skinnedDataOffset+stack[--size]*3;
    vec4 lo=receiverRead(receiverDynamic,node),hi=receiverRead(receiverDynamic,node+1),info=receiverRead(receiverDynamic,node+2);
    if(!receiverBox(origin,unitWorldRay,lo.xyz,hi.xyz,closest))continue;
    if(int(info.y)==0){stack[size++]=int(lo.w);stack[size++]=int(hi.w);continue;}
    for(int ti=0;ti<8;ti++) {
      if(ti>=int(info.y))break;
      int address=skinnedDataOffset+skinnedTriangleOffset+(int(info.x)+ti)*12;
      vec4 a=receiverRead(receiverDynamic,address); if(a.w<0.0)continue;
      vec3 b=receiverRead(receiverDynamic,address+1).xyz,c=receiverRead(receiverDynamic,address+2).xyz;
      vec3 e1=b-a.xyz,e2=c-a.xyz,p=cross(unitWorldRay,e2);float determinant=dot(e1,p);
      if(abs(determinant)<1e-10)continue;
      vec3 offset=origin-a.xyz;float u=dot(offset,p)/determinant;vec3 q=cross(offset,e1);float v=dot(unitWorldRay,q)/determinant,distance=dot(e2,q)/determinant;
      if(u<0.0||v<0.0||u+v>1.0||distance<1e-5||distance>=closest)continue;
      float w=1.0-u-v;closest=distance;found=true;hitWorld=origin+unitWorldRay*distance;materialId=int(a.w);
      vec3 n=receiverRead(receiverDynamic,address+3).xyz*w+receiverRead(receiverDynamic,address+4).xyz*u+receiverRead(receiverDynamic,address+5).xyz*v;
      if(dot(n,n)<1e-12)n=cross(e1,e2);normalWorld=normalize(n);if(dot(normalWorld,unitWorldRay)>0.0)normalWorld=-normalWorld;
      vec2 ua=receiverRead(receiverDynamic,address+6).xy,ub=receiverRead(receiverDynamic,address+7).xy,uc=receiverRead(receiverDynamic,address+8).xy;
      uv=ua*w+ub*u+uc*v;vertexColor=receiverRead(receiverDynamic,address+9).xyz*w+receiverRead(receiverDynamic,address+10).xyz*u+receiverRead(receiverDynamic,address+11).xyz*v;
      vec2 du=ub-ua,dv=uc-ua;float det=du.x*dv.y-du.y*dv.x;
      vec3 tangent=abs(det)>1e-10?(e1*dv.y-e2*du.y)/det:e1;
      tangent-=normalWorld*dot(normalWorld,tangent);
      if(dot(tangent,tangent)<1e-12)tangent=cross(abs(normalWorld.y)<0.9?vec3(0.0,1.0,0.0):vec3(1.0,0.0,0.0),normalWorld);
      tangentWorld=normalize(tangent);bitangentWorld=cross(normalWorld,tangentWorld);
      if(abs(det)>1e-10 && dot(bitangentWorld,(e2*du.x-e1*dv.x)/det)<0.0)bitangentWorld=-bitangentWorld;
    }
  }
  return found;
}
`;
