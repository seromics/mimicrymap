/* This adapter feeds the shared native viewer. It never calculates matches or figures. */
(function() {
  'use strict';
  const params = new URLSearchParams(location.hash.slice(1));
  const channel = params.get('channel'), origin = params.get('origin');
  const viewer = window.MimicryMapViewer, runtime = window.MimicryOne;
  let generation = 0, active = null, exporting = false;
  const send = data => parent.postMessage({channel,...data}, origin);
  const aborted = () => new DOMException('Comparison canceled','AbortError');
  const status = document.getElementById('embedStatus');
  function cancel() { generation++; active?.abort(); active=null; runtime.cancelLocalRun(); }
  function busy(value) {
    document.querySelector('.stage').inert = value;
    document.querySelector('.controls').inert = value;
    document.querySelector('.repro').inert = value;
    document.documentElement.dataset.embedBusy = value ? 'true' : 'false';
  }
  function show(result) {
    runtime.openLocalResult(result, result.source_catalog, 'explorer');
    window.MimicryStartup.pending = false;
    setPaused(true);
    document.documentElement.dataset.embedReady = 'true';
    status.textContent=''; status.hidden=true;
    paintStatic();
  }
  async function compare(input) {
    if (exporting) throw Error('Wait for the export to finish.');
    cancel(); const version=generation, controller=new AbortController();
    const targets=window.MimicryFastaInput.parse(input.targetFasta,'target');
    const parents=window.MimicryFastaInput.parseParents(input.parentFasta);
    if(targets.errors.length || parents.errors.length) throw Error([...targets.errors,...parents.errors].join('\n'));
    const targetIndex=input.targetIndex ?? 0, floor=input.minimumIdentity ?? 7;
    if (!Number.isInteger(targetIndex) || !targets.records[targetIndex]) throw Error('Select a valid target record index.');
    if (!Number.isInteger(floor) || floor<5 || floor>9) throw Error('Minimum identity must be an integer from 5 to 9.');
    const query=targets.records[targetIndex], assets=window.MimicryViewerAssets.validate(input.assets,query.sequence);
    const rows=parents.records.map(window.MimicryFastaInput.parentRecord);
    active=controller; busy(true); status.hidden=false; status.textContent='Comparing Sequences…';
    try {
      const run=await runtime.runLocalLibraryScan({floor,rows,library:'custom',queryRow:query,
        queryFasta:'>'+query.header+'\n'+query.sequence+'\n',rowsFasta:input.parentFasta,signal:controller.signal,
        onStatus:message=>{if(version===generation){status.textContent=message;send({event:'progress',detail:{message}});}}});
      if(version!==generation)throw aborted();
      run.result.result_id='embedded:'+crypto.randomUUID();
      run.result.viewer_assets=assets;
      run.result.parameters.source_scope_label=input.parentLabel || 'Supplied Parent Sequences';
      show(run.result);
      return runtime.getResult();
    } catch(error) {
      if(controller.signal.aborted || version!==generation)throw aborted();
      throw error;
    } finally { if(version===generation){active=null;busy(false);status.hidden=true;} }
  }
  async function exportFile(kind) {
    if(active || exporting)throw Error('Wait for the current operation to finish.');
    if(!runtime.getResult())throw Error('No completed comparison is available.');
    const ids={matches:'expWin',site:'expSite',parents:'expRank',summary:'expSummary',code:'reproBtn',figures:'figureBundle'};
    const button=document.getElementById(ids[kind]);
    if(!button)throw Error('Unknown export kind.');
    if(button.disabled)throw Error('An export is already running.');
    exporting=true;
    try {return await new Promise((resolve,reject)=>{
      viewer.hooks.download=resolve; viewer.hooks.exportError=reject; button.click();
    });} finally {delete viewer.hooks.download;delete viewer.hooks.exportError;exporting=false;}
  }
  const actions={
    compare,
    getResult:()=>runtime.getResult(),
    loadResult(result){
      if(exporting)throw Error('Wait for the export to finish.');
      cancel(); busy(false);
      if(!result?.complete_in_memory || !Array.isArray(result.inputs?.reproduction_parents))
        throw Error('Load a complete FASTA comparison result returned by this viewer.');
      window.MimicryViewerAssets.validate(result.viewer_assets,result.protein.sequence);
      runtime.openResult(result,result.source_catalog,'explorer');
      show(result);return runtime.getResult();
    },
    cancel(){cancel();busy(false);status.hidden=true;},
    setTracks(keys){
      if(!Array.isArray(keys) || keys.some(key=>!TRACKS.some(track=>track.key===key)))throw Error('Unknown track.');
      TRACKS.forEach(track=>{track.on=track.key==='mimicry'||keys.includes(track.key);});buildTrackToggles();buildCols();recompute();paintStatic();
    },
    setView(view){if(!['explorer','residues'].includes(view))throw Error('View must be explorer or residues.');setView(view);},
    selectWindow(start){if(!Number.isInteger(start)||start<1||start>N)throw Error('Window start is outside the target.');setPaused(true);scan=start-1;lastCol=-1;paintStatic();},
    setTheme(theme){
      if(!['light','dark'].includes(theme))throw Error('Theme must be light or dark.');
      document.documentElement.classList.toggle('dark',theme==='dark');document.documentElement.classList.toggle('light',theme==='light');
      document.documentElement.dataset.theme=theme;window.dispatchEvent(new Event('seromap:plot-palette'));paintStatic();
    },
    export:exportFile
  };
  addEventListener('message',async event=>{
    if(event.source!==parent || event.origin!==origin || event.data?.channel!==channel)return;
    const {id,method,value}=event.data;
    if(!Object.hasOwn(actions,method))return;
    try {send({id,value:await actions[method](value)});}
    catch(error){if(!active){busy(false);status.hidden=false;status.textContent=error.name==='AbortError'?'':error.message;}send({id,error:{name:error.name,message:error.message}});}
  });
  addEventListener('pagehide',cancel);
  setPaused(true);ambientStop();
  send({event:'ready'});
})();
