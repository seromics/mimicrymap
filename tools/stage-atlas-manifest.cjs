'use strict';
const fs=require('node:fs'),path=require('node:path');
const file=process.argv[2];if(!file)throw Error('Pass the staged dataset-manifest.json file.');
const source=JSON.parse(fs.readFileSync(file));
const result={schema:'mimicrymap.atlas-staging/1',version:source.version,status:'local-staging',doi:null,
  note:'Download URLs and final licenses will be assigned before publication. Payloads remain outside Git.',
  archives:source.archives.map(({file,title,bytes,uncompressedBytes,sha256})=>({file,title,bytes,uncompressedBytes,sha256,url:null,kind:file.startsWith('indexes-')?'candidate-index':file==='reference-fastas.zip'?'sequences-and-annotations':'coverage-summaries'}))};
const dir=path.resolve(__dirname,'../data');fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'atlas-manifest.json'),JSON.stringify(result,null,2)+'\n');
console.log(result.archives.length+' separately staged archives recorded; no payloads copied.');
