/* Recorded canonical identities shared by atlas tables and protein-page links. */
(function(root){
 'use strict';
 const segment=value=>encodeURIComponent(String(value)).replace(/[!'()*~.]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase());
 function protein(record){
  if(!record?.source)return null;
  if(record.library==='human_swissprot')return '/protein/'+segment(record.source)+'?tab=browse';
  if(['atlas_120_viruses','canonical_exposure'].includes(record.library)&&record.organism)
   return '/exposure/'+segment(String(record.organism).replaceAll(' ','_'))+'/protein/'+segment('@'+record.library+':'+record.source)+'?tab=browse';
  return null;
 }
 function comparison(target,parent,floor=7){
  if(!target?.library||!target.source||!parent?.library||!parent.source||![5,6,7,8,9].includes(Number(floor)))return null;
  return 'index.html?'+new URLSearchParams({target_library:target.library,target_source:target.source,parent_library:parent.library,parent_source:parent.source,target_floor:String(floor),target_label:target.source});
 }
 const api={protein,comparison};
 if(typeof module==='object'&&module.exports)module.exports=api;else root.MimicryReferenceLinks=api;
})(typeof globalThis==='undefined'?this:globalThis);
