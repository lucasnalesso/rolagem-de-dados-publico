/* Read only capture/route diagnostics; no recording, credentials, or device IDs. */
function readCallAudioStatus(){
 const track=media?.getAudioTracks()[0],settings=track?.getSettings?.()||{};
 return {capturing:Boolean(track&&track.readyState==='live'),microphoneMuted:muted,
  echoCancellation:settings.echoCancellation??null,noiseSuppression:settings.noiseSuppression??null,
  autoGainControl:settings.autoGainControl??null,processed:Boolean(microphoneInput.track()),
  context:microphoneInput.context?.state||'native',guard:echoProtection,
  guardReady:microphoneInput.guardEnabled,gateOpen:microphoneInput.gateOpen,
  references:microphoneInput.references.length,outputMuted:outputMuted||!remoteAudioUnlocked,
  inputVolume:microphoneGain,outputVolume,
  connections:peers.size,connectionStates:[...peers.values()].map(pc=>pc.connectionState),
  incomingAudio:[...remoteStreams.values()].reduce((count,stream)=>count+stream.getAudioTracks().filter(track=>track.readyState==='live').length,0)};
}
function sanitizeCallAudioStatus(value){
 if(!value||typeof value!=='object')return null;
 const status={};
 for(const key of ['capturing','microphoneMuted','noiseSuppression','autoGainControl','processed','guard','guardReady','gateOpen','outputMuted'])status[key]=typeof value[key]==='boolean'?value[key]:null;
 status.echoCancellation=[true,false,'all','remote-only'].includes(value.echoCancellation)?value.echoCancellation:null;
 status.context=['native','running','suspended','closed','interrupted'].includes(value.context)?value.context:'unknown';
 for(const key of ['references','inputVolume','outputVolume','connections','incomingAudio'])status[key]=typeof value[key]==='number'&&Number.isFinite(value[key])?Math.max(0,Math.min(400,value[key])):null;
 status.connectionStates=Array.isArray(value.connectionStates)?value.connectionStates.filter(state=>['new','connecting','connected','disconnected','failed','closed'].includes(state)).slice(0,5):[];
 return status;
}
async function publishCallAudioStatus(){
 if(!active||!media)return;
 await send({type:'camera-state',cameraOn:Boolean(media.getVideoTracks().some(track=>track.enabled)),audioStatus:readCallAudioStatus()});
}
function callAudioStatusText(title,status){
 if(!status)return title+'\nAguardando atualização do outro aparelho.';
 const state=value=>value===true?'ativado':value===false?'desativado':'não informado pelo navegador';
 return [title,'Conexões: '+(status.connections??'não informado')+' · '+(status.connectionStates?.join(', ')||'sem conexão'),
  'Faixas de áudio recebidas: '+(status.incomingAudio??'não informado'),
  'Microfone: '+(status.capturing?(status.microphoneMuted?'silenciado':'capturando'):'sem captura'),
  'Cancelamento de eco: '+state(status.echoCancellation===true||typeof status.echoCancellation==='string'?true:status.echoCancellation),
  'Redução de ruído: '+state(status.noiseSuppression),'Ganho automático: '+state(status.autoGainControl),
  'Volume enviado / recebido: '+status.inputVolume+'% / '+status.outputVolume+'%',
  'Som recebido: '+(status.outputMuted?'silenciado':'ligado'),
  'Antirretorno: '+(status.guard?(status.processed&&status.guardReady?'em funcionamento':'solicitado, sem processamento ativo'):'desligado'),
  'Processador de áudio: '+status.context+' · vozes analisadas: '+status.references,
  'Envio temporário do microfone: '+(status.gateOpen?'liberado':'reduzido pelo antirretorno')].join('\n');
}
function renderCallAudioDiagnostics(){
 const panel=document.getElementById('callAudioDiagnosticsPanel');if(panel.hidden)return;
 const own=readCallAudioStatus(),track=media?.getAudioTracks()[0],lines=[callAudioStatusText('NESTE APARELHO',own)];
 if(track?.label)lines.push('Entrada selecionada: '+track.label);
 if(track&&/stereo mix|mixagem est[eé]reo|what u hear|loopback/i.test(track.label))lines.push('Atenção: esta entrada pode incluir o áudio dos alto-falantes. Escolha o microfone físico ao iniciar a chamada.');
 for(const player of players.values())if(player.id!==uid)lines.push(callAudioStatusText('OUTRO APARELHO · '+player.name,player.audioStatus));
 if(players.size<2)lines.push('Entre com os dois aparelhos na mesma sala para comparar a chamada.');
 document.getElementById('callAudioDiagnosticsResult').textContent=lines.join('\n\n');
}
document.getElementById('callAudioDiagnostics').addEventListener('click',()=>{
 const panel=document.getElementById('callAudioDiagnosticsPanel');panel.hidden=!panel.hidden;
 if(!panel.hidden){renderCallAudioDiagnostics();publishCallAudioStatus()}
});
document.getElementById('copyCallAudioDiagnostics').addEventListener('click',async()=>{
 renderCallAudioDiagnostics();const text=document.getElementById('callAudioDiagnosticsResult').textContent,status=document.getElementById('callAudioDiagnosticsCopyStatus');
 try{await navigator.clipboard.writeText(text);status.textContent='Diagnóstico copiado. Você pode colar na conversa.'}
 catch{status.textContent='Selecione e copie o texto do diagnóstico acima.'}
});
setInterval(()=>{publishCallAudioStatus();renderCallAudioDiagnostics()},10000);
