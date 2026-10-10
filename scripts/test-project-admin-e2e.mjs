// Requires the disposable admin:preview service. Never points at production.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import sharp from 'sharp';

const origin = 'http://127.0.0.1:4335';
const login = await fetch(origin+'/beheer/api/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({password:['synthetic','project','admin','42'].join('-')})});
assert.equal(login.status,200);
const cookie = login.headers.get('set-cookie').split(';')[0];
const {csrfToken} = await login.json();
async function api(route,json) {
  const response = await fetch(origin+'/beheer/api'+route,{method:json ? 'POST' : 'GET',headers:{Origin:origin,Cookie:cookie,'X-CSRF-Token':csrfToken,'Content-Type':'application/json'},body:json ? JSON.stringify(json) : undefined});
  const data = await response.json();
  assert(response.ok,route+': '+JSON.stringify(data)); return data;
}
const jpeg = await sharp({create:{width:1200,height:800,channels:3,background:'#dac9ad'}}).jpeg().toBuffer();
const upload = await fetch(origin+'/beheer/api/media',{method:'POST',headers:{Origin:origin,Cookie:cookie,'X-CSRF-Token':csrfToken,'Content-Type':'image/jpeg'},body:jpeg});
assert.equal(upload.status,201);
const {cover} = await upload.json();
const suffix = Date.now();
const title = 'Synthetisch QA-project '+suffix;
const {projects: existingProjects} = await api('/projects');
const latestDate = existingProjects.map(item => item.date).filter(Boolean).sort().at(-1) || '2026-10-08';
const nextDate = new Date(latestDate+'T12:00:00Z');
nextDate.setUTCDate(nextDate.getUTCDate()+1);
const date = nextDate.toISOString().slice(0,10);
const {project} = await api('/projects',{title,category:'Badkamer',location:'Testplaats',date,summary:'Alleen synthetische gegevens voor een lokale publicatietest.',coverAlt:'Effen testafbeelding',cover,body:''});
const otherTitle = 'Niet publiceren '+suffix;
await api('/projects',{title:otherTitle,category:'Overig',location:'',date:'',summary:'',coverAlt:'',cover:'',body:''});
await api('/publish',{id:project.id});
let publication;
const deadline = Date.now()+360000;
do {
  await new Promise(resolve=>setTimeout(resolve,1000));
  ({publication} = await api('/publication'));
} while (publication.state === 'publishing' && Date.now()<deadline);
assert.equal(publication.state,'success',JSON.stringify(publication));
const home = await (await fetch(origin+'/')).text();
const timeline = await (await fetch(origin+'/projecten/')).text();
for (const html of [home,timeline]) { assert(html.includes(title)); assert(html.includes('client-'+project.id)); assert(!html.includes(otherTitle)); }
const image = await fetch(origin+'/images/projects/client/'+cover);
assert.equal(image.status,200);
assert(image.headers.get('content-type').includes('webp'));
const sitemap = await (await fetch(origin+'/sitemap.xml')).text();
assert(!sitemap.includes('/beheer/') && !sitemap.includes('/admin/'));
assert((await (await fetch(origin+'/robots.txt')).text()).includes('Disallow: /beheer/'));
await api('/logout',{});
const report={status:'PASS',checkedAt:new Date().toISOString(),scope:'Loopback synthetic real Astro publication',home:true,timeline:true,media:true,otherDraftExcluded:true,adminExcludedFromSitemap:true,projectId:project.id};
await fs.writeFile('artifacts/project-admin-e2e.json',JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
