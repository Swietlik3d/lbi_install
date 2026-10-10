/** Freeze only public application source for Linux validation or an authorized preview install. */
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const committed=process.argv.includes('--committed');
const git=(args)=>{const r=spawnSync('git',args,{cwd:root,shell:false,windowsHide:true,encoding:'utf8'});if(r.status!==0)throw new Error('Git source verification failed.');return r.stdout.trim();};
const sourceCommit=git(['rev-parse','HEAD']);
if(committed && git(['status','--porcelain'])) throw new Error('Commit source changes before creating the preview install snapshot.');
const id=crypto.randomUUID();
const artifact=path.join(root,'artifacts','linux-production-proof',id);
const snapshot=path.join(artifact,'source');
const allowlist=['src','public','server/project-admin','scripts','deploy','astro.config.ts','tailwind.config.mjs','tsconfig.json','package.json','package-lock.json'];
if(committed) {
  await fs.mkdir(snapshot,{recursive:true});
  const modes=git(['ls-files','--stage','--',...allowlist]).split('\n').filter(Boolean);
  if(!modes.length || modes.some(line=>!/^100(?:644|755) /.test(line))) throw new Error('Committed source forbids links and special files.');
  const gitArchive=path.join(artifact,'committed-tree.tar');
  const exported=spawnSync('git',['archive','--format=tar','--output='+gitArchive,sourceCommit,...allowlist],{cwd:root,shell:false,windowsHide:true,encoding:'utf8'});
  if(exported.status!==0)throw new Error('Committed source export failed.');
  const unpacked=spawnSync('tar',['-xf',gitArchive,'-C',snapshot],{shell:false,windowsHide:true,encoding:'utf8'});
  if(unpacked.status!==0)throw new Error('Committed source extraction failed.');
  await fs.unlink(gitArchive);
}
const files=[];
let totalBytes=0;
async function copy(relative) {
  const source=path.join(committed?snapshot:root,relative);
  const info=await fs.lstat(source);
  if(info.isSymbolicLink() || (!info.isFile() && !info.isDirectory())) throw new Error('Snapshot forbids links and special files: '+relative);
  const destination=path.join(snapshot,relative);
  if(info.isDirectory()) {
    await fs.mkdir(destination,{recursive:true});
    for(const name of await fs.readdir(source)) {
      if(name==='__pycache__' || name.endsWith('.pyc')) continue;
      if(/^(?:\.env(?:\..*)?|\.git|\.astro|\.artifacts|artifacts|node_modules|data|records|snapshots|auth)$/.test(name)) throw new Error('Private/cache path appeared in public source: '+relative+'/'+name);
      await copy(relative+'/'+name);
    }
  } else {
    totalBytes+=info.size;
    if(totalBytes>256*1024*1024 || files.length>=20000) throw new Error('Public source snapshot exceeds proof quota.');
    await fs.mkdir(path.dirname(destination),{recursive:true});
    if(!committed)await fs.copyFile(source,destination);
    files.push({path:relative,size:info.size,sha256:crypto.createHash('sha256').update(await fs.readFile(destination)).digest('hex')});
  }
}
await fs.mkdir(snapshot,{recursive:true});
for(const entry of allowlist) await copy(entry);
files.sort((a,b)=>a.path.localeCompare(b.path));
await fs.writeFile(path.join(artifact,'source-manifest.json'),JSON.stringify({id,createdAt:new Date().toISOString(),sourceCommit,committedTree:committed,scope:'Public source only; no dependency directory, private admin state, environment files, or auth data.',totalBytes,files},null,2));
const archive=path.join(artifact,'source.tar.gz');
const packed=spawnSync('tar',['-czf',archive,'-C',artifact,'source'],{shell:false,windowsHide:true,encoding:'utf8'});
if(packed.status!==0) throw new Error('Snapshot packaging failed: '+packed.stderr);
const sha256=crypto.createHash('sha256').update(await fs.readFile(archive)).digest('hex');
const result={id,sourceCommit,committedTree:committed,artifact,archive,sha256,totalBytes,files:files.length,remoteRoot:'/srv/lbi-readiness-proof-'+id};
await fs.writeFile(path.join(artifact,'package.json'),JSON.stringify(result,null,2));
console.log(JSON.stringify(result,null,2));
