// Local visual/interaction fixture: no authentication, no production writes.
// API authentication/publication are verified separately against the real service.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
const root = fileURLToPath(new URL('../',import.meta.url));
let projects = [], authenticated = true;
const server = http.createServer(async (request,response) => {
  try {
    const url = new URL(request.url,'http://127.0.0.1:4336');
    const send = (data,status=200) => { response.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'}); response.end(JSON.stringify(data)); };
    if (url.pathname === '/beheer/api/session') return send({authenticated,csrfToken:'ui-fixture-only'});
    if (url.pathname === '/beheer/api/publication') return send({publication:{state:'idle'}});
    if (url.pathname === '/beheer/api/logout') { authenticated=false; return send({authenticated:false}); }
    if (url.pathname === '/beheer/api/projects') {
      if (request.method === 'GET') return send({projects});
      if (request.method === 'POST') {
        let body=''; for await(const chunk of request) { body+=chunk; if(body.length>16000) throw new Error('Fixture body too large'); }
        const fields=JSON.parse(body), project={...fields,id:fields.id||randomUUID(),status:'concept',updatedAt:new Date().toISOString()};
        projects=projects.filter(item=>item.id!==project.id); projects.push(project);
        await new Promise(resolve=>setTimeout(resolve,800)); return send({project},201);
      }
    }
    const asset = url.pathname === '/beheer/projecten/' ? 'index.html' : url.pathname === '/beheer/projecten/app.js' ? 'app.js' : url.pathname === '/beheer/projecten/styles.css' ? 'styles.css' : null;
    if (!asset) return send({error:{message:'Fixture route missing'}},404);
    const body=await fs.readFile(path.join(root,'public','beheer','projecten',asset));
    response.writeHead(200,{'Content-Type':asset.endsWith('.js')?'application/javascript':asset.endsWith('.css')?'text/css':'text/html','Cache-Control':'no-store'}); response.end(body);
  } catch { response.writeHead(400); response.end('Synthetic fixture error'); }
});
server.listen(4336,'127.0.0.1',()=>console.log('UI-only synthetic fixture: http://127.0.0.1:4336/beheer/projecten/'));
for(const signal of ['SIGINT','SIGTERM']) process.once(signal,()=>server.close(()=>process.exit(0)));
