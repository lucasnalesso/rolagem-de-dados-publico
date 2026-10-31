/* Custom dashboard backgrounds are local preferences, like the built-in choices. */
(() => {
 'use strict';
 const options=document.getElementById('dashboardBackgroundOptions');
 const scene=document.querySelector('.scene');
 const imageKey='mesa:dashboard-upload:v1';
 const choiceKey='mesa:dashboard-background';
 const upload=document.createElement('button');
 upload.type='button';upload.id='uploadDashboardBtn';upload.className='dashboard-background-choice';
 upload.textContent='＋ Enviar plano';
 const input=document.createElement('input');
 input.type='file';input.id='dashboardImageUpload';input.accept='image/jpeg,image/png,image/webp';input.hidden=true;
 const custom=document.createElement('button');
 custom.type='button';custom.id='customDashboardBtn';custom.className='dashboard-background-choice';custom.hidden=true;
 const preview=document.createElement('img');preview.className='dashboard-background-preview';preview.alt='';
 const label=document.createElement('span');label.textContent='Meu plano enviado';custom.append(preview,label);
 const remove=document.createElement('button');
 remove.type='button';remove.id='deleteDashboardBtn';remove.className='dashboard-background-choice';
 remove.textContent='Excluir plano';remove.hidden=true;
 const note=document.createElement('small');note.textContent='Imagem salva para este navegador.';
 options.append(custom,upload,remove,input,note);
 let saved='';
 try{saved=localStorage.getItem(imageKey)||''}catch{}
 const valid=image=>/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(image);
 function apply(image){
  scene.classList.add('dashboard-photo');scene.style.backgroundImage=`url("${image}")`;
  document.querySelectorAll('[data-dashboard-bg]').forEach(button=>button.classList.remove('selected'));
  custom.classList.add('selected');
 }
 function showChoice(){custom.hidden=!valid(saved);remove.hidden=custom.hidden;remove.style.display=remove.hidden?'none':'';if(!custom.hidden)preview.src=saved;else preview.removeAttribute('src')}
 showChoice();
 if(valid(saved)&&localStorage.getItem(choiceKey)==='custom')apply(saved);
 options.addEventListener('click',event=>{
  if(event.target.closest('[data-dashboard-bg]'))custom.classList.remove('selected');
 });
 custom.addEventListener('click',()=>{if(valid(saved)){localStorage.setItem(choiceKey,'custom');apply(saved)}});
 upload.addEventListener('click',()=>input.click());
 remove.addEventListener('click',()=>{
  if(!valid(saved)||!confirm('Excluir o plano enviado deste navegador? A imagem original no dispositivo será mantida.'))return;
  try{
   const wasSelected=localStorage.getItem(choiceKey)==='custom';
   localStorage.removeItem(imageKey);
   if(wasSelected)document.querySelector('[data-dashboard-bg="default"]').click();
   saved='';custom.classList.remove('selected');showChoice();toast('Plano enviado excluído.');
  }catch{toast('Não foi possível excluir o plano. Tente novamente.')}
 });
 input.addEventListener('change',async()=>{
  const file=input.files[0];if(!file)return;
  upload.disabled=true;remove.disabled=true;upload.textContent='Enviando plano…';let url;
  try{
   if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>20*1024*1024)throw new Error('Escolha uma imagem JPG, PNG ou WebP de até 20 MB.');
   url=URL.createObjectURL(file);const image=new Image();
   await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=()=>reject(new Error('Não foi possível abrir esta imagem.'));image.src=url});
   const scale=Math.min(1,1600/image.naturalWidth,1200/image.naturalHeight),canvas=document.createElement('canvas');
   canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));
   const context=canvas.getContext('2d');context.fillStyle='#100e0c';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(image,0,0,canvas.width,canvas.height);
   let result;for(const quality of [.85,.7,.5,.3]){result=canvas.toDataURL('image/jpeg',quality);if(result.length<600000)break}
   if(result.length>=600000)throw new Error('Escolha uma imagem menor para salvar o plano de fundo.');
   try{localStorage.setItem(imageKey,result);localStorage.setItem(choiceKey,'custom')}
   catch{throw new Error('Não há espaço neste navegador para guardar o fundo. Escolha uma imagem menor.')}
   saved=result;showChoice();apply(saved);toast('Plano de fundo enviado e aplicado.');
  }catch(error){toast(error.message||'Não foi possível enviar o plano de fundo.')}
  finally{if(url)URL.revokeObjectURL(url);input.value='';upload.disabled=false;remove.disabled=false;upload.textContent='＋ Enviar plano'}
 });
})();
