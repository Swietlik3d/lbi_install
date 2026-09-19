import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'artifacts/hetzner-preview/latest-package.json'), 'utf8'));
const manifest = JSON.parse(fs.readFileSync(path.join(pkg.directory, 'payload/manifest.json'), 'utf8'));
const verified = JSON.parse(fs.readFileSync(path.join(pkg.directory, 'verification.json'), 'utf8'));
assert.equal(verified.release, pkg.release);
const origins = Object.fromEntries(Object.entries(manifest.sites).map(([site, value]) => [value.origin, site]));
const files = new Map(manifest.files.map(file => [file.path, file]));
const entries = [
  ...verified.routes.map(url => {
    const parsed = new URL(url);
    const file = files.get(origins[parsed.origin] + parsed.pathname + 'index.html');
    assert(file, 'Missing route in manifest: ' + url);
    return [url, file.sha256];
  }),
  ...Object.entries(verified.resources),
];
const results = [];
let next = 0;
await Promise.all(Array.from({ length: 4 }, async () => {
  while (next < entries.length) {
    const [url, sha256] = entries[next++];
    const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(25000) });
    assert.equal(response.status, 200, url);
    assert(response.headers.get('x-robots-tag')?.includes('noindex'), 'Missing noindex: ' + url);
    if (url.endsWith('.js')) assert(response.headers.get('content-type')?.includes('javascript'), 'Wrong script MIME: ' + url);
    const body = Buffer.from(await response.arrayBuffer());
    assert.equal(createHash('sha256').update(body).digest('hex'), sha256, 'Live content mismatch: ' + url);
    results.push({ url, status: response.status, sha256 });
  }
}));
for (const origin of Object.keys(origins)) {
  const options = { redirect: 'manual', signal: AbortSignal.timeout(25000) };
  const redirected = await fetch(origin.replace('https:', 'http:') + '/', options);
  assert.equal(redirected.status, 308, 'HTTP redirect: ' + origin);
  assert.equal(redirected.headers.get('location'), origin + '/');
  const robots = await fetch(origin + '/robots.txt', options);
  assert.equal(robots.status, 200);
  assert.equal(await robots.text(), 'User-agent: *\nDisallow: /\n');
  const admin = await fetch(origin + '/admin/', options);
  assert.equal(admin.status, 404, 'Admin exposed: ' + origin);
  await admin.arrayBuffer();
}
const report = { status: 'PASS', release: pkg.release, checkedAt: new Date().toISOString(), pages: verified.routes.length, resources: Object.keys(verified.resources).length, sites: Object.keys(origins).length, checks: results.sort((a, b) => a.url.localeCompare(b.url)) };
fs.writeFileSync(path.join(pkg.directory, 'external-verification.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ ...report, checks: results.length }, null, 2));
