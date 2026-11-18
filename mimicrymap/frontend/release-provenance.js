/* Display source versions only when their fingerprint matches the running catalog. */
(function () {
  'use strict';
  const detail = document.getElementById('releaseSourceDetail');
  if (!detail && !document.getElementById("corpusHuman")) return;
  const number = n => Number(n).toLocaleString('en-US');
  const releaseStartup = window.MimicryStartup ? window.MimicryStartup.hold('sources') : function() {};
  const sourceData = Promise.all(['/release-provenance.json', '/api/analysis/meta'].map(async url => {
    if (window.MimicryStartup) return window.MimicryStartup.loadJson(url);
    const response = await fetch(url, {cache:'no-cache',signal:releaseStartup.signal});
    if (!response.ok) throw new Error((/*@copy release-provenance.source-information-unavailable.b3827f2*/`Source information unavailable`/*@endcopy*/));
    return response.json();
  }));
  window.MimicrySourceData = sourceData;
  sourceData.then(([source, meta]) => {
    const component = (meta.component_releases || []).find(c => c.key === 'canonical');
    if (!component || component.release_fingerprint !== source.release_fingerprint)
      throw new Error((/*@copy release-provenance.source-information-does-not-match.1146e90*/`Source information could not be verified for the available library`/*@endcopy*/));
    const live = (meta.libraries || []).find(l => l.key === 'canonical_human' && l.component_key === 'canonical');
    if (!live || live.records !== source.human.records) throw new Error((/*@copy release-provenance.source-counts-do-not-match.7ea6685*/`Source record counts could not be verified`/*@endcopy*/));
    const h = source.human, e = source.exposure;
    const groups=meta.source_filters?.libraries?.canonical_human?.source_collections||[];
    const hormone=groups.find(g=>g.value==='hormone_fasta');
    if(!hormone||hormone.count!==h.hormone_scope_records)throw new Error((/*@copy release-provenance.source-membership-counts-do-not.f60946d*/`Source memberships could not be verified`/*@endcopy*/));
    const exposureLibrary=(meta.libraries||[]).find(l=>l.key==='canonical_exposure'&&l.component_key==='canonical');
    if(!exposureLibrary||exposureLibrary.records!==e.records)throw new Error((/*@copy release-provenance.exposure-counts-do-not-match.5feed13*/`Exposure record counts could not be verified`/*@endcopy*/));
    for(const [id,count] of [['corpusHuman',live.records],['corpusExposures',exposureLibrary.records],['corpusProteomes',e.curated_viral_proteomes]]){
      const node=document.getElementById(id);if(node)node.textContent=number(count);
    }
    if(detail){detail.replaceChildren();detail.dataset.status='ready';}
  }).catch(error => {
    if(!detail)return;
    detail.dataset.status='unavailable';
    detail.textContent=(/*@copy release-provenance.no-source-version-is-asserted.b651bcf*/`${error.message}. Source versions are unavailable; refresh to try again.`/*@endcopy*/);
  }).finally(releaseStartup);
})();
