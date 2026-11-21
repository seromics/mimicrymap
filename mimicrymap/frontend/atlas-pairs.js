/* Presentation of existing published pair coverage only. No sequence matching. */
(function(root){
 'use strict';
 const MIN_HUMAN_LENGTH_AA=50;
 const eligibleTarget=record=>Number.isFinite(record?.[3])&&record[3]>=MIN_HUMAN_LENGTH_AA;
 const displayTargetCount=data=>data.targets.filter(eligibleTarget).length;
 const lexical=(a,b)=>a<b?-1:a>b?1:0;
 function ranked(data,floor,metric){
  if(![7,8,9].includes(floor)||!['target','parent'].includes(metric))throw Error('Invalid table selection');
  const offset=2+(floor-7)*2,primary=offset+(metric==='target'?1:0),secondary=offset+(metric==='target'?0:1);
  // Apply the atlas human population before either ranking and pagination.
  // The underlying summary and its CSV download retain every source record.
  return data.pairs.filter(p=>eligibleTarget(data.targets[p[0]])&&p[offset]!==null&&p[offset+1]!==null).sort((a,b)=>b[primary]-a[primary]||b[secondary]-a[secondary]||lexical(data.targets[a[0]][1],data.targets[b[0]][1])||lexical(data.parents[a[1]][1],data.parents[b[1]][1])||a[0]-b[0]||a[1]-b[1]);
 }
 function pageSlice(rows,page,size){const pages=Math.max(1,Math.ceil(rows.length/size)),current=Math.max(1,Math.min(pages,page));return {page:current,pages,rows:rows.slice((current-1)*size,current*size),start:(current-1)*size};}
 if(typeof module==='object'&&module.exports){module.exports={ranked,pageSlice,displayTargetCount,MIN_HUMAN_LENGTH_AA};return;}
 const host=document.getElementById('atlasPairs');if(!host)return;
 const config=root.MimicryPanViralPairs||{},find=s=>host.querySelector(s),all=s=>[...host.querySelectorAll(s)],number=n=>Number(n).toLocaleString('en-US');
 const state={data:null,floor:7,metric:'target',size:10,page:1,cache:new Map(),view:null,request:0};
 const status=find('#atlasPairsStatus'),body=find('tbody'),scroll=find('.atlas-pairs-scroll'),pagination=find('.atlas-pairs-pagination');
 const csv=find('#atlasPairsCsv');if(config.summary_url){csv.href=config.summary_url;csv.download=config.summary_url.split('/').pop();}
 const code=document.createElement('button');code.type='button';code.className='af-exportbtn';code.textContent='Code';code.dataset.pairExport='code';code.hidden=typeof root.SeroMapCodeExport!=='function';code.disabled=true;csv.parentNode.append(code);
 root.addEventListener('seromap:code-export-ready',()=>{code.hidden=typeof root.SeroMapCodeExport!=='function';code.disabled=!state.view?.rows.length;});
 const originalTitle=find('#atlasPairsTitle').textContent;
 function element(tag,attrs,text){const n=document.createElement(tag);for(const [k,v]of Object.entries(attrs||{}))n.setAttribute(k,v);if(text!=null)n.textContent=text;return n;}
 const reference=(record,isParent)=>({library:isParent?'atlas_120_viruses':'human_swissprot',source:record[1],organism:isParent?record[3]:'Homo sapiens'});
 const recordHref=(record,isParent)=>root.MimicryReferenceLinks.protein(reference(record,isParent));
 const pairHref=(data,pair,floor,reverse=false)=>root.MimicryReferenceLinks.comparison(reference(reverse?data.parents[pair[1]]:data.targets[pair[0]],reverse),reference(reverse?data.targets[pair[0]]:data.parents[pair[1]],!reverse),floor);
 function labelCell(record,isParent){const cell=element('td',{},null);cell.dataset.tooltip=isParent?record[3]:record[2];const a=element('a',{href:recordHref(record,isParent)});a.append(element('strong',{},record[0]||record[1]));if(record[0])a.append(element('small',{},record[1]));cell.append(a);return cell;}
 function coverage(value,href){const cell=element('td'),bar=element('a',{class:'atlas-pairs-measure',href,title:'Open This Exact Pair in MimicryMap'});bar.style.setProperty('--pair-percent',value+'%');bar.append(element('span',{},value.toFixed(1)+'%'));cell.append(bar);return cell;}
 function render(){
  if(!state.data)return;
  const data=state.data,key=state.floor+':'+state.metric;if(!state.cache.has(key))state.cache.set(key,ranked(data,state.floor,state.metric));
  const rows=state.cache.get(key),view=pageSlice(rows,state.page,state.size);state.page=view.page;state.view=view;const offset=2+(state.floor-7)*2;
  const fragment=document.createDocumentFragment();
  view.rows.forEach((pair,i)=>{const tr=element('tr',{'data-target-accession':data.targets[pair[0]][1],'data-parent-accession':data.parents[pair[1]][1],'data-target-coverage':pair[offset+1],'data-parent-coverage':pair[offset]});tr.append(element('td',{},number(view.start+i+1)),labelCell(data.targets[pair[0]],false),labelCell(data.parents[pair[1]],true),element('td',{title:data.parents[pair[1]][3]},data.parents[pair[1]][2]),coverage(pair[offset+1],pairHref(data,pair,state.floor)),coverage(pair[offset],pairHref(data,pair,state.floor,true)));fragment.append(tr);});
  body.replaceChildren(fragment);find('#atlasPairsPlot').replaceChildren(tableSvg(view,data,state.floor));host.dataset.ready='true';host.dataset.floor=state.floor;host.dataset.metric=state.metric;
  all('[data-pair-floor]').forEach(b=>{b.disabled=false;b.setAttribute('aria-pressed',String(Number(b.dataset.pairFloor)===state.floor));});
  const first=rows.length?view.start+1:0,last=view.start+view.rows.length,total=rows.length,pages=view.pages;
  find('#atlasPairsRange').textContent=(/*@copy atlas-pairs.range*/`Rows ${number(first)}–${number(last)} of ${number(total)} pairs`/*@endcopy*/);
  find('#atlasPairsPageCount').textContent=(/*@copy atlas-pairs.pages*/`of ${number(pages)}`/*@endcopy*/);
  const input=find('#atlasPairsPage');input.value=state.page;input.max=pages;
  find('#atlasPairsPrevious').disabled=state.page===1;find('#atlasPairsNext').disabled=state.page===pages;
  find('#atlasPairsScope').textContent=(/*@copy atlas-pairs.scope*/`${number(data.proteomes)} viral proteomes · ${number(displayTargetCount(data))} human targets ≥${MIN_HUMAN_LENGTH_AA} AA`/*@endcopy*/);
  scroll.hidden=!rows.length;pagination.hidden=!rows.length;status.hidden=!!rows.length;
  if(!rows.length)status.textContent=(/*@copy atlas-pairs.empty*/`No pairs with a human target of at least ${MIN_HUMAN_LENGTH_AA} residues meet the summary listing floor at this identity.`/*@endcopy*/);
  all('[data-pair-export]').forEach(b=>b.disabled=!rows.length);

 }
 all('[data-pair-floor]').forEach(b=>b.addEventListener('click',()=>{state.floor=Number(b.dataset.pairFloor);state.page=1;render();}));
 const rankSelect=find('#atlasPairsRank'),rankItems=[...rankSelect.options].map(o=>({value:o.value,label:o.textContent}));
 const rankPicker=root.MimicryAtlasTable.picker({id:'atlasPairsRank',label:find('#atlasPairsRankLabel').textContent,searchable:false,
  items:()=>rankItems,value:()=>state.metric,onChange:value=>{state.metric=value;state.page=1;render();}});
 rankSelect.replaceWith(rankPicker);
 find('#atlasPairsSize').addEventListener('change',e=>{state.size=Number(e.target.value);state.page=1;render();});
 find('#atlasPairsPrevious').addEventListener('click',()=>{state.page--;render();});find('#atlasPairsNext').addEventListener('click',()=>{state.page++;render();});
 find('#atlasPairsPage').addEventListener('change',e=>{state.page=Math.max(1,Math.floor(Number(e.target.value)||1));render();});
 const ns='http://www.w3.org/2000/svg';
 function svgNode(tag,attrs,text){const n=document.createElementNS(ns,tag);for(const[k,v]of Object.entries(attrs||{}))n.setAttribute(k,v);if(text!=null)n.textContent=text;return n;}
 function tableSvg(view,data,floor){
  const offset=2+(floor-7)*2,heading=originalTitle;
  const target=p=>data.targets[p[0]],parent=p=>data.parents[p[1]];
  const label=r=>[r[0],r[1]].filter(Boolean).join(' | ');
  const headers=[...find('thead tr').children].map(th=>th.textContent.trim());
  return root.MimicryAtlasTable.render({
   width:1100,title:heading,heading,unit:`${floor}/9 | Coverage (%) | 0–100 | Human Targets ≥${MIN_HUMAN_LENGTH_AA} AA`,
   gutter:48,gutterTitle:headers[0],rows:view.rows,label:p=>number(view.start+view.rows.indexOf(p)+1),
   cols:[
    {t:headers[1],w:180,f:p=>label(target(p)),tooltip:p=>label(target(p))+' | '+target(p)[2],href:p=>recordHref(target(p),false)},
    {t:headers[2],w:180,f:p=>label(parent(p)),tooltip:p=>label(parent(p)),href:p=>recordHref(parent(p),true)},
    {t:headers[3],w:240,f:p=>parent(p)[2],tooltip:p=>parent(p)[3]},
    {t:headers[4],w:150,f:p=>p[offset+1].toFixed(1)+'%',bar:p=>p[offset+1],scale:100,href:p=>pairHref(data,p,floor)},
    {t:headers[5],w:150,f:p=>p[offset].toFixed(1)+'%',bar:p=>p[offset],scale:100,href:p=>pairHref(data,p,floor,true)}
   ]
  });
 }
 all('[data-pair-export]').forEach(button=>button.addEventListener('click',async()=>{
  if(!state.view)return;const view={...state.view,rows:state.view.rows.slice()},floor=state.floor,metric=state.metric,data=state.data,kind=button.dataset.pairExport;button.disabled=true;
  try{
   const metricLabel=rankItems.find(item=>item.value===metric).label;
   const subtitle=(/*@copy atlas-pairs.export-subtitle*/`Minimum identity ${floor}/9 · ${metricLabel} · Rows ${number(view.start+1)}–${number(view.start+view.rows.length)} of ${number(state.cache.get(floor+':'+metric).length)}`/*@endcopy*/);
   const svg=tableSvg(view,data,floor);
   svg.append(svgNode('desc',{},subtitle+'. '+find('#atlasPairsLegend').textContent));
   svg.append(svgNode('metadata',{},JSON.stringify({schema:'mimicryone/atlas-pair-figure/1',source_sha256:data.source_sha256,summary_url:config.summary_url,collection:'viruses',identity_min:floor,min_human_length_aa:MIN_HUMAN_LENGTH_AA,human_target_records:displayTargetCount(data),sort:metric,page:view.page,rows:view.rows})));
   const filename=`pan_viral_pairs_m${floor}_${metric}_page_${view.page}`;
   if(kind==='code'){
    const offset=2+(floor-7)*2,headers=[...find('thead tr').children].map(th=>th.textContent.trim());
    const rows=view.rows.map((pair,i)=>Object.fromEntries([
     [headers[0],view.start+i+1],[headers[1],data.targets[pair[0]].slice(0,2).filter(Boolean).join(' | ')],
     [headers[2],data.parents[pair[1]].slice(0,2).filter(Boolean).join(' | ')],[headers[3],data.parents[pair[1]][2]],
     [headers[4],pair[offset+1]],[headers[5],pair[offset]]
    ]));
    await root.SeroMapCodeExport({filename,csv:{rows,columns:headers},svg:root.MimicryAtlasTable.exportNode(svg),
     reproduction:{id:'mimicry-atlas-pairs',title:originalTitle,legend:find('#atlasPairsLegend').textContent,methods:'This package replays the captured page of published coverage results; it does not compute sequence matches.',
      settings:{identity:floor,min_human_length_aa:MIN_HUMAN_LENGTH_AA,human_target_records:displayTargetCount(data),sort:metric,page:view.page,pageSize:state.size,source_sha256:data.source_sha256,summary_url:config.summary_url},
      columnDefinitions:headers.map((label,i)=>({key:label,label,
       meaning:[
        'One-based position in the selected published pair ranking.',
        'Antigen target source gene and accession as displayed in this row.',
        'Mimicry parent source gene and accession as displayed in this row.',
        'Published mimicry parent organism or proteome label.',
        'Percent of the antigen target sequence covered by the published qualifying core union at the selected identity threshold.',
        'Percent of the mimicry parent sequence covered by the published qualifying core union at the selected identity threshold.'
       ][i],unit:i===0?'rank':i>=4?'percent':'text',missing:'Blank means unavailable in the published source. Numeric zero is retained as zero.'})),
      data:{rows},scope:{mode:'frozen-result-replay',upstreamRecomputed:false,table:'Current page; the separate summary CSV contains the complete published library',sequenceMatching:'Not executed or packaged'},
      sources:['mimicrymap/atlas-pairs.js','mimicrymap/atlas-figures.js']}});
   }else await root.MimicryAtlasTable.export(svg,filename,kind);
  }catch(error){if(error.name!=='AbortError'){status.hidden=false;status.textContent=(/*@copy atlas-pairs.export-error*/`The figure could not be exported. Please try again.`/*@endcopy*/);console.error(error);}}finally{button.disabled=!state.view?.rows.length;}
 }));
 async function fetchData(){
  const url=config.url;
  if(!url)throw Error('Pair view has not been built');const response=await fetch(url);if(!response.ok)throw Error('Pair data HTTP '+response.status);
  let bytes=new Uint8Array(await response.arrayBuffer());if(bytes[0]===31&&bytes[1]===139){bytes=new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());}
  const data=JSON.parse(new TextDecoder().decode(bytes));if(data.schema!=='mimicryone/atlas-pair-view/1'||data.source_sha256!==config.source_sha256||data.summary_url!==(config.source_summary_url||config.summary_url)||(data.collection||'viruses')!=='viruses')throw Error('Pair view source differs from current summary');
  if(!Array.isArray(data.targets)||!Array.isArray(data.parents)||!Array.isArray(data.pairs))throw Error('Invalid pair data');
  for(const p of data.pairs){if(p.length!==8||!Number.isInteger(p[0])||!Number.isInteger(p[1])||!data.targets[p[0]]||!data.parents[p[1]]||p.slice(2).some(v=>v!==null&&(!Number.isFinite(v)||v<0||v>100)))throw Error('Invalid pair values');}
  return data;
 }
 async function load(){
  const request=++state.request;
  state.data=null;state.view=null;state.cache=new Map();host.dataset.ready='loading';host.setAttribute('aria-busy','true');
  body.replaceChildren();find('#atlasPairsPlot').replaceChildren();scroll.hidden=true;pagination.hidden=true;find('#atlasPairsScope').textContent='';
  all('[data-pair-export]').forEach(b=>b.disabled=true);
  status.hidden=false;status.textContent=(/*@copy atlas-pairs.loading*/`Loading pair coverage…`/*@endcopy*/);all('[data-pair-floor]').forEach(b=>b.disabled=true);
  try{
   const data=await fetchData();
   if(request!==state.request)return;
   state.data=data;render();
  }catch(error){
   if(request!==state.request)return;
   status.hidden=false;status.replaceChildren(document.createTextNode((/*@copy atlas-pairs.load-error*/`The pair table could not be loaded. The full summary CSV is still available. `/*@endcopy*/)));const retry=element('button',{type:'button'},(/*@copy atlas-pairs.retry*/`Retry`/*@endcopy*/));retry.addEventListener('click',load);status.append(retry);host.dataset.ready='error';console.error(error);
  }finally{if(request===state.request)host.setAttribute('aria-busy','false');}
 }
 root.addEventListener('mimicryone:theme',()=>{if(state.view)find('#atlasPairsPlot').replaceChildren(tableSvg(state.view,state.data,state.floor));});

 load();
})(typeof globalThis!=='undefined'?globalThis:this);
