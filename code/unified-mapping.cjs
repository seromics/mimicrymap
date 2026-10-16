'use strict';
// A pair is stored once. Exact ribbon coverage and the declared statistical
// cutoff policy remain separate; lookup indexes are local, reproducible data.
const regions=require('./pair-regions.cjs');
const FORMAT='unified-mapping/1', APPLICATION_ID=0x4d4d5531;
const indexes=[
 ['page_forward','mapping_pairs(a,identity,ac DESC,bc DESC,b)'],
 ['page_reverse','mapping_pairs(b,identity,bc DESC,ac DESC,a)'],
 ['statistical_forward','mapping_pairs(identity,b,stats_ac,stats_bc,a)'],
 ['statistical_reverse','mapping_pairs(identity,a,stats_bc,stats_ac,b)'],
 ['sequence_sources','sequence_records(side,source)'],
 ['sequence_digest','sequence_records(side,sha256)'],
];
function views(db){db.exec(`
 CREATE VIEW pairs AS SELECT p.a target,t.source,p.b parent,
 coalesce(json_extract(s.metadata,'$.protein_id'),s.source) protein,
 coalesce(nullif(json_extract(s.metadata,'$.reference_set'),''),nullif(json_extract(s.metadata,'$.organism'),''),json_extract(s.metadata,'$.membership_group'),'') organism,
 p.identity,p.stats_ac tc,p.stats_bc pc,p.windows pairs
 FROM mapping_pairs p JOIN sequence_records t ON t.side=0 AND t.id=p.a JOIN sequence_records s ON s.side=1 AND s.id=p.b;
 CREATE VIEW reverse_pairs AS SELECT p.b target,t.source,p.a parent,
 coalesce(json_extract(s.metadata,'$.protein_id'),s.source) protein,
 coalesce(nullif(json_extract(s.metadata,'$.reference_set'),''),nullif(json_extract(s.metadata,'$.organism'),''),json_extract(s.metadata,'$.membership_group'),'') organism,
 p.identity,p.stats_bc tc,p.stats_ac pc,p.windows pairs
 FROM mapping_pairs p JOIN sequence_records t ON t.side=1 AND t.id=p.b JOIN sequence_records s ON s.side=0 AND s.id=p.a;
 CREATE VIEW pair_regions AS SELECT a target,b parent,identity,ranges payload FROM mapping_pairs;
 CREATE VIEW aliases AS SELECT alias,id target FROM record_aliases WHERE side=0;
 CREATE VIEW results AS SELECT id,token,source,name,NULL result,sha256 sequence_hash FROM sequence_records WHERE side=0;
 `);}
function create(db){
 db.exec(`PRAGMA application_id=${APPLICATION_ID};PRAGMA user_version=1;
 CREATE TABLE sequence_records(side INTEGER,id INTEGER,source TEXT,metadata TEXT,length INTEGER,sha256 TEXT,token TEXT,name TEXT,PRIMARY KEY(side,id)) WITHOUT ROWID;
 CREATE TABLE record_aliases(side INTEGER,alias TEXT,id INTEGER,PRIMARY KEY(side,alias,id)) WITHOUT ROWID;
 CREATE TABLE mapping_pairs(a INTEGER,b INTEGER,identity INTEGER,ac REAL,bc REAL,stats_ac REAL,stats_bc REAL,windows INTEGER,ranges BLOB,PRIMARY KEY(a,identity,b)) WITHOUT ROWID;
 CREATE TABLE overviews(side INTEGER,id INTEGER,identity INTEGER,ranges TEXT,count INTEGER,PRIMARY KEY(side,id,identity)) WITHOUT ROWID;
 CREATE TABLE library_unions(side INTEGER,id INTEGER,identity INTEGER,scope TEXT DEFAULT '',ranges TEXT,PRIMARY KEY(side,scope,id,identity)) WITHOUT ROWID;
 CREATE TABLE library_union_scopes(side INTEGER,identity INTEGER,scope TEXT DEFAULT '',PRIMARY KEY(side,identity,scope)) WITHOUT ROWID;`);
 views(db);
}
const known=new WeakMap();
function isUnified(db){if(!known.has(db))known.set(db,!!db.prepare("SELECT 1 FROM sqlite_master WHERE name='mapping_pairs' AND type='table'").get());return known.get(db);}
function prepare(db){
 if(db.prepare('PRAGMA application_id').get().application_id!==APPLICATION_ID)throw Error('Not a unified mapping database');
 if(db.prepare('PRAGMA user_version').get().user_version!==1)throw Error('Unsupported unified mapping version');
 db.exec('BEGIN');
 try{for(const [name,sql]of indexes)db.exec(`CREATE INDEX IF NOT EXISTS ${name} ON ${sql}`);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}
}
function columns(side){
 if(side!==0&&side!==1)throw Error('Invalid mapping side');
 return side?{own:'b',other:'a',tc:'bc',pc:'ac',stc:'stats_bc',spc:'stats_ac',statIndex:'statistical_reverse'}:{own:'a',other:'b',tc:'ac',pc:'bc',stc:'stats_ac',spc:'stats_bc',statIndex:'statistical_forward'};
}
function overview(db,side,id,identity){columns(side);const r=db.prepare('SELECT ranges,count FROM overviews WHERE side=? AND id=? AND identity=?').get(side,id,identity);return {records:r?.count||0,reference_ranges:r?JSON.parse(r.ranges):[]};}
 // A missing row is an empty union only when that complete comparison scope was
 // evaluated. Older filtered indexes must report unavailable, never uniqueness.
 function libraryUnionReader(db){
  if(!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='library_unions'").get())return ()=>null;
  const get=db.prepare('SELECT ranges FROM library_unions WHERE side=? AND id=? AND identity=? AND scope=?');
  const complete=new Set(db.prepare('SELECT side,identity,scope FROM library_union_scopes').all().map(r=>JSON.stringify([r.side,r.identity,r.scope])));
  return (side,id,identity,scope='')=>{const row=get.get(side,id,identity,scope);return row?JSON.parse(row.ranges):complete.has(JSON.stringify([side,identity,scope]))?[]:null;};
 }
function rows(db,side,id,identity,{offset=0,limit=Infinity}={}){
 const {own,other,tc,pc}=columns(side);
 return db.prepare(`SELECT ${other} id,${tc} reference_coverage,${pc} match_coverage,ranges FROM mapping_pairs WHERE ${own}=? AND identity=? ORDER BY ${tc} DESC,${pc} DESC,${other} LIMIT ? OFFSET ?`).all(id,identity,Number.isFinite(limit)?limit:-1,offset).map(({ranges,...r})=>{const v=regions.unpack(ranges,!!side);return {...r,reference_ranges:v.target_ranges,match_ranges:v.parent_ranges};});
}
// This projection intentionally avoids record metadata joins for bulk set
// membership scans. Both native Node SQLite and better-sqlite3 can consume it.
function memberProjection(side){const c=columns(side);return `(SELECT ${c.own} target,${c.other} parent,identity,${c.stc} tc,${c.spc} pc FROM mapping_pairs INDEXED BY ${c.statIndex})`;}
module.exports={FORMAT,APPLICATION_ID,indexes,create,views,prepare,isUnified,columns,overview,libraryUnionReader,rows,memberProjection};
