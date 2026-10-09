// Parents must be an exact population. A broader target menu can advertise its
// saved subset: opening an individual record still requires its exact sequence.
export function lookupStatus(snapshot, { target, parent, floor = 7, targetSubset = false } = {}) {
  const libraries = snapshot?.libraries || [];
  const targetLibrary = libraries.find(l => l.id === target), parentLibrary = libraries.find(l => l.id === parent);
  const valid = (side, current) => current && !current.stale && current.sha256 && current.sha256 === side.sha256;
  const matches = (snapshot?.comparisons || []).filter((c) =>
    c.complete && c.floor <= Number(floor) && valid(c.target, targetLibrary) && valid(c.parent, parentLibrary));
  const full = matches.filter((c) => c.retainsPositions !== false).sort((a, b) => b.floor - a.floor)[0];
  const index = matches.find((c) => c.retainsPositions === false);
  return full
    ? { suffix: '', title: targetSubset
      ? `Full lookup saved at ≥${full.floor}/9 for ${Number(full.targets || targetLibrary.records || 0).toLocaleString('en-US')} Swiss-Prot targets. Exact sequence matches reopen without rescanning; additional human records calculate on demand.`
      : `Full lookup saved at ≥${full.floor}/9. Opens complete sequence maps at ${floor}/9 without rescanning.`, kind: 'full' }
    : index
      ? { suffix: ' · index', title: `Candidate index saved at ≥${index.floor}/9. Coverage and summary tables are ready; complete sequence maps calculate on demand.`, kind: 'index' }
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
  // Canonical Human includes additional overlays; it is not the Swiss-Prot FASTA.
  if (library === 'canonical_exposure' && keys.length === 1 &&
      scope.source_collections?.length === 1 && scope.source_collections[0] === 'viral_nonhuman') id = 'builtin-viral120';
  return snapshot?.libraries.some((l) => l.id === id) ? id : null;
}
