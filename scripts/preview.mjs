import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const allowed=new Set(['/','/index.html','/app.js','/series.mjs','/library.mjs','/sync.mjs','/sync-config.json','/style.css','/data/library.json']);
const mime={'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.mjs':'text/javascript','.json':'application/json','.jpg':'image/jpeg'};
http.createServer(async(request,response)=>{
  try{
    const pathname=decodeURIComponent(new URL(request.url,'http://localhost').pathname);
    if((!allowed.has(pathname)&&!/^\/AnimeList\/Covers\/[\w\-\u0080-\uffff/.]+$/.test(pathname))||pathname.includes('..')){response.writeHead(404).end();return;}
    const file=path.join(root,pathname==='/'?'index.html':pathname.slice(1));
    const data=await readFile(file);response.setHeader('Content-Type',mime[path.extname(file)]||'application/octet-stream');response.setHeader('Cache-Control','no-store');response.end(data);
  }catch{response.writeHead(404).end();}
}).listen(4173,'127.0.0.1',()=>console.log('Preview: http://127.0.0.1:4173'));
