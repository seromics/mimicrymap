/* Completed desktop snapshots persist; web snapshots remain session-only. */
(function (root) {
  'use strict';
  function stable(value) {
    return JSON.stringify(value, function (key, item) {
      return item && typeof item === 'object' && !Array.isArray(item)
        ? Object.fromEntries(Object.keys(item).sort().map(k => [k, item[k]])) : item;
    });
  }
  function create(limits) {
    limits = limits || {};
    const maxBytes = limits.maxBytes ?? 64 * 1024 * 1024;
    const maxEntries = limits.maxEntries ?? 3;
    const entries = new Map(), encoder = new TextEncoder();
    let bytes = 0, hits = 0, misses = 0;
    function remove(key) { const entry = entries.get(key); if (entry) { bytes -= entry.bytes; entries.delete(key); } }
    function check(signal) { if (signal && signal.aborted) { const error = new Error('Request canceled'); error.name = 'AbortError'; throw error; } }
    return {
      async run(descriptor, compute, signal) {
        check(signal);
        const storage=root.seromapDesktop?.results;
        if(storage){
          let retained;
          // Retention is optional: large custom populations may exceed the host's
          // cache identity limit while remaining valid inputs to the local scanner.
          try { retained=await storage('get',{identity:descriptor}); }
          catch (_) { /* Use the bounded session cache or calculate normally. */ }
          check(signal);
          if(retained){const saved=JSON.parse(retained.snapshot),outcome=saved.outcome;if(Array.isArray(outcome.result.source_catalog))outcome.result.source_catalog_by_index=new Map(outcome.result.source_catalog.map(row=>[row.protein_idx,row]));if(saved.sharedParents)outcome.result.inputs.reproduction_parents=outcome.rows;outcome.cached=true;hits++;return outcome;}
        }
        const key = stable(descriptor), existing = entries.get(key);
        if (existing) {
          hits++; entries.delete(key); entries.set(key, existing);
          const started = performance.now(), saved = JSON.parse(existing.snapshot), outcome = saved.outcome;
          if (Array.isArray(outcome.result.source_catalog)) {
            outcome.result.source_catalog_by_index = new Map(outcome.result.source_catalog.map(row => [row.protein_idx, row]));
          }
          if (saved.sharedParents) outcome.result.inputs.reproduction_parents = outcome.rows;
          outcome.cached = true;
          outcome.timings = {cache_restore_ms: performance.now() - started};
          return outcome;
        }
        misses++;
        const outcome = await compute();
        check(signal);
        if (outcome && outcome.result && outcome.result.complete_in_memory === true &&
            !outcome.result.export_details_deferred && Array.isArray(outcome.rows)) {
          // Snapshot before the viewer attaches mutable identity/history state.
          // Failed serialization or oversized results never prevent display/export.
          try {
            const result = Object.assign({}, outcome.result);
            delete result.source_catalog_by_index; // Derived lookup, rebuilt from the restored catalog.
            const sharedParents = !!(result.inputs && result.inputs.reproduction_parents === outcome.rows);
            if (sharedParents) {
              result.inputs = Object.assign({}, result.inputs);
              delete result.inputs.reproduction_parents;
            }
            const snapshot = JSON.stringify({outcome: Object.assign({}, outcome, {result}), sharedParents});
            if(storage)await storage('put',{identity:descriptor,result:{snapshot}});
            const size = encoder.encode(key).byteLength + encoder.encode(snapshot).byteLength;
            if (maxEntries > 0 && size <= maxBytes) {
              remove(key);
              while (entries.size && (entries.size >= maxEntries || bytes + size > maxBytes)) remove(entries.keys().next().value);
              entries.set(key, {snapshot, bytes: size}); bytes += size;
            }
          } catch (_) { /* The completed result remains usable without caching. */ }
        }
        return outcome;
      },
      clear() { entries.clear(); bytes = 0; },
      stats() { return {entries: entries.size, bytes, hits, misses, maxBytes, maxEntries}; }
    };
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = {create};
  else root.MimicryLiteResultCache = create();
})(typeof window !== 'undefined' ? window : globalThis);
