/* Shared presentation registry. No analysis, identity or cache keys depend on it.
 * Universal script: React, Electron, native MimicryMap and offline renderers
 * consume the same definitions. Thresholds and interpolation positions belong
 * to the figure's scientific scale; settings change colors only. */
(function(root,factory){
  const api=root.SeroMapPlotPalette||factory();root.SeroMapPlotPalette=api;
  if(typeof module==='object'&&module.exports)module.exports=api;
})(typeof globalThis==='object'?globalThis:this,function(){
 'use strict';
 const schema=3, definitions=Object.create(null), groups=[];
 const add=(group,rows)=>{if(!groups.includes(group))groups.push(group);for(const [key,label,light,dark=light] of rows)definitions[key]={key,label,group,light,dark};};
 add('Direction and study groups',[
  ['up','Case / first group','#C75D50','#E8897E'],
  ['down','Comparison / reference','#5AA0D8','#86CFE0'],
  ['group2','Group / category 3','#1C5D92','#4F93D1'],
  ['group3','Group / category 4','#4E8A5F','#6FB98A'],
  ['group4','Group / category 5','#C0853F','#D6A05A'],
  ['group5','Group / category 6','#80558A','#B784BE'],
  ['group6','Group / category 7','#674832','#8B7448'],
  ['group7','Group / category 8','#7841cc'],['group8','Group / category 9','#4f9638'],['group9','Group / category 10','#cc79a7'],
  ['ns','Unhighlighted / neutral data','#A6AAA6','#8A94A0'],
  ['ctrl','Assay technical control','#C0853F','#D6A05A'],
  ['private','Private reactivity','#0d9488','#2dd4bf'],
  ['good','Positive annotation','#4E8A5F','#6FB98A'],
 ]);
 add('Heatmaps and figure accents',[
  ['rampLo','Signal heatmap · low','#EFEBE0','#101A2A'],
  ['rampHi','Signal heatmap · high','#173F6B','#4F93D1'],
  ['binaryHit','Heatmap called hit','#1C5D92','#4F93D1'],
  ['cellNull','Heatmap neutral / unavailable','#ECE5DA','#131C2B'],
  ['accent','Figure accent','#1C5D92','#4F93D1'],
  ['accentSoft','Selection background','#E5EDF4','#1B3048'],
  ['trackHigh','Numeric metadata · above median','#eab308'],
  ['trackLow','Numeric metadata · below median','#d4d4d8'],
 ]);
 add('Paired and shared reactivity',[
  ['pairedShared','Both timepoints','#770c19'],['pairedStart','Earlier only','#5dade2'],['pairedEnd','Later only','#f39c12'],
  ['publicHigh','Very public','#334155'],['privateSingle','Private, one sample','#99f6e4'],
 ]);
 add('Repertoire and summary',[
  ['repertoireSecreted','Secreted / Plasma','#16A085'],['repertoireMembrane','Membrane','#E67E22'],
  ['repertoireIntracellular','Intracellular','#5DADE2'],['repertoireOther','Other','#566573'],
  ['sharingPublic','Public','#A2AEB7','#5C6875'],
  ['sharingGroup','Group-shared','#1C5D92','#4F93D1'],
  ['sharingShared','Shared (≥2)','#0d9488','#2dd4bf'],
  ['sharingTransient','Transient','#6F7B86','#8A97A4'],
  ['summaryFrequency','Cohort hit-frequency','#1C5D92','#4F93D1'],
 ]);
 add('Assay and sequence tracks',[
  ['assayHuProt','HuProt clone','#4f46e5','#a5a0ff'],['assayHuScan','HuScan','#0d9488','#2dd4bf'],['assayVirScan','VirScan / Exposome','#4f46e5','#a5a0ff'],
  ['seqSelected','Selected assay','#f59e0b'],['seqHover','Hovered assay','#fdba74'],['seqHatch','Synthetic sequence hatch','#94a3b8'],
  ['seqSignal','Signal peptide','#a855f7'],['seqTM','Transmembrane','#f59e0b'],['seqECD','Extracellular','#0ea5e9'],['seqICD','Intracellular','#94a3b8'],
  ['seqActive','Active site','#9333ea'],['seqBinding','Binding site','#0891b2'],
  ['seqPathogenic','Sequence viewer · pathogenic','#d55e00'],['seqUncertain','Uncertain significance','#e69f00'],['seqBenign','Benign','#0072b2'],
  ['seqMissing','Unavailable sequence annotation','#9ca3af'],
 ]);
 const array=(group,prefix,label,values)=>{const keys=values.map((value,index)=>prefix+(index+1));add(group,values.map((value,index)=>[keys[index],label+' '+(index+1),value]));return keys;};
 const categorical=array('Categorical metadata','category','Category',['#0891b2','#d97706','#0f766e','#b45309','#0e7490','#a16207','#155e75','#854d0e','#164e63','#78716c']);
 const subgroup=['up','down',...array('Subgroup comparisons','subgroup','Additional subgroup',['#7c3aed','#0891b2','#b45309','#15803d','#be185d','#4338ca','#a16207','#0f766e'])];
 // The desktop shares one ten-color category/group sequence. Old category and
 // subgroup roles remain readable for website figures and retained snapshots.
 const mainGroups=['up','down',...Array.from({length:8},(_,i)=>'group'+(i+2))];
 const labelAliases=Object.fromEntries([...categorical.map((key,i)=>[key,mainGroups[i]]),...subgroup.slice(2).map((key,i)=>[key,mainGroups[i+2]])]);
 // Categorical parent identity, never an intensity/identity gradient.
 const tiles=array('HuScan parent identity','tile','Parent protein',['#0d9488','#10b981','#0891b2','#16a34a','#0e7490','#15803d','#14b8a6','#059669','#22c55e','#06b6d4','#2dd4bf','#4ade80']);
 const clusters=array('Dendrogram clusters','cluster','Cluster',['#E64B35','#4DBBD5','#00A087','#3C5488','#F39B7F','#8491B4','#91D1C2','#DC0000','#7E6148','#B09C85']);
 tiles[0]='assayHuScan';delete definitions.tile1;
 ['#2dd4bf','#34d399','#22d3ee','#4ade80','#67c8dd','#86d89d','#5eead4','#6ee7b7','#86efac','#67e8f9','#99f6e4','#bbf7d0']
  .forEach((color,index)=>definitions[tiles[index]].dark=color);
 const variantNames=['Missense_Mutation','Nonsense_Mutation','Frame_Shift_Del','Frame_Shift_Ins','Splice_Site','In_Frame_Del','In_Frame_Ins','Nonstop_Mutation','Translation_Start_Site','Silent'];
 const variants=array('Genomic variants','variant','Variant',['#E74C3C','#3498DB','#9B59B6','#E67E22','#F39C12','#1ABC9C','#2ECC71','#34495E','#E91E63','#95A5A6']);
 variants.forEach((key,index)=>definitions[key].label=variantNames[index].replaceAll('_',' '));
 const blosum=array('Substitution scores','blosum','BLOSUM62',['#ef4444','#f97316','#f59e0b','#fbbf24','#94a3b8','#86efac','#34d399','#10b981','#065f46']);
 const viridisSequence=array('Solvent accessibility · sequence viewer','viridisSequence','Gradient stop',['#440154','#3b528b','#21918c','#5ec962','#fde725']);
 const viridisNative=array('Solvent accessibility · MimicryMap','viridisNative','Gradient stop',['#440154','#1f968b','#fde725']);
 const density=array('Mimicry density','density','Gradient stop',['#fce38d','#e7833b','#8a1c26','#64121b']);
 const confidence=array('Structure confidence','confidence','pLDDT band',['#ff7d45','#ffdb13','#65cbf3','#0053d6']);
 const cleavage=array('Cleavage annotation','cleavage','Gradient stop',['#f5f5f5','#fdba6e','#e66d2c','#a52a2a']);
 add('MimicryMap annotations',[
  ['mimicryCore','Selected core','#059669'],['mimicryCoreHover','Hovered core','#047857','#6ee7b7'],['mimicryContext','Selected context','#2563eb'],['mimicryContextHover','Hovered context','#1d4ed8','#93c5fd'],
  ['mimicryIdentity','Window identity','#991b1b'],['mimicryPathogenic','Pathogenic annotation','#b91c1c'],
  ['mimicryECD','Extracellular','#56b4e9'],['mimicryICD','Intracellular','#cc79a7'],['mimicryTM','Transmembrane','#e69f00'],
  ['mimicryUnknown','Unknown annotation','#e5e7eb'],['mimicryMissing','Unavailable annotation','#f3f4f6'],
  ['sequenceMatch','Matching residue','#047857','#34d399'],['sequenceMismatch','Substituted residue','#b91c1c','#f87171'],
  ['sequenceMatchPrint','Matching residue · export','#047857'],['sequenceMismatchPrint','Substituted residue · export','#b91c1c'],
 ]);
 const modificationNames=['Phosphorylation','Acetylation','Methylation','Other acylation','Hydroxylation','ADP-ribosylation','Amidation','Sulfation','Citrullination','Multiple / rare'];
 const modifications=array('Modified residues','modification','Modification',['#b45309','#0369a1','#7c3aed','#be185d','#0f766e','#a21caf','#475569','#a16207','#9f1239','#475569']);
 modifications.forEach((key,index)=>definitions[key].label=modificationNames[index]);
 // Legacy snapshot tokens only; new reports resolve the shared study-group roles.
 const portable=array('Legacy portable cohort groups','portableGroup','Fallback group',['#3C5488','#E64B35','#00A087','#4DBBD5','#F39B7F','#8491B4']);
 add('Figure text and neutral marks',[
  ['ink','Text / axes','#1A2230','#E8EDF2'],['body','Secondary text','#45413B','#C2CCD6'],
  ['muted','Muted text','#6F7B86','#8A97A4'],['faint','Faint marks','#A2AEB7','#5C6875'],
  ['line','Figure border','#CBD2D7','#2A3848'],['surface','Figure surface','#F8F6F1','#141E2E'],
  ['grid','Figure grid','#dcd8d2','#3a4356'],
  ['bg','Figure background','#EFEBE3','#0C1320'],['headerBg','Figure header','#182536','#111C2B'],
  ['goodSoft','Positive annotation background','#E7F0EA','#16301F'],['warnSoft','Warning annotation background','#F6EFE2','#3A2E16'],
  ['imgPlate','Illustration plate','#f4f1ec','#cbd5e1'],['white','Light contrast text','#ffffff'],['black','Dark contrast text','#000000'],
  ['outline','Track outlines','#cbd5e1'],['cellInactive','Inactive cell compartment','#e2e8f0'],
  ['printInk','MimicryMap export text','#111111'],['printBody','MimicryMap export secondary text','#444444'],['printMuted','MimicryMap export muted text','#666666'],['printLine','MimicryMap export lines','#888888'],
 ]);
 add('Residue labels and presentation',[
  ['nativeSurface','MimicryMap unavailable track','#0f172a'],['nativeBackground','MimicryMap capture backdrop','#020617'],
  ['nativeDim','Unmapped structure','#475569'],['nativeFaint','Unclassified annotation','#64748b'],
  ['residueInk','Dark residue letters','#212529'],['identityLight','High-identity label','#fef3c7'],['identityDark','Low-identity label','#1c1917'],
  ['rowShadeA','MimicryMap alternating row 1','#b8ad9e','#1e293b'],['rowShadeB','MimicryMap alternating row 2','#b8ad9e','#0f172a'],
  ['methodMatch','Methods · matching residue','#047857','#6ee7b7'],['methodDifference','Methods · differing residue','#b91c1c','#fca5a5'],
  ['methodContext','Methods · aligned context','#5276ce'],['methodMismatch','Methods · mismatch','#bb4141'],['methodMissing','Methods · unavailable residue','#8a8178'],
  ['contrastInk','Dark annotation label','#161616'],
  ['portableGrid','Portable cohort grid','#D8DCE0'],['portableMissing','Portable cohort missing values','#AEB8C1'],
 ]);
 add('Amino-acid class logos',[
  ['logoHydrophobic','Hydrophobic','#1a1a1a','#e0e0e0'],['logoPolar','Polar','#2ca02c','#66d966'],['logoBasic','Basic','#388b86','#73c4b9'],
  ['logoSerine','Serine','#d96661','#ff9187'],['logoProline','Proline','#c99b00','#e9be24'],['logoGlycine','Glycine','#6a8738','#a7bc6d'],
  ['logoAmide','Amide','#3c87a4','#7eb8cf'],['logoThreonine','Threonine','#cd8b52','#eab181'],['logoHistidine','Histidine','#805e43','#c2a084'],
  ['logoAcidic','Acidic','#d62728','#e06060'],['logoOther','Other','#666666'],
 ]);
 // Shared aliases retain legacy snapshot names without a second host palette.
 const aliases={...labelAliases,binaryHit:'rampHi',viridisNative1:'viridisSequence1',viridisNative2:'viridisSequence3',viridisNative3:'viridisSequence5',
  printInk:'ink',printBody:'body',printMuted:'muted',printLine:'line',
  sequenceMatchPrint:'sequenceMatch',sequenceMismatchPrint:'sequenceMismatch',methodMatch:'sequenceMatch',methodDifference:'sequenceMismatch'};
 const signalKeys=['rampLo','ramp25','rampMid','ramp75','rampHi'];
 add('Heatmaps and figure accents',signalKeys.slice(1,-1).map((key,i)=>[key,'Signal heatmap · '+[25,50,75][i]+'%', '#ffffff']));
 const ramps={signal:{keys:signalKeys,positions:[0,.25,.5,.75,1]},solvent:{keys:viridisSequence,positions:[0,.25,.5,.75,1]},solventNative:{keys:viridisNative,positions:[0,.5,1]},density:{keys:density,positions:[0,.33,.66,1]},cleavage:{keys:cleavage,positions:[0,.33,.66,1]}};
 const bands={confidence:{keys:confidence,thresholds:[50,70,90]}};
 const scaleContracts={
  binaryHit:{kind:'binary',quantity:'Called hit; uses the signal high endpoint, with neutral non-hits',surfaces:'Comparison, clustering and protein hit-call heatmaps'},
  signal:{kind:'continuous',quantity:'Displayed signal; each figure owns its transform and domain',surfaces:'Clustering and protein scanning heatmaps'},
  solvent:{kind:'continuous',quantity:'Relative solvent accessibility, 0–1',surfaces:'Protein sequence viewer and MimicryMap tracks/structures'},
  density:{kind:'continuous',quantity:'Relative mimicry density on the declared track scale',surfaces:'MimicryMap tracks/structures'},
  confidence:{kind:'bands',quantity:'pLDDT; upper band boundaries 50, 70, 90',surfaces:'MimicryMap confidence track/structure'},
  cleavage:{kind:'continuous',quantity:'Cleavage annotation on the declared track scale',surfaces:'MimicryMap cleavage track/structure'},
  tiles:{kind:'categorical',quantity:'HuScan parent-protein identity; repeats after twelve parents',surfaces:'Protein sequence viewer'},
  clusters:{kind:'categorical',quantity:'Assigned dendrogram cluster number',surfaces:'Clustering membership ribbon and numbered legend'},
  blosum:{kind:'discrete',quantity:'BLOSUM62 substitution-score band',surfaces:'Protein alignment viewer'},
 };
 const palettes={groups:mainGroups,clusters,categorical,subgroup,tiles,variants,blosum,modifications,portable};
 // User controls are a deliberate statistical subset of the internal registry.
 // Reference annotations and sequence/structure scales retain authored defaults.
 const settingsGroups=[
  {label:'Groups and categories',note:'Sample plots, timecourses and category labels. Case/Comparison colors also mark direction in volcanoes, panels and correlation plots; named study colors take priority for groups.',keys:[...mainGroups,'ns'],compact:true},
  {label:'Signal heatmaps',note:'Clustering, protein scanning and Jaccard matrices: low to high. Hit-call plots and panels use the high color for hits; non-hits stay neutral.',keys:signalKeys,compact:true},
  {label:'Paired samples',note:'Individual → Paired scatter and paired Admixture: persistent, lost and acquired hits.',keys:['pairedShared','pairedStart','pairedEnd']},
  {label:'Dendrogram clusters',note:'Clustering: membership ribbon and numbered legend. Each palette supplies coordinated cluster colors; individual edits override them.',keys:clusters,compact:true},
  {label:'Repertoire map',note:'Individual → Repertoire map: human protein classes and the Other category.',keys:['repertoireSecreted','repertoireMembrane','repertoireIntracellular','repertoireOther'],compact:true},
  {label:'Admixture',note:'Individual → Admixture: sharing categories. Timepoint colors use Paired samples above.',keys:['publicHigh','sharingPublic','sharingGroup','sharingShared','privateSingle','sharingTransient'],compact:true},
  {label:'Study summary',note:'Summary: cohort hit-frequency histogram, across all platforms.',keys:['summaryFrequency'],compact:true},
 ];
 const settingsKeys=new Set(settingsGroups.flatMap(group=>group.keys));
 const settingsDefinitions=settingsGroups.flatMap(group=>group.keys.map(key=>({...definitions[key],group:group.label,compact:!!group.compact})));
 const variantKeys=Object.fromEntries(variantNames.map((name,index)=>[name,variants[index]]));
 const structural=new Set(['ink','body','muted','faint','line','surface','bg','cellNull']);
 const cssName=key=>'--c-'+key.replace(/([a-z0-9])([A-Z])/g,'$1-$2').replace(/([A-Z])([A-Z][a-z])/g,'$1-$2').toLowerCase();
 const ref=key=>{if(!definitions[key])throw Error('Unknown plot color: '+key);return 'var('+cssName(key)+')';};
 const references=name=>{if(!palettes[name])throw Error('Unknown plot palette');return palettes[name].map(ref);};
 const hex=value=>{if(typeof value!=='string'||!/^#[\da-f]{6}$/i.test(value))throw Error('Use a six-digit hexadecimal color');return value.toLowerCase();};
 // Named presets only affect statistical marks. Stable IDs preserve saved
 // choices; simple display labels and source mappings are documented in the wiki.
 const presets={};
 function preset(id,label,list,roles,signal='blue'){
  const colors={up:roles[0],down:roles[1],group2:roles[2],group3:roles[3],group4:roles[4],group5:roles[5],group6:roles[6]||list[8],ns:'#929292',pairedShared:roles[0],pairedStart:roles[1],pairedEnd:roles[2]};
  const used=new Set(mainGroups.slice(0,7).map(key=>colors[key]));
  const extra=list.filter(color=>!used.has(color));
  mainGroups.slice(7).forEach((key,i)=>colors[key]=extra[i]);
  clusters.forEach((key,i)=>colors[key]=list[i]);
  presets[id]={id,label,colors,signal};
 }
 preset('seromap','SeroMap (default)',
  ['#7841cc','#4f9638','#cc79a7','#8c564b','#66717f','#0072b2','#d55e00','#009988','#e6ab02','#332288'],
  ['#cc3311','#0072b2','#b8860b','#687480','#009988','#332288','#8c564b']);
 preset('nature','Natural',
  ['#7241b9','#469049','#cc79a7','#7e6148','#b09c85','#3c5488','#e64b35','#00a087','#4dbbd5','#91d1c2'],
  ['#e64b35','#3c5488','#c59322','#8491b4','#00a087','#7e6148','#4dbbd5']);
 preset('science','Scientific',
  ['#9732c9','#008b45','#a20056','#631879','#808180','#3b4992','#ee0000','#008280','#bb0021','#1b1919'],
  ['#ee0000','#3b4992','#b28a13','#808180','#008280','#a20056','#631879']);
 preset('cell','Cellular',
  ['#8743d4','#4daf4a','#f781bf','#a65628','#999999','#377eb8','#e41a1c','#ff7f00','#ffff33','#984ea3'],
  ['#e41a1c','#377eb8','#ff7f00','#999999','#4daf4a','#984ea3','#a65628']);
 preset('bbc','Broadcast',
  ['#663399','#588300','#df4b8f','#734c29','#faab18','#1380a1','#990000','#009b7f','#59b9d4','#333333'],
  ['#990000','#1380a1','#faab18','#333333','#588300','#663399','#734c29']);
 // Published qualitative colors, reordered for comparison roles. The cluster
 // companion starts away from the first three group colors. Never interpolate
 // these finite palettes: later slots repeat with hatching in categorical figures.
 // Sources: Okabe & Ito https://jfly.uni-koeln.de/color/
 // Paul Tol https://sronpersonalpages.nl/~pault/ (Bright / Muted).
 function publishedPreset(id,label,roles,clusterOrder){
  const colors={ns:'#929292',pairedShared:roles[0],pairedStart:roles[1],pairedEnd:roles[2]};
  mainGroups.forEach((key,i)=>colors[key]=roles[i%roles.length]);
  clusters.forEach((key,i)=>colors[key]=roles[clusterOrder[i%roles.length]]);
  presets[id]={id,label,colors,signal:'blue',sourceCount:roles.length};
 }
 publishedPreset('okabe-ito','Okabe–Ito',
  ['#d55e00','#0072b2','#e69f00','#cc79a7','#009e73','#000000','#56b4e9','#f0e442'],
  [3,4,7,6,5,0,1,2]);
 publishedPreset('tol-bright','Tol Bright',
  ['#ee6677','#4477aa','#ccbb44','#aa3377','#228833','#66ccee','#bbbbbb'],
  [3,4,6,5,2,0,1]);
 publishedPreset('tol-muted','Tol Muted',
  ['#cc6677','#332288','#ddcc77','#117733','#aa4499','#88ccee','#999933','#882255','#44aa99'],
  [4,3,5,6,7,8,0,1,2]);
 // Flame/Greens/Purples/Grays sample stops 1,3,5,7,9 of ColorBrewer's
 // nine-color YlOrRd/Greens/Purples/Greys scales. Designs by Cynthia Brewer.
 // https://github.com/axismaps/colorbrewer (Apache-2.0; desktop/assets/licenses).
 // Dark versions derive contrast from these same colors, without extra settings.
 const signalSchemes={
  blue:{id:'blue',label:'SeroMap (default)',stops:['#efebe0','#b9c0c3','#8395a6','#4d6a88','#173f6b']},
  flame:{id:'flame',label:'Flame',dark:'adaptive',stops:['#ffffcc','#fed976','#fd8d3c','#e31a1c','#800026']},
  greens:{id:'greens',label:'Greens',dark:'adaptive',stops:['#f7fcf5','#c7e9c0','#74c476','#238b45','#00441b']},
  purples:{id:'purples',label:'Purples',dark:'adaptive',stops:['#fcfbfd','#dadaeb','#9e9ac8','#6a51a3','#3f007d']},
  grays:{id:'grays',label:'Grays',dark:'adaptive',stops:['#ffffff','#d9d9d9','#969696','#525252','#000000']},
  viridis:{id:'viridis',label:'Viridis',stops:['#440154','#3b528b','#21918c','#5ec962','#fde725']},
  plasma:{id:'plasma',label:'Plasma',stops:['#0d0887','#7e03a8','#cc4778','#f89540','#f0f921']},
 };
 // These are label/display conventions only; never used for analysis or cohort
 // membership. HCC is deliberately not treated as HC.
 const controlPatterns=[/^(no[_-]?|non[_-]?|without[_-]?|anti[_-]?)/i,/^(ctl|ctrl|control|healthy|hc|hp|hd|nc)$/i,/^healthy[_-]?control$/i,/^normal$/i,/^baseline$/i,/^(reference|ref)$/i,/^(untreated|naive|pretreatment|pre[_-]?treatment)$/i,/^(negative|neg|absent|none|missing)$/i,/(_no|_none|_neg|_negative|_absent)$/i,/(_control|_ctl|_ctrl|_healthy|_hc|_hp|_hd|_normal|_baseline|_ref|_reference)$/i,/^remission$/i,/(remission|inactive)$/i,/(_remission|_inactive|_resolved|_recovered|_cured)$/i];
 const isControlGroup=name=>name!=null&&controlPatterns.some(re=>re.test(String(name).trim()));
 const groupName=(study,name)=>{const s=String(name).trim(),prefix=String(study)+'_';return s.toLowerCase().startsWith(prefix.toLowerCase())?s.slice(prefix.length):s;};
 const studyDefaults={Iwasaki:{HC:'down',CVC:'group2',LC:'up'}};
 const groupKey=name=>'studyGroup_'+Array.from(String(name).trim()).map(c=>c.codePointAt(0).toString(16)).join('_');
 // Label-derived variable names remain stable through filtering and reordering.
 // The fallback covers comparison labels such as "rest of cohort" before/without
 // a registered primary-group match. No React redraw or new analysis is needed.
 function studyGroupRef(name,fallback){return 'var('+cssName(groupKey(name))+', '+fallback+')';}
 function studyGroupRoles(study,names){
  let next=0;const roles=Object.create(null),builtIn=Object.hasOwn(studyDefaults,study)?studyDefaults[study]:{},available=mainGroups.filter(key=>key!=='down');
  for(const name of names||[]){const clean=groupName(study,name);if(Object.hasOwn(roles,clean))continue;roles[clean]=Object.hasOwn(builtIn,clean)?builtIn[clean]:(isControlGroup(name)?'down':available[next++%available.length]);}
  return roles;
 }
 const record=(value,message)=>{if(!value||typeof value!=='object'||Array.isArray(value))throw Error(message);return value;};
 function colorEntries(value,groupColors=false){
  const result={};for(const [key,color] of Object.entries(record(value??{},'Invalid plot colors'))){
   if(groupColors){if(!key.trim()||key.length>256||['__proto__','constructor','prototype'].includes(key))throw Error('Invalid study group');}
   else if(!Object.hasOwn(definitions,key))throw Error('Unknown plot color: '+key);
   result[key]=hex(color);
  }return result;
 }
 function selection(value,key,choices){if(value[key]==null)return {};if(!Object.hasOwn(choices,value[key]))throw Error('Unknown '+key);return {[key]:value[key]};}
 function validate(value){
  if(value==null)return {schema,colors:{},studies:{}};
  if(typeof value!=='object'||Array.isArray(value)||![1,2,schema].includes(value.schema))throw Error('Unsupported plot palette');
  const result={schema,...selection(value,'preset',presets),...selection(value,'signal',signalSchemes),colors:value.schema===1?{...colorEntries(value.dark),...colorEntries(value.export),...colorEntries(value.light)}:colorEntries(value.colors),studies:{}};
  for(const [study,entry] of Object.entries(record(value.studies??{},'Invalid study palettes'))){
   if(!/^[A-Za-z0-9_.-]{1,120}$/.test(study)||['__proto__','constructor','prototype'].includes(study))throw Error('Invalid study palette');
   record(entry,'Invalid study palette');const groups=colorEntries(entry.groups,true);if(Object.keys(groups).length>128)throw Error('At most 128 study group colors');
   result.studies[study]={...selection(entry,'preset',presets),...selection(entry,'signal',signalSchemes),colors:colorEntries(entry.colors),groups};
  }
  if(Object.keys(result.studies).length>500)throw Error('Too many study palettes');return result;
 }
 function userOverrides(value){
  const result=validate(value);result.preset??='seromap';
  for(const scope of [result,...Object.values(result.studies)]){
   // Explicit main colors win over category edits when the two are merged.
   // Retired subgroup edits were unused by the neutral comparison-label renderer.
   for(const old of categorical){const key=labelAliases[old];if(scope.colors[old]&&!scope.colors[key])scope.colors[key]=scope.colors[old];}
   for(const key of Object.keys(scope.colors))if(!settingsKeys.has(key))delete scope.colors[key];
  }
  return result;
 }
 let configuration={brand:'seromap',overrides:validate(null),study:'',studyGroups:[]},cache=new Map();
 function configure(value={}){configuration={...configuration,brand:'seromap',overrides:value.overrides===undefined?configuration.overrides:validate(value.overrides),study:value.study===undefined?configuration.study:String(value.study||''),studyGroups:value.studyGroups===undefined?configuration.studyGroups:[...new Set((value.studyGroups||[]).map(String))]};cache.clear();return snapshot();}
 function snapshot(){return JSON.parse(JSON.stringify(configuration));}
 const mode=()=>typeof document==='object'&&document.documentElement.classList.contains('dark')?'dark':'light';
 function effective(overrides,study){
  const local=overrides.studies[study]||{},chosen=local.preset||overrides.preset;
  const colors={...(presets[overrides.preset]?.colors||{}),...overrides.colors,...(local.preset?presets[local.preset].colors:{}),...local.colors};
  const signal=local.signal||(local.preset?presets[local.preset].signal:overrides.signal)||presets[chosen]?.signal;
  // A local preset/scale replaces inherited ramp edits; a local single-color
  // edit still wins. A study without either continues to inherit workspace edits.
  const rampOverrides={...(!local.preset&&!local.signal?overrides.colors:{}),...local.colors};
  if(signal)signalKeys.forEach((key,i)=>colors[key]=rampOverrides[key]||signalSchemes[signal].stops[i]);
  return {colors,signal,rampOverrides,groups:local.groups||{}};
 }
 function colors(options={}){
  const selected=options.export?'light':options.mode||mode(),overrides=options.overrides===undefined?configuration.overrides:validate(options.overrides),study=options.study===undefined?configuration.study:options.study,names=options.studyGroups||configuration.studyGroups,output={};
  const cacheKey=options.overrides===undefined&&options.study===undefined&&options.studyGroups===undefined?selected+':'+!!options.export:null;
  if(cacheKey&&cache.has(cacheKey))return cache.get(cacheKey);
  const active=effective(overrides,study);
  for(const [key,item] of Object.entries(definitions)){
   const field=selected;
   output[key]=active.colors[key]||item[field];
   if(selected==='dark'&&settingsKeys.has(key)&&!signalKeys.includes(key))output[key]=darkColor(key,active.colors[key]||item.light);
  }
  // Theme-adaptive sequential ramps keep low signal near the dark surface and
  // make the high endpoint visible. Multi-hue stops retain their source hue.
  // Viridis/Plasma retain their authored ordering and stops in both themes.
  const adaptiveStops=signalSchemes[active.signal]?.dark==='adaptive';
  if(!active.signal||active.signal==='blue'||adaptiveStops){
   if(selected==='dark'){output.rampLo=darkColor('rampLo',active.colors.rampLo||definitions.rampLo.light);output.rampHi=darkColor('rampHi',active.colors.rampHi||definitions.rampHi.light);}
   signalKeys.slice(1,-1).forEach((key,i)=>{
    const position=(i+1)/4,source=active.rampOverrides?.[key]||(adaptiveStops?active.colors[key]:null);
    output[key]=selected==='dark'
     ? mix(output.rampLo,source?darkColor('rampHi',source):output.rampHi,position)
     : active.colors[key]||mix(output.rampLo,output.rampHi,position);
   });
  }
  {
   for(const [key,target] of Object.entries(aliases))output[key]=active.colors[key]||output[target];
   // Derived paint only: repeat colors acquire a contrasting hatch in ribbons
   // and their keys. Keep this in the captured palette so SVG/PNG/Code agree,
   // and CSS updates recolor existing figures without refitting their data.
   for(const keys of [categorical,clusters]){
    const seen=new Set();
    for(const key of keys){
     const base=(active.colors[aliases[key]||key]||definitions[key].light).toLowerCase();
     output[key+'Hatch']=seen.has(base)?(contrast(output[key],'#000000')>=contrast(output[key],'#ffffff')?'#000000':'#ffffff'):'transparent';
     seen.add(base);
    }
   }
   const roles=studyGroupRoles(study,names);
   for(const name of names){const clean=groupName(study,name),base=active.groups?.[clean],value=base?(selected==='dark'?darkColor('up',base):base):output[roles[clean]];
    output[groupKey(name)]=value;output[groupKey(clean)]=value;if(study)output[groupKey(study+'_'+clean)]=value;
   }
  }
  if(cacheKey)cache.set(cacheKey,Object.freeze(output));return output;
 }
 const raw=(key,options)=>{if(!definitions[key])throw Error('Unknown plot color: '+key);return colors(options)[key];};
 function declarations(values){return Object.entries(values).map(([key,value])=>cssName(key)+':'+value).join(';')+';';}
 function css(options={}){return 'html:root{'+declarations(colors({...options,mode:'light'}))+'}html:root.dark{'+declarations(colors({...options,mode:'dark'}))+'}';}
 const rgb=value=>[1,3,5].map(i=>parseInt(hex(value).slice(i,i+2),16));
 function mix(a,b,t){const left=rgb(a),right=rgb(b);return '#'+left.map((v,i)=>Math.round(v+(right[i]-v)*Math.min(1,Math.max(0,t))).toString(16).padStart(2,'0')).join('');}
 const luminance=color=>rgb(color).map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
 const contrast=(a,b)=>{const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);};
 const darkRules=Object.freeze({minimumContrast:4.5,heatmapBackgroundMix:.95});
 function darkColor(key,color){
  const background=definitions.surface.dark;
  // Low signal stays near the dark surface. The high end and categorical
  // marks get only the tint needed for contrast; never invert a data scale.
  if(key==='rampLo')return mix(color,background,darkRules.heatmapBackgroundMix);
  if(contrast(color,background)>=darkRules.minimumContrast)return color;
  let lo=0,hi=1;for(let i=0;i<16;i++){const t=(lo+hi)/2;if(contrast(mix(color,'#ffffff',t),background)<darkRules.minimumContrast)lo=t;else hi=t;}
  return mix(color,'#ffffff',hi);
 }
 const rampDefinition=(name,options={})=>ramps[name==='solventNative'?'solvent':name];
 function ramp(name,t,options={}){
  const {keys,positions}=rampDefinition(name,options)||{};if(!keys)throw Error('Unknown plot gradient');
  const value=Math.max(0,Math.min(1,Number(t)||0));let index=0;while(index<positions.length-2&&value>positions[index+1])index++;
  const fraction=(value-positions[index])/(positions[index+1]-positions[index]);
  return options.css?'color-mix(in srgb, '+ref(keys[index+1])+' '+(fraction*100).toFixed(4)+'%, '+ref(keys[index])+')':mix(raw(keys[index],options),raw(keys[index+1],options),fraction);
 }
 function gradient(name,options={}){const value=rampDefinition(name,options);return 'linear-gradient(90deg,'+value.keys.map((key,index)=>ref(key)+' '+value.positions[index]*100+'%').join(',')+')';}
 const alpha=(key,opacity,options)=>{const values=rgb(raw(key,options));return `rgba(${values.join(',')},${opacity})`;};
 // Flatten the CSS colors used by figures for SVG editors without CSS-variable
 // or color-mix support. Geometry, opacity attributes and data stay unchanged.
 function resolveColor(value,values=colors({export:true})){
  const variables=Object.fromEntries(Object.entries(values).map(([key,color])=>[key.startsWith('--')?key:cssName(key),color]));
  let text=String(value);
  for(let i=0;i<8;i++){const next=text.replace(/var\((--[\w-]+)(?:,\s*([^()]+))?\)/g,(original,key,fallback)=>variables[key]||fallback||original);if(next===text)break;text=next;}
  const color='(#[\\da-f]{6}|transparent)',part=color+'(?:\\s+([\\d.]+)%)?';
  const pattern=new RegExp('color-mix\\(in srgb,\\s*'+part+'\\s*,\\s*'+part+'\\s*\\)','gi');
  for(let round=0;round<8;round++){
   const next=text.replace(pattern,(_all,a,pa,b,pb)=>{
    let x=pa==null?(pb==null?.5:1-Number(pb)/100):Number(pa)/100,y=pb==null?1-x:Number(pb)/100;
    const sum=x+y;if(!sum)return 'rgba(0,0,0,0)';x/=sum;y/=sum;
    const alphaA=a==='transparent'?0:1,alphaB=b==='transparent'?0:1,opacity=(alphaA*x+alphaB*y)*Math.min(1,sum);
    if(!opacity)return 'rgba(0,0,0,0)';
    if(alphaA&&alphaB)return mix(a,b,y);
    const source=rgb(alphaA?a:b);return 'rgba('+source.join(',')+','+Number(opacity.toFixed(6))+')';
   });if(next===text)break;text=next;
  }return text;
 }
 // Expose actual derived defaults, not obsolete hand-authored dark variants.
 for(const key of settingsKeys)definitions[key].dark=darkColor(key,definitions[key].light);
 return {schema,presets,signalSchemes,studyDefaults,studyGroupRoles,studyGroupRef,groupName,groupKey,isControlGroup,definitions,groups,palettes,ramps,bands,scaleContracts,aliases,settingsGroups,settingsDefinitions,userOverrides,variantKeys,structural,darkRules,darkColor,contrast,cssName,ref,references,raw,colors,css,declarations,configure,snapshot,validate,mode,mix,ramp,gradient,alpha,resolveColor};
});
