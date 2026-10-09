'use strict';
const path=require('node:path'),{spawnSync}=require('node:child_process');
const identity=require('../frontend/mimicryone-identity.js');
function annotate(groups, options) {
  if(!options?.python||!options.moduleRoot||!groups.some(g=>g.library?.startsWith('builtin-')&&g.records.length))return;
  const response=spawnSync(options.python,['-B',path.join(__dirname,'annotations.py')],{
    input:JSON.stringify({moduleRoot:options.moduleRoot,groups}),encoding:'utf8',windowsHide:true,maxBuffer:64*1024*1024,
  });
  if(response.error||response.status!==0)throw response.error||Error('Could not read installed sequence annotations: '+response.stderr.trim());
  const annotations=JSON.parse(response.stdout);
  groups.forEach((group,i)=>group.records.forEach((record,j)=>{
    const fields=annotations[i][j];if(!fields)return;
    Object.assign(record,fields,{gene:fields.display_gene,source_accession:fields.display_accession,name:fields.protein_name});
    record.identity=identity.resolve(record);
  }));
}
module.exports={annotate};
