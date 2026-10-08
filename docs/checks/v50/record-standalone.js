(()=>{
 const canvas=document.querySelector('canvas');
 const mime=['video/webm;codecs=vp9','video/webm;codecs=vp8','video/webm'].find(x=>MediaRecorder.isTypeSupported(x));
 if(!canvas||!mime)throw Error('Canvas recording unavailable');
 const stream=canvas.captureStream(30),chunks=[],recorder=new MediaRecorder(stream,{mimeType:mime,videoBitsPerSecond:3500000});
 const job=window.__foamRecording50={status:'recording',mime,started:performance.now(),scope:'Internal visual QA recording of the actual production canvas, not the final showcase film.'};
 let watchdog,monitor;
 const stop=()=>{clearInterval(monitor);clearTimeout(watchdog);if(recorder.state!=='inactive')recorder.stop();};
 recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data)};
 recorder.onerror=e=>{job.status='error';job.error=String(e.error);stop();};
 recorder.onstop=()=>{
  job.elapsed=performance.now()-job.started;stream.getTracks().forEach(t=>t.stop());
  const blob=new Blob(chunks,{type:mime}),reader=new FileReader();job.bytes=blob.size;
  reader.onload=()=>{job.data=String(reader.result);job.status='done';};reader.onerror=()=>{job.status='error';job.error=String(reader.error);};reader.readAsDataURL(blob);
 };
 recorder.start(500);monitor=setInterval(()=>{if(['done','unreached','capped','error'].includes(window.__foamRoute50?.status))stop()},200);watchdog=setTimeout(stop,46000);
 return {started:true,mime};
})()
