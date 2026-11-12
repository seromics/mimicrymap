#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {chromium}=require('playwright'),{build}=require('./build-viewer.cjs'),{createServer}=require('./serve-viewer.cjs');
const qaPath=path.resolve(__dirname,'../../desktop/test/qa-temp.cjs');
const qa=fs.existsSync(qaPath)?require(qaPath):null;
const temporary=qa?qa.directory('embed-'):fs.mkdtempSync(path.join(os.tmpdir(),'mimicrymap-viewer-'));
const directory=build(path.join(temporary,'package')),server=createServer(directory,'/nested/mimicrymap/');
let browser;
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const origin=`http://127.0.0.1:${server.address().port}`,base=origin+'/nested/mimicrymap/';
 browser=await chromium.launch({headless:true,channel:process.env.MIMICRY_BROWSER_CHANNEL || (process.platform==='win32'?'msedge':undefined)});
 const page=await browser.newPage({viewport:{width:1440,height:1100}}),errors=[],requests=[];
 page.on('pageerror',error=>{errors.push(error.message);console.error('Browser:',error.message);});
 page.on('response',r=>{if(r.status()>=400)errors.push(r.status()+' '+r.url());});
 page.on('request',r=>requests.push(r.url()));
 await page.goto(base+'examples/index.html');
 await page.waitForFunction(()=>window.demoViewer);
 await page.evaluate(()=>demoViewer.ready);
 await page.selectOption('#inputPreset','references');
 assert.equal(await page.locator('#loadPreset').isDisabled(),true,'Unpublished data must not be downloaded');
 await page.selectOption('#inputPreset','demo');
 const result=await page.evaluate(async()=>demoViewer.compare({targetFasta:document.querySelector('#targetFasta').value,parentFasta:document.querySelector('#parentFasta').value,minimumIdentity:5}));
 assert.equal(result.protein.length,178);assert.ok(result.positional_matches[0].hits.length>0);
 const expected=[];const a=result.protein.sequence,b=result.source_catalog[0].sequence;
 for(let i=0;i<=a.length-9;i++)for(let j=0;j<=b.length-9;j++){let n=0;for(let k=0;k<9;k++)if(a[i+k]===b[j+k]&&'ACDEFGHIKLMNPQRSTVWY'.includes(a[i+k]))n++;if(n>=5)expected.push([i+1,j+1,n]);}
 assert.deepEqual(result.positional_matches[0].hits.map(r=>r.slice(0,3)),expected);
 console.log('Matching agrees with exhaustive comparison.');
 const frame=page.frames().find(f=>f.url().includes('/viewer/index.html'));
 await frame.waitForFunction(()=>document.documentElement.dataset.embedReady==='true');
 assert.ok(await frame.locator('#viz').isVisible());
 assert.ok(await frame.locator('#ematches').isVisible());
 assert.equal(await frame.locator('.native-player-loading').isVisible(),false);
 for(const kind of ['matches','site','parents','summary','code','figures']){
  console.log('Checking export:',kind);
  const file=await page.evaluate(async kind=>{const f=await demoViewer.export(kind),data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(reader.error);reader.readAsDataURL(f.blob);});return {filename:f.filename,data};},kind);
  const bytes=Buffer.from(file.data.slice(file.data.indexOf(',')+1),'base64');
  assert.ok(bytes.length>100,kind);fs.writeFileSync(path.join(temporary,file.filename),bytes);
  if(kind==='matches')assert.equal(bytes.toString(),await frame.evaluate(()=>[...MimicryExportCore.csvChunks(MimicryOne.getResult(),5,1,MimicryOne.getFigureState().ranking,'matches')].map(p=>p.text||'').join('')));
 }
 // A second isolated viewer must not inherit another instance's result, styling or controls.
 const other=await page.evaluate(async()=>{
  const {createViewer}=await import('../mimicrymap.mjs'),div=document.createElement('div');div.style.height='600px';document.body.append(div);window.second=createViewer(div);
  return second.compare({targetFasta:'>distinct\nACDEFGHIKLMNPQRSTVWY',parentFasta:'>p\nACDEFGHIKLMNPQRSTVWY',minimumIdentity:9});
 });
 assert.equal(other.protein.sequence,'ACDEFGHIKLMNPQRSTVWY');
 assert.equal((await page.evaluate(()=>demoViewer.getResult())).protein.length,178);
 await page.evaluate(async result=>{await demoViewer.loadResult(JSON.parse(JSON.stringify(result)));await demoViewer.setTheme('light');},result);
 assert.equal(await frame.evaluate(()=>document.documentElement.classList.contains('dark')),false);
 // A superseded scan is canceled and cannot overwrite the replacement result.
 const cancellation=await page.evaluate(async()=>{
  const long='ACDEFGHIKLMNPQRSTVWY'.repeat(250);
  const pending=second.compare({targetFasta:'>long\n'+long,parentFasta:'>longparent\n'+long,minimumIdentity:5}).then(()=>false,e=>e.name==='AbortError');
  await new Promise(r=>setTimeout(r,25));await second.cancel();return pending;
 });
 assert.equal(cancellation,true);
 await page.evaluate(()=>second.destroy());
 await page.goto(base+'examples/annotations.html');await page.waitForFunction(()=>window.demoViewer);await page.locator('#load').click();
 await page.waitForFunction(()=>!document.querySelector('#load').disabled);assert.equal(await page.locator('#status').textContent(),'');
 const annotated=page.frames().find(f=>f.url().includes('/viewer/index.html'));
 assert.ok(await annotated.evaluate(()=>S3 && S3.ca.length===178 && ANN.plddt.length===178 && activeTracks().some(t=>t.key==='plddt')));
 assert.ok(await annotated.locator('#viz3d').isVisible());
 assert.equal(await annotated.locator('.native-player-loading').isVisible(),false);
 if(process.env.MIMICRY_VIEWER_SCREENSHOT)await page.screenshot({path:process.env.MIMICRY_VIEWER_SCREENSHOT,fullPage:true});
 const mismatch=await page.evaluate(async()=>{const r=await demoViewer.getResult();r.viewer_assets.sequence='wrong';try{await demoViewer.loadResult(r);return false;}catch(e){return e.message.includes('exactly match');}});
 assert.equal(mismatch,true);
 assert.equal((await page.evaluate(()=>demoViewer.getResult())).protein.length,178);
 // Exercise the future public-download route using local fixtures only.
 await page.route('**/references.json',route=>route.fulfill({json:{published:true,target:{filename:'target.fasta',url:base+'examples/target.fasta'},parent:{filename:'parents.fasta',url:base+'examples/parents.fasta'}}}));
 await page.goto(base+'examples/index.html');await page.waitForFunction(()=>window.demoViewer);
 await page.selectOption('#inputPreset','references');await page.locator('#loadPreset').click();
 await page.waitForFunction(()=>!document.querySelector('#loadPreset').disabled);
 assert.ok((await page.locator('#targetFasta').inputValue()).includes('P22301'));
 assert.equal(await page.evaluate(()=>demoViewer.getResult()),null,'Loading a library must not launch a comparison');
 await page.locator('#targetSearch').fill('IL10');assert.equal(await page.locator('#targetIndex option').count(),1);
 assert.equal(requests.some(url=>url.includes('zenodo.org')),false);
 assert.deepEqual(requests.filter(url=>/\/api\/|\/data\//.test(url)),[],'Static viewer must not request a database/catalogue');
 assert.deepEqual(errors,[]);
 console.log('PASS: nested static hosting, exact window pairs, six shared exports, independent instances, saved results, cancellation, annotations and structure.');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{
 await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
 if(qa)qa.cleanup();else if(path.dirname(temporary)===os.tmpdir()&&path.basename(temporary).startsWith('mimicrymap-viewer-'))fs.rmSync(temporary,{recursive:true,force:true});
});
