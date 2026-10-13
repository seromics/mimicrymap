'use strict';
// Portable summary contract. CSV owns coverage/ranges; sidecars own stable
// record identities and list order. No matching or database is needed to read it.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const readline=require('node:readline');
const SCHEMA='mimicrymap.summary-package/1';
const quote=v=>'"'+String(v??'').replaceAll('"','""')+'"';
const csvLine=values=>values.map(quote).join(',')+'\r\n';
async function hash(file){const h=crypto.createHash('sha256');for await(const b of fs.createReadStream(file))h.update(b);return h.digest('hex');}
async function* jsonLines(file){for await(const line of readline.createInterface({input:fs.createReadStream(file),crlfDelay:Infinity}))if(line.trim())yield JSON.parse(line);}
async function* csvRows(file){
 let row=[],field='',quoted=false,afterQuote=false,first=true,cr=false;
 for await(let chunk of fs.createReadStream(file,{encoding:'utf8'})){
  if(first){chunk=chunk.replace(/^\uFEFF/,'');first=false;}
  for(const c of chunk){
   if(cr){cr=false;if(c==='\n')continue;}
   if(quoted){if(c==='"'){quoted=false;afterQuote=true;}else field+=c;continue;}
   if(afterQuote&&c==='"'){field+='"';quoted=true;afterQuote=false;continue;}
   if(c===','){row.push(field);field='';afterQuote=false;}
   else if(c==='\r'||c==='\n'){row.push(field);if(row.some(v=>v!==''))yield row;row=[];field='';afterQuote=false;cr=c==='\r';}
   else if(c==='"'&&!field&&!afterQuote)quoted=true;
   else{if(afterQuote)throw Error('Unexpected text after quoted CSV field');field+=c;}
  }
 }
 if(quoted)throw Error('Unclosed quoted CSV field');if(field||row.length){row.push(field);yield row;}
}
function safeFile(root,file){
 if(typeof file!=='string'||!file||path.isAbsolute(file)||file.includes('\\')||file.split('/').some(p=>!p||p==='.'||p==='..'))throw Error('Invalid summary package path');
 const resolved=path.resolve(root,file),base=fs.realpathSync(root),actual=fs.realpathSync(resolved);
 if(!actual.startsWith(base+path.sep))throw Error('Summary file escapes its package');return resolved;
}
async function seal(directory,manifest){
 const files={};
 for(const file of new Set([manifest.csv,manifest.recordsFile,manifest.keysFile,...Object.values(manifest.inputs||{})])){
  const full=safeFile(directory,file);files[file]={bytes:fs.statSync(full).size,sha256:await hash(full)};
 }
 const value={...manifest,schema:SCHEMA,coverageFloor:10,coverageSide:'either',membershipCoverage:manifest.membershipCoverage||'exact-residue-union',coordinates:'1-based inclusive',files};
 fs.writeFileSync(path.join(directory,'summary.json'),JSON.stringify(value,null,2)+'\n');return value;
}
async function validate(directory){
 const manifest=JSON.parse(fs.readFileSync(path.join(directory,'summary.json'),'utf8'));
 if(manifest.schema!==SCHEMA||manifest.coverageFloor!==10||manifest.coverageSide!=='either'||manifest.coordinates!=='1-based inclusive'||!Array.isArray(manifest.floors)||!manifest.floors.length||new Set(manifest.floors).size!==manifest.floors.length||manifest.floors.some(f=>!Number.isInteger(f)||f<5||f>9))throw Error('Unsupported summary package contract');
 for(const f of manifest.floors)if(!['exact-residue-union','csv-pair-percent'].includes(typeof manifest.membershipCoverage==='object'?manifest.membershipCoverage[f]:manifest.membershipCoverage))throw Error('Missing or unsupported membership coverage policy');
 for(const file of new Set([manifest.csv,manifest.recordsFile,manifest.keysFile,...Object.values(manifest.inputs||{})])){
  const full=safeFile(directory,file),expected=manifest.files?.[file];
  if(!expected||fs.statSync(full).size!==expected.bytes||await hash(full)!==expected.sha256)throw Error('Incomplete or altered summary file: '+file);
 }
 for(const side of ['target','parent'])if(!manifest.inputs?.[side]||manifest[side]?.sha256!==manifest.files[manifest.inputs[side]]?.sha256)throw Error('Library descriptor differs from its FASTA input');
 if(typeof manifest.complete!=='boolean'||!Number.isSafeInteger(manifest.rows)||manifest.rows<1||manifest.rows>manifest.target.records||manifest.complete&&manifest.rows!==manifest.target.records)throw Error('Invalid summary completeness declaration');
 return manifest;
}
function record(side,row,metadata){
 const {sequence,...fields}=metadata;
 return {side,id:row.id,token:row.token,source:row.source,length:sequence.length,sha256:crypto.createHash('sha256').update(sequence).digest('hex'),metadata:fields,
  aliases:[...new Set([row.token,row.source,metadata.protein_id,metadata.assay_id].filter(Boolean))]};
}
module.exports={SCHEMA,csvLine,csvRows,jsonLines,hash,safeFile,seal,validate,record};
