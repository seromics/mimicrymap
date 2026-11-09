'use strict';
const fs=require('node:fs'),path=require('node:path');
const file=process.argv[2];if(!file)throw Error('Pass the consolidated Zenodo manifest.json file.');
const source=JSON.parse(fs.readFileSync(file));
if(source.schema!=='mimicrymap.release-downloads/1'||!Number.isInteger(source.zenodo_record_id)||!Array.isArray(source.files))
  throw Error('Use the current consolidated release manifest, not the historical application package inventory.');
const names=new Set();
for(const item of source.files){
  if(!item.filename||path.basename(item.filename)!==item.filename||names.has(item.filename)||!Number.isSafeInteger(item.bytes)||item.bytes<0)
    throw Error('Invalid or repeated release file');
  names.add(item.filename);
}
const result={...source,status:'unpublished-draft',doi:null,public_links_active:false,
  draft_url:`https://zenodo.org/uploads/${source.zenodo_record_id}`,
  note:'The consolidated draft is uploaded but unpublished. File URLs are planned public links and become usable after publication. Payloads remain outside Git; the software license is separate from this dataset license.'};
const dir=path.resolve(__dirname,'../data');fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'atlas-manifest.json'),JSON.stringify(result,null,2)+'\n');
console.log(result.files.length+' consolidated release files recorded; no payloads copied or published.');
