"use strict";
const { spawn } = require("node:child_process");
const { createInterface } = require("node:readline");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

async function createScanner({ parentDirectory, floor, python, report }) {
  if (!python || ![5, 6, 7, 8, 9].includes(floor))
    throw Error("GPU builds require installed NVIDIA support and 5/9–9/9.");
  report?.({phase:'Starting GPU and preparing parent search',done:0,total:0});
  const child = spawn(
    python,
    [
      "-I",
      path.join(__dirname, "gpu_worker.py"),
      "--library",
      parentDirectory,
      "--floor",
      String(floor),
    ],
    { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
  );
  const parents = new DatabaseSync(
    path.join(parentDirectory, "library.sqlite"),
    { readOnly: true },
  );
  const get = parents.prepare("SELECT * FROM records WHERE id=?");
  const parentCache = new Map();
  const parentAt = (id) => {
    if (!parentCache.has(id)) {
      const row = get.get(id);
      if (!row) throw Error("GPU returned an unknown parent record");
      if (parentCache.size >= 4096) parentCache.delete(parentCache.keys().next().value);
      parentCache.set(id, { ...JSON.parse(row.metadata), sequence: row.sequence, record_id: id });
    }
    return parentCache.get(id);
  };
  let pending,
    error,
    stderr = "",
    hits,
    closed = false;
  const kill = () => child.kill();
  process.once("exit", kill);
  const fail = (e) => {
    error = e;
    pending?.reject(e);
    pending = null;
  };
  child.stderr.on("data", (b) => {
    stderr = (stderr + b).slice(-4000);
  });
  child.on("error", fail);
  child.stdin.on("error", fail);
  child.on("exit", (code) => {
    if (!closed) fail(Error(stderr || "GPU worker stopped (" + code + ")."));
  });
  const wait = () =>
    new Promise((resolve, reject) => {
      if (error) reject(error);
      else pending = { resolve, reject };
    });
  const ready = wait();
  createInterface({ input: child.stdout }).on("line", (line) => {
    try {
      const m = JSON.parse(line);
      if (m.error) return fail(Error(m.error));
      if (m.progress) report?.(m.progress);
      if (m.hits)
        for (const [qid, id, q, p, n] of m.hits) {
          const target = hits[qid];
          if (!target) throw Error("GPU returned an unknown target record");
          let item = target.get(id);
          if (!item) {
            item = {
              parent: parentAt(id),
              hits: [],
            };
            target.set(id, item);
          }
          item.hits.push([q, p, n, item.parent.sequence.slice(p - 1, p + 8)]);
        }
      if (m.ready || m.done) {
        pending?.resolve();
        pending = null;
      }
    } catch (e) {
      fail(e);
      kill();
    }
  });
  const close = async () => {
    if (closed) return;
    closed = true;
    child.stdin.end();
    child.kill();
    parents.close();
    process.removeListener("exit", kill);
  };
  try {
    await ready;
  } catch (e) {
    await close();
    throw e;
  }
  const scanBatch = async (queries, skipIds = []) => {
      hits = queries.map(() => new Map());
      const done = wait();
      child.stdin.write(
        JSON.stringify({ queries: queries.map((query, i) => ({ sequence: query.sequence, skipId: skipIds[i] })) }) + "\n",
      );
      await done;
      return hits.map(target => {
        const values = [...target.values()].sort((a, b) => a.parent.record_id - b.parent.record_id);
        for (const item of values) item.hits.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
        return values;
      });
  };
  return {
    close, scanBatch,
    async scan(query, skipId) { return (await scanBatch([query], [skipId]))[0]; },
  };
}
module.exports = { createScanner };
