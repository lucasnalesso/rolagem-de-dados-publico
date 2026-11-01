/* Microphone-only amplification. This graph never connects to the local speakers. */
(() => {
 'use strict';
 function gainStage(context,source,level){
  const gain=context.createGain(),compressor=context.createDynamicsCompressor(),limiter=context.createWaveShaper();
  gain.gain.value=Math.max(0,Math.min(4,level));
  compressor.threshold.value=-3;compressor.knee.value=3;compressor.ratio.value=20;
  compressor.attack.value=.003;compressor.release.value=.1;
  const ceiling=new Float32Array(2049);
  for(let i=0;i<ceiling.length;i++)ceiling[i]=Math.max(-.98,Math.min(.98,2*i/(ceiling.length-1)-1));
  limiter.curve=ceiling;
  source.connect(gain);gain.connect(compressor);compressor.connect(limiter);
  return {gain,compressor,limiter};
 }
 class MicrophoneInput {
  constructor(){this.context=null;this.source=null;this.output=null;this.stage=null;this.level=2}
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
   try{this.source?.disconnect();this.stage?.gain.disconnect();this.stage?.compressor.disconnect();this.stage?.limiter.disconnect()}catch{}
   this.output?.stream.getTracks().forEach(track=>track.stop());this.source=null;this.stage=null;this.output=null;
  }
  stop(){this.disconnect();const context=this.context;this.context=null;if(context&&context.state!=='closed')context.close().catch(()=>{})}
 }
 window.MesaVoiceAudio={MicrophoneInput,gainStage};
})();
