/* Desktop FASTA collections and complete positional comparisons. No Electron API. */
"use strict";
const fs = require("node:fs"),
  fsp = require("node:fs/promises"),
  path = require("node:path"),
  crypto = require("node:crypto");
const readline = require("node:readline"),
  { DatabaseSync } = require("node:sqlite"),
  zlib = require("node:zlib");
const input = require("../frontend/reproduce/fasta-input.js");
const coverage = require("../frontend/reproduce/residue-coverage.js");
const exportsCore = require("../frontend/reproduce/export-core.js");
const metadata = require('./metadata.cjs');
const FORMAT = "seromap.mimicry-comparison/1",
  METHOD = "complete-nine-residue-identity/1";
const hashFile = async (file) => {
  const h = crypto.createHash("sha256");
  for await (const b of fs.createReadStream(file)) h.update(b);
  return h.digest("hex");
};
const json = (file, value) =>
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n");
const dbOpen = (file, readOnly = false) => new DatabaseSync(file, { readOnly });
const textId = (r) => r.assay_id || r.original_id || r.protein_id;
async function importFasta(
  { source, directory, id, name, platforms = [] },
  report = () => {},
) {
  fs.mkdirSync(directory, { recursive: true });
  const file = path.join(directory, "library.sqlite"),
    db = dbOpen(file);
  db.exec(
    "PRAGMA journal_mode=DELETE; CREATE TABLE records (id INTEGER PRIMARY KEY, token TEXT UNIQUE, source TEXT, metadata TEXT, sequence TEXT); CREATE INDEX sources ON records(source);",
  );
  const put = db.prepare("INSERT INTO records VALUES(?,?,?,?,?)"),
    identifiers = new Map();
  let header = "",
    sequence = "",
    count = 0,
    residues = 0,
    bytes = 0,
    short = 0;
  const total = fs.statSync(source).size,
    sha = crypto.createHash("sha256");
  // Retain the exact original input bytes. Parsing normalizes residues only in
  // the library database; the downloadable source never rewrites the FASTA.
  await fsp.copyFile(
    source,
    path.join(directory, "source.fasta"),
    fs.constants.COPYFILE_EXCL,
  );
  const commit = () => {
    if (!header) return;
    const parsed = input.parse(">" + header + "\n" + sequence, "query", 1);
    if (parsed.errors.length) throw Error(parsed.errors.join(" "));
    const record = parsed.records[0];
    let token = header.split(/\s/)[0];
    record.library_id = id;
    const seen = (identifiers.get(record.protein_id) || 0) + 1;
    identifiers.set(record.protein_id, seen);
    if (seen > 1) record.protein_id += "__" + seen;
    // A few pinned exposure records share an accession but have different
    // sequences. Retain both occurrences and the original FASTA/header; give
    // their annotation keys the same deterministic occurrence suffix as IDs.
    if (seen > 1 && ['builtin-exposure','builtin-nonvertebrate'].includes(id)) token += '__' + seen;
    try {
      put.run(
        ++count,
        token,
        textId(record),
        JSON.stringify({ ...record, sequence: undefined }),
        record.sequence,
      );
    } catch (error) {
      throw Error(
        "Duplicate FASTA identifier " +
          token +
          ". Give every record a unique identifier. " +
          error.message,
      );
    }
    residues += record.length;
    if (record.length < 9) short++;
  };
  try {
    db.exec("BEGIN");
    const stream = fs.createReadStream(path.join(directory, "source.fasta"));
    stream.on("data", (b) => {
      sha.update(b);
      bytes += b.length;
    });
    for await (const line of readline.createInterface({
      input: stream,
      crlfDelay: Infinity,
    })) {
      const value = line.trim();
      if (!value) continue;
      if (value.startsWith(">")) {
        commit();
        header = value.slice(1).trim();
        sequence = "";
        if (!header) throw Error("FASTA record has an empty identifier");
        if (count % 1000 === 0)
          report({
            phase: "Reading FASTA",
            done: bytes,
            total,
            detail: count.toLocaleString() + " records",
          });
      } else {
        if (!header) throw Error("FASTA must start with a > record header.");
        sequence += value.replace(/\s/g, "");
      }
    }
    commit();
    if (!count) throw Error("The FASTA contains no records.");
    db.exec("COMMIT");
    const library = {
      id,
      name,
      platforms,
      records: count,
      residues,
      short,
      sha256: sha.digest("hex"),
      createdAt: new Date().toISOString(),
      file: "source.fasta",
      schema: "seromap.mimicry-library/1",
    };
    json(path.join(directory, "library.json"), library);
    return library;
  } finally {
    db.close();
  }
}
// A >= k/9 match has <= 9-k mismatches. Partitioning into 10-k disjoint
// seeds guarantees at least one exact canonical seed; verify every candidate.
function blocks(floor) {
  const n = 10 - floor;
  return Array.from({ length: n }, (_, i) => [
    Math.floor((9 * i) / n),
    Math.floor((9 * (i + 1)) / n),
  ]);
}
function identityAt(a, q, b, p, floor) {
  let n = 0;
  for (let i = 0; i < 9; i++) {
    if (a[q + i] === b[p + i] && /^[ACDEFGHIKLMNPQRSTVWY]$/.test(a[q + i])) n++;
    if (n + 8 - i < floor) return 0;
  }
  return n;
}
function prepareSeeds(library, floor, report = () => {}) {
  const file = path.join(library, "seeds-" + floor + ".sqlite");
  if (fs.existsSync(file)) return file;
  const pending = file + ".pending";
  fs.rmSync(pending, { force: true });
  const db = dbOpen(pending),
    source = dbOpen(path.join(library, "library.sqlite"), true),
    partition = blocks(floor);
  try {
    db.exec(
      "PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF; CREATE TABLE seeds (block INTEGER,seed TEXT,record INTEGER,start INTEGER); BEGIN",
    );
    const put = db.prepare("INSERT INTO seeds VALUES(?,?,?,?)");
    let done = 0,
      total = source.prepare("SELECT count(*) n FROM records").get().n;
    for (const r of source
      .prepare("SELECT id,sequence FROM records")
      .iterate()) {
      for (let p = 0; p + 9 <= r.sequence.length; p++)
        for (let b = 0; b < partition.length; b++) {
          const [s, e] = partition[b],
            seed = r.sequence.slice(p + s, p + e);
          if (/^[ACDEFGHIKLMNPQRSTVWY]+$/.test(seed)) put.run(b, seed, r.id, p);
        }
      if (++done % 500 === 0)
        report({
          phase: "Indexing parent windows",
          done,
          total,
          detail:
            done.toLocaleString() + " / " + total.toLocaleString() + " records",
        });
    }
    db.exec("COMMIT; CREATE INDEX lookup ON seeds(block,seed,record,start)");
  } finally {
    db.close();
    source.close();
  }
  fs.renameSync(pending, file);
  return file;
}
function record(row) {
  return {
    ...JSON.parse(row.metadata),
    sequence: row.sequence,
    record_id: row.id,
  };
}
function scanner(parentDirectory, floor, report) {
  const seed = dbOpen(prepareSeeds(parentDirectory, floor, report), true),
    parents = dbOpen(path.join(parentDirectory, "library.sqlite"), true);
  const lookup = seed.prepare(
      "SELECT record,start FROM seeds WHERE block=? AND seed=?",
    ),
    get = parents.prepare("SELECT * FROM records WHERE id=?"),
    cache = new Map(),
    parts = blocks(floor);
  // Tiled assays repeat the same windows across records. Reuse verified window
  // matches, with a bounded cache; self exclusion remains record-specific below.
  const windows = new Map();
  let cachedPositions = 0;
  const parentAt = (id) => {
    let parent = cache.get(id);
    if (!parent) {
      parent = record(get.get(id));
      cache.set(id, parent);
      if (cache.size > 20000) cache.delete(cache.keys().next().value);
    }
    return parent;
  };
  return {
    close() {
      seed.close();
      parents.close();
    },
    scan(query, skipId) {
      const hits = new Map();
      for (let q = 0; q + 9 <= query.sequence.length; q++) {
        const window = query.sequence.slice(q, q + 9);
        let candidates = windows.get(window);
        if (candidates) {
          windows.delete(window);
          windows.set(window, candidates);
        } else {
          candidates = [];
          const seen = new Set();
          for (let b = 0; b < parts.length; b++) {
            const [s, e] = parts[b],
              key = query.sequence.slice(q + s, q + e);
            if (!/^[ACDEFGHIKLMNPQRSTVWY]+$/.test(key)) continue;
            for (const candidate of lookup.iterate(b, key)) {
              const k = candidate.record + ":" + candidate.start;
              if (seen.has(k)) continue;
              seen.add(k);
              const parent = parentAt(candidate.record);
              const identity = identityAt(
                query.sequence,
                q,
                parent.sequence,
                candidate.start,
                floor,
              );
              if (!identity) continue;
              candidates.push([candidate.record, candidate.start, identity]);
            }
          }
          if (candidates.length <= 5000) {
            windows.set(window, candidates);
            cachedPositions += candidates.length;
            while (windows.size > 16000 || cachedPositions > 250000) {
              const oldest = windows.keys().next().value;
              cachedPositions -= windows.get(oldest).length;
              windows.delete(oldest);
            }
          }
        }
        for (const [id, p, identity] of candidates) {
          if (id === skipId) continue;
          const parent = parentAt(id);
          if (!hits.has(id)) hits.set(id, { parent, hits: [] });
          hits
            .get(id)
            .hits.push([
              q + 1,
              p + 1,
              identity,
              parent.sequence.slice(p, p + 9),
            ]);
        }
        if (q && q % 1000 === 0)
          report?.({
            detail:
              "Target window " +
              (q + 1).toLocaleString() +
              " / " +
              Math.max(0, query.sequence.length - 8).toLocaleString(),
          });
      }
      for (const item of hits.values())
        item.hits.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      return [...hits.values()].sort(
        (a, b) => a.parent.record_id - b.parent.record_id,
      );
    },
  };
}
function resultFor(query, matches, { floor, id, parentName, targetName, summaryOnly = false }) {
  const available = Array.from({ length: 10 - floor }, (_, i) => floor + i),
    catalog = [],
    positions = [],
    ranks = [];
  for (const { parent, hits } of matches) {
    const idx = parent.record_id;
    catalog.push({ ...parent, protein_idx: idx });
    positions.push({
      protein_idx: idx,
      protein_id: parent.protein_id,
      best_identity: Math.max(...new Set(hits.map((h) => h[2]))),
      hits_columns: ["target_start", "source_start", "identity", "source_9mer"],
      hits,
    });
    // Candidate summaries need coordinates, not the viewer's ranked/locus data.
    if (summaryOnly) continue;
    const floors = {};
    for (const f of available) {
      const filtered = hits.filter((h) => h[2] >= f),
        q = filtered.map((h) => h[0]),
        p = filtered.map((h) => h[1]);
      floors["m" + f] = {
        pairs: filtered.length,
        target_windows: new Set(q).size,
        source_windows: new Set(p).size,
        target_loci: coverage.overlapGroups(q),
        source_loci: coverage.overlapGroups(p),
      };
    }
    ranks.push({
      protein_index: idx,
      protein_id: parent.protein_id,
      best_identity: positions.at(-1).best_identity,
      floors,
    });
  }
  return {
    schema: "mimicryone/result/1",
    origin: "custom",
    complete_in_memory: true,
    protein: query,
    source_catalog: catalog,
    positional_matches: positions,
    ranked_matches: ranks,
    available_floors: available,
    result_id: id + ":" + query.record_id,
    parameters: {
      floor,
      window: 9,
      coordinates: "1-based starts and inclusive ends",
      source_scope: "custom",
      source_scope_label: parentName,
      source_entity_level: "parent_record",
      source_entity_label: "parent records",
      summary_query_windows_complete: true,
    },
    inputs: {
      execution: "desktop_workspace",
      input_source: targetName + " → " + parentName,
    },
    provenance: { execution: "Complete saved positions", method: METHOD },
    statistics_status: {
      state: "descriptive_only",
      p_values: false,
      q_values: false,
    },
  };
}
function residuePercent(hits, column, length) {
  if (!length) return 0;
  const starts = [...new Set(hits.map((h) => h[column]))].sort((a, b) => a - b);
  let end = 0,
    count = 0;
  for (const start of starts) {
    const stop = Math.min(length, start + 8);
    count += Math.max(0, stop - Math.max(end, start - 1));
    end = Math.max(end, stop);
  }
  return (100 * count) / length;
}
function* targetBatches(rows) {
  const budget = Math.max(1, Number(process.env.SERO_GPU_QUERY_WINDOWS) || 100000);
  let batch = [], windows = 0;
  for (const row of rows) {
    const count = Math.max(0, row.sequence.length - 8);
    if (batch.length && (windows + count > budget || batch.length >= 4096)) {
      yield batch; batch = []; windows = 0;
    }
    batch.push(row); windows += count;
  }
  if (batch.length) yield batch;
}
function bufferedText(fd) {
  let text = '';
  const flush = () => { if (text) fs.writeSync(fd, text); text = ''; };
  return { append(value) { text += value; if (text.length >= 1024 * 1024) flush(); }, flush };
}
async function buildComparison(
  {
    targetDirectory,
    parentDirectory,
    directory,
    id,
    name,
    floor = 7,
    targetId = null,
    retainPositions = false,
    backend = "cpu",
    gpuPython = null,
    reuseDirectory = null,
    sample = false,
    sampleReuseDirectory = null,
    machine = null,
    targetAnnotations = null,
    parentAnnotations = null,
  },
  report = () => {},
) {
  const started = Date.now();
  if (!Number.isInteger(floor) || floor < 5 || floor > 9)
    throw Error("Choose a minimum identity from 5/9 to 9/9.");
  if (!["cpu", "gpu"].includes(backend))
    throw Error("Choose CPU or NVIDIA GPU.");
  retainPositions = targetId !== null || retainPositions === true;
  const target = JSON.parse(
      fs.readFileSync(path.join(targetDirectory, "library.json")),
    ),
    parent = JSON.parse(
      fs.readFileSync(path.join(parentDirectory, "library.json")),
    );
  // A full saved lookup already contains the work needed for a compact candidate index.
  const reuse = reuseDirectory
    ? dbOpen(path.join(reuseDirectory, "comparison.sqlite"), true)
    : null;
  const sampleReuse = !reuse && sampleReuseDirectory
    ? dbOpen(path.join(sampleReuseDirectory, 'comparison.sqlite'), true) : null;
  const reusableTarget = sampleReuse?.prepare('SELECT 1 FROM results WHERE id=? AND result IS NOT NULL');
  const scan = reuse
    ? null
    : backend === "gpu"
      ? await require("./gpu-scanner.cjs").createScanner({
          parentDirectory,
          floor,
          python: gpuPython,
          report,
        })
      : scanner(parentDirectory, floor, report);
  const source = dbOpen(path.join(targetDirectory, "library.sqlite"), true);
  const targetMetadata=metadata.open(targetAnnotations),parentMetadata=metadata.open(parentAnnotations);
  let setupMs = Date.now() - started;
  let matchMs = 0, writeMs = 0, viewerMs = 0, packingMs = 0, indexMs = 0, targetWindows = 0, positionBytes = 0, reusedTargets = 0, libraryWindows = 0;
  const observations = [];
  fs.mkdirSync(directory, { recursive: true });
  const db = dbOpen(path.join(directory, "comparison.sqlite"));
  const summary = fs.openSync(
      path.join(directory, "library_summary.csv"),
      "wx",
    ),
    pairs = fs.openSync(path.join(directory, "pair_coverage.csv"), "wx");
  const csv = (values) =>
    values
      .map((v) => '"' + String(v ?? "").replaceAll('"', '""') + '"')
      .join(",") + "\r\n";
  const pairHeader = csv([
      "Target record",
      "Target ID",
      "Parent record",
      "Parent ID",
      "Organism",
      "Reference set",
      "Core identity ≥",
      "Target coverage (%)",
      "Parent coverage (%)",
      "Window pairs",
    ]);
  fs.writeSync(pairs, pairHeader);
  const pairWriter = bufferedText(pairs), summaryWriter = bufferedText(summary);
  let done = 0,
    positionCount = 0,
    pairCount = 0,
    summaryHeader = false, summaryHeaderLength = 0, fixedBytes = Buffer.byteLength(pairHeader);
  try {
    db.exec(
      "PRAGMA journal_mode=DELETE; CREATE TABLE results (id INTEGER PRIMARY KEY,token TEXT,source TEXT,name TEXT,result BLOB,sequence_hash TEXT); CREATE TABLE pairs (target INTEGER,source TEXT,parent INTEGER,protein TEXT,organism TEXT,identity INTEGER,tc REAL,pc REAL,pairs INTEGER); CREATE TABLE aliases (alias TEXT,target INTEGER,PRIMARY KEY(alias,target));",
    );
    // Empty tables plus the three secondary-index root pages are fixed costs.
    fixedBytes += fs.statSync(path.join(directory, 'comparison.sqlite')).size + 3 * Number(db.prepare('PRAGMA page_size').get().page_size);
    const putResult = db.prepare("INSERT INTO results VALUES(?,?,?,?,?,?)"),
      putPair = db.prepare("INSERT INTO pairs VALUES(?,?,?,?,?,?,?,?,?)"),
      alias = db.prepare("INSERT OR IGNORE INTO aliases VALUES(?,?)");
    // Deterministic length-stratified sampling, including records throughout the
    // input. A test retains complete matches so the subsequent build can reuse it.
    let sampleIds;
    if (sample) {
      const ordered = source.prepare('SELECT id,length(sequence) n FROM records ORDER BY length(sequence), id').all();
      libraryWindows = ordered.reduce((n,r)=>n+Math.max(0,r.n-8),0);
      const size = Math.min(8192, ordered.length);
      const spread = Array.from({length:size}, (_, i) => ordered[Math.min(ordered.length-1,Math.floor((i+.5)*ordered.length/size))].id);
      // Interleave lengths so even a time-limited test covers the whole library.
      const reverseBits = n => { let r=0; for(let b=0;b<13;b++){r=(r<<1)|(n&1);n>>>=1;} return r; };
      sampleIds = spread.map((id,i)=>({id,order:reverseBits(i)})).sort((a,b)=>a.order-b.order).map(r=>r.id);
    }
    const rows = sampleIds ? sampleIds.map(id => source.prepare('SELECT * FROM records WHERE id=?').get(id)) : targetId
      ? source.prepare("SELECT * FROM records WHERE id=?").all(targetId)
      : source.prepare("SELECT * FROM records ORDER BY id").iterate();
    const total = sampleIds?.length || (targetId ? 1 : target.records);
    // Isolate lazy CUDA allocation/compilation from steady-state sample timing.
    // Warming changes neither output nor scientific cache compatibility.
    if (scan?.scanBatch) {
      report({phase:'Warming GPU',done:0,total:target.records});
      const warm = source.prepare('SELECT * FROM records WHERE id=?').get(sampleIds?.[0] || targetId || 1);
      if (warm) await scan.scan(record(warm), target.sha256 === parent.sha256 ? warm.id : null);
    }
    setupMs = Date.now() - started;
    for (const batch of targetBatches(rows)) {
      const matchStart = Date.now();
      const queries = batch.map(r=>targetMetadata.apply(record(r))), matched = new Array(batch.length), fresh = [];
      for (let i=0;i<batch.length;i++) {
        const row=batch[i], saved=reuse || (reusableTarget?.get(row.id) ? sampleReuse : null);
        if (saved) { matched[i]=matchesFromSaved(saved,row.id,floor); reusedTargets++; }
        else fresh.push(i);
      }
      if (fresh.length) {
        const queryBatch=fresh.map(i=>queries[i]), skips=fresh.map(i=>target.sha256===parent.sha256 ? batch[i].id : null);
        const found=scan.scanBatch ? await scan.scanBatch(queryBatch,skips) : [];
        if (!scan.scanBatch) for(let i=0;i<fresh.length;i++) found.push(await scan.scan(queryBatch[i],skips[i]));
        fresh.forEach((index,i)=>{matched[index]=found[i];});
      }
      const matching = Date.now() - matchStart, writeStart = Date.now();
      matchMs += matching;
      let batchWindows=0;
      db.exec('BEGIN');
      for (let i=0;i<batch.length;i++) {
        const row=batch[i], query=queries[i], matches=matched[i];
        for(const item of matches)item.parent=parentMetadata.apply(item.parent);
        const viewerStart=Date.now();
        const result = resultFor(query, matches, {
          floor,
          id,
          parentName: parent.name,
          targetName: target.name,
          summaryOnly: !retainPositions,
        });
        if (retainPositions) viewerMs += Date.now()-viewerStart;
        const windows = Math.max(0, query.length - 8);
        targetWindows += windows; batchWindows += windows;
        const packStart=Date.now();
        const packed = retainPositions ? zlib.gzipSync(JSON.stringify(result)) : null;
        packingMs += Date.now()-packStart;
        positionBytes += packed?.length || 0;
        putResult.run(
          row.id,
          row.token,
          row.source,
          query.gene || query.name || query.protein_id,
          packed,
          crypto.createHash("sha256").update(query.sequence).digest("hex"),
        );
        for (const key of new Set(
          [row.token, row.source, query.protein_id, query.assay_id].filter(
            Boolean,
          ),
        ))
          alias.run(key, row.id);
        for (const item of matches) {
          positionCount += item.hits.length;
          for (let f = floor; f <= 9; f++) {
            const h = item.hits.filter((h) => h[2] >= f);
            if (!h.length) continue;
            const organism = item.parent.reference_set || item.parent.organism || parent.name,
              tc = residuePercent(h, 0, query.length),
              pc = residuePercent(h, 1, item.parent.length),
              protein = item.parent.protein_id;
            putPair.run(
              row.id,
              row.source,
              item.parent.record_id,
              protein,
              organism,
              f,
              tc,
              pc,
              h.length,
            );
            pairCount++;
            pairWriter.append(csv([
                row.id,
                row.source,
                item.parent.record_id,
                protein,
                item.parent.organism || '',
                organism,
                f,
                tc,
                pc,
                h.length,
              ]));
          }
        }
        const native = exportsCore.summaryTable(
          result,
          [7, 8, 9].filter((f) => f >= floor),
        );
        // The shared formatter may quote multiline headers/metadata; split only the
        // header record when appending (serialize one row after the first target).
        if (!summaryHeader) {
          const single = native.csv;
          let quoted = false,
            end = -1;
          for (
            let i = single.charCodeAt(0) === 0xfeff ? 1 : 0;
            i < single.length;
            i++
          ) {
            if (single[i] === '"') {
              if (quoted && single[i + 1] === '"') i++;
              else quoted = !quoted;
            } else if (!quoted && single[i] === "\n") {
              end = i + 1;
              break;
            }
          }
          if (end < 0) throw Error("Summary header missing");
          summaryHeaderLength = end;
          fixedBytes += Buffer.byteLength(single.slice(0,end));
          summaryWriter.append(single);
          summaryHeader = true;
        } else {
          summaryWriter.append(native.csv.slice(summaryHeaderLength));
        }
        done++;
      }
      db.exec('COMMIT');
      pairWriter.flush(); summaryWriter.flush();
      const writing = Date.now() - writeStart;
      writeMs += writing;
      if (sample) observations.push({targets:batch.length,windows:batchWindows,matchMs:matching,writeMs:writing});
      report({
        phase: "Comparing sequences",
        done,
        total,
        detail:
          done.toLocaleString() + ' / ' + total.toLocaleString() + ' targets' +
          " · " +
          (retainPositions
            ? positionCount.toLocaleString() + " window pairs saved"
            : pairCount.toLocaleString() + " coverage rows saved"),
      });
      // Parent-index preparation/warm-up is separate; finish the current batch
      // before stopping the short test. Cancel can interrupt any phase.
      if (sample && observations.length >= 3 && Date.now() - started - setupMs >= 20000) break;
    }
    if (!done) throw Error("The selected target is not in this library.");
    const indexStart=Date.now();
    db.exec('CREATE INDEX target_sequence ON results(sequence_hash); CREATE INDEX target_source ON results(source); CREATE INDEX memberships ON pairs(identity,organism,source);');
    indexMs=Date.now()-indexStart;
  } finally {
    pairWriter.flush(); summaryWriter.flush();
    fs.closeSync(summary);
    fs.closeSync(pairs);
    source.close();
    targetMetadata.close();parentMetadata.close();
    await scan?.close();
    reuse?.close();
    sampleReuse?.close();
    db.close();
  }
  const manifest = {
    schema: FORMAT,
    method: METHOD,
    id,
    name: name || target.name + " → " + parent.name,
    floor,
    window: 9,
    target,
    parent,
    targetId,
    complete: targetId === null && !sample,
    sample: !!sample,
    retainsPositions: retainPositions,
    output:
      sample ? 'sample-lookup' : targetId !== null
        ? "single-target"
        : retainPositions
          ? "full-lookup"
          : "candidate-index",
    backend: reuse ? "saved-lookup" : backend,
    targets: done,
    positions: positionCount,
    pairs: pairCount,
    createdAt: new Date().toISOString(),
    files: {},
  };
  // Internal tests reuse the installed inputs by checksum. Only portable
  // comparison products need another complete copy of both FASTAs.
  const inputBytes = fs.statSync(path.join(targetDirectory,'source.fasta')).size +
    fs.statSync(path.join(parentDirectory,'source.fasta')).size;
  if (!sample) {
    await fsp.mkdir(path.join(directory, "inputs"), { recursive: true });
    await fsp.copyFile(path.join(targetDirectory, "source.fasta"), path.join(directory, "inputs/targets.fasta"));
    await fsp.copyFile(path.join(parentDirectory, "source.fasta"), path.join(directory, "inputs/parents.fasta"));
    for(const [side,file] of [['targets',targetAnnotations],['parents',parentAnnotations]])if(file){
      await fsp.copyFile(file,path.join(directory,'inputs',side+'.annotations.sqlite'));
      await fsp.copyFile(metadata.csvFor(file),path.join(directory,'inputs',side+'.annotations.csv'));
    }
  }
  json(path.join(directory, "settings.json"), {
    floor,
    targetId,
    retainPositions,
    targetName: target.name,
    parentName: parent.name,
  });
  for (const file of [
    "comparison.sqlite",
    "library_summary.csv",
    "pair_coverage.csv",
    ...(!sample ? ["inputs/targets.fasta", "inputs/parents.fasta"] : []),
    ...(!sample&&targetAnnotations?['inputs/targets.annotations.sqlite','inputs/targets.annotations.csv']:[]),
    ...(!sample&&parentAnnotations?['inputs/parents.annotations.sqlite','inputs/parents.annotations.csv']:[]),
    "settings.json",
  ])
    manifest.files[file] = {
      bytes: fs.statSync(path.join(directory, file)).size,
      sha256: await hashFile(path.join(directory, file)),
    };
  manifest.measurement = {execution:'bulk-2',machine, setupMs, matchMs, writeMs, viewerMs, packingMs, indexMs, fixedBytes,
    finishMs:Date.now()-started-setupMs-matchMs-writeMs-indexMs,
    totalMs:Date.now()-started, targetWindows, libraryWindows:sample?libraryWindows:targetWindows, positionBytes, inputBytes, reusedTargets,
    observations:sample ? observations : undefined};
  json(path.join(directory, "comparison.json"), manifest);
  return manifest;
}
function matchesFromSaved(db, targetId, floor) {
  const row = db.prepare("SELECT result FROM results WHERE id=?").get(targetId);
  if (!row?.result)
    throw Error(
      "This saved comparison has no complete positions for the target.",
    );
  const result = JSON.parse(zlib.gunzipSync(row.result)),
    parents = new Map(result.source_catalog.map((p) => [p.protein_idx, p]));
  return result.positional_matches
    .map((p) => ({
      parent: parents.get(p.protein_idx),
      hits: p.hits.filter((h) => h[2] >= floor),
    }))
    .filter((p) => p.hits.length);
}
function searchRecords({directory,comparison=false,search='',offset=0,annotationFile}) {
  const db=dbOpen(path.join(directory,comparison?'comparison.sqlite':'library.sqlite'),true);
  const overlay=metadata.open(annotationFile);
  try{
    if(annotationFile)db.prepare('ATTACH DATABASE ? AS annotations').run(annotationFile);
    const table=comparison?'results':'records',term='%'+String(search).replace(/[\\%_]/g,c=>'\\'+c)+'%';
    const fields=['r.token','r.source',comparison?'r.name':'r.metadata',...(annotationFile?['m.gene','m.accession','m.description','m.organism','m.reference_set']:[])];
    const clause=fields.map(f=>f+" LIKE ? ESCAPE '\\'").join(' OR '),args=fields.map(()=>term);
    const from=table+' r '+(annotationFile?'LEFT JOIN annotations.records m ON m.id=r.id ':'');
    const rows=db.prepare('SELECT r.* FROM '+from+' WHERE '+clause+' ORDER BY r.id LIMIT 25 OFFSET ?').all(...args,Math.max(0,Number(offset)||0));
    return {total:db.prepare('SELECT count(*) n FROM '+from+' WHERE '+clause).get(...args).n,
      rows:rows.map(r=>{const meta=comparison?{protein_id:r.source,raw_header:r.token,record_id:r.id}:record(r);const value=overlay.apply(meta);delete value.sequence;return {id:r.id,token:r.token,source:r.source,name:value.gene||value.protein_name||r.name,metadata:value};})};
  }finally{overlay.close();db.close();}
}

