/* Optional supplied assets use the displayed sequence's 1-based coordinates. */
(function(root) {
  'use strict';
  const amino = {ALA:'A',ARG:'R',ASN:'N',ASP:'D',CYS:'C',GLN:'Q',GLU:'E',GLY:'G',HIS:'H',ILE:'I',LEU:'L',LYS:'K',MET:'M',PHE:'F',PRO:'P',SER:'S',THR:'T',TRP:'W',TYR:'Y',VAL:'V'};
  function validate(assets, sequence) {
    if (!assets) return null;
    if (assets.sequence !== sequence) throw Error('Annotation/structure sequence must exactly match the selected target.');
    const n = sequence.length, annotations = {}, input = assets.annotations || {};
    for (const key of ['plddt','rsasa','cleavage_epitope']) {
      const values = input[key];
      if (values == null) continue;
      const max = key === 'plddt' ? 100 : 1;
      if (!Array.isArray(values) || values.length !== n || values.some(v => v !== null && (!Number.isFinite(v) || v < 0 || v > max)))
        throw Error(key + ' must contain one value per residue (or null), within 0–' + max + '.');
      annotations[key] = values.slice();
    }
    for (const key of ['surface','extracellular','transmembrane','intracellular']) {
      if (input[key] == null) continue;
      if (typeof input[key] !== 'string' || input[key].length !== n || /[^01?]/.test(input[key]))
        throw Error(key + ' must contain one 0, 1 or ? per residue.');
      annotations[key] = input[key];
    }
    if (input.variants != null) {
      if (!Array.isArray(input.variants)) throw Error('Variants must be an array.');
      annotations.variants = input.variants.map(v => {
        if (!Number.isInteger(v.pos) || v.pos < 1 || v.pos > n || (v.ref && v.ref !== sequence[v.pos - 1]))
          throw Error('Variant positions and reference residues must match the target.');
        if (!['LP/P','LB/B','US'].includes(v.cat)) throw Error('Variant category must be LP/P, LB/B or US.');
        return Object.fromEntries(['pos','ref','alt','cat','ftid','dbsnp','disease'].filter(k => v[k] != null).map(k => [k,v[k]]));
      });
    }
    const pdb = assets.pdb || null;
    if (pdb) {
      if (typeof pdb !== 'string') throw Error('Structure must be PDB text.');
      const chains = new Set(), positions = new Set();
      for (const line of pdb.split(/\r?\n/)) {
        if (line.startsWith('ENDMDL')) break;
        if (!line.startsWith('ATOM') || ![' ','A'].includes(line[16])) continue;
        const pos = Number(line.slice(22,26));
        if (!Number.isInteger(pos) || pos < 1 || pos > n || line[26] !== ' ' ||
            ![30,38,46].every(i => Number.isFinite(Number.parseFloat(line.slice(i,i+8)))))
          throw Error('PDB residues must use the target’s 1-based numbering, without insertion codes.');
        if (line.slice(12,16).trim() === 'CA') {
          chains.add(line[21]); positions.add(pos);
          if (amino[line.slice(17,20)] !== sequence[pos-1]) throw Error('PDB residue identity differs from the target.');
        }
      }
      if (chains.size !== 1 || positions.size < 2) throw Error('Supply one PDB chain with at least two mapped residues.');
    }
    return {sequence, annotations, pdb, provenance: assets.provenance || {kind:'User-supplied annotations and structure; not inferred from sequence'}};
  }
  const api = {validate};
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MimicryViewerAssets = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
