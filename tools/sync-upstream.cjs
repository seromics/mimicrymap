#!/usr/bin/env node
'use strict';
// Explicit source promotion. Never edits the desktop or website checkout.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const {execFileSync} = require('node:child_process');
const root = path.resolve(__dirname, '..');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const manifestPath = path.join(root, 'source-manifest.json');
const args = process.argv.slice(2);
if (args[0] === '--check') {
  const manifest = JSON.parse(fs.readFileSync(manifestPath));
  const changed = manifest.files.filter(item => !fs.existsSync(path.join(root, item.path)) || sha(fs.readFileSync(path.join(root, item.path))) !== item.sha256);
  if (changed.length) { console.error('Shared-source differences:\n' + changed.map(f => f.path).join('\n')); process.exitCode = 1; }
  else console.log(`${manifest.files.length} shared files match the recorded desktop source.`);
} else {
  const source = args[0] && path.resolve(args[0]);
  if (!source || !args.includes('--write')) throw Error('Use node tools/sync-upstream.cjs --check, or <desktop-checkout> --write for an explicit promotion.');
  if (fs.existsSync(manifestPath) && !args.includes('--update')) throw Error('An existing snapshot needs --update. Review git diff after promotion.');
  const tracked = execFileSync('git', ['ls-files', '-z', 'mimicrymap'], {cwd:source,encoding:'utf8'}).split('\0').filter(Boolean);
  if(!tracked.includes('mimicrymap/frontend/recorded_source.py'))tracked.push('mimicrymap/frontend/recorded_source.py');
  for(const extra of ['mimicrymap/workspace/study-library.cjs','mimicrymap/frontend/reproduce/unified-mapping.cjs','mimicrymap/workspace/prepare-mapping.cjs','mimicrymap/tools/build_pan_viral_pairs.py','mimicrymap/tools/build_selected_virus_summaries.py','mimicrymap/tools/stage_selected_virus_summaries.py','mimicrymap/frontend/reproduce/reference-links.js'])if(!tracked.includes(extra))tracked.push(extra);
  const pairView=JSON.parse(fs.readFileSync(path.join(source,'mimicrymap/frontend/atlas-pairs-manifest.json')));
  if(!/^\/document-data\/pan_viral_pairs_[a-f0-9]+\.json\.gz$/.test(pairView.url))throw Error('Unexpected pan-viral page data path');
  const pairPayload='mimicrymap/frontend'+pairView.url;if(!tracked.includes(pairPayload))tracked.push(pairPayload);
  const files = tracked.filter(f => !/(^|\/)test[^/]*\.(?:js|mjs|cjs|py)$/.test(f) && !/\.zip$/.test(f) && !f.endsWith('/source-origin.json'));
  const mappings = files.map(f => [f,f]);
  const pipeline = ['export-core.js','context-score.js','ranking.js','residue-coverage.js','projected-events.js','fasta-input.js','parallel-scan.cjs','pipeline.cjs','pipeline-runner.cjs','pipeline-selection.js','pipeline-layout.json','summary-package.cjs','summary-index.cjs','unified-mapping.cjs','pair-regions.cjs','mapping-writer.cjs','mapping-csv.cjs','mapping-bundles.cjs','zip-files.cjs'];
  for (const f of pipeline) mappings.push(['code/'+f,'mimicrymap/frontend/reproduce/'+f]);
  for (const f of ['custom-worker.js','mimicryone-identity.js']) mappings.push(['code/'+f,'mimicrymap/frontend/'+f]);
  for (const destination of ['code/plot-palette.cjs','mimicrymap/frontend/reproduce/plot-palette.cjs']) mappings.push([destination,'atlas/viewer/shared/plotPalette.cjs']);
  for (const f of ['TABLES.md','GLOSSARY.md','SUMMARY-DOWNLOADS.md']) mappings.push(['docs/'+f,'mimicrymap/frontend/reproduce/docs/'+f]);
  const manifest = {schema:'mimicrymap.source-snapshot/1',repository:'https://github.com/seromics/seromap_electron',commit:execFileSync('git',['rev-parse','HEAD'],{cwd:source,encoding:'utf8'}).trim(),files:[]};
  for (const [destination, origin] of mappings) {
    const bytes=fs.readFileSync(path.join(source,origin)), target=path.join(root,destination);
    fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,bytes);
    manifest.files.push({path:destination,source:origin,bytes:bytes.length,sha256:sha(bytes)});
  }
  fs.writeFileSync(manifestPath,JSON.stringify(manifest,null,2)+'\n');
  console.log(`Staged ${manifest.files.length} files from ${manifest.commit}. Review before committing.`);
}
