import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { parse } from 'parse5';

const pkg = JSON.parse(fs.readFileSync('artifacts/hetzner-preview/latest-package.json', 'utf8'));
const root = path.join(pkg.directory, 'payload');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const attr = (node, name) => node.attrs?.find(item => item.name === name)?.value;
const walk = node => [node, ...(node.childNodes ?? []).flatMap(walk)];
const knownOrigins = Object.fromEntries(Object.entries(manifest.sites).map(([id, site]) => [site.origin, id]));
const knownFiles = new Set(manifest.files.map(file => file.path));
const routes = [];
const resources = new Map();
let links = 0;
let faqAnswers = 0;
for (const file of manifest.files) {
  const disk = path.join(root, file.path);
  const bytes = fs.readFileSync(disk);
  assert.equal(bytes.length, file.bytes, file.path);
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), file.sha256, file.path);
  assert(!/(^|\/)(admin|concept|\.env|\.git)(\/|$)/.test(file.path), file.path);
  const site = file.path.split('/')[0];
  const origin = manifest.sites[site].origin;
  if (file.path.endsWith('robots.txt')) assert.equal(bytes.toString(), 'User-agent: *\nDisallow: /\n');
  if (!file.path.endsWith('.html')) continue;
  const html = bytes.toString();
  assert(!/https?:\/\/(?:www\.)?(?:lbi-helmond|elektrastoring-helmond|lekkage-reparatie-helmond|gasleiding-service-helmond)\.nl/.test(html), file.path + ': production domain');
  assert(!/bezwaarpilot/i.test(html), file.path + ': unrelated brand/domain');
  const tree = walk(parse(html));
  const find = (tag, key, value) => tree.find(node => node.tagName === tag && (!key || attr(node, key) === value));
  assert.equal(tree.filter(node => node.tagName === 'h1').length, 1, file.path + ': H1');
  assert.equal(attr(find('meta', 'name', 'robots'), 'content'), 'noindex,nofollow,noarchive', file.path + ': robots');
  assert(!tree.some(node => node.tagName === 'form'), file.path + ': no client data submission');
  const relative = file.path.slice(site.length + 1);
  const route = relative === 'index.html' ? '/' : relative.endsWith('/index.html') ? '/' + relative.slice(0, -10) : '/' + relative;
  assert.equal(attr(find('link', 'rel', 'canonical'), 'href'), origin + (relative === '404.html' ? '/404/' : route), file.path + ': canonical');
  if (relative !== '404.html') routes.push(origin + route);
  const script = find('script', 'type', 'application/ld+json');
  if (script) {
    const graph = JSON.parse(script.childNodes.map(node => node.value ?? '').join(''))['@graph'];
    const faq = graph.find(node => node['@type'] === 'FAQPage');
    if (site !== 'lbi' && relative !== '404.html') {
      assert.equal(faq?.mainEntity.length, 6, file.path + ': six FAQs');
      faqAnswers += faq.mainEntity.length;
    }
  }
  for (const node of tree) {
    const refs = [];
    if (attr(node, 'href')) refs.push(attr(node, 'href'));
    if (attr(node, 'src')) refs.push(attr(node, 'src'));
    if (node.tagName === 'meta' && ['og:image', 'og:url'].includes(attr(node, 'property'))) refs.push(attr(node, 'content'));
    for (const ref of refs) {
      if (/^(?:tel:|mailto:|data:)/.test(ref)) continue;
      const url = new URL(ref, origin + route);
      const target = knownOrigins[url.origin];
      if (!target) continue;
      const pathname = decodeURIComponent(url.pathname).replace(/^\//, '');
      let key = target + '/' + pathname;
      if (url.pathname.endsWith('/')) key += 'index.html';
      if (!knownFiles.has(key) && knownFiles.has(key + '/index.html')) key += '/index.html';
      assert(knownFiles.has(key) || url.pathname === '/404/', file.path + ': missing target ' + ref);
      if (url.hash && url.origin === origin && url.pathname === route) assert(tree.some(item => attr(item, 'id') === decodeURIComponent(url.hash.slice(1))), file.path + ': missing anchor ' + ref);
      if (!key.endsWith('.html') && knownFiles.has(key)) resources.set(url.origin + url.pathname, manifest.files.find(item => item.path === key).sha256);
      links++;
    }
  }
}
for (const file of manifest.files.filter(item => /\.(?:js|mjs|css)$/.test(item.path))) {
  const site = file.path.split('/')[0];
  const value = fs.readFileSync(path.join(root, file.path), 'utf8');
  for (const match of value.matchAll(/(?:["'])(\.\.?\/[^"'\s]+\.(?:js|css))(?:["'])/g)) {
    const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(file.path), match[1]));
    assert(knownFiles.has(resolved), file.path + ': module import ' + match[1]);
    resources.set(manifest.sites[site].origin + '/' + resolved.slice(site.length + 1), manifest.files.find(item => item.path === resolved).sha256);
  }
}
assert.equal(routes.length, 27, '12 LBI pages plus 15 microsite pages');
assert.equal(faqAnswers, 90, 'All microsite FAQ answers');
const result = { status: 'PASS', release: pkg.release, files: manifest.files.length, pages: routes.length, faqAnswers, links, routes, resources: Object.fromEntries(resources) };
fs.writeFileSync(path.join(pkg.directory, 'verification.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ ...result, routes: result.routes.length, resources: resources.size }, null, 2));
