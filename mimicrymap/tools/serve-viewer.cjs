#!/usr/bin/env node
'use strict';
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const types={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.cjs':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2','.gz':'application/gzip','.zip':'application/zip'};
function createServer(directory,prefix='/'){
 const root=fs.realpathSync(directory);
 return http.createServer((req,res)=>{
  let name;try{name=decodeURIComponent(new URL(req.url,'http://localhost').pathname);}catch{res.writeHead(400).end();return;}
  if(!name.startsWith(prefix)){res.writeHead(404).end();return;}
  const file=path.resolve(root,name.slice(prefix.length)||'examples/index.html');
  if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
  fs.stat(file,(error,stat)=>{
   if(error||!stat.isFile()){res.writeHead(404).end('Not found');return;}
   res.writeHead(200,{'Content-Type':types[path.extname(file)]||'text/plain; charset=utf-8','Content-Length':stat.size,'Cache-Control':'no-cache'});
   if(req.method==='HEAD')res.end();else fs.createReadStream(file).pipe(res);
  });
 });
}
module.exports={createServer};
if(require.main===module){const directory=process.argv[2],port=Number(process.argv[3]||5408);if(!directory)throw Error('Usage: node serve-viewer.cjs DIRECTORY [PORT]');createServer(directory).listen(port,'127.0.0.1',()=>console.log(`MimicryMap examples: http://127.0.0.1:${port}/examples/index.html`));}
