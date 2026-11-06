// Capture the generated ontology review, without opening a live study.
const fs=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url');
const {chromium}=require('playwright'),qa=require('../../desktop/test/qa-temp.cjs');
(async()=>{
 const output=path.resolve(process.argv[2]||'');
 if(!process.argv[2])throw Error('Pass the generated ontology review directory');
 const browser=await chromium.launchPersistentContext(qa.directory('human-ontology-review-'),{
  channel:'msedge',headless:true,viewport:{width:1600,height:1100},deviceScaleFactor:1});
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 async function save(name,live=false){
  fs.writeFileSync(path.join(output,name+'.svg'),await page.evaluate(live=>ontology.serialized(live),live));
  const data=await page.evaluate(live=>ontology.png(live),live);
  fs.writeFileSync(path.join(output,name+'.png'),Buffer.from(data.split(',')[1],'base64'));
 }
 try{
  await page.goto(pathToFileURL(path.join(output,'index.html')).href,{waitUntil:'load',timeout:120000});
  await page.waitForFunction(()=>!!window.ontology?.state.svg,{timeout:120000});
  await page.evaluate(()=>document.body.classList.add('light'));
  for(const [name,aspect]of [['01-molecular-function','molecular_function'],['02-biological-process','biological_process'],['03-cellular-location','cellular_component']]){
   await page.selectOption('#aspect',aspect);await save(name);
  }
  // The exact term/sample statistic is retained after navigation.
  await page.selectOption('#aspect','molecular_function');
  const chosen=await page.evaluate(()=>{
   const i=ontology.data.nodes.findIndex(n=>n.id==='GO:0003677');
   return {i,q:ontology.data.assays.HuProt_635nm.evidence.q[i][0]};
  });
  await page.evaluate(i=>ontology.focus(i),chosen.i);
  const q=await page.evaluate(i=>ontology.data.assays.HuProt_635nm.evidence.q[i][0],chosen.i);
  if(q!==chosen.q)throw Error('Navigation changed BH');
  await save('04-dna-binding-children');
  await page.click('#families-tab');
  await page.locator('[data-family]').first().click();
  if(!await page.locator('#back-families').count())throw Error('Sequence-family drilldown failed');
  await page.selectOption('#assay','HuProt_532nm');
  await page.click('#home');
  await page.selectOption('#scope','s:Lean_Initial_1_1');
  await save('05-iga-individual');
  await page.selectOption('#assay','HuProt_635nm');
  await page.selectOption('#scope','gv:Lean:Initial');
  await page.check('#compare');await page.selectOption('#scope2','gv:Obese:Initial');
  await page.evaluate(()=>{document.body.classList.remove('light');ontology.draw()});
  await save('06-group-comparison-dark',true);
  await page.screenshot({path:path.join(output,'review-dark.png'),fullPage:false});
  if(errors.length)throw Error(errors.join('\n'));
  console.log(JSON.stringify({output,views:6,assays:2,term:'GO:0003677',errors}));
 }finally{await browser.close();qa.cleanup();}
})().catch(e=>{console.error(e);process.exitCode=1});
