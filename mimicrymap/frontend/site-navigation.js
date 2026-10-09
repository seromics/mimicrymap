/* Restore old chapter bookmarks before the home player starts loading. */
(function(){
 'use strict';
 function route(){
  if(!['/','/index.html'].includes(location.pathname)||!location.hash)return;
  let anchor;try{anchor=decodeURIComponent(location.hash.slice(1));}catch(_){return;}
  const destination=window.MimicrySiteRoutes?.[anchor];
  if(destination)location.replace(destination+location.search+location.hash);
 }
 route();window.addEventListener('hashchange',route);
})();
