'use strict';
// Read-only indexed canonical records, shared by the app and website.
const {DatabaseSync}=require('node:sqlite');
const VERSION=1;
function open(file,library){
 const db=new DatabaseSync(file,{readOnly:true});
 try{
  db.exec('PRAGMA query_only=ON; PRAGMA cache_size=-8192;');
  const meta=Object.fromEntries(db.prepare('SELECT key,value FROM metadata').all().map(r=>[r.key,r.value]));
  if(meta.schema!=='mimicrymap.reference-roster/1'||meta.library!==library)throw Error('Incompatible reference roster: '+library);
  const hydrate=row=>row?{...JSON.parse(row.record_json),sequence:row.masked_sequence??row.original_sequence}:null;
  const one=db.prepare('SELECT * FROM records WHERE record_id=?'),alias=db.prepare('SELECT * FROM records WHERE source_accession=? OR record_id=? LIMIT 2');
  const page=db.prepare('SELECT * FROM records WHERE rowid>? ORDER BY rowid LIMIT 256');
  const sequence=db.prepare('SELECT sequence_accession AS source_accession,original_sequence AS sequence FROM records WHERE record_id=?');
  return {meta,get:id=>hydrate(one.get(id)),resolve:id=>{const rows=alias.all(id,id);return rows.length===1?hydrate(rows[0]):null;},
   sequence:id=>{const row=sequence.get(id);return row?{...row}:null;},
   async all(){const rows=[];let position=0;for(;;){const batch=page.all(position);if(!batch.length)return rows;rows.push(...batch.map(hydrate));position+=batch.length;await new Promise(resolve=>setImmediate(resolve));}},
   close:()=>db.close()};
 }catch(error){db.close();throw error;}
}
module.exports={VERSION,open};
