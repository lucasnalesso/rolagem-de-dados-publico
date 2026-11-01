/* Local-camera backgrounds only. Composition stays live while a dedicated worker segments frames. */
(() => {
 'use strict';
 const VERSION='1.2.0';
 const MODEL='https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter_landscape/float16/1/selfie_segmenter_landscape.tflite';
 let assetsPromise=null;
 const abortError=()=>new DOMException('Filtro cancelado','AbortError');
 function check(signal){if(signal?.aborted)throw abortError()}
 function fit(ctx,image,width,height){const scale=Math.max(width/image.width,height/image.height),w=image.width*scale,h=image.height*scale;ctx.drawImage(image,(width-w)/2,(height-h)/2,w,h)}
 async function workerEngine(signal,lowPower){
  const worker=new Worker(new URL('background-worker.js?v=2',document.baseURI));
  const pending=new Map();let sequence=0,closed=false;
  const close=()=>{if(closed)return;closed=true;worker.terminate();for(const request of pending.values()){clearTimeout(request.timer);request.reject(abortError())}pending.clear();signal.removeEventListener('abort',close)};
  signal.addEventListener('abort',close,{once:true});
  function request(type,values={},transfer=[]){
   if(closed)return Promise.reject(abortError());
   return new Promise((resolve,reject)=>{
    const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(new Error('Tempo de processamento do filtro excedido'));close()},type==='init'?35000:5000);
    pending.set(id,{resolve,reject,timer});
    try{worker.postMessage({id,type,...values},transfer)}catch(error){clearTimeout(timer);pending.delete(id);reject(error)}
   });
  }
  worker.onmessage=event=>{const item=pending.get(event.data.id);if(!item)return;clearTimeout(item.timer);pending.delete(event.data.id);if(event.data.error)item.reject(new Error(event.data.error));else item.resolve(event.data)};
  worker.onerror=event=>{event.preventDefault();for(const item of pending.values()){clearTimeout(item.timer);item.reject(new Error('Não foi possível iniciar o filtro isolado'))}pending.clear();close()};
  try{
   const init=await request('init');check(signal);
   return {mode:'worker',personCategory:init.personCategory,labels:init.labels,close,
    async infer(video,timestamp){
     check(signal);const width=lowPower?256:320,height=Math.max(1,Math.round(width*video.videoHeight/video.videoWidth));
     let bitmap;
     try{bitmap=await createImageBitmap(video,{resizeWidth:width,resizeHeight:height})}catch{bitmap=await createImageBitmap(video)}
     try{check(signal);return await request('frame',{bitmap,timestamp},[bitmap])}finally{try{bitmap.close()}catch{}}
    }};
  }catch(error){close();throw error}
 }
 async function compatibleEngine(signal){
  if(!assetsPromise)assetsPromise=(async()=>{
   const vision=await import(`https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VERSION}/vision_bundle.mjs`);
   const files=await vision.FilesetResolver.forVisionTasks(`https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VERSION}/wasm`);
   return {vision,files};
  })().catch(error=>{assetsPromise=null;throw error});
  const {vision,files}=await assetsPromise;check(signal);
  // Cache only library assets, never a model that a previous pipeline may have closed.
  const segmenter=await vision.ImageSegmenter.createFromOptions(files,{baseOptions:{modelAssetPath:MODEL,delegate:'CPU'},runningMode:'VIDEO',outputCategoryMask:true,outputConfidenceMasks:false});
  let closed=false;const close=()=>{if(!closed){closed=true;segmenter.close();signal.removeEventListener('abort',close)}};
  if(signal.aborted){close();throw abortError()}signal.addEventListener('abort',close,{once:true});
  const labels=segmenter.getLabels(),found=labels.findIndex(label=>/person|selfie|foreground|human/i.test(label));
  return {mode:'compatible',labels,personCategory:found>=0?found:0,close,
   async infer(video,timestamp){
    check(signal);if(closed)throw abortError();let result;
    try{const start=performance.now();result=segmenter.segmentForVideo(video,timestamp);const mask=result.categoryMask;if(!mask)throw new Error('Máscara não retornada');return {width:mask.width,height:mask.height,data:new Uint8Array(mask.getAsUint8Array()).buffer,elapsed:performance.now()-start}}
    finally{if(result?.close)result.close();else{result?.categoryMask?.close();result?.confidenceMasks?.forEach(mask=>mask.close())}}
   }};
 }
 async function create({stream,image,lowPower=false,onFailure=()=>{},signal:externalSignal}){
  const sourceTrack=stream.getVideoTracks()[0];if(!sourceTrack||sourceTrack.readyState!=='live')throw abortError();
  const controller=new AbortController(),signal=controller.signal;
  const video=document.createElement('video');video.muted=true;video.playsInline=true;video.srcObject=new MediaStream([sourceTrack]);
  const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d',{alpha:false}),maskCanvas=document.createElement('canvas'),maskCtx=maskCanvas.getContext('2d'),personCanvas=document.createElement('canvas'),personCtx=personCanvas.getContext('2d');
  let engine=null,output=null,frame=0,busy=false,ready=false,hasMask=false,maskImage=null,errors=0,lastRequest=-Infinity,lastVideoTime=-1,lastDraw=-Infinity;
  let interval=lowPower?180:110;const fps=lowPower?12:18;
  const pipeline={image,video,stream:null,active:true,stats:{frames:0,masks:0,mode:'loading',interval},
   stop(){if(!pipeline.active)return;pipeline.active=false;controller.abort();clearTimeout(frame);engine?.close();output?.getTracks().forEach(track=>track.stop());video.pause();video.srcObject=null;sourceTrack.removeEventListener('ended',stop);externalSignal?.removeEventListener('abort',stop)}
  };
  const stop=()=>pipeline.stop();sourceTrack.addEventListener('ended',stop,{once:true});externalSignal?.addEventListener('abort',stop,{once:true});
  function install(result){
   if(!pipeline.active)return;
   const {width,height}=result,values=new Uint8Array(result.data);
   if(maskCanvas.width!==width||maskCanvas.height!==height){maskCanvas.width=width;maskCanvas.height=height;maskImage=maskCtx.createImageData(width,height)}
   if(!maskImage)maskImage=maskCtx.createImageData(width,height);
   for(let i=0;i<values.length;i++){const j=i*4;maskImage.data[j]=maskImage.data[j+1]=maskImage.data[j+2]=255;maskImage.data[j+3]=values[i]===engine.personCategory?255:0}
   maskCtx.putImageData(maskImage,0,0);hasMask=true;pipeline.stats.masks++;
   interval=Math.max(lowPower?180:110,Math.min(750,result.elapsed*3));pipeline.stats.interval=interval;
  }
  function compose(){
   const width=canvas.width,height=canvas.height;
   if(!sourceTrack.enabled){ctx.fillStyle='#090807';ctx.fillRect(0,0,width,height);return}
   ctx.globalCompositeOperation='source-over';fit(ctx,pipeline.image,width,height);
   personCtx.globalCompositeOperation='source-over';personCtx.clearRect(0,0,width,height);personCtx.drawImage(video,0,0,width,height);
   if(hasMask){personCtx.globalCompositeOperation='destination-in';personCtx.drawImage(maskCanvas,0,0,width,height);personCtx.globalCompositeOperation='source-over'}
   ctx.drawImage(personCanvas,0,0,width,height);pipeline.stats.frames++;
  }
  function fail(error){if(!pipeline.active)return;pipeline.stop();if(ready)onFailure(error)}
  function draw(now){
   if(!pipeline.active)return;frame=setTimeout(()=>draw(performance.now()),1000/fps);
   if(video.readyState<2||!video.videoWidth)return;
   if(now-lastDraw>=1000/fps){lastDraw=now;try{compose()}catch(error){fail(error);return}}
   if(!sourceTrack.enabled||busy||now-lastRequest<interval||lastVideoTime===video.currentTime)return;
   busy=true;lastRequest=now;lastVideoTime=video.currentTime;
   engine.infer(video,now).then(result=>{if(!pipeline.active)return;install(result);errors=0}).catch(error=>{if(pipeline.active&&++errors>=3)fail(error)}).finally(()=>{busy=false});
  }
  let playTimer;
  try{
   check(externalSignal);await Promise.race([video.play(),new Promise((_,reject)=>{playTimer=setTimeout(()=>reject(new Error('Câmera sem quadros disponíveis')),10000)})]);clearTimeout(playTimer);check(signal);
   if(typeof Worker==='function'&&typeof OffscreenCanvas==='function'&&typeof createImageBitmap==='function'){
    try{engine=await workerEngine(signal,lowPower)}catch(error){check(signal);console.warn('Filtro isolado indisponível; usando modo compatível',error);engine=await compatibleEngine(signal)}
   }else engine=await compatibleEngine(signal);
   check(signal);pipeline.stats.mode=engine.mode;pipeline.stats.personCategory=engine.personCategory;
   const width=Math.min(video.videoWidth,lowPower?360:480),height=Math.max(1,Math.round(width*video.videoHeight/video.videoWidth));
   canvas.width=personCanvas.width=width;canvas.height=personCanvas.height=height;
   install(await engine.infer(video,performance.now()));check(signal);compose();
   output=canvas.captureStream(fps);pipeline.stream=output;ready=true;frame=setTimeout(()=>draw(performance.now()),1000/fps);return pipeline;
  }catch(error){clearTimeout(playTimer);pipeline.stop();throw error}
 }
 window.MesaBackgroundEffects={create};
})();
