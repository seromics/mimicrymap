/* Shared, lightweight theme state for the player and document pages. */
(function(){
 'use strict';
 // Align the CSS animation phase across page navigation; no animation loop.
 document.documentElement.style.setProperty('--ambient-delay',(-Date.now()%120000/1000)+'s');
 try{const saved=localStorage.getItem('mimicryone-theme');if(saved==='light'||saved==='dark')document.documentElement.classList.toggle('dark',saved==='dark');}catch(_){}
 function boot(){
  const host=document.getElementById('atlasThemeToggle');if(!host)return;
  function sync(){const dark=document.documentElement.classList.contains('dark');host.querySelectorAll('button[data-mode]').forEach(b=>b.setAttribute('aria-pressed',String((b.dataset.mode==='dark')===dark)));window.dispatchEvent(new CustomEvent('mimicryone:theme',{detail:{dark}}));}
  host.querySelectorAll('button[data-mode]').forEach(b=>b.addEventListener('click',()=>{document.documentElement.classList.toggle('dark',b.dataset.mode==='dark');try{localStorage.setItem('mimicryone-theme',b.dataset.mode);}catch(_){}sync();}));
  sync();
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
})();
