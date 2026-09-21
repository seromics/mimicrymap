/* Browser-local complete positional scanner for MimicryMap Custom FASTA.
   No network calls are made from this worker. Coordinates emitted here are 1-based. */

"use strict";

const WINDOW = 9;
const CANONICAL_CODES = new Set(Array.from('ACDEFGHIKLMNPQRSTVWY', residue=>residue.charCodeAt(0)));

function identityAt(query, queryStart, target, targetStart, floor) {
  let matches = 0;
  let mismatches = 0;
  const maximumMismatches = WINDOW - floor;
  for (let offset = 0; offset < WINDOW; offset += 1) {
    const queryResidue = query.charCodeAt(queryStart + offset);
    const targetResidue = target.charCodeAt(targetStart + offset);
    // Preserve all input positions; only canonical residues can establish identity.
    if (queryResidue === targetResidue && CANONICAL_CODES.has(queryResidue)) {
      matches += 1;
    } else {
      mismatches += 1;
      if (mismatches > maximumMismatches) return 0;
    }
  }
  return matches;
}

self.onmessage = function onMessage(event) {
  const data = event.data || {};
  if (data.type !== "scan") return;

  const query = String(data.query.sequence || "");
  const targets = data.targets || [];
  const floor = Math.max(5, Math.min(9, Number(data.floor) || 7));
  const queryWindows = Math.max(0, query.length - WINDOW + 1);
  const summaries = [];

  for (let targetIndex = 0; targetIndex < targets.length; targetIndex += 1) {
    const target = targets[targetIndex];
    const sequence = String(target.sequence || "");
    const targetWindows = Math.max(0, sequence.length - WINDOW + 1);
    const hits = [];
    const queryStarts = new Set();
    const sourceStarts = new Set();
    let bestIdentity = 0;

    for (let queryStart = 0; queryStart < queryWindows; queryStart += 1) {
      for (let sourceStart = 0; sourceStart < targetWindows; sourceStart += 1) {
        const identity = identityAt(query, queryStart, sequence, sourceStart, floor);
        if (!identity) continue;
        hits.push([
          queryStart + 1,
          sourceStart + 1,
          identity,
          sequence.slice(sourceStart, sourceStart + WINDOW),
        ]);
        queryStarts.add(queryStart + 1);
        sourceStarts.add(sourceStart + 1);
        if (identity > bestIdentity) bestIdentity = identity;
      }
    }

    if (hits.length) {
      summaries.push({
        protein_index: Number(data.chunkOffset || 0) + targetIndex,
        protein_id: target.protein_id,
        best_identity: bestIdentity,
        query_starts: Array.from(queryStarts).sort((a, b) => a - b),
        source_starts: Array.from(sourceStarts).sort((a, b) => a - b),
        hits,
      });
    }

    if ((targetIndex & 7) === 0 || targetIndex + 1 === targets.length) {
      self.postMessage({
        type: "progress",
        completed: targetIndex + 1,
        total: targets.length,
      });
    }
  }

  self.postMessage({
    type: "complete",
    chunkOffset: Number(data.chunkOffset || 0),
    summaries,
  });
};
