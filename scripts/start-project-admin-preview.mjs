/** Disposable local preview with synthetic credentials/content; never a production account. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createProjectAdmin } from '../server/project-admin/app.mjs';
import { createPasswordRecord } from '../server/project-admin/security.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const preview = path.join(root, '.artifacts', 'project-admin-preview');
const source = path.join(preview, 'source');
const data = path.join(preview, 'data');
const publish = path.join(preview, 'published');
await fs.mkdir(source,{recursive:true});
for (const name of ['src','public','scripts','astro.config.ts','tailwind.config.mjs','tsconfig.json','package.json']) {
  await fs.cp(path.join(root,name),path.join(source,name),{recursive:true});
}
await fs.mkdir(path.join(source,'dist'),{recursive:true});
await fs.cp(path.join(root,'dist','lbi'),path.join(source,'dist','lbi'),{recursive:true});
const modules = path.join(source,'node_modules');
if (!await fs.lstat(modules).catch(() => null)) await fs.symlink(path.join(root,'node_modules'),modules,process.platform === 'win32' ? 'junction' : 'dir');
await fs.mkdir(path.join(data,'auth'),{recursive:true,mode:0o700});
await fs.mkdir(publish,{recursive:true,mode:0o755});
const passwordFile = path.join(data,'auth','password.json');
if (!await fs.lstat(passwordFile).catch(() => null)) {
  const record = await createPasswordRecord(['synthetic','project','admin','42'].join('-'));
  await fs.writeFile(passwordFile,JSON.stringify(record),{mode:0o600,flag:'wx'});
}
const app = await createProjectAdmin({config:{sourceDir:source,dataDir:data,publishRoot:publish,origin:'http://127.0.0.1:4335',port:4335}});
await app.listen();
console.log('Synthetic local preview: http://127.0.0.1:4335/beheer/projecten/');
console.log('All saved projects and releases remain in .artifacts/project-admin-preview. No production access.');
for (const signal of ['SIGINT','SIGTERM']) process.once(signal,async () => { await app.close(); process.exit(0); });
