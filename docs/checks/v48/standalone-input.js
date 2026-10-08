(()=>{
 const j=window.__plantStandalone48={status:'travelling',samples:[],scope:'Production app from dive bookmark; synthetic DOM W/A/S/D/C/Space key listeners, no QA state or teleport API.'};
 const held=new Set(),names={KeyW:'w',KeyS:'s',KeyA:'a',KeyD:'d',KeyC:'c',Space:' '};
 function keys(desired){for(const code of Object.keys(names)){const down=desired.has(code);if(down===held.has(code))continue;window.dispatchEvent(new KeyboardEvent(down?'keydown':'keyup',{key:names[code],code,bubbles:true}));if(down)held.add(code);else held.delete(code);}}
 const begin=performance.now();let reached=0;
 const timer=setInterval(()=>{
  try{
   const d=__sea,p=d.camera,dx=-118.401425-p.x,dz=-93.524357-p.z,distance=Math.hypot(dx,dz),desired=new Set();
   j.samples.push({elapsed:performance.now()-begin,camera:p,adventure:d.adventure,quality:d.quality,fps:d.fps,distance});
   if(!reached&&distance>.8){
    const f=dx*Math.sin(p.yaw)-dz*Math.cos(p.yaw),r=dx*Math.cos(p.yaw)+dz*Math.sin(p.yaw);
    if(Math.abs(f)>.35)desired.add(f>0?'KeyW':'KeyS');if(Math.abs(r)>.35)desired.add(r>0?'KeyD':'KeyA');
   }else if(!reached){reached=performance.now();j.status='holding';j.arrival={camera:p,adventure:d.adventure,distance};}
   if(d.adventure.depth<2.3)desired.add('KeyC');else if(d.adventure.depth>2.6)desired.add('Space');
   if(reached&&performance.now()-reached>12000||performance.now()-begin>45000){
    clearInterval(timer);keys(new Set());j.status=reached?'done':'unreached';j.final={camera:p,adventure:d.adventure,distance};return;
   }
   keys(desired);
  }catch(e){clearInterval(timer);keys(new Set());j.status='error';j.error=String(e);}
 },100);
 // Independent input-release cap, including a failed observation of this job.
 setTimeout(()=>{clearInterval(timer);keys(new Set());if(!['done','unreached','error'].includes(j.status))j.status='capped';},46000);
 return {started:true};
})()
