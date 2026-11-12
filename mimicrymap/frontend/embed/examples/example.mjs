import {createViewer} from '../mimicrymap.mjs';
const $=id=>document.getElementById(id),viewer=createViewer($('viewer'));
let headers=[];
function targetOptions(){
 const term=$('targetSearch').value.toLowerCase(),previous=$('targetIndex').value;
 const matches=headers.map((text,i)=>({text,i})).filter(row=>row.text.toLowerCase().includes(term));
 $('targetIndex').replaceChildren(...matches.slice(0,100).map(row=>new Option(row.text,String(row.i))));
 if([...$('targetIndex').options].some(o=>o.value===previous))$('targetIndex').value=previous;
 $('targetCount').textContent=headers.length>1?`${matches.length.toLocaleString()} matching targets${matches.length>100?' · first 100 shown':''}`:'';
}
function targets(){headers=[...$('targetFasta').value.matchAll(/^>[^\S\r\n]*(.+)$/gm)].map(m=>m[1]);if(!headers.length&&$('targetFasta').value.trim())headers=['Target'];targetOptions();}
const references=await (await fetch('references.json')).json();
let preparing=false;
function presetState(){
 const preset=$('inputPreset').value;
 $('loadPreset').textContent=preset==='references'?'Download FASTAs':preset==='custom'?'Clear Inputs':'Load Example';
 $('loadPreset').disabled=preparing||(preset==='references'&&!references.published);
 $('referenceStatus').textContent=preset==='references'?(references.published?'15.23 MB of FASTA sequences. Select one target, then compare.':'Coming soon. The reference download is not public yet. You can load local copies using the file selectors below.') : '';
}
function setInputs(target,parent){$('targetFasta').value=target;$('parentFasta').value=parent;$('targetSearch').value='';targets();}
const initial=await Promise.all(['target.fasta','parents.fasta'].map(async name=>{const r=await fetch(name);if(!r.ok)throw Error('Cannot load '+name);return r.text();}));
setInputs(...initial);presetState();window.demoViewer=viewer;
$('targetSearch').addEventListener('input',targetOptions);
$('inputPreset').onchange=presetState;
$('loadPreset').onclick=async()=>{
 const preset=$('inputPreset').value;
 if(preset==='demo'){setInputs(...initial);return;}
 if(preset==='custom'){setInputs('','');return;}
 if(!references.published)return;
 preparing=true;presetState();$('status').textContent='Downloading Reference FASTAs…';
 try{const inputs=await Promise.all([references.target,references.parent].map(async item=>{
  const r=await fetch(item.url);if(!r.ok)throw Error(`Cannot download ${item.filename} (HTTP ${r.status}). Use the local file selector instead.`);
  const text=await r.text();if(!text.trimStart().startsWith('>'))throw Error(item.filename+' did not return FASTA data.');return text;
 }));setInputs(...inputs);$('status').textContent='';}
 catch(error){$('status').textContent=error.message;}finally{preparing=false;presetState();}
};
$('targetFasta').addEventListener('change',targets);
for(const [file,text] of [['targetFile','targetFasta'],['parentFile','parentFasta']])$(file).onchange=async()=>{if($(file).files[0]){$(text).value=await $(file).files[0].text();targets();}};
viewer.addEventListener('progress',event=>$('status').textContent=event.detail.message);
$('inputs').onsubmit=async event=>{event.preventDefault();$('compare').disabled=true;$('cancel').disabled=false;$('save').disabled=true;try{
 await viewer.compare({targetFasta:$('targetFasta').value,parentFasta:$('parentFasta').value,targetIndex:Number($('targetIndex').value),minimumIdentity:Number($('floor').value)});
 $('status').textContent='';$('save').disabled=false;
}catch(error){$('status').textContent=error.name==='AbortError'?'Canceled':error.message;}finally{$('compare').disabled=false;$('cancel').disabled=true;}};
$('cancel').onclick=()=>viewer.cancel();$('theme').onchange=event=>viewer.setTheme(event.target.value);
$('save').onclick=async()=>{const result=await viewer.getResult(),url=URL.createObjectURL(new Blob([JSON.stringify(result)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='mimicrymap-result.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
$('resultFile').onchange=async()=>{try{const file=$('resultFile').files[0];if(file){await viewer.loadResult(JSON.parse(await file.text()));$('save').disabled=false;$('status').textContent='';}}catch(error){$('status').textContent=error.message;}};
