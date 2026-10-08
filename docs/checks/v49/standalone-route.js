(()=>{
 const job=window.__sandRoute49={status:'outward',samples:[],frameIntervals:[],scope:'Production sea.html from Secret bookmark; actual key listeners via bounded synthetic DOM input, no QA pose mutation. Local waterline out-and-back only.'};
 const start=performance.now(),origin={x:__sea.camera.x,z:__sea.camera.z},held=new Set(),names={KeyW:'w',KeyA:'a',KeyS:'s',KeyD:'d'};
 let lastFrame=0,holdStart=0,stage=0,stopped=false;
 function keys(desired){for(const code of Object.keys(names)){const down=desired.has(code);if(down===held.has(code))continue;window.dispatchEvent(new KeyboardEvent(down?'keydown':'keyup',{key:names[code],code,bubbles:true}));if(down)held.add(code);else held.delete(code);}}
 const frame=t=>{if(stopped)return;if(lastFrame)job.frameIntervals.push(t-lastFrame);lastFrame=t;requestAnimationFrame(frame)};requestAnimationFrame(frame);
 const timer=setInterval(()=>{
  try{
   const d=__sea,p=d.camera,target=stage<2?{x:origin.x+20,z:origin.z}:origin,dx=target.x-p.x,dz=target.z-p.z,distance=Math.hypot(dx,dz),desired=new Set();
   job.samples.push({elapsed:performance.now()-start,camera:p,adventure:d.adventure,ground:d.ground,sand:d.sandMoisture,distance,stage});
   if(stage===0&&distance<.35){stage=1;holdStart=performance.now();job.status='at-waterline';job.arrival=job.samples.at(-1);}
   if(stage===1&&performance.now()-holdStart>2500){stage=2;job.status='returning';keys(new Set());return;}
   if(stage!==1&&distance>.28){const f=dx*Math.sin(p.yaw)-dz*Math.cos(p.yaw),r=dx*Math.cos(p.yaw)+dz*Math.sin(p.yaw);if(Math.abs(f)>.2)desired.add(f>0?'KeyW':'KeyS');if(Math.abs(r)>.2)desired.add(r>0?'KeyD':'KeyA');}
   if(stage===2&&distance<.28||performance.now()-start>44000){clearInterval(timer);keys(new Set());stopped=true;job.status=stage===2&&distance<.28?'done':'unreached';job.final=job.samples.at(-1);return;}
   keys(desired);
  }catch(e){clearInterval(timer);keys(new Set());stopped=true;job.status='error';job.error=String(e);}
 },100);
 setTimeout(()=>{clearInterval(timer);keys(new Set());stopped=true;if(!['done','unreached','error'].includes(job.status))job.status='capped';},45000);
 return {started:true,origin};
})()
