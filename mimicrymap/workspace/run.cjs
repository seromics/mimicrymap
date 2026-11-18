// Portable desktop comparison reproducer: Node 24+, no Electron or reference pack.
const fs = require('node:fs'),
  path = require('node:path'),
  { randomUUID } = require('node:crypto');
const engine = require('./code/mimicrymap/workspace/engine.cjs');
(async () => {
  if(process.argv.includes('--from-summary'))throw Error('Use the separate SQLite mapping package. CSV summaries are standalone tables.');
  const root = __dirname,
    settings = JSON.parse(fs.readFileSync(path.join(root, 'settings.json'))),
    out = path.join(root, 'reproduced-' + new Date().toISOString().replace(/[:.]/g, '-'));
  const report = (p) => process.stdout.write((p.phase || '') + ' ' + (p.detail || '') + '\n');
  await engine.importFasta(
    {
      source: path.join(root, 'inputs/targets.fasta'),
      directory: path.join(out, 'targets'),
      id: 'targets',
      name: settings.targetName,
    },
    report,
  );
  await engine.importFasta(
    {
      source: path.join(root, 'inputs/parents.fasta'),
      directory: path.join(out, 'parents'),
      id: 'parents',
      name: settings.parentName,
    },
    report,
  );
  await engine.buildComparison(
    {
      targetDirectory: path.join(out, 'targets'),
      parentDirectory: path.join(out, 'parents'),
      directory: path.join(out, 'comparison'),
      id: randomUUID(),
      floor: settings.floor,
      bidirectional:!!settings.bidirectional,
      targetId: settings.targetId || null,
      retainPositions: settings.retainPositions ?? true,
      targetAnnotations:fs.existsSync(path.join(root,'inputs/targets.annotations.sqlite'))?path.join(root,'inputs/targets.annotations.sqlite'):null,
      parentAnnotations:fs.existsSync(path.join(root,'inputs/parents.annotations.sqlite'))?path.join(root,'inputs/parents.annotations.sqlite'):null,
    },
    report,
  );
  await engine.exportBundle({source:path.join(out,'comparison'),destination:out,product:'both'},report);
  console.log('Complete: ' + path.join(out, 'comparison'));
})().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
