/* Collapsing the player changes its layout only; playback and volume stay intact. */
document.addEventListener('DOMContentLoaded',()=>{
 const player=document.getElementById('musicPlayer'),heading=player.querySelector('.music-player-heading');
 const controls=document.createElement('div');controls.className='music-window-controls';
 const minimize=document.createElement('button');minimize.id='minimizeMusicBtn';minimize.type='button';minimize.textContent='—';minimize.title='Minimizar Trilha da Party';minimize.setAttribute('aria-label','Minimizar Trilha da Party');
 const restore=document.createElement('button');restore.id='restoreMusicBtn';restore.type='button';restore.textContent='Restaurar';restore.title='Restaurar Trilha da Party';restore.setAttribute('aria-label','Restaurar Trilha da Party');
 controls.append(minimize,restore);heading.querySelector('span').after(controls);
 function setMinimized(value){
  player.classList.toggle('music-minimized',value);minimize.hidden=value;restore.hidden=!value;
  minimize.setAttribute('aria-expanded',String(!value));restore.setAttribute('aria-expanded',String(!value));
  try{localStorage.setItem('mesa:music-minimized',value?'yes':'no')}catch{}
  requestAnimationFrame(()=>document.documentElement.style.setProperty('--party-player-top',Math.ceil(window.innerHeight-player.getBoundingClientRect().top+12)+'px'));
 }
 minimize.addEventListener('click',()=>{setMinimized(true);restore.focus()});
 restore.addEventListener('click',()=>{setMinimized(false);minimize.focus()});
 let saved=false;try{saved=localStorage.getItem('mesa:music-minimized')==='yes'}catch{}
 setMinimized(saved);
});
