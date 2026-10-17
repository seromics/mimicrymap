import test from 'node:test'
import assert from 'node:assert/strict'
import {workspaceReferenceRecord} from './workspace-lookups.mjs'

test('identical numeric record IDs resolve inside the selected collection FASTA',async()=>{
 const libraries=[{id:'a',sha256:'source-a'},{id:'b',sha256:'source-b'}]
 const snapshot={libraries,collections:libraries.map(parent=>({id:'collection-'+parent.id,parent,enabled:true})),comparisons:[]},seen=[]
 const native=async(action,request)=>{if(action==='snapshot')return snapshot;seen.push(request);return {record_id:request.id,sequence:request.library==='a'?'ACDEFGHIK':'LMNPQRSTV'}}
 const a=await workspaceReferenceRecord(native,'collection-a','7999'),b=await workspaceReferenceRecord(native,'collection-b',7999)
 assert.deepEqual(seen,[{library:'a',id:7999},{library:'b',id:7999}])
 assert.equal(a.record.sequence,'ACDEFGHIK');assert.equal(b.record.sequence,'LMNPQRSTV')
 const comparison={id:'direct',parent:libraries[1],enabled:true,complete:true};snapshot.comparisons.push(comparison)
 assert.equal((await workspaceReferenceRecord(native,'direct',7999)).library.id,'b')
})

test('missing or replaced workspace FASTAs never fall back to a canonical record',async()=>{
 const parent={id:'original',sha256:'saved'},snapshot={collections:[{id:'collection',enabled:true,parent}],libraries:[{id:'original',sha256:'replacement'}]}
 const native=async action=>{if(action==='snapshot')return snapshot;assert.fail('Must not read another library record')}
 await assert.rejects(workspaceReferenceRecord(native,'collection',7999),/original reference FASTA/)
 await assert.rejects(workspaceReferenceRecord(native,'other',7999),/collection is unavailable/)
 await assert.rejects(workspaceReferenceRecord(native,'collection',0),/record is unavailable/)
})
