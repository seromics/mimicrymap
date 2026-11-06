"use strict";

// A reference collection routes each assay to one directed comparison. It never
// merges antigen identities or treats a reverse comparison as interchangeable.
const comparisonRevision = c => c.files[c.candidateFile||"comparison.sqlite"].sha256 + ":" + c.platforms.slice().sort().join(",") + ':' + (c.annotationRevision||['targets','parents'].map(s=>c.files['inputs/'+s+'.annotations.csv']?.sha256||'').join(':')) + (c.sourceIdentity?':'+c.sourceIdentity+':'+JSON.stringify(c.studyBindings||[]):'') + (c.verifiedStudyBindings?.length?':verified-source-sequences:'+JSON.stringify(c.verifiedStudyBindings):'');
function referenceMetadata(state,reference){
 const library=state.libraries?.find(l=>l.id===reference.parent?.id&&l.sha256===reference.parent?.sha256),taxonomy=library?.referenceTaxonomy;
 return taxonomy?{...reference,referenceTaxonomy:{...taxonomy,libraryFolder:library.folder||library.id},revision:reference.revision+':taxonomy:'+taxonomy.revision}:reference;
}
function collectionReference(state, collection) {
  const bindings = collection.bindings || [];
  if (!collection.enabled || !bindings.length) return null;
  const members = [], platforms = new Set();
  for (const binding of bindings) {
    const c = state.comparisons.find(c => c.id === binding.comparison);
    if (!c?.complete || !c.files?.["comparison.sqlite"]?.sha256 ||
        c.parent.sha256 !== collection.parent.sha256 || c.floor > collection.floor ||
        !binding.platforms?.length) return null;
    for (const p of binding.platforms) {
      if (platforms.has(p)) return null;
      platforms.add(p);
    }
    members.push({...c, platforms:binding.platforms});
  }
  return referenceMetadata(state,{...collection, complete:true, members, platforms:[...platforms],
    revision:collection.floor + ":" + members.map(comparisonRevision).sort().join("|")});
}
function candidateReferences(state) {
  const collections = (state?.collections || []).map(c => collectionReference(state,c)).filter(Boolean);
  const grouped = new Set(collections.flatMap(c => c.members.map(m => m.id)));
  return [...collections, ...(state?.comparisons || [])
    .filter(c => c.complete && c.enabled && c.platforms?.length && !grouped.has(c.id))
    .map(c => referenceMetadata(state,{...c, revision:comparisonRevision(c)}))];
}
function resolveReference(state, id) {
  const collection = (state.collections || []).find(c => c.id === id);
  if (collection) return collectionReference(state,collection);
  const c = state.comparisons.find(c => c.id === id && c.complete && c.enabled && c.platforms?.length);
  return c ? referenceMetadata(state,{...c, revision:comparisonRevision(c)}) : null;
}
// Published mapping indexes are already selectable in SeroMap. They are not
// Workspace comparison packages, and should not be silently rebuilt as such.
function installedCandidateProducts(state, {parent,targets=[],floor=7,retainPositions=false}) {
  if (retainPositions || !['builtin-viral120','builtin-exposure','builtin-human'].includes(parent)) return [];
  const libraries=state.libraries||[];
  const canonical=id=>libraries.some(l=>l.id===id&&l.builtin&&!l.stale);
  if (!canonical(parent)) return [];
  return (state.references?.products||[]).filter(p=>p.kind==='candidate'&&p.installed&&
    p.parent===parent&&targets.includes(p.target)&&canonical(p.target)&&p.floors.includes(Number(floor)));
}
module.exports = {candidateReferences, resolveReference, installedCandidateProducts};
