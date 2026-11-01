/* Microphone-only amplification. This graph never connects to the local speakers. */
(() => {
 'use strict';
 function gainStage(context,source,level){
  const gain=context.createGain(),limiter=context.createWaveShaper();
  gain.gain.value=Math.max(0,Math.min(4,level));
  const ceiling=new Float32Array(2049);
  for(let i=0;i<ceiling.length;i++)ceiling[i]=Math.max(-.98,Math.min(.98,2*i/(ceiling.length-1)-1));
  limiter.curve=ceiling;
  source.connect(gain);gain.connect(limiter);
  return {gain,limiter};
 }
 class MicrophoneInput {
  constructor(){this.context=null;this.source=null;this.output=null;this.stage=null;this.level=1;this.gate=null;this.references=[];this.referenceKey="";this.guardTimer=null;this.guardEnabled=false;this.guardAudible=false;this.lastFarSpeech=-Infinity;this.gateOpen=true}
  async unlock(){
   const Context=window.AudioContext||window.webkitAudioContext;
   if(!Context)return false;
   if(!this.context||this.context.state==='closed')this.context=new Context({latencyHint:'interactive'});
   if(this.context.state!=='running')await this.context.resume();
   return this.context.state==='running';
  }
  async start(stream,level){
   this.level=Math.max(0,Math.min(4,level));
   if(!await this.unlock())return null;
   const tracks=stream.getAudioTracks().filter(track=>track.readyState==='live');
   if(!tracks.length)return null;
   this.disconnect();
   this.source=this.context.createMediaStreamSource(new MediaStream(tracks));
   this.stage=gainStage(this.context,this.source,this.level);
   this.output=this.context.createMediaStreamDestination();
   this.gate=this.context.createGain();this.gate.gain.value=1;
   this.stage.limiter.connect(this.gate);this.gate.connect(this.output);
   const track=this.output.stream.getAudioTracks()[0];
   try{track.contentHint='speech'}catch{}
   return track;
  }
  setLevel(level){
   this.level=Math.max(0,Math.min(4,level));
   if(this.stage&&this.context.state!=='closed')this.stage.gain.gain.setTargetAtTime(this.level,this.context.currentTime,.025);
  }
  setEchoReference(streams,enabled,audible,volume=1){
   if(!this.context||!this.gate){this.guardEnabled=false;return}
   this.guardEnabled=enabled;this.guardAudible=audible;this.referenceVolume=volume;
   const tracks=streams.flatMap(stream=>stream.getAudioTracks()).filter(track=>track.readyState==='live');
   const key=enabled?tracks.map(track=>track.id).sort().join(','):'';
   if(this.referenceKey!==key){
    this.clearReferences();this.referenceKey=key;
    for(const track of enabled?tracks:[]){
     let source;
     try{
      source=this.context.createMediaStreamSource(new MediaStream([track]));
      const analyser=this.context.createAnalyser();analyser.fftSize=512;
      source.connect(analyser);
      // Analysis only: no reference is connected to speakers or to the microphone output.
      this.references.push({source,analyser,track,buffer:new Float32Array(512)});
     }catch{try{source?.disconnect()}catch{}}
    }
   }
   if(!enabled||!audible){this.lastFarSpeech=-Infinity;this.setGate(true)}
   if(!this.guardTimer&&enabled)this.checkEchoReference();
   if(!enabled){clearTimeout(this.guardTimer);this.guardTimer=null}
  }
  setGate(open){
   if(!this.gate||this.gateOpen===open)return;
   this.gateOpen=open;
   this.gate.gain.setTargetAtTime(open?1:0,this.context.currentTime,open?.025:.004);
  }
  checkEchoReference(){
   this.guardTimer=null;if(!this.context||!this.gate||!this.guardEnabled)return;
   const now=this.context.currentTime;let speaking=false;
   if(this.guardAudible&&this.context.state==='running')for(const reference of this.references){
    if(reference.track.readyState!=='live')continue;
    reference.analyser.getFloatTimeDomainData(reference.buffer);
    let power=0;for(const sample of reference.buffer)power+=sample*sample;
    if(Math.sqrt(power/reference.buffer.length)*this.referenceVolume>.003){speaking=true;break}
   }
   if(speaking)this.lastFarSpeech=now;
   this.setGate(!this.guardAudible||now-this.lastFarSpeech>.24);
   this.guardTimer=setTimeout(()=>this.checkEchoReference(),20);
  }
  clearReferences(){
   for(const reference of this.references){try{reference.source.disconnect();reference.analyser.disconnect()}catch{}}
   this.references=[];this.referenceKey='';
  }
  setMuted(muted){for(const track of this.output?.stream.getAudioTracks()||[])track.enabled=!muted}
  track(){return this.output?.stream.getAudioTracks().find(track=>track.readyState==='live')||null}
  disconnect(){
   clearTimeout(this.guardTimer);this.guardTimer=null;this.guardEnabled=false;this.lastFarSpeech=-Infinity;this.clearReferences();
   try{this.source?.disconnect();this.stage?.gain.disconnect();this.stage?.limiter.disconnect();this.gate?.disconnect()}catch{}
   this.output?.stream.getTracks().forEach(track=>track.stop());this.source=null;this.stage=null;this.output=null;this.gate=null;this.gateOpen=true;
  }
  stop(){this.disconnect();const context=this.context;this.context=null;if(context&&context.state!=='closed')context.close().catch(()=>{})}
 }
 async function protectMicrophone(track){
  // Keep the capture settings used before microphone amplification was introduced.
  // Apply cancellation before any optional manual gain, never to the music output.
  try{await track.applyConstraints({echoCancellation:true,noiseSuppression:true,autoGainControl:false,channelCount:1})}
  catch{try{await track.applyConstraints({echoCancellation:true,noiseSuppression:true,autoGainControl:false})}catch{}}
 }
 window.MesaVoiceAudio={MicrophoneInput,gainStage,protectMicrophone};
})();
