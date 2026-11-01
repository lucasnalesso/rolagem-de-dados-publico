/* Private rolls stay in this browser: no room event, fetch, or server storage. */
(() => {
 'use strict';
 const button=document.getElementById('privateRollBtn');
 button.addEventListener('click',()=>{
  if(!active){toast('Entre na mesa antes de rolar.');return}
  const modifier=Math.max(-99,Math.min(99,Number(document.getElementById('modifier').value)||0));
  const values=Array.from({length:qty},()=>Math.floor(Math.random()*sides)+1);
  const result={name:name+' · 🔒 NO ESCURO',sides,qty,mod:modifier,values,
   total:values.reduce((sum,value)=>sum+value,0)+modifier,at:Date.now()};
  renderRoll(result,true);
  document.getElementById('rollStatus').textContent='ROLAGEM NO ESCURO · SOMENTE VOCÊ VÊ';
 });
})();
