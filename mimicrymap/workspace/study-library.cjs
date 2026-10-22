'use strict';
const {createHash}=require('node:crypto');
const IDENTITY='study-source-sequence/1';
const sequence=value=>String(value||'').replace(/\s+/g,'').toUpperCase();
const sequenceHash=value=>createHash('sha256').update(sequence(value)).digest('hex');
function sourceKey(id,peptide){
  return 'SERO_'+createHash('sha256').update(String(id)).update('\0').update(sequence(peptide)).digest('hex');
}

// Read only the installed antigen catalogue. Calls, normalization, and sample
// matrices are not inputs to sequence-library construction.
async function exportStudyLibrary({file,platform,directory},report=()=>{}){
  const fs=require('node:fs'),fsp=require('node:fs/promises'),path=require('node:path');
  const {DatabaseSync}=require('node:sqlite');
  const db=new DatabaseSync(file,{readOnly:true});
  await fsp.mkdir(directory,{recursive:true});
  const destination=path.join(directory,'source.fasta'),pending=destination+'.partial';
  const handle=await fsp.open(pending,'w');
  let rows=0,missing=0,invalid=0,buffer='',last=null,lastSequence=null;
  const hash=createHash('sha256');
  const flush=async()=>{if(buffer){hash.update(buffer);await handle.write(buffer);buffer='';}};
  try{
    const total=db.prepare('SELECT count(*) n FROM antigens WHERE is_deleted=0 AND platform=?').get(platform).n;
    if(!total)throw Error('No assay records were saved for this channel.');
    for(const row of db.prepare('SELECT source_id,peptide FROM antigens WHERE is_deleted=0 AND platform=? ORDER BY source_id,antigen_id').iterate(platform)){
      const aa=sequence(row.peptide);
      if(!aa||/^(NA|NULL|NAN)$/i.test(aa)){missing++;continue;}
      if(!/^[ACDEFGHIKLMNPQRSTVWYBXZJUO]+$/.test(aa)){invalid++;continue;}
      if(last===row.source_id){
        if(lastSequence!==aa)throw Error('One source ID has conflicting amino-acid sequences.');
        continue;
      }
      last=row.source_id;lastSequence=aa;
      buffer+='>'+sourceKey(row.source_id,aa)+' '+String(row.source_id).replace(/[\r\n\x00-\x1f]/g,' ')+'\n'+aa+'\n';rows++;
      if(buffer.length>1024*1024){await flush();report({phase:'Preparing assay sequences',done:rows+missing+invalid,total});}
    }
    if(missing||invalid)throw Error(`Cross-mapping needs amino-acid sequences for every assay record: ${missing} missing, ${invalid} invalid. The installed study is unchanged.`);
    await flush();await handle.close();await fsp.rename(pending,destination);
    return {source:destination,sha256:hash.digest('hex'),records:rows,sourceIdentity:IDENTITY};
  }finally{await handle.close().catch(()=>{});db.close();}
}
// Reuse a manually installed comparison only when every source ID resolves
// uniquely and its complete amino-acid sequence is identical. Labels alone do
// not establish compatibility between assay-library generations.
function verifyStudyComparison({file,platform,mapping},report=()=>{}){
  const {DatabaseSync}=require('node:sqlite');
  const study=new DatabaseSync(file,{readOnly:true}),saved=new DatabaseSync(mapping,{readOnly:true});
  try{
    const aliases=new Map(),ambiguous=new Set();
    for(const row of saved.prepare('SELECT a.alias,a.id,s.sha256 FROM record_aliases a JOIN sequence_records s USING(side,id) WHERE a.side=0').iterate()){
      if(aliases.has(row.alias)&&aliases.get(row.alias).id!==row.id)ambiguous.add(row.alias);
      else aliases.set(row.alias,row);
    }
    let records=0;
    for(const row of study.prepare('SELECT source_id,peptide FROM antigens WHERE is_deleted=0 AND platform=?').iterate(platform)){
      const aa=sequence(row.peptide),match=aliases.get(row.source_id);
      if(!aa||ambiguous.has(row.source_id)||!match||match.sha256!==sequenceHash(aa))return {matches:false};
      records++;
    }
    report({phase:'Checking saved sequence mappings',done:records,total:records});
    return {matches:records>0,records};
  }finally{study.close();saved.close();}
}
module.exports={IDENTITY,sequence,sequenceHash,sourceKey,exportStudyLibrary,verifyStudyComparison};
