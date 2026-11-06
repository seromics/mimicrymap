// Ontology evidence keeps its own encodings while sharing Serome presentation.
const FIGURE_FONT='Inter, system-ui, sans-serif';
const textMeasure=document.createElement('canvas').getContext('2d');
function plotMeasure(value,size,weight=400){textMeasure.font=`${weight} ${size}px Inter`;return textMeasure.measureText(value).width;}
function plotWrap(value,width,size,weight=400){
 const lines=[];let line='';
 for(const word of value.split(/\s+/)){const next=line?line+' '+word:word;if(line&&plotMeasure(next,size,weight)>width){lines.push(line);line=word}else line=next;}
 if(line)lines.push(line);return lines;
}
function displayTerm(i){return Object.values(D.aspects).find(a=>a.root===i)?.label||node(i).label;}
function ontologyGeometry(tree){
 const inner=182.5,outer=475.5,step=(outer-inner)/tree.maxDepth,items=[],leaves=[],innerLabels=[];
 function visit(t,parent){
  if(t.depth){
   const pad=Math.min(.003,(t.hi-t.lo)*.06),lo=t.lo+pad,hi=t.hi-pad;
   const n={...t,key:String(items.length),name:displayTerm(t.i),rank:t.children.length?'family':'member',
    start:lo,end:hi,r0:inner+(t.depth-1)*step+2,r1:t.children.length?inner+t.depth*step-2:outer,
    radius:outer,portStart:lo,step:(hi-lo)/node(t.i).proteins.length,members:node(t.i).proteins,parent};
   n.labelOuter=n.r1-2;items.push(n);if(!t.children.length)leaves.push(n);parent=n;
  }
  for(const child of t.children)visit(child,parent);
 }
 visit(tree,null);
 for(let depth=1;depth<tree.maxDepth;depth++){
  const ring=items.filter(n=>n.depth===depth&&n.children.length).map(n=>({...n,radius:n.labelOuter-47}));
  innerLabels.push(...SeromeStyle.antigenFlowInnerLabels(ring,plotMeasure));
 }
 const layout=SeromeStyle.antigenFlowLabels(leaves,plotMeasure),byKey=new Map(items.map(n=>[n.key,n]));
 // GO term names are preserved verbatim; parenthesized qualifiers are meaningful.
 const labels=layout.labels.map(n=>({...n,text:byKey.get(n.key).name,
  width:plotMeasure(byKey.get(n.key).name,9,700)+plotMeasure(' | BH 9.9e−300 · 80/80',9)}));
 const bounds={left:-560,right:560,top:-560,bottom:560};
 for(const n of labels)for(const r of [n.radius,n.radius+n.width]){
  const x=r*Math.cos(n.angle),y=r*Math.sin(n.angle);
  bounds.left=Math.min(bounds.left,x-12);bounds.right=Math.max(bounds.right,x+12);
  bounds.top=Math.min(bounds.top,y-12);bounds.bottom=Math.max(bounds.bottom,y+12);
 }
 return {items,labels,innerLabels,byKey,bounds,outer};
}
function centerLegend(g,sc,tree){
 const p=palette(),rows=[];let y=0;
 const line=(value,size=10,lineHeight=16,title=false)=>{
  for(const text of plotWrap(value,title?260:280,size,title?600:400)){rows.push({text,size,title,y:y+lineHeight/2});y+=lineHeight;}
 };
 line(`${sc.label} · Human Ontology`,18,22,true);y+=6;
 line(`${displayTerm(tree.i)} · ${$('assay').selectedOptions[0].textContent}`,11,15);
 line(`≥${D.identity}/9 · ≥${D.coverage}% Assay Coverage`,11,15);
 line(`${sc.indices.length} ${sc.indices.length===1?'Sample':'Samples'}`);y+=12;
 rows.push({kind:'ramp',y:y+4});y+=33;
 line('Mean Mapped Hit Fraction');y+=8;
 rows.push({kind:'support',y:y+6});y+=20;
 line(sc.indices.length===1?'BH: Sample BH':'Support: Samples with BH < 0.01');
 line('Spikes: Protein Hit Fraction (0–100%)');
 const group=el('g',{transform:`translate(0,${-y/2})`,'text-anchor':'middle','dominant-baseline':'central'});g.append(group);
 for(const row of rows){
  if(row.kind==='ramp'){
   const width=150;for(let k=0;k<100;k++)group.append(el('rect',{x:-width/2+k*width/100,y:row.y-4,width:width/100+.1,height:8,fill:color(k/99*Number($('color-max').value))}));
   txt(group,-width/2,row.y+16,'0',9,{'text-anchor':'start',fill:p.muted});
   txt(group,width/2,row.y+16,'≥'+pct(Number($('color-max').value)),9,{'text-anchor':'end',fill:p.muted});
  }else if(row.kind==='support'){
   const label=sc.indices.length===1?'Sample BH < 0.01':'≥1 Sample BH < 0.01',width=20+plotMeasure(label,10),x=-width/2;
   group.append(el('line',{x1:x,y1:row.y,x2:x+12,y2:row.y,stroke:p.blue,'stroke-width':2.4}));
   txt(group,x+20,row.y,label,10,{'text-anchor':'start',fill:p.muted});
  }else txt(group,0,row.y,row.text,row.size,{'font-weight':row.title?600:400,fill:row.title?p.ink:p.muted});
 }
}
function ontologyPanel(svg,sc,tree,geometry,offsetX,width,height,panelIndex){
 const p=palette(),{items,labels,innerLabels,byKey,bounds}=geometry,cx=width/2,cy=14-bounds.top;
 const panel=el('g',{transform:`translate(${offsetX},0)`,'data-panel-label':sc.label});svg.append(panel);
 panel.append(el('rect',{width,height,fill:p.bg}));const g=el('g',{transform:`translate(${cx},${cy})`});panel.append(g);
 const arc=SeromeStyle.fingerprintArc,band=SeromeStyle.fingerprintBand,xy=(r,a)=>[r*Math.cos(a),r*Math.sin(a)];
 const signals=new Map(items.map(n=>[n.key,signal(n.i,sc)]));
 for(const n of items){
  const d=signals.get(n.key),path=el('path',{d:band(n.r0,n.r1,n.start,n.end),fill:color(d.f),stroke:p.bg,'stroke-width':1.2,class:'node','data-term':node(n.i).id});
  path.append(el('title',{},`${n.name} · ${node(n.i).id}\n${node(n.i).proteins.length} reference proteins\n${d.h}/${d.n} hit/observed antigen–sample calls\n${d.supported}/${d.count} samples with BH < 0.01`));path.onclick=()=>focus(n.i);g.append(path);
  if(n.rank==='member')for(let k=0;k<n.members.length;k++){
   const fraction=proteinSignal(n.members[k],sc),angle=n.portStart+(k+.5)*n.step,a=xy(n.radius+18,angle),b=xy(n.radius+18+.65+28*fraction,angle);
   g.append(el('line',{x1:a[0],y1:a[1],x2:b[0],y2:b[1],stroke:color(fraction),'stroke-width':.55}));
  }
 }
 // Thin support arcs follow the same label-edge placement as viral Serome.
 for(const n of items.filter(n=>n.rank!=='member')){
  const d=signals.get(n.key);g.append(el('path',{d:arc(n.labelOuter+5,n.start,n.end),fill:'none',stroke:p.muted,'stroke-width':.55}));
  if(d.supported)g.append(el('path',{d:arc(n.labelOuter+1,n.start,n.end),fill:'none',stroke:p.blue,'stroke-width':2.4}));
 }
 for(const n of labels){const t=byKey.get(n.key),d=signals.get(n.key);
  g.append(el('path',{d:arc(n.barRadius,t.start,t.end),fill:'none',stroke:p.muted,'stroke-width':1}));
  if(d.supported)g.append(el('path',{d:arc(n.supportRadius,t.start,t.end),fill:'none',stroke:p.blue,'stroke-width':2.4}));
 }
 if($('labels').checked){
  for(const [index,n]of innerLabels.entries()){
   const t=byKey.get(n.key),d=signals.get(n.key),ink=d.supported?p.ink:p.muted;
   if(n.callout)g.append(el('path',{d:SeromeStyle.antigenFlowLabelLeader(n,t),fill:'none',stroke:ink,'stroke-width':.55}));
   for(const [j,line]of n.lines.entries()){
    const {reverseArc}=SeromeStyle.antigenFlowTextFacing(n.angle),r=n.radius+n.fontSize*.33+(reverseArc?j:n.lines.length-1-j)*SeromeStyle.antigenFlowInnerLineHeight,half=(n.width+10)/r/2,mask=(n.width+2)/r/2,direction=reverseArc?-1:1,id=`go-arc-${panelIndex}-${index}-${j}`;
    g.append(el('path',{d:band(r-n.fontSize*.65,r+n.fontSize*.65,n.angle-mask,n.angle+mask),fill:p.bg}));
    const defs=el('defs');defs.append(el('path',{id,d:arc(r,n.angle-direction*half,n.angle+direction*half)}));g.append(defs);
    const text=el('text',{'font-family':FIGURE_FONT,'font-size':n.fontSize,'font-weight':700,'text-anchor':'middle','dominant-baseline':'central',fill:ink,'data-inner-label':node(t.i).id});
    text.append(el('textPath',{href:'#'+id,startOffset:'50%'},line));text.onclick=()=>focus(t.i);text.style.cursor='pointer';g.append(text);
   }
  }
  for(const n of labels){
   const t=byKey.get(n.key),d=signals.get(n.key),{left}=SeromeStyle.antigenFlowTextFacing(n.angle),ink=d.supported?p.ink:p.muted;
   if(n.callout)g.append(el('path',{d:`M${xy(n.barRadius,n.anchor)}L${xy(n.radius-3,n.angle)}`,fill:'none',stroke:ink,'stroke-width':.5}));
   const labelGroup=el('g',{transform:`rotate(${n.angle*180/Math.PI+(left?180:0)})`});g.append(labelGroup);
   const text=el('text',{x:left?-n.radius:n.radius,'text-anchor':left?'end':'start','dominant-baseline':'central','font-family':FIGURE_FONT,'font-size':9,fill:ink,'data-label':node(t.i).id});
   text.append(el('tspan',{'font-weight':700},n.text));
   text.append(el('tspan',{fill:p.muted},' | '));
   const suffix=sc.indices.length===1?'BH '+fmt(d.q):`${d.supported}/${d.count}`;
   text.append(el('tspan',{fill:d.supported?p.blue:p.muted},suffix));text.onclick=()=>focus(t.i);text.style.cursor='pointer';labelGroup.append(text);
  }
 }
 centerLegend(g,sc,tree);
}
function caption(){
 const focused=S.focus==null?'broad GO branches and generic GO slim':displayTerm(S.focus)+' and its immediate children';
 return `${D.study} · ${$('assay').selectedOptions[0].textContent} · ${focused}. Bands show mean mapped-antigen hit fraction; outer spikes show protein-level mapped hit fraction. Blue arcs mark terms supported in at least one selected sample (BH < 0.01). Names remain bold and turn gray when unsupported. Repeated branches share the same evidence.`;
}
function buildFigure(mode){
 const previous=S.figureMode;S.figureMode=mode;
 try{
  const p=palette(),tree=makeHierarchy(),geometry=ontologyGeometry(tree),ss=scopes(),bounds=geometry.bounds,W=2*(Math.max(-bounds.left,bounds.right)+14),H=bounds.bottom-bounds.top+28;
  const svg=el('svg',{xmlns:NS,width:W*ss.length,height:H,viewBox:`0 0 ${W*ss.length} ${H}`,'font-family':FIGURE_FONT});
  svg.append(el('style',{},SEROME_FONT_CSS));svg.append(el('rect',{width:W*ss.length,height:H,fill:p.bg}));svg.append(el('desc',{},caption()));
  for(const [k,sc]of ss.entries())ontologyPanel(svg,sc,tree,geometry,k*W,W,H,k);
  return {svg,visible:[...new Set(geometry.items.map(n=>n.i))]};
 }finally{S.figureMode=previous;}
}
function draw(){
 const p=palette();for(const [k,v]of Object.entries(p))document.body.style.setProperty('--'+k,v);
 const figure=buildFigure();S.svg=figure.svg;S.visible=figure.visible;$('figure').replaceChildren(S.svg);
 // Preserve authored glyph sizes when two panels exceed the window width.
 S.svg.style.minWidth=Math.min(1500*scopes().length,Number(S.svg.getAttribute('width')))+'px';
 $('scope2').classList.toggle('hidden',!$('compare').checked);$('title').textContent=S.focus==null?D.aspects[$('aspect').value].label+' · Ontology Overview':displayTerm(S.focus);
 $('legend').textContent=caption();$('home').disabled=S.focus==null;inspector();table();
}
