// Capture the generated local review; does not read or operate a live study.
const fs=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url');
const {chromium}=require('playwright');
const qa=require('../../desktop/test/qa-temp.cjs');

(async()=>{
 const output=path.resolve(process.argv[2]||'');
 if(!process.argv[2])throw Error('Pass the generated human assembly review directory');
 const profile=qa.directory('human-assembly-review-');
 const browser=await chromium.launchPersistentContext(profile,{channel:'msedge',headless:true,viewport:{width:1560,height:1120},deviceScaleFactor:1});
 const page=await browser.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.goto(pathToFileURL(path.join(output,'index.html')).href,{waitUntil:'load',timeout:120000});
  await page.waitForFunction(()=>!!window.review?.state.svg,{timeout:120000});
  const snapshots=[
   ['01-reference-families','reference',false,false],
   ['02-reference-enriched','reference',true,false],
   ['03-study-active','active',false,false],
   ['04-sample-active','patient',false,false],
   ['05-molecular-function','ontology',false,false],
   ['06-cellular-location','ontology',false,true],
   ['07-protein-class','ontology',false,false],
  ];
  for(const[name,view,support,location]of snapshots){
   await page.selectOption('#view',view);
   if(location)await page.selectOption('#layer','HPA_Subcellular_main_location');
   if(name==='07-protein-class')await page.selectOption('#layer','HPA_Protein_class');
   if(support)await page.check('#support');else if(await page.locator('#support').isVisible())await page.uncheck('#support');
   await page.evaluate(()=>{document.body.classList.add('light');window.review.draw()});
   const svg=await page.evaluate(()=>window.review.serialized());
   fs.writeFileSync(path.join(output,name+'.svg'),svg);
   const png=await page.evaluate(async()=>{
    const url=URL.createObjectURL(new Blob([window.review.serialized()],{type:'image/svg+xml'})),img=new Image();
    await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=reject;img.src=url});
    const c=document.createElement('canvas');c.width=img.width*1.5;c.height=img.height*1.5;
    c.getContext('2d').drawImage(img,0,0,c.width,c.height);URL.revokeObjectURL(url);
    return c.toDataURL('image/png').split(',')[1];
   });
   fs.writeFileSync(path.join(output,name+'.png'),Buffer.from(png,'base64'));
  }
  // Exercise the other assay and actual family drilldown through the controls.
  await page.selectOption('#assay','HuProt_532nm');
  await page.selectOption('#view','reference');
  await page.fill('#search','RBPJ');
  await page.locator('#search-results button').first().click();
  await page.click('#inspect');
  if(!await page.locator('#figure').textContent().then(s=>s.includes('RBPJ')))throw Error('Family drilldown did not render');
  await page.click('#back');
  await page.selectOption('#assay','HuProt_635nm');
  await page.check('#compare');
  await page.evaluate(()=>{document.body.classList.remove('light');window.review.draw()});
  await page.screenshot({path:path.join(output,'review-dark.png'),fullPage:true});
  if(errors.length)throw Error(errors.join('\n'));
  console.log(JSON.stringify({output,views:snapshots.length,assays:2,drilldown:'RBPJ',errors}));
 }finally{await browser.close();qa.cleanup();}
})().catch(e=>{console.error(e);process.exitCode=1});
