'use strict';
// Compile the exact packaged FASTA/annotation join once, before distribution.
const fs=require('node:fs'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const fasta=require('../frontend/reproduce/fasta-input.js'),metadata=require('./metadata.cjs');
const {VERSION}=require('./reference-roster.cjs');
async function build({sequenceFile,annotationFile,manifestFile,library,output}){
 const manifest=JSON.parse(fs.readFileSync(manifestFile,'utf8'));
 if(await metadata.hash(sequenceFile)!==manifest.fastaSha256||await metadata.hash(annotationFile)!==manifest.sha256)throw Error('Reference roster inputs do not match their annotations');
 const text=fs.readFileSync(sequenceFile,'utf8'),parsed=fasta.parse(text,'target',1);
 if(parsed.errors.length)throw Error(parsed.errors.join('; '));
 const original=text.trim().split(/^>/m).filter(Boolean).map(block=>block.slice(block.indexOf('\n')+1).replace(/\s/g,'').toUpperCase());
 const annotations=new Map();let fields;
 for await(const row of metadata.csvRows(annotationFile)){
  if(!fields){fields=row;continue;}
  const value=Object.fromEntries(fields.map((f,i)=>[f,row[i]||'']));
  if(annotations.has(value.record_id))throw Error('Duplicate reference annotation: '+value.record_id);
  annotations.set(value.record_id,value);
 }
 if(parsed.records.length!==manifest.records||annotations.size!==manifest.records||original.length!==manifest.records)throw Error('Incomplete reference roster');
 fs.mkdirSync(path.dirname(output),{recursive:true});const temporary=output+'.partial';
 if(fs.existsSync(temporary))throw Error('Reference roster build already exists: '+temporary);
 const db=new DatabaseSync(temporary);
 try{
  db.exec(`PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF; PRAGMA user_version=${VERSION};
   CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL);
   CREATE TABLE records(record_id TEXT PRIMARY KEY,source_accession TEXT NOT NULL,sequence_accession TEXT NOT NULL,original_sequence TEXT NOT NULL,masked_sequence TEXT,record_json TEXT NOT NULL);
   CREATE INDEX records_accession ON records(source_accession); BEGIN;`);
  const put=db.prepare('INSERT INTO records VALUES(?,?,?,?,?,?)');
  for(let i=0;i<parsed.records.length;i++){
   const record=parsed.records[i],token=record.protein_id,annotation=annotations.get(token);
   if(!annotation)throw Error('Missing reference annotation: '+token);
   const row=metadata.apply({...record,library_id:library,source_token:token},annotation),sequence=row.sequence;
   // Routes use source-record keys, never an ambiguous accession-only join.
   row.reference_version=manifest.version;row.route_accession='@'+library+':'+token;
   row.route_parent='E:'+String(row.organism||'Unknown organism').replaceAll(' ','_');
   delete row.sequence;
   put.run(token,row.source_accession,record.source_accession||record.original_id||'',original[i],sequence===original[i]?null:sequence,JSON.stringify(row));
  }
  const meta={schema:'mimicrymap.reference-roster/1',library,records:manifest.records,reference_version:manifest.version,fastaSha256:manifest.fastaSha256,annotationSha256:manifest.sha256};
  const insert=db.prepare('INSERT INTO metadata VALUES(?,?)');for(const [key,value] of Object.entries(meta))insert.run(key,String(value));
  db.exec('COMMIT; PRAGMA optimize;');
 }finally{db.close();}
 fs.renameSync(temporary,output);
 return {records:manifest.records,bytes:fs.statSync(output).size};
}
module.exports={build};
