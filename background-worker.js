/* One segmentation model per worker/pipeline. No audio or room signaling. */
const VERSION='1.2.0';
const MODEL='https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter_landscape/float16/1/selfie_segmenter_landscape.tflite';
let segmenter=null;
self.onmessage=async event=>{
 const {id,type,bitmap,timestamp}=event.data;
 let result;
 try{
  if(type==='init'){
   const vision=await import(`https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VERSION}/vision_bundle.mjs`);
   const files=await vision.FilesetResolver.forVisionTasks(`https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VERSION}/wasm`);
   segmenter=await vision.ImageSegmenter.createFromOptions(files,{
    baseOptions:{modelAssetPath:MODEL,delegate:'CPU'},canvas:new OffscreenCanvas(256,144),
    runningMode:'VIDEO',outputCategoryMask:true,outputConfidenceMasks:false
   });
   const labels=segmenter.getLabels();
   const found=labels.findIndex(label=>/person|selfie|foreground|human/i.test(label));
   self.postMessage({id,labels,personCategory:found>=0?found:0});return;
  }
  if(type==='frame'){
   if(!segmenter)throw new Error('Modelo indisponível');
   const start=performance.now();result=segmenter.segmentForVideo(bitmap,timestamp);
   const mask=result.categoryMask;if(!mask)throw new Error('Máscara não retornada');
   // Copy before closing the result; its mask memory belongs to MediaPipe.
   const data=new Uint8Array(mask.getAsUint8Array()).buffer;
   self.postMessage({id,width:mask.width,height:mask.height,data,elapsed:performance.now()-start},[data]);
  }
 }catch(error){self.postMessage({id,error:error.message||'Falha no filtro'})}
 finally{
  try{if(result?.close)result.close();else{result?.categoryMask?.close();result?.confidenceMasks?.forEach(mask=>mask.close())}}catch{}
  try{bitmap?.close()}catch{}
 }
};
