'use strict';
const fs=require('node:fs'),path=require('node:path');
const STEMS={'builtin-human':'human_swissprot','builtin-viral120':'atlas_120_viruses','builtin-exposure':'canonical_exposure','builtin-nonvertebrate':'canonical_exposure_no_vertebrates','builtin-huprot':'huprot4','builtin-huscan':'huscan','builtin-virscan':'virscan_exposome'};
function packaged(root,library){
  if(!root||!STEMS[library])return null;
  const file=path.join(root,'mimicrymap/reference/record-annotations',STEMS[library]+'.json');
  if(!fs.existsSync(file))return null;
  const manifest=JSON.parse(fs.readFileSync(file,'utf8'));
  if(manifest.schema!=='mimicrymap.record-annotations/1'||manifest.library!==library)throw Error('Invalid packaged library annotations');
  return {...manifest,file:path.join(path.dirname(file),STEMS[library]+'.csv')};
}
module.exports={STEMS,packaged};
