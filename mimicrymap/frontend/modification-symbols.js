/* Display taxonomy for existing UniProt MOD_RES annotations; no inference of sites. */
(function(root){
  'use strict';
  var palette=root.SeroMapPlotPalette||(typeof require==='function'?require('../../atlas/viewer/shared/plotPalette.cjs'):null);
  function ink(key){return root.MimicryPlotPalette?root.MimicryPlotPalette.raw(key):palette.raw(key);}
  // The drawn key is at most two characters so every family renders as a labeled
  // block in a residue cell; anything wider fell back to an unlabeled circle. The
  // family id is unchanged (classification and lookups depend on it) and the full
  // name still travels as `label` for the legend beneath the track.
  var families=[
    ['P',(/*@copy modification-symbols.phosphorylation.9ee29e5*/`Phosphorylation`/*@endcopy*/),'modification1'],['Ac',(/*@copy modification-symbols.acetylation.31f70be*/`Acetylation`/*@endcopy*/),'modification2'],
    ['Me',(/*@copy modification-symbols.methylation.9caaf6b*/`Methylation`/*@endcopy*/),'modification3'],['Acyl',(/*@copy modification-symbols.other-acylation.b6a883e*/`Other acylation`/*@endcopy*/),'modification4','Ay'],
    ['OH',(/*@copy modification-symbols.hydroxylation.82a28e8*/`Hydroxylation`/*@endcopy*/),'modification5'],['ADPr',(/*@copy modification-symbols.adp-ribosylation.9e5d65c*/`ADP-ribosylation`/*@endcopy*/),'modification6','AR'],
    ['Am',(/*@copy modification-symbols.amidation.f664680*/`Amidation`/*@endcopy*/),'modification7'],['Sulf',(/*@copy modification-symbols.sulfation.722aa5b*/`Sulfation`/*@endcopy*/),'modification8','Su'],
    ['Cit',(/*@copy modification-symbols.citrullination.49c7820*/`Citrullination`/*@endcopy*/),'modification9','Ci']
  ].map(function(x){return {id:x[0],symbol:x[3]||x[0],label:x[1],get color(){return ink(x[2]);}};});
  var lookup=new Map(families.map(function(f){return [f.id,f];}));
  function baseLabel(description){return String(description||'Modified residue').split(';')[0].trim();}
  function classify(description){
    var label=baseLabel(description),s=label.replace(/^\(Microbial infection\)\s*/,'');
    if (/^(?:Di)?phospho/i.test(s)) return ['P'];
    if (/acetyl.*methyl/i.test(s)) return ['Ac','Me'];
    if (/acetyl/i.test(s)) return ['Ac'];
    if (/^N6-.*(?:succinyl|glutaryl|malonyl|butyryl|benzoyl|crotonyl|methacryl|isonicotinyl|lactoyl|propionyl)/i.test(s)) return ['Acyl'];
    if (/ADP-ribosyl/i.test(s)) return ['ADPr'];
    if (/methyl/i.test(s) && !/ester|dipyrrolyl/i.test(s)) return ['Me'];
    if (/^(?:\([^)]+\)-)?(?:\d+-)?hydroxy(?:proline|lysine|arginine|asparagine|aspartate|histidine|leucine)$/i.test(s)) return ['OH'];
    if (/ amide$| 1-amide$/i.test(s)) return ['Am'];
    if (/^Sulfo(?:tyrosine|serine|cysteine)$/i.test(s)) return ['Sulf'];
    if (s==='Citrulline') return ['Cit'];
    // Rare chemistry stays explicit in the legend, never hidden under "Other".
    return ['rare:'+label];
  }
  function build(rows){
    var rare=new Set(),positions=new Map(),present=new Set();
    (rows||[]).forEach(function(row){
      if (!Number.isInteger(row.pos)||row.pos<1) return;
      if(!positions.has(row.pos))positions.set(row.pos,{pos:row.pos,rows:[],ids:new Set()});
      var point=positions.get(row.pos);point.rows.push(row);
      classify(row.description).forEach(function(id){point.ids.add(id);present.add(id);if(id.startsWith('rare:'))rare.add(id);});
    });
    var local=new Map(lookup);
    Array.from(rare).sort().forEach(function(id,i){local.set(id,{id:id,symbol:'R'+(i+1),label:id.slice(5),color:ink('modification10')});});
    var legend=families.filter(function(f){return present.has(f.id);}).concat(Array.from(rare).sort().map(function(id){return local.get(id);}));
    var hasMultiple=false;
    positions.forEach(function(point){
      point.families=Array.from(point.ids).map(function(id){return local.get(id);});
      point.multiple=point.rows.length>1 || point.families.length>1;
      hasMultiple=hasMultiple||point.multiple;
      point.symbol=point.multiple?'+':point.families[0].symbol;
      point.color=point.multiple?ink('modification10'):point.families[0].color;
    });
    if(hasMultiple)legend.push({id:'multiple',symbol:'+',label:(/*@copy modification-symbols.multiple-annotations-alternatives.dbe1b83*/`Multiple annotations / alternatives`/*@endcopy*/),color:ink('modification10')});
    return {positions:positions,points:Array.from(positions.values()),legend:legend};
  }
  var api={build:build,classify:classify,baseLabel:baseLabel};
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.MimicryModificationSymbols=api;
})(typeof window==='object'?window:globalThis);
