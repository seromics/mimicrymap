#!/usr/bin/env node
'use strict';
// Assemble the existing viewer and exporters with a static host adapter.
const fs=require('node:fs'),path=require('node:path');
const source=path.resolve(__dirname,'../frontend');
function build(destination){
 const root=path.resolve(destination),viewer=path.join(root,'viewer');
 fs.mkdirSync(viewer,{recursive:true});
 const copy=(from,to)=>{fs.mkdirSync(path.dirname(to),{recursive:true});fs.copyFileSync(from,to);};
 function tree(from,to){for(const file of fs.readdirSync(from,{withFileTypes:true})){
  if(file.name.startsWith('.')||file.name==='__pycache__'||file.name.endsWith('.zip'))continue;
  const input=path.join(from,file.name),output=path.join(to,file.name);
  if(file.isDirectory())tree(input,output);else copy(input,output);
 }}
 for(const file of fs.readdirSync(source))if(/\.(js|mjs|css)$/.test(file)&&!file.startsWith('test_'))copy(path.join(source,file),path.join(viewer,file));
 for(const dir of ['fonts','reproduce'])tree(path.join(source,dir),path.join(viewer,dir));
 const palette=path.resolve(source,'../../atlas/viewer/shared/plotPalette.cjs');
 copy(fs.existsSync(palette)?palette:path.join(source,'reproduce/plot-palette.cjs'),path.join(viewer,'plot-palette.js'));
 for(const file of ['bootstrap.js','bridge.js','viewer.css'])copy(path.join(source,'embed',file),path.join(viewer,file));
 copy(path.join(source,'embed/mimicrymap.mjs'),path.join(root,'mimicrymap.mjs'));
 tree(path.join(source,'embed/examples'),path.join(root,'examples'));
 let html=fs.readFileSync(path.join(source,'index.html'),'utf8');
 const excluded=['site-routes.js','site-navigation.js','site-theme.js','startup-shell.js','page-links.js','release-provenance.js','analysis-entry.js','scope-dependencies.js','player-performance.js','local-mapped-result.js','lite-result-cache.js'];
 for(const name of excluded)html=html.replace(new RegExp('<script[^>]*src="/'+name.replaceAll('.','\\.')+'"[^>]*><\\/script>','g'),'');
 html=html.replace(/<link[^>]*href="\/(site-pages|mimicryone-mobile)\.css"[^>]*>/g,'');
 html=html.replace(/<script type="module">import \{watchNativeLoading\}[\s\S]*?<\/script>/,'');
 html=html.replace('<head>','<head>\n<script src="bootstrap.js"></script>');
 html=html.replace('<script src="/viewer-api.js"></script>','<script src="/viewer-api.js"></script>\n<script>MimicryMapViewer.configure({embedded:true,standalone:true,referenceAssets:false});</script>');
 html=html.replace('</head>','<link rel="stylesheet" href="viewer.css">\n</head>');
 html=html.replace(/<body[^>]*>/,'<body><div id="embedStatus" role="status">Load Target and Parent Sequences</div>');
 html=html.replace('</body>','<script src="bridge.js"></script>\n</body>');
 html=html.replace(/((?:src|href)=")\/(?!\/)/g,'$1./');
 fs.writeFileSync(path.join(viewer,'index.html'),html);
 // CSS URLs resolve relative to each stylesheet, including nested fonts.
 for(const file of fs.readdirSync(viewer).filter(f=>f.endsWith('.css'))){
  const target=path.join(viewer,file);fs.writeFileSync(target,fs.readFileSync(target,'utf8').replace(/url\((['"]?)\/(?!\/)/g,'url($1./'));
 }
 const license=path.resolve(__dirname,'../LICENSE');
 if(fs.existsSync(license))copy(license,path.join(root,'LICENSE'));
 copy(path.join(source,'embed/README.md'),path.join(root,'README.md'));
 return root;
}
module.exports={build};
if(require.main===module){if(!process.argv[2])throw Error('Usage: node build-viewer.cjs OUTPUT_DIRECTORY');console.log(build(process.argv[2]));}
