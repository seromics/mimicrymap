/* Metadata compatibility only. This module never reads or compares sequences. */
(function(root){
  "use strict";
  const order=["source_collections","sublibraries","legacy_sources","facets","domain_groups","domains",
    "kingdoms","phyla","classes","orders","families","genera","species","source_organisms",
    "human_tropism_statuses","variant_sources","humsavar_significance","locations","accessibilities","regions"];
  let manifest=null;
  const api={
    install(data){manifest=data;},
    matches(fingerprint){return !!manifest && manifest.filter_policy_fingerprint===fingerprint;},
    has(library){return !!(manifest && manifest.libraries[library]);},
    inspect(library,value,changed){
      const spec=manifest && manifest.libraries[library];
      if(!spec) return {available:{},cleared:[]};
      let rows=spec.rows;
      if(value.exclude_vertebrates){
        const index=spec.fields.indexOf("classes"), names=spec.vertebrate_classes || [];
        const codes=new Set(names.map(name=>(spec.values.classes || []).indexOf(name)));
        const status=spec.fields.indexOf("taxonomy_status"), resolved=(spec.values.taxonomy_status || []).indexOf("resolved");
        if(index>=0 && status>=0) rows=rows.filter(row=>row[status].includes(resolved) && !row[index].some(code=>codes.has(code)));
      }
      if(value.exclude_mammals){
        const index=spec.fields.indexOf("classes"), code=(spec.values.classes || []).indexOf("Mammalia");
        if(index>=0 && code>=0) rows=rows.filter(row=>!row[index].includes(code));
      }
      const available={},cleared=[];
      const changeIndex=changed ? order.indexOf(changed) : -1;
      for(const field of order){
        const index=spec.fields.indexOf(field);
        if(index<0) continue;
        const dictionary=spec.values[field];
        const codes=new Set();
        for(const row of rows) for(const code of row[index]) codes.add(code);
        available[field]=dictionary.filter((_,i)=>codes.has(i));
        let selected=Array.isArray(value[field]) ? value[field] : [];
        if(changed && order.indexOf(field)>changeIndex && selected.length){
          const kept=selected.filter(item=>available[field].includes(item));
          for(const item of selected) if(!kept.includes(item)) cleared.push({field,value:item});
          value[field]=selected=kept;
        }
        if(selected.length){
          const selectedCodes=new Set(selected.map(item=>dictionary.indexOf(item)));
          rows=rows.filter(row=>row[index].some(code=>selectedCodes.has(code)) ||
            (field==="domains" && value.include_unclassified===true && row[index].length===0));
        }
      }
      return {available,cleared};
    }
  };
  root.MimicryScopeDependencies=api;
  if(typeof module!=="undefined") module.exports=api;
})(typeof window!=="undefined"?window:globalThis);
