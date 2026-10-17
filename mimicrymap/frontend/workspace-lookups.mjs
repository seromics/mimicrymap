// Parents must be an exact population. A broader target menu can advertise its
// saved subset: opening an individual record still requires its exact sequence.
export async function workspaceReferenceRecord(native,referenceId,recordId){
  const id=Number(recordId)
  if(typeof native!=='function'||!Number.isSafeInteger(id)||id<1)throw Error('The selected workspace reference record is unavailable.')
  const snapshot=await native('snapshot')
  const reference=(snapshot.collections||[]).find(c=>c.id===referenceId&&c.enabled)
    ||(snapshot.comparisons||[]).find(c=>c.id===referenceId&&c.enabled&&c.complete)
  if(!reference?.parent)throw Error('The selected workspace reference collection is unavailable.')
  const parent=reference.parent,libraries=(snapshot.libraries||[]).filter(l=>!l.stale&&l.sha256&&l.sha256===parent.sha256)
  const library=libraries.find(l=>l.id===parent.id)||(libraries.length===1?libraries[0]:null)
  if(!library)throw Error('The original reference FASTA is not installed. Install it to open this comparison.')
  const record=await native('record',{library:library.id,id})
  if(record?.record_id!==id||!record.sequence)throw Error('The selected workspace reference sequence is unavailable.')
  return {library,record}
}

export function lookupStatus(snapshot, { target, parent, floor = 7, targetSubset = false } = {}) {
  const libraries = snapshot?.libraries || [];
  const targetLibrary = libraries.find(l => l.id === target), parentLibrary = libraries.find(l => l.id === parent);
  const valid = (side, current) => current && !current.stale && current.sha256 && current.sha256 === side.sha256;
  const matches = (snapshot?.comparisons || []).filter((c) =>
    c.complete && c.floor <= Number(floor) && valid(c.target, targetLibrary) && valid(c.parent, parentLibrary));
  const installed=(snapshot?.references?.products||[]).find(p=>p.kind==='lookup'&&p.installed&&p.target===target&&p.parent===parent&&p.floors?.includes(Number(floor))&&targetLibrary&&!targetLibrary.stale&&parentLibrary&&!parentLibrary.stale&&(!p.targetSha256||p.targetSha256===targetLibrary.sha256)&&(!p.parentSha256||p.parentSha256===parentLibrary.sha256));
  const full = matches.filter((c) => c.retainsPositions !== false || c.bidirectional).sort((a, b) => b.floor - a.floor)[0] || (installed?{floor:Math.min(...installed.floors)}:null);
  const index = matches.find((c) => c.retainsPositions === false);
  return full
    ? { suffix: '', title: targetSubset
      ? `Full lookup saved at ≥${full.floor}/9 for ${Number(full.targets || targetLibrary.records || 0).toLocaleString('en-US')} Swiss-Prot targets. Exact sequence matches reopen without rescanning; additional human records calculate on demand.`
      : `Full lookup saved at ≥${full.floor}/9. Opens complete sequence maps at ${floor}/9 without rescanning.`, kind: 'full' }
    : index
      ? { suffix: ' · index', title: `SeroMap index saved at ≥${index.floor}/9. Mapping ranges, summary tables and statistical memberships are ready; complete sequence maps calculate on demand.`, kind: 'index' }
      : { suffix: '', title: 'No complete lookup saved for this selection. Sequences can be compared on demand.', kind: 'none' };
}

export function lookupTargetLibrary(snapshot, library, filters = {}) {
  const exact = nativeParentLibrary(snapshot, library, filters);
  if (exact) return { id: exact, subset: false };
  const scope = Object.entries(filters || {}).filter(([, v]) =>
    v != null && v !== false && (!Array.isArray(v) || v.length));
  const sources = filters?.source_collections || [];
  if (library === 'canonical_human' && scope.every(([k]) => k === 'source_collections') &&
      (!sources.length || sources.includes('human_canonical_swissprot')) &&
      snapshot?.libraries.some(l => l.id === 'builtin-human')) {
    return { id: 'builtin-human', subset: true };
  }
  return { id: null, subset: false };
}

export function nativeParentLibrary(snapshot, library, filters = {}) {
  // Even an empty record_ids means a single-parent selection, not the full library.
  if (Object.hasOwn(filters || {}, 'record_ids')) return null;
  const scope = Object.fromEntries(Object.entries(filters || {}).filter(([, v]) =>
    v != null && v !== false && (!Array.isArray(v) || v.length)));
  const keys = Object.keys(scope);
  let id = null;
  if (library?.startsWith('workspace-') && !keys.length) id = library.slice(10);
  if(!keys.length)id=({huprot4:'builtin-huprot',human_current:'builtin-huscan',virscan_exposome_current:'builtin-virscan',atlas_120_viruses:'builtin-viral120'})[library]||id;
  if(library==='canonical_human'&&keys.length===1&&scope.source_collections?.length===1&&scope.source_collections[0]==='human_canonical_swissprot')id='builtin-human';
  // Canonical Human includes additional overlays; it is not the Swiss-Prot FASTA.
  if (library === 'canonical_exposure' && keys.length === 1 &&
      scope.source_collections?.length === 1 && scope.source_collections[0] === 'viral_nonhuman') id = 'builtin-viral120';
  return snapshot?.libraries.some((l) => l.id === id) ? id : null;
}
