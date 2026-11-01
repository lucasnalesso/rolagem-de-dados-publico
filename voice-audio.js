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
  constructor(){this.context=null;this.source=null;this.output=null;this.stage=null;this.level=1}
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
   this.stage.limiter.connect(this.output);
   const track=this.output.stream.getAudioTracks()[0];
   try{track.contentHint='speech'}catch{}
   return track;
  }
  setLevel(level){
   this.level=Math.max(0,Math.min(4,level));
   if(this.stage&&this.context.state!=='closed')this.stage.gain.gain.setTargetAtTime(this.level,this.context.currentTime,.025);
  }
  setMuted(muted){for(const track of this.output?.stream.getAudioTracks()||[])track.enabled=!muted}
  track(){return this.output?.stream.getAudioTracks().find(track=>track.readyState==='live')||null}
  disconnect(){
   try{this.source?.disconnect();this.stage?.gain.disconnect();this.stage?.limiter.disconnect()}catch{}
   this.output?.stream.getTracks().forEach(track=>track.stop());this.source=null;this.stage=null;this.output=null;
  }
  stop(){this.disconnect();const context=this.context;this.context=null;if(context&&context.state!=='closed')context.close().catch(()=>{})}
 }
 async function protectMicrophone(track){
  const capabilities=track.getCapabilities?.()||{};
  const modes=capabilities.echoCancellation;
  const echo=Array.isArray(modes)&&modes.includes('all')?'all':true;
  try{await track.applyConstraints({echoCancellation:echo,noiseSuppression:true,autoGainControl:true,channelCount:1})}
  catch{try{await track.applyConstraints({echoCancellation:true,noiseSuppression:true,autoGainControl:true})}catch{}}
 }
 function tuneReceiver(receiver){
  if(receiver?.track?.kind!=='audio')return;
  // A preferred target; the browser can increase buffering on an unstable network.
  try{if('jitterBufferTarget' in receiver)receiver.jitterBufferTarget=60}catch{}
 }
 window.MesaVoiceAudio={MicrophoneInput,gainStage,protectMicrophone,tuneReceiver};
})();
