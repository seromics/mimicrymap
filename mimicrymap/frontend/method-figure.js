/* Saved comparisons, illustrated without a catalog query or production scan.
   Illustrated rows come from the saved export at build time.

   The records are the pair Lanz et al., Nature (2022) studied. An antibody from a cerebrospinal-
   fluid B-cell clone in multiple sclerosis bound both EBV EBNA1 and human GlialCAM (HEPACAM);
   the study compared EBNA1 386-405 with GlialCAM 370-389. The target excerpt below is the same
   GlialCAM 367-393 context the worked example above displays, and the parent excerpt is the EBNA1
   region containing the studied peptide. The threshold walked here is >=5/9. */
(function(){
 'use strict';
 const host=document.getElementById('methodFigurePanels'),coverage=window.MimicryResidueCoverage;
 if(!host||!coverage)return;
 const authored=window.MimicryPublicCopy;
 const saved=window.MimicryMethodSavedExamples;
 if(!saved)throw new Error('Missing saved Methods export examples');
 function copy(key,values=[]){
  if(!authored||typeof authored[key]!=='string')throw new Error((/*@copy method-figure.missing-public-diagram-copy.6b4b0f6*/`Missing public diagram copy: ${key}`/*@endcopy*/));
  return authored[key].replace(/\{(\d+)\}/g,(_,i)=>{
   if(Number(i)>=values.length)throw new Error((/*@copy method-figure.missing-diagram-copy-value.6e54067*/`Missing diagram copy value: ${key}`/*@endcopy*/));
   return String(values[Number(i)]);
  });
 }
 // Frozen comparison excerpts retained as internal regression fixtures. Full-record coverage uses the
 // saved full-record coordinates and lengths, never these excerpt denominators.
 const T='RSPATGRTHSSPPRAPSSPGRSRSASR',P='RGRGRGEKRPRSPSSQSSSSGSPPRRPPPGRRPFFHPVGEADYFEYHQ';
 const TOFF=367,POFF=372,TFULL=416,PFULL=641,FLOOR=5;
 const TNAME='GlialCAM · Q14CZ8',PNAME='EBNA1 · P03211';
 const tp=i=>TOFF+i-1,pp=i=>POFF+i-1;          // local index -> position in the whole protein
 const targetWindows=T.length-8,parentWindows=P.length-8,candidatePairs=targetWindows*parentWindows;
 // Every >=5/9 pair between these two excerpts, in local coordinates. Complete, not a selection.
 const pairs=[[8,19,5],[9,20,5],[10,7,5],[10,21,5],[11,8,5],[11,22,5],[12,9,5],[13,10,5],[14,11,5]];
 const selected=pairs[3],q=selected[0],p=selected[1];   // T376 / P392
 const context=(seq,start)=>Array.from({length:27},(_,i)=>seq[start-10+i]||'–').join('');
 const ct=context(T,q),cp=context(P,p);
 const target=coverage.measure(pairs.map(h=>h[0]),T.length),parent=coverage.measure(pairs.map(h=>h[1]),P.length);
 const text=(x,y,s,c='')=>`<text x="${x}" y="${y}" class="${c}">${s}</text>`;
 const rect=(x,y,w,h,c)=>`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="2" class="${c}"/>`;
 const line=(a,b,c,d,cls='method-axis')=>`<line x1="${a}" y1="${b}" x2="${c}" y2="${d}" class="${cls}"/>`;
 // Geometric asterisks share the circle centers, independent of font baselines.
 const wildcard=(x,y)=>`<path class="method-wildcard" transform="translate(${x},${y})" d="M0 -3.5V3.5M-3.03 -1.75L3.03 1.75M-3.03 1.75L3.03 -1.75"/>`;
 const PEPTIDE_STEP=12, ROW_PITCH=28;
 const escapeText=value=>String(value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
 function letters(sequence,x,y,{step=PEPTIDE_STEP,reference=null,paint=null}={}){
  return Array.from(sequence,(aa,i)=>text(x+i*step,y,aa,'method-aa '+
   (aa==='–'?'method-aa-absent':reference?(aa===reference[i]?'method-aa-match':'method-aa-mismatch'):paint?.(i)?'method-aa-match':''))).join('');
 }
 // Every expanded context uses the same three nine-position sections and letter pitch.
 const contextX=i=>25+Math.floor(i/9)*120+(i%9)*PEPTIDE_STEP;
 function contextStrip(sequence,y,reference=null){
  let strip='';
  for(let section=0;section<3;section++){
   const x=contextX(section*9);
   strip+=letters(sequence.slice(section*9,section*9+9),x,y,
    {reference:reference?.slice(section*9,section*9+9)})+
    line(x,y+6,x+105,y+6,section===1?'method-core-underline':'method-context-underline');
  }
  return strip;
 }
 /* Reference-inspired residue colors; letter height carries frequency, not color. */
 const AA_CATEGORY={A:'hydrophobic',V:'hydrophobic',L:'hydrophobic',I:'hydrophobic',M:'hydrophobic',
  F:'hydrophobic',W:'hydrophobic',P:'proline',S:'serine',T:'threonine',N:'amide',Q:'amide',Y:'polar',
  C:'polar',G:'glycine',K:'basic',R:'basic',H:'histidine',D:'acidic',E:'acidic'};
 const aaClass=aa=>'method-logo-'+(AA_CATEGORY[aa]||'other');
 /* A two-record frequency logo: identical residues fill the column, differing residues
    each fill half. Fit visible glyph ink, not the SVG font box (which includes whitespace),
    into fixed-width slots sharing a baseline and ceiling. */
 const LOGO_BASE=100,LOGO_H=40,LOGO_W=11;
 function logoColumn(x,bottom,stack){
  const each=LOGO_H/stack.length;
  return stack.map((aa,i)=>
   `<text x="0" y="0" style="font-size:${LOGO_BASE}px" `+
   `class="method-logo ${aaClass(aa)}" data-x="${x}" data-h="${each.toFixed(3)}" `+
   `data-bottom="${(bottom-i*each).toFixed(3)}">${aa}</text>`).join('');
 }
 function mergedLogo(a,b,positions,bottom){
  let out='';
  for(let i=0;i<a.length;i++){
   const t=a[i],p=b[i];
   // Same residue: one letter over the full column. Different: both, evenly, parent beneath target.
   out+=logoColumn(positions(i),bottom,t===p&&t!=='–'?[t]:[p,t]);
  }
  return out;
 }
 /* Canvas supplies actual ink bounds for the same SVG font. Explicit font size avoids the
    diagram's shared text CSS overriding the measurement size. Letter bearings are normalized
    horizontally too, so every column stays aligned with the sequence rows above. */
 function calibrateLogo(root){
  const measure=document.createElement('canvas').getContext('2d');
  for(const glyph of root.querySelectorAll('text.method-logo')){
   const style=getComputedStyle(glyph);
   measure.font=`${style.fontWeight} ${LOGO_BASE}px ${style.fontFamily}`;
   const ink=measure.measureText(glyph.textContent);
   const height=ink.actualBoundingBoxAscent+ink.actualBoundingBoxDescent;
   const width=ink.actualBoundingBoxLeft+ink.actualBoundingBoxRight;
   if(!height||!width)continue;
   const h=Number(glyph.dataset.h),bottom=Number(glyph.dataset.bottom);
   const sx=LOGO_W/width,sy=h/height;
   const x=Number(glyph.dataset.x)+ink.actualBoundingBoxLeft*sx;
   const baseline=bottom-ink.actualBoundingBoxDescent*sy;
   glyph.setAttribute('transform',`translate(${x},${baseline}) scale(${sx},${sy})`);
   glyph.dataset.inkHeight=String(height*sy);
   glyph.dataset.inkWidth=String(width*sx);
  }
 }
 function panel(n,title,svg,equations,caption,height=200){
  const id='method-panel-'+n,s=document.createElement('section');s.className='method-panel';s.dataset.step=String(n);
  s.innerHTML=(/*@copy method-figure.text.d66e716*/`<div class="method-step-copy"><h4 id="${id}-title">${n+1} · ${title}</h4><div class="method-equation" id="${id}-formula">${equations}</div><div class="method-caption" id="${id}-caption"></div></div><div class="method-diagram"><svg viewBox="0 0 400 ${height}" role="img" aria-labelledby="${id}-title" aria-describedby="${id}-formula ${id}-caption">${svg}</svg></div>`/*@endcopy*/);
  // Captions are authored below, never supplied by input files or API metadata.
  s.querySelector('h4').textContent=({0:'1',2:'2',4:'3',3:'4',1:'5'}[n])+' · '+title;
  s.querySelector('.method-caption').innerHTML=caption;host.append(s);
 }
 // Record bars indicate a many-record population, not a measured size distribution.
 function choiceDiagram(wide){
  const width=wide?680:400,targetW=wide?170:122,parentX=wide?250:150,parentW=width-parentX-10;
  const targetCenter=10+targetW/2,parentCenter=parentX+parentW/2;
  let diagram=rect(10,16,targetW,160,'method-track')+rect(parentX,16,parentW,160,'method-track')+
   text(targetCenter,40,copy('choice.target'),'method-center method-label')+
   text(targetCenter,62,copy('choice.one'),'method-center method-coordinate')+
   line(targetCenter-27,99,targetCenter+27,99,'method-core-underline')+
   text(parentCenter,40,copy('choice.parent'),'method-center method-label')+
   text(parentCenter,62,copy('choice.record-field'),'method-center method-coordinate');
  const columns=wide?6:4,rows=5,cellWidth=(parentW-28)/columns;
  for(let row=0;row<rows;row++)for(let col=0;col<columns;col++){
   const x=parentX+14+col*cellWidth,y=83+row*12;
   const length=cellWidth*(.46+((row+col*2)%4)*.12);
   diagram+=line(x,y,x+length,y,'method-core-underline');
  }
  diagram+=text(targetCenter,157,copy('choice.target-name'),'method-center method-label')+
   text(parentCenter,157,copy('choice.many'),'method-center method-label')+
   line(targetCenter,176,targetCenter,197)+line(parentCenter,176,parentCenter,197)+
   line(targetCenter,197,parentCenter,197)+line(width/2,197,width/2,216)+
   text(width/2,239,copy('choice.pair'),'method-center method-label')+
   text(width/2,270,copy('choice.threshold',[FLOOR]),'method-center');
  return {svg:diagram,width,height:292};
 }
 panel(0,copy('panel0.title'),'',copy('panel0.equation'),copy('panel0.caption'));
 responsivePanel(0,choiceDiagram);
 // Sequence-heavy panels have wide and wrapped geometries, not a scaled-down desktop image.
 function responsivePanel(n,render,pixelSized=false){
  const container=host.querySelector('[data-step="'+n+'"] .method-diagram'),svg=container.querySelector('svg');
  let previous=null;
  const draw=()=>{
   const wide=container.clientWidth>=640;
   const size=pixelSized?container.clientWidth:wide;
   if(size===previous)return;
   previous=size;
   const frame=render(wide,container.clientWidth);
   svg.setAttribute('viewBox','0 0 '+frame.width+' '+frame.height);
   svg.innerHTML=frame.svg;
   calibrateLogo(svg);
  };
  draw();
  new ResizeObserver(draw).observe(container);
 }
 function inputDiagram(wide){
  const width=wide?680:400;
  let input=text(width/2,18,copy('input.scale'),'method-center method-label'),inputY=46;
  const proteinScale=(width-56)/PFULL;
  for(const [sequence,key,name,offset0,full]of
    [[ct,'input.target',TNAME,tp(q-9),TFULL],[cp,'input.parent',PNAME,pp(p-9),PFULL]]){
   input+=text(width/2,inputY,copy(key,[name,full]),'method-center');
   const barX=32,barY=inputY+15,spanX=barX+(offset0-1)*proteinScale,spanW=sequence.length*proteinScale;
   input+='<g class="method-protein-scale" data-length="'+full+'">'+rect(barX,barY,full*proteinScale,10,'method-track')+
    rect(spanX,barY,spanW,10,'method-context')+
    rect(spanX+9*proteinScale,barY,9*proteinScale,10,'method-match method-context-core')+'</g>'+
    text(barX,barY+26,'1','method-coordinate')+
    text(barX+full*proteinScale,barY+26,String(full),'method-end method-coordinate')+
    '<path class="method-pair-line method-context-connector" d="M'+(spanX+spanW/2)+','+(barY+12)+' V'+(barY+39)+' L'+(width/2)+','+(barY+65)+'"/>';
   inputY+=72;
   input+=text(width/2,inputY,copy('input.context',[offset0,offset0+sequence.length-1]),'method-center method-coordinate');
   inputY+=ROW_PITCH;
   input+='<g class="method-selected-context" data-start="'+offset0+'" data-end="'+(offset0+26)+'" style="--method-local-type-scale:'+(400/width)+'" transform="translate(0,'+inputY+') scale('+(width/400)+')">'+
    contextStrip(sequence,0,sequence===ct?cp:ct)+'</g>';
   inputY+=ROW_PITCH;
   inputY+=20;
  }
  const scale=width/400;
  input+=text(width/2,inputY+20,(/*@copy method-figure.merged-mer-frequency-logo.cf4324d*/`Merged 27-mer Frequency Logo`/*@endcopy*/),'method-center')+
   '<g class="method-inspection-logo" style="--method-local-type-scale:'+(1/scale)+'" transform="translate(0,'+(inputY-160*scale)+') scale('+scale+')">'+
   mergedLogo(ct,cp,contextX,232)+
   '<g class="method-logo-underlines">'+[0,1,2].map(section=>{
    const x=contextX(section*9);
    return line(x,238,x+105,238,section===1?'method-core-underline':'method-context-underline');
   }).join('')+'</g></g>';
  return {svg:input,width,height:inputY+90*scale};
 }
 function windowDiagram(wide,availableWidth){
  const width=Math.max(360,availableWidth),step=Math.min(12,(width-128)/26);
  const sequenceWidth=26*step+8,x=(width-sequenceWidth)/2;
  const barX=32,barY=45,proteinScale=(width-64)/TFULL;
  const spanX=barX+(TOFF-1)*proteinScale,spanW=ct.length*proteinScale;
  let windows=text(width/2,18,copy('input.target',[TNAME,TFULL]),'method-center method-label method-extraction-title')+
   '<g class="method-extraction-protein" data-length="'+TFULL+'" data-start="'+TOFF+'" data-end="'+(TOFF+ct.length-1)+'">'+
   rect(barX,barY,TFULL*proteinScale,10,'method-track')+
   rect(spanX,barY,spanW,10,'method-context')+'</g>'+
   text(barX,barY+26,'1','method-coordinate')+
   text(barX+TFULL*proteinScale,barY+26,String(TFULL),'method-end method-coordinate')+
   '<path class="method-pair-line" d="M'+(spanX+spanW/2)+','+(barY+12)+' V84 L'+(width/2)+',94"/>'+
   text(width/2,112,copy('windows.excerpt'),'method-center method-label')+
   '<g class="method-extraction-sequence">'+
   text(x-12,132,String(TOFF),'method-end method-coordinate')+
   letters(ct,x,132,{step})+
   text(x+sequenceWidth+12,132,String(TOFF+ct.length-1),'method-coordinate')+'</g>'+
   text(width/2,165,copy('windows.walk'),'method-center method-label')+
   text(x-12,188,copy('windows.core-start'),'method-end method-coordinate')+
   text(x+sequenceWidth+12,188,copy('windows.core-end'),'method-coordinate');
  for(let start=0;start<=ct.length-9;start++){
   const y=210+start*24;
   windows+='<g class="method-window-slice" data-start="'+(TOFF+start)+'" data-end="'+(TOFF+start+8)+'">';
   if(start===q-1)windows+=rect(x-5,y-17,sequenceWidth+10,23,'method-selected-row');
   windows+=rect(x+start*step-3,y-14,8*step+11,18,'method-window-core');
   windows+=text(x-12,y,String(TOFF+start),'method-end method-coordinate method-window-coordinate')+
    text(x+sequenceWidth+12,y,String(TOFF+start+8),'method-coordinate method-window-coordinate');
   for(let i=0;i<ct.length;i++)windows+=text(x+i*step,y,ct[i],
    'method-aa '+(i>=start&&i<start+9?'method-window-active':'method-aa-absent'));
   windows+='</g>';
  }
  windows+=text(width/2,676,copy('windows.step'),'method-center method-coordinate');
  return {svg:windows,width,height:698};
 }
 panel(2,copy('panel2.title'),'',
  copy('panel2.equation',[T.length,targetWindows,P.length,parentWindows,candidatePairs.toLocaleString('en-US')]),
  copy('panel2.caption'));
 responsivePanel(2,windowDiagram,true);
 // Derive display patterns from the retained aligned examples, without searching.
 function peptideField(wide){
  const width=wide?680:400,groups=[54,376,329].map(start=>({
   start,rows:(start===376?[...saved.mappingRows.slice(1),saved.mappingRows[0]]:
    saved.fieldRows.filter(row=>row.targetStart===start)).filter(row=>row.parentAccession!=='P33871')
  }));
  const maxPatterns=Math.max(...groups.map(group=>group.rows.length));
  let mobileTop=38,bottom=0;
  let diagram=text(width/2,18,copy('field.target-title'),'method-center method-label');
  function pattern(row,cx,y){
   const mask=Array.from(row.targetCore,(aa,i)=>aa===row.parentCore[i]?aa:'*').join('');
   let drawing='<g class="method-field-pattern" data-target="'+row.targetStart+
    '" data-parent="'+row.parentStart+'" data-accession="'+escapeText(row.parentAccession)+'" data-mask="'+mask+'">';
   Array.from(mask).forEach((symbol,i)=>{
    const x=cx-44+i*12;
    drawing+='<g class="method-pattern-slot" data-position="'+(i+1)+'" data-required="'+(symbol!=='*')+'">'+
     (symbol==='*'?wildcard(x,y-4):text(x,y,symbol,'method-aa method-aa-match method-center'))+'</g>';
   });
   return drawing+'</g>';
  }
  groups.forEach(({start,rows},index)=>{
   const groupX=wide?index*(width/3):0,top=wide?38:mobileTop;
   const gw=wide?width/3:width,cx=groupX+gw/2;
   const cardsTop=top+(wide?92+maxPatterns*26:132);
   const groupBottom=cardsTop+(wide?rows.length-1:Math.ceil(rows.length/2)-1)*(wide?98:136)+90;
   mobileTop=groupBottom+38;bottom=Math.max(bottom,groupBottom);
   diagram+='<g class="method-field-group" data-target="'+start+'">'+
    text(cx,top+17,copy('field.target-range',[start,start+8]),'method-center method-coordinate')+
    letters(rows[0].targetCore,cx-48,top+44)+line(cx-49,top+50,cx+57,top+50,'method-core-underline')+
    text(cx,top+76,copy('motif.title'),'method-center method-coordinate');
   rows.forEach((row,j)=>{
    const selected=row.parentAccession==='P03211'&&row.targetStart===376&&row.parentStart===392;
    const x=wide?groupX+22:8+(j%2)*200,y=cardsTop+(wide?j*98:Math.floor(j/2)*136),w=wide?gw-28:184;
    const patternX=wide?cx:x+w/2,patternY=wide?top+104+j*26:y-16;
    diagram+=pattern(row,patternX,patternY);
    const label=row.parentLabel.split(' | ')[0].split(' (')[0],limit=Math.floor((w-24)/6);
    const short=label.length>limit?label.slice(0,limit-1)+'…':label;
    let remaining=row.organism.replace(/\s+/g,' ').trim();const organism=[];
    for(let lineIndex=0;lineIndex<2&&remaining;lineIndex++){
     if(remaining.length<=limit){organism.push(remaining);break;}
     if(lineIndex===1){organism.push(remaining.slice(0,limit-1)+'…');break;}
     const space=remaining.lastIndexOf(' ',limit),cut=space>limit/2?space:limit;
     organism.push(remaining.slice(0,cut));remaining=remaining.slice(cut).trim();
    }
    // Each pattern connects to its own card; desktop links use the side gutter.
    const branch=groupX+5+j*4;
    diagram+=wide?'<path class="method-map-link" d="M'+(cx-58)+','+(patternY-4)+' H'+branch+' V'+(y+49)+' H'+(x-3)+' M'+(x-7)+','+(y+45)+' L'+(x-3)+','+(y+49)+' L'+(x-7)+','+(y+53)+'"/>':
     '<path class="method-map-link" d="M'+patternX+','+(patternY+4)+' V'+(y-4)+' M'+(patternX-4)+','+(y-8)+' L'+patternX+','+(y-4)+' L'+(patternX+4)+','+(y-8)+'"/>';
    diagram+='<g class="method-field-pair" data-target="'+row.targetStart+'" data-parent="'+row.parentStart+'" data-accession="'+escapeText(row.parentAccession)+'">'+
     rect(x,y,w,90,selected?'method-selected-row method-selected-parent':'method-track')+
     text(x+10,y+17,escapeText(row.parentAccession),'method-label')+
     text(x+w-10,y+17,copy('windows.range',[row.parentStart,row.parentStart+8])+' · '+row.identity+'/9','method-end method-card-note method-card-position')+
     text(x+10,y+33,escapeText(short),'method-card-note')+
     organism.map((part,i)=>text(x+10,y+47+i*12,escapeText(part),'method-card-organism')).join('')+
     letters(row.parentCore,x+w/2-48,y+79,{reference:row.targetCore})+'</g>';
   });
   diagram+='</g>';
  });
  return {width,height:bottom+18,svg:diagram};
 }
 panel(4,copy('panel4.title'),'',copy('panel4.equation'),copy('panel4.caption'));
 responsivePanel(4,peptideField);
 const contextMatches=Array.from(ct).filter((aa,i)=>aa===cp[i]&&aa!=='–').length;
 panel(3,copy('panel3.title'),'',
  copy('panel3.equation',[contextMatches]),
  copy('panel3.caption',[tp(q),tp(q+8),pp(p),pp(p+8)]));
 responsivePanel(3,inputDiagram);
 const full=saved.fullPair;
 const fullTarget=coverage.measure(full.pairs.map(row=>row[0]),full.targetLength),
  fullParent=coverage.measure(full.pairs.map(row=>row[1]),full.parentLength);
 if(fullTarget.coveredResidues!==full.targetCovered||fullParent.coveredResidues!==full.parentCovered)
  throw new Error('Saved full-record coverage does not agree with exported coordinates');
 function fullCoverageDiagram(wide){
  const width=wide?680:400,x0=104,scale=(width-x0-16)/full.parentLength;
  const heading=copy('coverage.full-title'),headingBreak=heading.search(/9-?mer/),headingOffset=wide?0:20;
  let drawing=wide?text(width/2,18,heading,'method-center method-label'):
   text(width/2,18,heading.slice(0,headingBreak).trim(),'method-center method-label')+text(width/2,36,heading.slice(headingBreak),'method-center method-label');
  drawing+='<g transform="translate(0,'+headingOffset+')">';
  for(const [name,length,y,m,key]of [
   ['HEPACAM',full.targetLength,76,fullTarget,'coverage.target-fraction'],
   ['EBNA1',full.parentLength,202,fullParent,'coverage.parent-fraction']]){
   drawing+=text(10,y+10,name,'method-label')+text(10,y+30,length+' AA','method-coordinate')+
    '<g class="method-full-record" data-length="'+length+'" data-covered="'+m.coveredResidues+'">'+
    rect(x0,y,length*scale,12,'method-track');
   for(const [start,end]of m.intervals)drawing+=rect(x0+(start-1)*scale,y,(end-start+1)*scale,12,'method-match');
   drawing+='</g>';
   const startIndex=name==='HEPACAM'?0:1;
   const starts=[...new Set(full.pairs.map(row=>row[startIndex]))].sort((a,b)=>a-b);
   const low=x0+12,high=width-20,gap=28,perLane=Math.floor((high-low)/gap)+1;
   for(let offset=0;offset<starts.length;offset+=perLane){
    const lane=starts.slice(offset,offset+perLane),laneY=y-14-Math.floor(offset/perLane)*17;
    const labelXs=lane.map(start=>x0+(start-1)*scale);
    for(let i=0;i<labelXs.length;i++)labelXs[i]=Math.max(low,labelXs[i],i?labelXs[i-1]+gap:low);
    for(let i=labelXs.length-1;i>=0;i--)labelXs[i]=Math.min(high,labelXs[i],i<labelXs.length-1?labelXs[i+1]-gap:high);
    lane.forEach((start,i)=>{
     const siteX=x0+(start-1)*scale;
     drawing+='<g class="method-coverage-start" data-protein="'+name+'" data-start="'+start+'">'+
      text(labelXs[i],laneY,String(start),'method-center method-coordinate')+
      line(labelXs[i],laneY+4,siteX,y-2,'method-pair-line')+'</g>';
    });
   }
   drawing+=text(x0,y+30,'1','method-coordinate')+
    text(x0+length*scale,y+30,String(length),'method-end method-coordinate')+
    text(width/2,y+58,copy(key,[m.coveredResidues,length,m.percent.toFixed(1)]),'method-center method-mono-note');
  }
  const columns=wide?4:2,cellWidth=width/columns,miniScale=.6,rowPitch=44;
  full.logoRows.forEach((row,index)=>{
   const left=(index%columns)*cellWidth,top=288+Math.floor(index/columns)*rowPitch;
   drawing+='<g class="method-mini-pair" data-target="'+row.targetStart+'" data-parent="'+row.parentStart+'">'+
    text(left+cellWidth/2-40,top+14,String(row.targetStart),'method-end method-coordinate method-mini-target-start')+
    text(left+cellWidth/2-40,top+26,String(row.parentStart),'method-end method-coordinate method-mini-parent-start')+
    text(left+cellWidth/2+40,top+14,String(row.targetStart+8),'method-coordinate method-mini-target-end')+
    text(left+cellWidth/2+40,top+26,String(row.parentStart+8),'method-coordinate method-mini-parent-end')+
    '<g class="method-mini-logo" transform="translate('+(left+cellWidth/2-32.4)+','+(top+4)+') scale('+miniScale+')">'+
    mergedLogo(row.targetCore,row.parentCore,i=>i*12,40)+'</g></g>';
  });
  return {width,height:288+headingOffset+Math.ceil(full.logoRows.length/columns)*rowPitch,svg:drawing+'</g>'};

 }
 panel(1,copy('panel1.title'),'',copy('panel1.equation'),
  copy('panel1.caption',[full.pairs.length,full.logoRows.length]));
 responsivePanel(1,fullCoverageDiagram);
 // The key sits with each logo example; it is not a user-editable palette.
 for(const diagram of host.querySelectorAll('.method-diagram')){
  if(!diagram.querySelector('.method-logo'))continue;
  const legend=document.createElement('div');legend.className='method-logo-key';
  legend.setAttribute('role','group');legend.setAttribute('aria-label','Amino-acid colors');
  for(const category of [...new Set(Object.values(AA_CATEGORY))]){
   const item=document.createElement('span'),letters=document.createElement('b');
   letters.textContent=Object.keys(AA_CATEGORY).filter(aa=>AA_CATEGORY[aa]===category).join('');
   letters.style.color='var(--c-logo-'+category+')';
   item.append(letters,' '+category[0].toUpperCase()+category.slice(1));legend.append(item);
  }
  diagram.append(legend);
 }
 /* Measure once now, and again when the webfont has actually arrived: a glyph measured against
    the fallback face has a different ink box, which leaves the column short and the stack
    overlapping once the real face swaps in. */
 calibrateLogo(host);
 if(document.fonts&&document.fonts.ready)document.fonts.ready.then(()=>calibrateLogo(host));
 // Keep diagram type at the same screen size when the SVG drawing area expands.
 // Logo glyphs use their own explicit visible-ink sizing and are not normalized here.
 function normalizeDiagramType(svg){
  const renderedWidth=svg.getBoundingClientRect().width;
  if(renderedWidth)svg.style.setProperty('--method-type-scale',String(svg.viewBox.baseVal.width/renderedWidth));
 }
 const typeObserver=new ResizeObserver(entries=>entries.forEach(({target:svg})=>normalizeDiagramType(svg)));
 for(const svg of host.querySelectorAll('.method-diagram svg')){normalizeDiagramType(svg);typeObserver.observe(svg);}
 window.MimicryMethodExamples=Object.freeze({target,parent,targetSequence:T,parentSequence:P,pairs,selected,
  fullTarget,fullParent,
  coreMatches:selected[2],contextMatches,floor:FLOOR,targetOffset:TOFF,parentOffset:POFF,
  availableContext:Array.from(cp).filter(aa=>aa!=='–').length});
})();
