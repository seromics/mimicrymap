'use strict';
// Trusted installer worker. Archives never supply executable preparation code.
const {DatabaseSync}=require('node:sqlite');
const path=require('node:path');
const mapping=require('../frontend/reproduce/unified-mapping.cjs');
const identity=require('../frontend/mimicryone-identity.js');
// The staging path can fit Windows' legacy limit while its journal path does not.
const db=new DatabaseSync(path.toNamespacedPath(path.resolve(process.argv[2])));
try{
 for(const row of db.prepare('SELECT source,metadata FROM sequence_records').iterate())identity.validateRecord(JSON.parse(row.metadata),{source:row.source});
 db.exec('PRAGMA cache_size=-131072;');mapping.prepare(db);
 if(db.prepare('PRAGMA quick_check').get().quick_check!=='ok')throw Error('Prepared mapping failed its integrity check');
}finally{db.close();}
