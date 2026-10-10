/** Read-only verification of actual four-site build output and preserved 3D sources. */
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
const sites=JSON.parse(await fs.readFile(path.join(root,'src/config/sites.json'),'utf8'));
const ids=['lbi','elektra','lekkage','gas'];
const failures=[];
const checked=[];
const trees=new Map();
const decode=value=>value.replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'");
function attributes(tag) {
  return Object.fromEntries([...tag.matchAll(/([a-zA-Z_:][-\w:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)].map(match=>[match[1].toLowerCase(),decode(match[2]??match[3])]));
}
async function inventory(dir,prefix='') {
  const files=new Map();
  for(const entry of await fs.readdir(dir,{withFileTypes:true})) {
    const relative=prefix+entry.name;
    if(entry.isSymbolicLink()) {failures.push(`Symlink in build: ${relative}`);continue;}
    if(entry.isDirectory()) for(const [name,file] of await inventory(path.join(dir,entry.name),relative+'/')) files.set(name,file);
    else if(entry.isFile()) files.set(relative,path.join(dir,entry.name));
    else failures.push(`Special file in build: ${relative}`);
  }
  return files;
}
function targetFile(url,tree) {
  let name;
  try{name=decodeURIComponent(url.pathname).replace(/^\//,'');}catch{return null;}
  if(!name || name.endsWith('/')) name+='index.html';
  if(tree.has(name)) return name;
  return tree.has(name+'/index.html') ? name+'/index.html' : null;
}
for(const id of ids) trees.set(id,await inventory(path.join(root,'dist',id)));
for(const id of ids) {
  const tree=trees.get(id);
  const origin=sites[id].domain;
  const htmlPages=[...tree.keys()].filter(file=>file.endsWith('.html'));
  let links=0,images=0,indexedPages=0;
  for(const file of htmlPages) {
    const html=await fs.readFile(tree.get(file),'utf8');
    const privatePage=/^(admin|beheer)\//.test(file);
    const pagePath=file==='index.html' ? '/' : file.endsWith('/index.html') ? '/'+file.slice(0,-10) : '/'+file;
    const base=new URL(pagePath,origin);
    const tags=[...html.matchAll(/<(?:a|link|script|img|source)\b[^>]*>/gi)].map(match=>({name:/^<(\w+)/.exec(match[0])[1].toLowerCase(),attrs:attributes(match[0])}));
    if(!privatePage) {
      const h1Count=[...html.matchAll(/<h1\b/gi)].length;
      if(h1Count!==1) failures.push(`${id}:${file} has ${h1Count} h1 elements`);
      const canonical=tags.find(tag=>tag.name==='link' && tag.attrs.rel==='canonical')?.attrs.href;
      const expectedCanonical=file==='404.html' ? new URL('/404/',origin).href : base.href;
      if(canonical!==expectedCanonical) failures.push(`${id}:${file} canonical mismatch: ${canonical}`);
      if(file==='404.html' && !/<meta\b[^>]*name=["']robots["'][^>]*content=["'][^"']*noindex/i.test(html)) failures.push(`${id}:404.html missing noindex`);
      if(!/<html\b[^>]*\blang=["']nl(?:-NL)?["']/i.test(html)) failures.push(`${id}:${file} has no Dutch document language`);
      const title=/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];
      if(!title?.trim()) failures.push(`${id}:${file} missing document title`);
      if(file!=='404.html') indexedPages++;
    } else if(!/<meta\b[^>]*name=["']robots["'][^>]*content=["'][^"']*noindex/i.test(html)) failures.push(`${id}:${file} missing noindex`);
    for(const tag of tags) {
      // Astro's synthetic /404/ canonical is not a user navigation target.
      if(file==='404.html' && tag.name==='link' && tag.attrs.rel==='canonical') continue;
      if(tag.name==='img') {
        images++;
        if(!Object.hasOwn(tag.attrs,'alt')) failures.push(`${id}:${file} image without alt`);
      }
      const urls=[tag.attrs.href,tag.attrs.src].filter(Boolean);
      if(tag.attrs.srcset) urls.push(...tag.attrs.srcset.split(',').map(item=>item.trim().split(/\s+/)[0]));
      for(const value of urls) {
        if(/^(?:mailto:|tel:|data:|javascript:|blob:)/i.test(value)) continue;
        let url;
        try{url=new URL(value,base);}catch{failures.push(`${id}:${file} invalid URL ${value}`);continue;}
        const targetId=ids.find(site=>new URL(sites[site].domain).origin===url.origin);
        if(!targetId) continue;
        // The optional legacy Decap CMS relies on a platform identity endpoint.
        if(privatePage && /\.(?:ya?ml|json)$/.test(url.pathname)) continue;
        links++;
        const targetTree=trees.get(targetId);
        const target=targetFile(url,targetTree);
        if(!target) {failures.push(`${id}:${file} missing target ${url.href}`);continue;}
        if(url.hash && target.endsWith('.html')) {
          const destination=await fs.readFile(targetTree.get(target),'utf8');
          const anchor=decodeURIComponent(url.hash.slice(1));
          const anchors=[...destination.matchAll(/\b(?:id|name)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)].map(match=>decode(match[1]??match[2]));
          if(!anchors.includes(anchor)) failures.push(`${id}:${file} missing anchor ${url.href}`);
        }
      }
    }
    for(const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
      if(attributes(match[1]).type==='application/ld+json') {
        try{JSON.parse(match[2]);}catch{failures.push(`${id}:${file} invalid JSON-LD`);}
      }
    }
  }
  const sitemap=await fs.readFile(tree.get('sitemap.xml'),'utf8');
  const locations=[...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(match=>decode(match[1]));
  if(locations.length!==indexedPages) failures.push(`${id} sitemap page count ${locations.length}, expected ${indexedPages}`);
  for(const location of locations) {
    const url=new URL(location);
    if(url.origin!==origin || /\/(?:admin|beheer)\//.test(url.pathname) || !targetFile(url,tree)) failures.push(`${id} invalid sitemap URL ${location}`);
  }
  const robots=await fs.readFile(tree.get('robots.txt'),'utf8');
  if(!robots.includes(`Sitemap: ${origin}/sitemap.xml`) || !robots.includes('Disallow: /beheer/') || !robots.includes('Disallow: /admin/')) failures.push(`${id} robots.txt missing production sitemap/private exclusions`);
  checked.push({site:id,htmlPages:htmlPages.length,publicPages:indexedPages,localReferences:links,images,sitemapEntries:locations.length});
}
const baselineText=await fs.readFile(path.join(root,'artifacts/production-design-baseline.json'),'utf8').catch(error=>{if(error.code==='ENOENT')return null;throw error;});
const baseline=baselineText ? JSON.parse(baselineText) : null;
const changesText=await fs.readFile(path.join(root,'artifacts/production-design-changes.json'),'utf8').catch(error=>{if(error.code==='ENOENT')return null;throw error;});
const expectedChanges=changesText ? JSON.parse(changesText) : {};
const preserved=[];
const intentionalChanges=[];
for(const [file,expected] of Object.entries(baseline?.sourceHashes || {})) {
  if(!file.startsWith('src/scripts/') && !file.includes('Concept') && !file.includes('EmergencyLanding') && !file.includes('Water')) continue;
  const current=crypto.createHash('sha256').update(await fs.readFile(path.join(root,file))).digest('hex');
  if(current!==expected) {
    const change=expectedChanges[file];
    if(change?.beforeSha256===expected && change?.afterSha256===current && typeof change.reason==='string' && change.reason.trim()) intentionalChanges.push({file,...change});
    else failures.push(`Unexpected scene/layout change: ${file}`);
  }
  else preserved.push(file);
}
const report={checkedAt:new Date().toISOString(),status:failures.length?'FAIL':'PASS',scope:'Actual static output: all pages, local/cross-site links, anchors, assets, images, canonical, sitemap, robots, structured data; preserved 3D hashes and explicitly recorded before/after changes when a baseline exists. Browser motion/appearance is a separate check.',sites:checked,sceneBaseline:baseline ? 'checked' : 'NOT_RUN: no local accepted-design snapshot',preservedSceneFiles:preserved,intentionalSceneChanges:intentionalChanges,failures};
await fs.mkdir(path.join(root,'artifacts'),{recursive:true});
await fs.writeFile(path.join(root,'artifacts/production-static-verification.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
if(failures.length) process.exitCode=1;
