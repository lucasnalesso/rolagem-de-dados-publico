/* One segmentation model per worker/pipeline. No audio or room signaling. */
const VERSION='1.2.0';
const MODEL='https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter_landscape/float16/1/selfie_segmenter_landscape.tflite';
let segmenter=null,personCategory=0;
self.onmessage=async event=>{
 const {id,type,bitmap,timestamp}=event.data;
 let result,returned=false;
 try{
  if(type==='init'){
   const vision=await import(`https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VERSION}/vision_bundle.mjs`);
   const files=await vision.FilesetResolver.forVisionTasks(`https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VERSION}/wasm`);
   segmenter=await vision.ImageSegmenter.createFromOptions(files,{
    baseOptions:{modelAssetPath:MODEL,delegate:'CPU'},canvas:new OffscreenCanvas(256,144),
    runningMode:'VIDEO',outputCategoryMask:false,outputConfidenceMasks:true
   });
   const labels=segmenter.getLabels();
   const found=labels.findIndex(label=>/person|selfie|foreground|human/i.test(label));
   personCategory=found>=0?found:0;self.postMessage({id,labels,personCategory});return;
  }
  if(type==='frame'){
   if(!segmenter)throw new Error('Modelo indisponível');
   const start=performance.now();result=segmenter.segmentForVideo(bitmap,timestamp);
   const mask=result.confidenceMasks?.[personCategory];if(!mask)throw new Error('Máscara não retornada');
   // Copy before closing the result; its mask memory belongs to MediaPipe.
   const data=new Float32Array(mask.getAsFloat32Array()).buffer;
   self.postMessage({id,width:mask.width,height:mask.height,data,frame:bitmap,elapsed:performance.now()-start},[data,bitmap]);returned=true;
  }
 }catch(error){self.postMessage({id,error:error.message||'Falha no filtro'})}
 finally{
  try{if(result?.close)result.close();else{result?.categoryMask?.close();result?.confidenceMasks?.forEach(mask=>mask.close())}}catch{}
  try{if(!returned)bitmap?.close()}catch{}
 }
};
