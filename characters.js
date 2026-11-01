/* Public edition only: AD&D 2e character editor, based on the four-page reference. */
function mountCharacterEditor(npc) {
 'use strict';
 const el = id => document.getElementById(npc && !['nameInput','joinBtn'].includes(id) ? 'npc-'+id : id);
 const scoped = html => npc ? html.replace(/(id|for|aria-labelledby|aria-controls)="([^"]+)"/g, (_,attr,id)=>`${attr}="npc-${id}"`) : html;
 const endpoint = npc ? '/api/npcs' : '/api/characters';
 const screen = el('charactersScreen');
 const records = new Map(), drafts = new Map(), queues = new Map();
 let selected = npc ? crypto.randomUUID().replaceAll('-','') : 1, page = 1, storage = 'server', refreshing = false, timer;
 const titles = ['Atributos e combate', 'Equipamentos e perícias', 'Magias I', 'Magias II'];
 const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const cacheKey = slot => `mesa:${npc?'npc':'character'}-editor:v1:${room}:${slot}`;
 const slots = () => npc ? [...new Set([...records.keys(), ...[...drafts].filter(([id,data])=>data.dirty||data.editToken).map(([id])=>id), selected])] : [1,2,3,4,5];
 const slotLabel = slot => npc ? 'NPC '+(slots().indexOf(slot)+1) : 'Jogador '+slot;
 const newToken = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), n => n.toString(16).padStart(2, '0')).join('');
 function draft(slot) {
  if (!drafts.has(slot)) {
   let data;
   try { data = JSON.parse(localStorage.getItem(cacheKey(slot)) || 'null'); } catch {}
   if (!data || typeof data.fields !== 'object' || !data.fields) data = {fields:{}, editToken:'', version:0, dirty:false};
   drafts.set(slot, data);
  }
  return drafts.get(slot);
 }
 function persist(slot) {
  try { localStorage.setItem(cacheKey(slot), JSON.stringify(draft(slot))); return true; }
  catch { status('O navegador não conseguiu guardar a cópia. Use “Baixar cópia” e salve na sala.', true); return false; }
 }
 function editable(slot = selected) { return active && (!records.has(slot) || Boolean(draft(slot).editToken)); }
 function status(text, warning = false) {
  const label = el('characterSaveStatus');
  if (label) { label.textContent = text; label.classList.toggle('warning', warning); }
 }
 function field(key, label, multiline = false) {
  const value = escape(draft(selected).fields[key] || '');
  return `<label class="character-field"><span>${escape(label)}</span>${multiline
   ? `<textarea data-field="${key}" maxlength="12000" rows="4">${value}</textarea>`
   : `<input data-field="${key}" type="text" maxlength="1000" value="${value}" autocomplete="off">`}</label>`;
 }
 function section(title, body) { return `<section class="character-section"><h3>${escape(title)}</h3>${body}</section>`; }
 function fields(prefix, labels) { return `<div class="character-fields">${labels.map(([key,label]) => field(prefix + key,label)).join('')}</div>`; }
 function table(prefix, columns, count, caption) {
  return `<div class="character-table-scroll" tabindex="0" aria-label="${escape(caption)} — deslize para ver todas as colunas"><table class="character-table"><caption>${escape(caption)}</caption><thead><tr><th scope="col">#</th>${columns.map(([,label])=>`<th scope="col">${escape(label)}</th>`).join('')}</tr></thead><tbody>${Array.from({length:count},(_,i)=>`<tr><th scope="row">${i+1}</th>${columns.map(([key,label])=>`<td><input type="text" maxlength="1000" data-field="${prefix}.${i}.${key}" value="${escape(draft(selected).fields[`${prefix}.${i}.${key}`] || '')}" aria-label="${escape(caption)}, linha ${i+1}, ${escape(label)}" autocomplete="off"></td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
 }
 const abilities = [
  ['strength','Força',[['hit','Chance de acertar'],['damage','Ajuste de dano'],['load','Carga permitida'],['sustain','Sustentação'],['doors','Abrir portas'],['bars','Barras / portais']]],
  ['dexterity','Destreza',[['reaction','Ajuste de reação'],['ranged','Ataque à distância'],['defense','Ajuste defensivo']]],
  ['constitution','Constituição',[['hp','Ajuste dos P.V.'],['shock','Resistir a colapso'],['resurrection','Chance de ressurreição'],['poison','Resistência a veneno'],['regeneration','Regeneração']]],
  ['intelligence','Inteligência',[['languages','Número de línguas'],['circle','Círculo de magia'],['learn','Chance de aprender magia'],['maximum','Máximo de magias / círculo'],['immunity','Imunidade a magias']]],
  ['wisdom','Sabedoria',[['defense','Defesa à magia'],['bonus','Magias extras'],['failure','Chance de falha'],['immunity','Imunidade a magias']]],
  ['charisma','Carisma',[['allies','Máximo de aliados'],['loyalty','Fator de lealdade'],['reaction','Ajuste de reação']]]
 ];
 function expandableCount(kind){
  const data=draft(selected).fields,weapon=kind==='weapons',minimum=weapon?6:11;
  const inferred=Math.max(minimum,...Object.keys(data).map(key=>{const match=key.match(weapon?/^weapons\.(\d+)\./:/^spells\.(\d+)\./);return match?Number(match[1])+(weapon?1:-9):minimum}));
  return Math.min(99,Math.max(minimum,Number(data[weapon?'layout.weaponRows':'layout.magicIIRows'])||minimum,inferred));
 }
 function addSpaceButton(kind){
  return `<button type="button" class="character-add-space" data-add-sheet-section="${kind}" ${expandableCount(kind)>=99?'disabled':''}>＋ Adicionar mais ${kind==='weapons'?'armas':'magias'}</button>`;
 }
 function combatPage() {
  let body = section('Identificação', fields('identity.', [['name','Nome do personagem'],['class','Classe'],['race','Raça'],['alignment','Tendência'],['level','Nível'],['ageSex','Idade e sexo'],['weightHeight','Peso e altura'],['hairEyes','Cabelos e olhos'],['player','Jogador']]) + field('identity.appearance','Aparência geral / descrição do personagem',true));
  body += section('Atributos', abilities.map(([key,label,extras])=>`<div class="ability-row"><div class="ability-score">${field(key+'.score',label)}</div>${fields(key+'.',extras)}</div>`).join(''));
  body += '<div class="character-two-columns">' + section('Categoria de armadura',fields('armor.',[['dexterity','Destreza'],['armor','Armadura'],['shield','Escudo'],['magic','Magia'],['other','Outros ajustes'],['final','CA final']])) + section('Pontos de vida',fields('hp.',[['maximum','P.V. máximos'],['current','P.V. atuais']])+field('hp.wounds','Ferimentos',true)) + '</div>';
  body += section('Armas corpo a corpo / distância',table('weapons',[['name','Arma'],['attacks','Nº de ataques'],['range','Alcance (P/M/L)'],['damageSmall','Dano (P/M)'],['damageLarge','Dano (G)'],['damageBonus','Ajuste de dano'],['weightSize','Peso / tamanho'],['type','Tipo de dano'],['speed','Velocidade']],expandableCount('weapons'),'Armas')+addSpaceButton('weapons'));
  body += section('Tabela de combate',fields('combat.',[['thac0','TACO'],['hit','Chance de acertar'],['ranged','Ataque à distância']]) + '<div class="combat-values">'+Array.from({length:21},(_,i)=>field('combat.ca'+(10-i),'CA '+(10-i))).join('')+'</div>');
  body += '<div class="character-two-columns">'+section('Resistências',fields('saves.',[['death','Paralisação, veneno ou morte'],['wands','Bastão, cajado ou varinha'],['petrification','Petrificação ou transformação'],['breath','Sopro de dragão'],['spells','Magias ou outros poderes mágicos']])) + section('Experiência',fields('xp.',[['current','Pontos atuais'],['next','Necessários para o próximo nível']]))+'</div>';
  return body;
 }
 function equipmentPage() {
  return section('Perícias com armas',fields('weaponSkills.',[['initial','Pontos iniciais'],['perLevel','Adicionais por nível'],['penalty','Penalidade']])+table('weaponSkills.rows',[['weapon','Arma'],['points','Pontos']],20,'Perícias com armas'))
   +section('Equipamentos',table('equipment',[['item','Item'],['cost','Custo'],['weight','Peso']],24,'Equipamentos')+fields('equipmentTotals.',[['cost','Custo total'],['weight','Peso total']]))
   +section('Dinheiro',fields('money.',[['copper','Peças de cobre'],['silver','Peças de prata'],['electrum','Peças de electrum'],['gold','Peças de ouro'],['platinum','Peças de platina']])+field('money.jewels','Joias',true))
   +section('Perícias gerais',fields('generalSkills.',[['initial','Pontos iniciais'],['intelligence','Bônus de inteligência'],['perLevel','Adicionais por nível']])+table('generalSkills.rows',[['name','Perícia'],['points','Pontos'],['ability','Habilidade'],['modifier','Modificador']],20,'Perícias gerais'))
   +section('Poder da fé',fields('faith.',[['skeleton','Esqueleto ou 1 DV'],['zombie','Zumbi'],['ghoul','Carniçal ou 2 DV'],['shadow','Sombra ou 3–4 DV'],['wight','Vulto ou 5 DV'],['ghast','Carneçal'],['wraith','Aparição ou 6 DV'],['mummy','Múmia ou 7 DV'],['spectre','Espectro ou 8 DV'],['vampire','Vampiro ou 9 DV'],['ghost','Fantasma ou 10 DV'],['lich','Lich ou 11 DV ou mais'],['special','Especial']]))
   +section('Talentos ladinos',fields('thief.',[['pickpockets','Furtar bolsos'],['locks','Abrir fechaduras'],['traps','Achar / desarmar armadilhas'],['silent','Mover-se em silêncio'],['hide','Esconder-se nas sombras'],['noise','Ouvir ruídos'],['climb','Escalar muros'],['languages','Decifrar linguagens'],['backstab','Ataque pelas costas']]))
   +section('Anotações',field('notes','Itens mágicos, contatos, nomes, lugares e outras anotações',true))
   +section('Habilidades específicas',field('abilities','Habilidades raciais, de classe e outras',true));
 }
 function magicPage(second) {
  const first = second ? 10 : 0, count = second ? expandableCount('magic') : 10;
  let body = second ? '' : section('Magias por dia',fields('daily.',Array.from({length:9},(_,i)=>[String(i+1),(i+1)+'º círculo'])));
  for (let i=first;i<first+count;i++) body += section('Magia '+(i+1),fields(`spells.${i}.`,[['name','Nome'],['level','Nível / círculo'],['range','Alcance'],['components','Componentes'],['duration','Duração'],['casting','Tempo de execução'],['area','Área de efeito'],['resistance','Resistência']])+field(`spells.${i}.description`,'Descrição',true));
  if(second)body+=addSpaceButton('magic');
  return body;
 }
 function renderPlayersList() {
  const list = el('characterSlots');
  if (!list) return;
  list.innerHTML = slots().map(slot=>{
   const record=records.get(slot), data=draft(slot);
   const label=data.fields['identity.name']||record?.fields?.['identity.name']||record?.ownerName||'Ficha disponível';
   return `<button type="button" data-character-slot="${slot}" class="character-player ${selected===slot?'selected':''}" aria-pressed="${selected===slot}"><b>${escape(slotLabel(slot).toUpperCase())}</b><span>${escape(label)}</span><small>${data.dirty?'Alterações neste aparelho':record?'Ficha salva':'Nova ficha'}</small></button>`;
  }).join('');
 }
 function renderPage() {
  renderPlayersList();
  renderPortrait();
  el('createNpcBtn').hidden=!npc;
  el('createNpcBtn').disabled=!active;
  el('deleteNpcBtn').hidden=!npc;el('deleteNpcBtn').disabled=!editable();
  el('characterTabs').innerHTML = titles.map((label,i)=>`<button type="button" data-character-page="${i+1}" class="${page===i+1?'active':''}" aria-pressed="${page===i+1}">${i+1} · ${label}</button>`).join('');
  el('editableCharacterTitle').textContent = `${slotLabel(selected)} · ${draft(selected).fields['identity.name']||'Ficha de personagem'}`;
  const form=el('characterFields');
  form.innerHTML=page===1?combatPage():page===2?equipmentPage():magicPage(page===4);
  form.disabled=!editable();
  el('saveCharacterBtn').disabled=!editable();
  el('importCharacterBtn').disabled=!editable();
  el('characterJoinPanel').hidden=active;
  el('recoverCharacterBtn').hidden=!records.has(selected)||editable();
  el('editKeyBtn').hidden=!draft(selected).editToken;
  el('characterStorageNotice').textContent=storage==='cloud'
   ? 'Salvamento em nuvem ativo. A chave de edição permite recuperar sua ficha em outro aparelho.'
   : 'Cópia automática neste navegador e sincronização com a sala. No Render gratuito, a cópia do servidor pode ser perdida após reinícios. Baixe uma cópia para guardar ou transferir para outro aparelho.';
  status(!active?'Preencha seu nome acima e clique em “Entrar e editar ficha” para liberar os campos.':!editable()?'Somente leitura · esta ficha pertence a outro jogador. Use “Recuperar acesso” se ela for sua.':draft(selected).dirty?'Alterações guardadas neste aparelho; aguardando salvar na sala.':'Edição liberada · clique nos campos para preencher. As alterações são salvas automaticamente.');
 }
 async function api(url,options) {
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),20000);
  try{
   const response=await fetch(url,{...options,signal:controller.signal}),data=await response.json();
   if(!response.ok){const error=new Error(data.error||'Não foi possível salvar a ficha.');error.status=response.status;throw error}
   return data;
  }catch(error){if(error.name==='AbortError')throw new Error('A sincronização demorou demais. A cópia neste aparelho foi mantida.');throw error}
  finally{clearTimeout(timeout)}
 }
 async function refresh(initial=false) {
  if(refreshing)return;
  refreshing=true;let deletedSelection=false;
  try {
   const data=await api(`${endpoint}?room=${encodeURIComponent(room)}`);
   if(npc){for(const id of data.deleted||[]){records.delete(id);drafts.delete(id);localStorage.removeItem(cacheKey(id));if(selected===id){selected=crypto.randomUUID().replaceAll('-','');deletedSelection=true}}}
   storage=data.storage;records.clear();
   for(const record of data.sheets||[]) {
    records.set(record.slot,record);const local=draft(record.slot);
    if(!local.dirty||JSON.stringify(local.fields)===JSON.stringify(record.fields)){local.fields={...record.fields};local.version=record.version;local.dirty=false;local.blocked=false;persist(record.slot)}
   }
   if(npc&&initial&&records.size&&!records.has(selected)&&!draft(selected).dirty&&!draft(selected).editToken)selected=[...records.keys()].find(slot=>draft(slot).editToken)||records.keys().next().value;
   for(const slot of slots()){
    const local=draft(slot);
    if(!records.has(slot)&&local.editToken&&Object.keys(local.fields).length){local.version=0;local.dirty=true;persist(slot)}
   }
   if(initial||deletedSelection||(!editable()&&!screen.contains(document.activeElement)))renderPage();else renderPlayersList();
   if(initial&&active&&draft(selected).dirty&&editable())scheduleSave(selected);
  } catch(error){if(initial)renderPage();status(error.message+' A cópia deste navegador foi mantida.',true)}
  finally{refreshing=false}
 }
 function scheduleSave(slot){clearTimeout(timer);timer=setTimeout(()=>save(slot),900)}
 async function save(slot=selected) {
  if(!active||!editable(slot))return;
  const local=draft(slot);
  if(queues.has(slot)){local.dirty=true;return queues.get(slot)}
  if(!local.editToken)local.editToken=newToken();
  persist(slot);
  const snapshot=JSON.stringify(local.fields),fieldsCopy={...local.fields},token=local.editToken,version=local.version;
  if(slot===selected)status('Cópia no aparelho salva. Sincronizando com a sala…');
  const operation=(async()=>{
   try{
    const data=await api(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({room,slot,fields:fieldsCopy,editToken:token,version,playerId:uid,playerName:name})});
    records.set(slot,data.sheet);storage=data.storage;local.version=data.sheet.version;
    local.dirty=JSON.stringify(local.fields)!==snapshot;persist(slot);
    if(slot===selected)el('editKeyBtn').hidden=false;
    if(slot===selected)status(local.dirty?'Salvando novas alterações…':storage==='cloud'?'Salvo na nuvem e neste aparelho.':'Salvo neste aparelho e na sala.');
    renderPlayersList();
   }catch(error){if(npc&&error.status===410){local.dirty=false;local.blocked=true;drafts.delete(slot);records.delete(slot);localStorage.removeItem(cacheKey(slot));if(slot===selected){selected=crypto.randomUUID().replaceAll('-','');refresh(true)}return}local.dirty=true;local.blocked=error.status===409||error.status===403;persist(slot);if(slot===selected)status(error.message,true)}
   finally{queues.delete(slot);if(local.dirty&&!local.blocked&&JSON.stringify(local.fields)!==snapshot)scheduleSave(slot)}
  })();queues.set(slot,operation);return operation;
 }
 function renderPortrait(){
  const image=draft(selected).fields['portrait.image']||'';
  el('portraitPreview').hidden=!image;
  if(image)el('portraitImage').src=image;else el('portraitImage').removeAttribute('src');
  el('uploadPortraitBtn').disabled=!editable();
  el('deletePortraitBtn').hidden=!image;el('deletePortraitBtn').disabled=!editable();
 }
 async function uploadPortrait(file){
  if(!file||!editable())return;
  const slot=selected,button=el('uploadPortraitBtn');button.disabled=true;
  let url;
  try{
   if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>20*1024*1024)throw new Error('Escolha uma imagem JPG, PNG ou WebP de até 20 MB.');
   url=URL.createObjectURL(file);const image=new Image();
   await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=()=>reject(new Error('Não foi possível abrir a imagem.'));image.src=url});
   const scale=Math.min(1,800/image.naturalWidth,800/image.naturalHeight),canvas=document.createElement('canvas');
   canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));
   const ctx=canvas.getContext('2d');ctx.fillStyle='#100e0c';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(image,0,0,canvas.width,canvas.height);
   let result;for(const quality of [.85,.7,.5,.3]){result=canvas.toDataURL('image/jpeg',quality);if(result.length<245000)break}
   if(result.length>=245000)throw new Error('A imagem tem muitos detalhes. Escolha uma imagem menor.');
   const local=draft(slot);local.fields['portrait.image']=result;local.dirty=true;local.blocked=false;persist(slot);
   if(slot===selected)renderPortrait();await save(slot);
  }catch(error){status(error.message,true)}finally{if(url)URL.revokeObjectURL(url);button.disabled=!editable();el('portraitInput').value=''}
 }
 function enlargePortrait(){
  const src=draft(selected).fields['portrait.image'];if(!src)return;
  const overlay=document.createElement('div');overlay.className='temporary-scene-overlay character-portrait-overlay';
  overlay.innerHTML='<section class="temporary-scene-dialog" role="dialog" aria-modal="true" aria-label="Imagem do personagem"><div class="temporary-scene-heading"><span></span><button type="button" class="temporary-scene-close" aria-label="Fechar imagem do personagem">×</button></div><img class="temporary-scene-image" alt="Imagem do personagem"></section>';
  overlay.querySelector('span').textContent=draft(selected).fields['identity.name']||slotLabel(selected);
  overlay.querySelector('img').src=src;
  const close=()=>{overlay.remove();el('portraitPreview').focus()};
  overlay.querySelector('button').onclick=close;
  overlay.addEventListener('keydown',event=>{if(event.key==='Escape')close()});
  document.body.append(overlay);overlay.querySelector('button').focus();
 }
 function openEditor(){
  screen.hidden=false;selected=slots().find(slot=>draft(slot).editToken)||selected;
  const joinName=el('characterJoinName');
  if(!joinName.value)joinName.value=el('nameInput').value.trim()||(active?name:'');
  renderPage();refresh(true);
 }
 function downloadBackup(){
  const local=draft(selected),data={format:'mesa-adnd-v1',room,slot:selected,fields:local.fields,editToken:local.editToken};
  const link=document.createElement('a'),url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));
  link.href=url;link.download=`ficha-${room}-${npc?'npc':'jogador'}-${selected}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  status('Cópia baixada. Ela contém sua chave de edição; guarde-a com você.');
 }
 async function importBackup(file){
  if(!file||!editable())return;
  try{
   if(file.size>512*1024)throw new Error('A cópia deve ter no máximo 512 KB.');
   const data=JSON.parse(await file.text());
   if(data.format!=='mesa-adnd-v1'||!data.fields||typeof data.fields!=='object'||Array.isArray(data.fields)||Object.keys(data.fields).length>4000)throw new Error('Esta não é uma cópia de ficha da Mesa Sombria.');
   for(const [key,value] of Object.entries(data.fields))if(!/^[A-Za-z0-9_.-]{1,100}$/.test(key)||['__proto__','constructor','prototype'].includes(key)||typeof value!=='string'||value.length>(key==='portrait.image'?300000:12000))throw new Error('A cópia contém dados inválidos.');
   if(!confirm('Substituir o preenchimento desta ficha pelos dados da cópia?'))return;
   const local=draft(selected);local.fields={...data.fields};
   if(!records.has(selected)&&data.room===room&&data.slot===selected&&/^[a-f0-9]{64}$/.test(data.editToken||''))local.editToken=data.editToken;
   local.dirty=true;local.blocked=false;persist(selected);renderPage();scheduleSave(selected);
  }catch(error){status(error.message,true)}
 }
 if(npc){for(const key of Object.keys(localStorage)){const prefix=`mesa:npc-editor:v1:${room}:`;if(key.startsWith(prefix)&&/^[a-f0-9]{32}$/.test(key.slice(prefix.length)))draft(key.slice(prefix.length))}}
 screen.innerHTML=scoped(`<div class="characters-shell character-editor-shell"><div class="characters-header"><div><span class="eyebrow">FICHAS DA PARTY · AD&D 2ª EDIÇÃO</span><h2 id="charactersHeading">${npc?'Ver NPC':'Ver personagens'}</h2></div><button type="button" class="characters-back" id="editorCloseBtn">← VOLTAR À MESA</button></div><div class="characters-layout character-editor-layout"><aside class="characters-list" id="characterSlots" aria-label="${npc?'Fichas dos NPCs':'Fichas dos cinco jogadores'}"></aside><section class="character-document"><div class="character-editor-heading"><h3 id="editableCharacterTitle"></h3><div class="character-editor-actions"><button type="button" id="deleteNpcBtn" hidden>Excluir NPC</button><button type="button" id="saveCharacterBtn">Salvar agora</button><button type="button" id="exportCharacterBtn">Baixar cópia</button><button type="button" id="importCharacterBtn">Importar cópia</button><button type="button" id="editKeyBtn">Chave de edição</button><button type="button" id="recoverCharacterBtn" hidden>Recuperar acesso</button><input id="characterBackupInput" type="file" accept="application/json,.json" hidden></div></div><div class="character-portrait-panel" id="portraitPanel"><button type="button" id="portraitPreview" class="character-portrait-preview" aria-label="Ampliar imagem do personagem" hidden><img id="portraitImage" alt="Imagem do personagem"></button><div class="character-portrait-actions"><button type="button" id="uploadPortraitBtn">Enviar imagem do personagem</button><button type="button" id="deletePortraitBtn" hidden>Excluir imagem</button><input type="file" id="portraitInput" accept="image/jpeg,image/png,image/webp" hidden><small>JPG, PNG ou WebP · a imagem fica salva junto à ficha.</small></div></div><p class="character-storage-notice" id="characterStorageNotice"></p><p class="character-save-status" id="characterSaveStatus" role="status" aria-live="polite"></p><nav class="character-tabs" id="characterTabs" aria-label="Páginas da ficha"></nav><form id="characterEditorForm"><fieldset id="characterFields"></fieldset></form></section></div></div>`);
 const createNpc=document.createElement('button');createNpc.type='button';createNpc.id=npc?'npc-createNpcBtn':'createNpcBtn';createNpc.className='create-npc-button';createNpc.textContent='＋ Criar novo NPC';createNpc.hidden=!npc;el('characterSlots').after(createNpc);
 if(npc){const aside=document.createElement('div');aside.className='npc-sidebar';el('characterSlots').before(aside);aside.append(el('characterSlots'),createNpc)}
 const joinPanel=document.createElement('section');
 joinPanel.id=npc?'npc-characterJoinPanel':'characterJoinPanel';joinPanel.className='character-join-panel';
 joinPanel.innerHTML='<div><strong>Entre na mesa para editar sua ficha</strong><p>Informe seu nome para liberar os campos e salvar seu personagem nesta sala.</p></div><form id="characterJoinForm"><label for="characterJoinName">Seu nome de jogador</label><div><input id="characterJoinName" type="text" maxlength="18" autocomplete="nickname" placeholder="Digite seu nome" required><button id="characterJoinBtn" type="submit">Entrar e editar ficha</button></div></form>';
 joinPanel.innerHTML=scoped(joinPanel.innerHTML);
 el('characterStorageNotice').before(joinPanel);
 el('characterJoinForm').addEventListener('submit',async event=>{
  event.preventDefault();
  const input=el('characterJoinName'),button=el('characterJoinBtn');
  const enteredName=input.value.trim();
  if(!enteredName){input.focus();return}
  if(active){renderPage();return}
  button.disabled=true;button.textContent='Entrando na mesa…';
  try{
   const mainInput=el('nameInput'),mainButton=el('joinBtn');
   mainInput.value=enteredName;
   await mainButton.onclick.call(mainButton);
   renderPage();
   if(active){await refresh(true);const firstField=el('characterFields').querySelector('input:not(:disabled)');firstField?.focus()}
   else status('Não foi possível entrar na sala. Confira a conexão e tente novamente.',true);
  }catch{status('Não foi possível entrar na sala. Tente novamente.',true)}
  finally{button.disabled=false;button.textContent='Entrar e editar ficha'}
 });
 el('viewCharactersBtn').addEventListener('click',openEditor);
 el('editorCloseBtn').addEventListener('click',()=>{if(draft(selected).dirty)save();screen.hidden=true;el('viewCharactersBtn').focus()});
 el('characterEditorForm').addEventListener('submit',event=>{event.preventDefault();save()});
 el('characterFields').addEventListener('click',event=>{
  const button=event.target.closest('[data-add-sheet-section]');if(!button||!editable())return;
  const kind=button.dataset.addSheetSection,current=expandableCount(kind);if(current>=99)return;
  const local=draft(selected);local.fields[kind==='weapons'?'layout.weaponRows':'layout.magicIIRows']=String(current+1);local.dirty=true;local.blocked=false;
  persist(selected);renderPage();scheduleSave(selected);
  const key=kind==='weapons'?`weapons.${current}.name`:`spells.${10+current}.name`;
  const input=el('characterFields').querySelector(`[data-field="${key}"]`);input?.scrollIntoView({block:'center'});input?.focus({preventScroll:true});
  status('Novo espaço criado. Salvando na sala…');
 });
 el('characterFields').addEventListener('input',event=>{
  const key=event.target.dataset.field;if(!key||!editable())return;
  const local=draft(selected);local.fields[key]=event.target.value;local.dirty=true;local.blocked=false;
  if(key==='identity.name')el('editableCharacterTitle').textContent=`${slotLabel(selected)} · ${event.target.value||'Ficha de personagem'}`;
  if(persist(selected))status('Guardado neste aparelho. Salvando na sala…');
  renderPlayersList();scheduleSave(selected);
 });
 el('characterSlots').addEventListener('click',event=>{const button=event.target.closest('[data-character-slot]');if(!button)return;if(draft(selected).dirty)save(selected);selected=npc?button.dataset.characterSlot:Number(button.dataset.characterSlot);page=1;renderPage();if(draft(selected).dirty&&editable())scheduleSave(selected)});
 el('characterTabs').addEventListener('click',event=>{const button=event.target.closest('[data-character-page]');if(!button)return;page=Number(button.dataset.characterPage);renderPage()});
 el('deleteNpcBtn').addEventListener('click',async()=>{
  if(!npc||!editable())return;
  const slot=selected,label=draft(slot).fields['identity.name']||slotLabel(slot);
  if(!confirm(`Excluir o NPC “${label}” e sua imagem?`))return;
  const button=el('deleteNpcBtn');button.disabled=true;clearTimeout(timer);
  try{
   if(queues.has(slot))await queues.get(slot);
   const local=draft(slot);
   if(records.has(slot))await api(endpoint,{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({room,slot,editToken:local.editToken,version:local.version})});
   records.delete(slot);drafts.delete(slot);localStorage.removeItem(cacheKey(slot));
   selected=slots().find(id=>id!==slot)||crypto.randomUUID().replaceAll('-','');page=1;
   renderPage();status('NPC excluído.');
  }catch(error){status(error.message,true)}finally{button.disabled=!editable()}
 });
 el('createNpcBtn').addEventListener('click',async()=>{
  if(!npc||!active)return;if(draft(selected).dirty)await save(selected);
  selected=crypto.randomUUID().replaceAll('-','');page=1;
  draft(selected).fields['identity.name']='Novo NPC';draft(selected).dirty=true;
  renderPage();await save(selected);el('characterFields').querySelector('input')?.focus();
 });
 el('uploadPortraitBtn').addEventListener('click',()=>el('portraitInput').click());
 el('portraitInput').addEventListener('change',event=>uploadPortrait(event.target.files[0]));
 el('portraitPreview').addEventListener('click',enlargePortrait);
 el('deletePortraitBtn').addEventListener('click',async()=>{
  if(!editable()||!confirm('Excluir a imagem deste personagem?'))return;
  const local=draft(selected);delete local.fields['portrait.image'];local.dirty=true;local.blocked=false;persist(selected);renderPortrait();await save();
 });
 el('saveCharacterBtn').addEventListener('click',()=>save());
 el('exportCharacterBtn').addEventListener('click',downloadBackup);
 el('importCharacterBtn').addEventListener('click',()=>el('characterBackupInput').click());
 el('characterBackupInput').addEventListener('change',event=>{importBackup(event.target.files[0]);event.target.value=''});
 el('editKeyBtn').addEventListener('click',()=>{window.prompt('Guarde esta chave para editar a mesma ficha em outro aparelho. Não compartilhe com outros jogadores.',draft(selected).editToken)});
 el('recoverCharacterBtn').addEventListener('click',()=>{
  const token=window.prompt('Informe a chave de edição desta ficha:');if(!token)return;
  if(!/^[a-f0-9]{64}$/.test(token.trim())){status('Chave de edição inválida.',true);return}
  draft(selected).editToken=token.trim();persist(selected);renderPage();status('A chave será conferida ao salvar.');
 });
 window.addEventListener('pagehide',()=>{
  for(const [slot,local] of drafts){if(!local.dirty)continue;persist(slot);if(active&&local.editToken&&!queues.has(slot))navigator.sendBeacon(endpoint,new Blob([JSON.stringify({room,slot,fields:local.fields,editToken:local.editToken,version:local.version,playerId:uid,playerName:name})],{type:'application/json'}))}
 });
 setInterval(()=>{if(!screen.hidden&&!document.hidden)refresh()},10000);
}
mountCharacterEditor();
mountCharacterEditor(true);
