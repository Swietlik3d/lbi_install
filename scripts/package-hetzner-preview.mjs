import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const config = JSON.parse(fs.readFileSync(path.join(root, 'deploy/hetzner-preview.json'), 'utf8'));
const sites = JSON.parse(fs.readFileSync(path.join(root, 'src/config/sites.json'), 'utf8'));
const staticExtensions = new Set(['.html', '.css', '.js', '.mjs', '.json', '.xml', '.txt', '.svg', '.png', '.jpg', '.jpeg', '.webp', '.avif', '.gif', '.ico', '.woff', '.woff2', '.ttf']);
const textExtensions = new Set(['.html', '.css', '.js', '.mjs', '.json', '.xml', '.txt', '.svg']);
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const tree = directory => fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
  const full = path.join(directory, entry.name);
  if (entry.isSymbolicLink()) throw new Error('Symlink in build: ' + full);
  return entry.isDirectory() ? tree(full) : [full];
});
const rewrites = Object.keys(config.sites).flatMap(id => {
  const hostname = new URL(sites[id].domain).hostname.replace(/^www\./, '');
  return ['https://www.', 'https://', 'http://www.', 'http://'].map(prefix => [prefix + hostname, config.sites[id]]);
});
const release = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
const directory = path.join(root, 'artifacts/hetzner-preview', release);
fs.mkdirSync(path.dirname(directory), { recursive: true });
fs.mkdirSync(directory); // Unique release; never replace another artifact.
const payload = path.join(directory, 'payload');
fs.mkdirSync(payload);
const manifest = {
  release,
  createdAt: new Date().toISOString(),
  sourceHead: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  includesWorkingTreeChanges: true,
  sites: {},
  files: [],
};
for (const [id, origin] of Object.entries(config.sites)) {
  const source = path.join(root, 'dist', id);
  if (!fs.existsSync(path.join(source, 'index.html'))) throw new Error('Build missing: ' + id);
  let htmlPages = 0;
  for (const full of tree(source)) {
    const relative = path.relative(source, full).split(path.sep).join('/');
    if (/^(admin|concept)(\/|$)/.test(relative) || relative.split('/').some(part => part.startsWith('.')) || /(^|\/)README\.md$/i.test(relative)) continue;
    const extension = path.extname(full).toLowerCase();
    if (!staticExtensions.has(extension)) throw new Error('Unexpected build file: ' + relative);
    let bytes = fs.readFileSync(full);
    if (textExtensions.has(extension)) {
      let value = bytes.toString('utf8');
      for (const [from, to] of rewrites) value = value.replaceAll(from, to);
      if (extension === '.html') {
        const robots = /<meta\s+name=["']robots["'][^>]*>/gi;
        if (!robots.test(value)) throw new Error('Robots meta missing: ' + relative);
        value = value.replace(robots, '<meta name="robots" content="noindex,nofollow,noarchive">');
        htmlPages++;
      }
      if (relative === 'robots.txt') value = 'User-agent: *\nDisallow: /\n';
      if (/-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----|(?:sk-proj-|ghp_|github_pat_)[A-Za-z0-9_-]{20,}|C:\\\\Users\\\\|C:\\\\PROJECTS\\\\/.test(value)) throw new Error('Private source material in ' + relative);
      for (const [from] of rewrites) if (value.includes(from)) throw new Error('Production URL escaped preview rewrite: ' + relative);
      bytes = Buffer.from(value, 'utf8');
    }
    const destination = path.join(payload, id, relative);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, bytes);
    manifest.files.push({ path: id + '/' + relative, bytes: bytes.length, sha256: hash(bytes) });
  }
  manifest.sites[id] = { origin, htmlPages };
}
manifest.files.sort((a, b) => a.path.localeCompare(b.path));
fs.writeFileSync(path.join(payload, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
const archive = path.join(directory, 'preview.tar.gz');
execFileSync('tar', ['-czf', archive, '-C', payload, '.']);
const result = { release, directory, archive, sha256: hash(fs.readFileSync(archive)), files: manifest.files.length, unpackedBytes: manifest.files.reduce((sum, file) => sum + file.bytes, 0), sites: manifest.sites };
fs.writeFileSync(path.join(directory, 'package.json'), JSON.stringify(result, null, 2) + '\n');
fs.writeFileSync(path.join(root, 'artifacts/hetzner-preview/latest-package.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
