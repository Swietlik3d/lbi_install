// Loopback-only static QA servers. Does not deploy or serve private panel data.
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
const mode=process.argv[2] || 'current';
if (!['baseline','current'].includes(mode)) throw new Error('Use baseline or current.');
const sites=JSON.parse(await fs.readFile(path.join(root,'src/config/sites.json'),'utf8'));
const ids=['lbi','elektra','lekkage','gas'];
const basePort=mode==='baseline' ? 4351 : 4361;
const origins=Object.fromEntries(ids.map((id,index)=>[id,`http://127.0.0.1:${basePort+index}`]));
const types={'.html':'text/html; charset=utf-8','.js':'application/javascript','.css':'text/css','.svg':'image/svg+xml','.jpg':'image/jpeg','.png':'image/png','.webp':'image/webp','.woff2':'font/woff2','.ico':'image/x-icon','.xml':'application/xml','.txt':'text/plain; charset=utf-8'};
const servers=[];
for(const [index,id] of ids.entries()) {
  const dir=await fs.realpath(path.join(root,mode==='baseline' ? 'artifacts/production-baseline-dist' : 'dist',id));
  const server=http.createServer(async(request,response)=>{
    try {
      let pathname=decodeURIComponent(new URL(request.url,origins[id]).pathname);
      if(pathname.includes('\\') || pathname.split('/').some(part=>part.startsWith('.')) || /^\/(beheer|admin)(\/|$)/.test(pathname)) {response.writeHead(403).end();return;}
      let candidate=path.resolve(dir,'.'+pathname);
      if(!candidate.startsWith(dir+path.sep) && candidate!==dir) {response.writeHead(403).end();return;}
      const info=await fs.stat(candidate);
      if(info.isDirectory()) candidate=path.join(candidate,'index.html');
      const real=await fs.realpath(candidate);
      if(!real.startsWith(dir+path.sep)) {response.writeHead(403).end();return;}
      let bytes=await fs.readFile(real);
      const ext=path.extname(real);
      if(ext==='.html') {
        let html=bytes.toString('utf8');
        for(const key of ids) html=html.replaceAll(sites[key].domain,origins[key]);
        bytes=Buffer.from(html);
      }
      response.writeHead(200,{'Content-Type':types[ext] || 'application/octet-stream','Cache-Control':'no-store','X-Robots-Tag':'noindex'}).end(bytes);
    } catch {response.writeHead(404).end('Not found');}
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(basePort+index,'127.0.0.1',resolve);});
  servers.push(server);
  console.log(`${mode}: ${id} ${origins[id]}/`);
}
for(const signal of ['SIGINT','SIGTERM']) process.once(signal,()=>{for(const server of servers)server.close();});