function readResult({ directory, targetId, annotations, targetAnnotations, parentAnnotations }) {
  const db = dbOpen(path.join(directory, "comparison.sqlite"), true);
  try {
    const row = db
      .prepare("SELECT result FROM results WHERE id=?")
      .get(targetId);
    if (!row) throw Error("Target is not in the saved comparison");
    if (!row.result)
      throw Error(
        "This candidate index contains coverage summaries. Use Compare one target to compute its sequence map.",
      );
    const result = JSON.parse(zlib.gunzipSync(row.result));
    if (annotations?.python && annotations.moduleRoot) require('./annotations.cjs').annotate([
      {library:annotations?.target,records:[result.protein]},
      {library:annotations?.parent,records:result.source_catalog},
    ], annotations);
    const ta=metadata.open(targetAnnotations),pa=metadata.open(parentAnnotations);
    try{result.protein=ta.apply(result.protein);result.source_catalog=result.source_catalog.map(r=>pa.apply(r));}finally{ta.close();pa.close();}
    return result;
  } finally {
    db.close();
  }
}
function readRecord({ directory, id, annotations, annotationFile }) {
  const db = dbOpen(path.join(directory, "library.sqlite"), true);
  try {
    const row = db.prepare("SELECT * FROM records WHERE id=?").get(id);
    if (!row) throw Error("Record not found");
    const value = record(row);
    if (annotations?.python && annotations.moduleRoot) require('./annotations.cjs').annotate([{library:annotations.library,records:[value]}], annotations);
    const overlay=metadata.open(annotationFile);try{return overlay.apply(value);}finally{overlay.close();}
  } finally {
    db.close();
  }
}
function findSaved({ directory, sequence }) {
  const db = dbOpen(path.join(directory, "comparison.sqlite"), true);
  try {
    // Sequence identities are indexed separately from labels, never guessed from genes.
    const digest = crypto.createHash("sha256").update(sequence).digest("hex");
    return db
      .prepare(
        "SELECT id FROM results WHERE sequence_hash=? AND result IS NOT NULL LIMIT 2",
      )
      .all(digest);
  } finally {
    db.close();
  }
}
async function validateComparison(directory) {
  const m = JSON.parse(
    fs.readFileSync(path.join(directory, "comparison.json"), "utf8"),
  );
  if (
    m.schema !== FORMAT ||
    m.method !== METHOD ||
    m.window !== 9 ||
    ![5, 6, 7, 8, 9].includes(m.floor)
  )
    throw Error("Unsupported comparison format");
  for (const file of [
    "comparison.sqlite",
    "library_summary.csv",
    "pair_coverage.csv",
    "inputs/targets.fasta",
    "inputs/parents.fasta",
    "settings.json",
  ])
    if (
      !m.files?.[file] ||
      (await hashFile(path.join(directory, file))) !== m.files[file].sha256
    )
      throw Error("Incomplete or altered comparison: " + file);
  for(const side of ['targets','parents']) for(const extension of ['sqlite','csv']) {
    const file='inputs/'+side+'.annotations.'+extension;
    if(m.files?.[file]&&(await hashFile(path.join(directory,file)))!==m.files[file].sha256)throw Error('Incomplete or altered comparison: '+file);
  }
  const settings = JSON.parse(
    fs.readFileSync(path.join(directory, "settings.json"), "utf8"),
  );
  if (
    settings.floor !== m.floor ||
    settings.targetId !== m.targetId ||
    m.complete !== (m.targetId === null) ||
    m.target?.sha256 !== m.files['inputs/targets.fasta'].sha256 ||
    m.parent?.sha256 !== m.files['inputs/parents.fasta'].sha256
  )
    throw Error("Comparison settings do not match its manifest");
  const retainsPositions = m.retainsPositions !== false; // Existing full packages remain compatible.
  if (
    (settings.retainPositions ?? true) !== retainsPositions ||
    (!m.complete && !retainsPositions)
  )
    throw Error("Comparison output type does not match its settings");
  const db = dbOpen(path.join(directory, "comparison.sqlite"), true);
  try {
    if (
      db.prepare("PRAGMA quick_check").get().quick_check !== "ok" ||
      db.prepare("SELECT count(*) n FROM results").get().n !== m.targets
    )
      throw Error("Comparison database is incomplete");
    const stored = db
      .prepare("SELECT count(*) n FROM results WHERE result IS NOT NULL")
      .get().n;
    if (stored !== (retainsPositions ? m.targets : 0))
      throw Error("Comparison positional storage does not match its manifest");
  } finally {
    db.close();
  }
  return m;
}
module.exports = {
  prepareAnnotations:metadata.prepare,
  refreshAnnotations:require('./metadata-outputs.cjs').refresh,
  hashFile,
  FORMAT,
  METHOD,
  importFasta,
  prepareSeeds,
  scanner,
  resultFor,
  residuePercent,
  buildComparison,
  searchRecords,
  readResult,
  readRecord,
  findSaved,
  validateComparison,
  hashFile,
};
