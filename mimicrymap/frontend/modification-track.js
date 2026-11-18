/* Additive, exact-sequence-gated display of retained UniProt modification sites. */
(function () {
  'use strict';
  var cache = new Map();
  var indexedRows=null, model=null;
  function currentModel(){
    var rows=ANN && ANN.modifications;
    if(rows!==indexedRows||!model){indexedRows=rows;model=MimicryModificationSymbols.build(rows);}
    return model;
  }
  var originalLoad = loadAnnots, originalHasData = trackHasData, originalColor = annColor;
  TRACKS.splice(2, 0, {key:'modifications', label:'Modifications', on:false,
    title:'Retained UniProt modified-residue annotations, including phosphorylation. Evidence can be inferred by similarity; an unmarked position is not proof of no modification. These annotations do not change sequence identity scores.'});
  window.modificationColorAt = function (pos) {
    var point=currentModel().positions.get(pos);
    return point ? point.color : null;
  };
  window.modificationPointAt=function(pos){return currentModel().positions.get(pos)||null;};
  window.modificationPoints=function(){return currentModel().points;};
  window.drawModificationMarker=function(context,pos,x,y,availableWidth,height){
    var point=modificationPointAt(pos);if(!point)return;
    context.save();
    // Size to the interior of the lane, not the surrounding row. Alphabetic
    // baseline plus measured glyph bounds also survives native SVG capture.
    var label=point.symbol,boxHeight=Math.min(12,Math.max(0,height-2));
    var font=Math.min(8,boxHeight*.78);
    context.textAlign='center';context.textBaseline='alphabetic';
    context.font='600 '+font+'px sans-serif';
    var labelWidth=context.measureText(label).width+4;
    while(labelWidth>availableWidth && font>5){
      font-=.5;context.font='600 '+font+'px sans-serif';labelWidth=context.measureText(label).width+4;
    }
    context.fillStyle=point.color;
    if(availableWidth>=labelWidth && boxHeight>=6){
      var metrics=context.measureText(label);
      var ascent=Number.isFinite(metrics.actualBoundingBoxAscent)?metrics.actualBoundingBoxAscent:font*.75;
      var descent=Number.isFinite(metrics.actualBoundingBoxDescent)?metrics.actualBoundingBoxDescent:font*.2;
      context.fillRect(x-labelWidth/2,y-boxHeight/2,labelWidth,boxHeight);
      context.fillStyle=PLOT.raw('white');
      context.fillText(label,x,y+(ascent-descent)/2);
    }else{
      context.beginPath();context.arc(x,y,Math.max(.5,Math.min(2.3,boxHeight/2-.5)),0,Math.PI*2);context.fill();
      context.strokeStyle=PLOT.alpha('white',.65);context.lineWidth=.7;context.stroke();
    }
    context.restore();
  };
  trackHasData = function (key) {
    return key === 'modifications' ? !!(ANN && ANN.modifications && ANN.modifications.length) : originalHasData(key);
  };
  annColor = function (key, i) {
    return key === 'modifications' ? 'rgba(0,0,0,0)' : originalColor(key, i);
  };
  var summary = variantSummaryAt;
  variantSummaryAt = function (pos) {
    var point=currentModel().positions.get(pos),rows=point?point.rows:[];
    return [summary(pos)].concat(rows.map(function (r) {
      return 'UniProt · '+pos+' · '+r.description+(r.evidence ? '\nEvidence: '+r.evidence : '\nEvidence not supplied');
    })).concat(point&&point.multiple?['Multiple annotations may describe alternative states, not simultaneous modifications.']:[]).filter(Boolean).join('\n');
  };
  loadAnnots = function (accession, done) {
    var releaseStartup=window.MimicryStartup ? window.MimicryStartup.hold("assets") : function(){};
    originalLoad(accession, function () {
      var owner = T, base = Object.assign({}, ANN || {}), alias = owner && (owner.nativeTrackAccession || accession);
      if (owner?.suppliedAssets || window.MimicryMapViewer?.referenceAssetsEnabled === false) {
        if (done) done(); releaseStartup(); return;
      }
      delete base.modifications;
      if (!owner || !alias) { if (done) done(); releaseStartup(); return; }
      if (!cache.has(alias)) cache.set(alias, fetch('/data/assets/modifications/'+encodeURIComponent(alias)+'.json', {signal:releaseStartup.signal})
        .then(function (r) { return r.ok ? r.json() : null; }).catch(function () { cache.delete(alias); return null; }));
      cache.get(alias).then(function (payload) {
        if (T !== owner) return;
        ANN = Object.keys(base).length ? base : null;
        if (payload && payload.schema === 'mimicryone/modification-sites/1' && payload.sequence === owner.seq) {
          ANN = Object.assign({}, base || {}, {modifications:payload.sites});
        }
        if (done) done();
      }).finally(releaseStartup);
    });
  };
  var legend = document.querySelector('#variantlegend');
  if (legend) {
    var item = document.createElement('span');
    item.className = 'lgrp'; item.dataset.trackLegend = 'modifications'; item.hidden = true;
    item.dataset.tooltip = 'UniProt modified residues. Hover over a site for its description and evidence. Unmarked positions have no annotation in this retained source.';
    item.id='modificationLegend';
    legend.after(item);
  }
  var originalLegends=updateTrackLegends;
  updateTrackLegends=function(){
    var host=document.getElementById('modificationLegend');
    if(host){
      host.replaceChildren();
      currentModel().legend.forEach(function(f){
        var entry=document.createElement('span');entry.className='modification-legend-entry';
        var symbol=document.createElement('span');symbol.className='modification-symbol';
        symbol.style.backgroundColor=f.color;symbol.textContent=f.symbol;
        symbol.dataset.symbol=f.symbol;symbol.dataset.label=f.label;
        var label=document.createElement('span');label.textContent=f.label;
        entry.append(symbol,label);host.append(entry);
      });
    }
    originalLegends();
  };
  window.addEventListener('mimicryone:theme',function(){model=null;updateTrackLegends();},{capture:true});
  // Hydrate the already-selected record as well as later selections.
  if (T && !(window.MimicryStartup && window.MimicryStartup.pending)) loadAnnots(T.acc, function () { buildTrackToggles(); buildCols(); recompute(); paintStatic(); });
})();
