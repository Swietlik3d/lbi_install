"""Root-only, consistent backup and file restoration proof for the LBI preview.

Stops only lbi-preview-admin while taking a snapshot; always restarts a service
which was running. Archives are private and include the password HASH, never
the plaintext password. No other site, release, or backup is deleted.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import subprocess
import tarfile
import tempfile

DATA = Path('/var/lib/lbi-preview-project-admin')
PUBLISH = Path('/var/www/strony/lbi')
BACKUPS = Path('/var/backups/lbi-preview')
SERVICE = 'lbi-preview-admin.service'

def require(condition, message):
    if not condition:
        raise RuntimeError(message)

def digest(file):
    with file.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()

def inventory(root):
    files = []
    total = 0
    for entry in sorted(root.rglob('*')):
        require(not entry.is_symlink() and (entry.is_dir() or entry.is_file()), 'Backup forbids links/special files')
        if entry.is_file():
            size = entry.stat().st_size
            total += size
            require(total <= 2 * 1024 ** 3 and len(files) < 60000, 'Backup quota exceeded')
            files.append({'path': entry.relative_to(root).as_posix(), 'size': size, 'sha256': digest(entry)})
    return files

def backup():
    require(DATA.is_dir() and DATA.resolve() == DATA, 'Private data root unsafe')
    require(BACKUPS.is_dir() and BACKUPS.resolve() == BACKUPS and BACKUPS.stat().st_mode & 0o077 == 0, 'Backup root must be private')
    identifier = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    destination = BACKUPS / ('snapshot-' + identifier)
    destination.mkdir(mode=0o700)
    active = subprocess.run(['systemctl', 'is-active', '--quiet', SERVICE]).returncode == 0
    if active:
        subprocess.run(['systemctl', 'stop', SERVICE], check=True)
    try:
        require(not (DATA / 'publication-pending.json').exists(), 'Pending publication requires recovery before backup')
        current = (PUBLISH / 'current').resolve(strict=True)
        require(current.parent == PUBLISH / 'releases', 'Public current outside known releases')
        source_line = next(line for line in Path('/etc/lbi-preview/project-admin.env').read_text().splitlines() if line.startswith('LBI_ADMIN_SOURCE_DIR='))
        source = Path(source_line.split('=', 1)[1])
        require(source.parent == Path('/srv/lbi-preview') and source.resolve() == source, 'Source identity unsafe')
        with tempfile.TemporaryDirectory(prefix='backup-', dir=destination) as temporary:
            snapshot = Path(temporary) / 'snapshot'
            snapshot.mkdir(mode=0o700)
            shutil.copytree(DATA, snapshot / 'data', symlinks=True)
            shutil.copytree(current, snapshot / 'public', symlinks=True)
            config = snapshot / 'config'
            config.mkdir(mode=0o700)
            for item in (Path('/etc/lbi-preview/project-admin.env'),
                         Path('/etc/systemd/system/lbi-preview-admin.service'),
                         Path('/etc/systemd/system/lbi-preview-builder.service'),
                         Path('/etc/tmpfiles.d/lbi-preview-builder.conf'),
                         Path('/etc/nginx/sites-available/lbi-preview')):
                require(item.is_file() and not item.is_symlink(), 'Configuration input unsafe')
                shutil.copyfile(item, config / item.name)
            files = inventory(snapshot)
            manifest = {'version': 1, 'createdAt': datetime.now(timezone.utc).isoformat(),
                        'current': str(current), 'source': str(source), 'files': files}
            (snapshot / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
            archive = destination / 'snapshot.tar.gz'
            with tarfile.open(archive, 'w:gz') as output:
                output.add(snapshot, arcname='snapshot', recursive=True)
            archive.chmod(0o600)
        report = {'status': 'BACKED_UP', 'directory': str(destination), 'archive': str(archive),
                  'sha256': digest(archive), 'files': len(files), 'current': str(current),
                  'source': str(source), 'plaintext_password_included': False}
        (destination / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
        (destination / 'report.json').chmod(0o600)
        return report
    finally:
        if active:
            subprocess.run(['systemctl', 'start', SERVICE], check=True)

def verify(archive, expected_hash):
    require(archive.is_file() and not archive.is_symlink() and archive.parent.parent == BACKUPS,
            'Restore proof accepts only known private preview snapshots')
    require(digest(archive) == expected_hash, 'Backup archive SHA mismatch')
    with tempfile.TemporaryDirectory(prefix='restore-proof-', dir=BACKUPS) as temporary:
        restored = Path(temporary)
        with tarfile.open(archive, 'r:gz') as packed:
            regular = {}
            directories = []
            members = packed.getmembers()
            require(len(members) <= 120000, 'Too many backup members')
            for member in members:
                name = PurePosixPath(member.name)
                require(not name.is_absolute() and '..' not in name.parts and name.parts[0] == 'snapshot', 'Unsafe backup path')
                require(member.isfile() or member.isdir(), 'Backup links/special files forbidden')
                if member.isfile():
                    relative = str(PurePosixPath(*name.parts[1:]))
                    require(relative not in regular, 'Duplicate backup member')
                    regular[relative] = member
                else:
                    directories.append(str(PurePosixPath(*name.parts[1:])))
            require('manifest.json' in regular and regular['manifest.json'].size < 24 * 1024 * 1024, 'Backup manifest missing/too large')
            manifest = json.load(packed.extractfile(regular['manifest.json']))
            files = {item['path']: item for item in manifest['files']}
            require(len(files) == len(manifest['files']) <= 60000 and set(regular) == set(files) | {'manifest.json'}, 'Backup inventory mismatch')
            require(sum(item['size'] for item in files.values()) <= 2 * 1024 ** 3, 'Restore exceeds quota')
            # Preserve empty records/media folders too; an empty fresh panel
            # is a valid snapshot and must not fail a later readdir check.
            for relative in directories:
                target = restored / relative
                require(target.resolve().is_relative_to(restored), 'Restored directory outside scratch')
                target.mkdir(parents=True, exist_ok=True, mode=0o700)
            for relative, item in files.items():
                member = regular[relative]
                require(member.size == item['size'], 'Restored file size mismatch')
                target = restored / relative
                target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
                with target.open('xb') as output, packed.extractfile(member) as incoming:
                    shutil.copyfileobj(incoming, output)
                target.chmod(0o600)
                require(digest(target) == item['sha256'], 'Restored file hash mismatch')
        source = Path(manifest['source'])
        require(source.parent == Path('/srv/lbi-preview') and source.resolve() == source, 'Restore source identity unsafe')
        # Decode actual restored media and validate the restored password record
        # without printing either the record or any private project content.
        program = '''import fs from 'node:fs/promises';import path from 'node:path';
import {validatePasswordRecord} from './server/project-admin/security.mjs';import sharp from 'sharp';
const root=process.argv[1];validatePasswordRecord(JSON.parse(await fs.readFile(path.join(root,'data/auth/password.json'),'utf8')));
const records=await fs.readdir(path.join(root,'data/records'));
for(const file of records){const r=JSON.parse(await fs.readFile(path.join(root,'data/records',file),'utf8'));if(r.draft?.id!==file.slice(0,-5))throw Error('Restored record identity mismatch');}
for(const file of await fs.readdir(path.join(root,'data/media'))){if(file.endsWith('.webp'))await sharp(path.join(root,'data/media',file)).metadata();}
for(const file of ['index.html','projecten/index.html','robots.txt','sitemap.xml'])await fs.access(path.join(root,'public',file));
if(await fs.readFile(path.join(root,'public/robots.txt'),'utf8')!==['User-agent: *','Disallow: /',''].join(String.fromCharCode(10)))throw Error('Restored preview robots invalid');
'''
        validation = subprocess.run(['/usr/bin/node', '--input-type=module', '-e', program, str(restored)], cwd=source, capture_output=True, text=True, timeout=30)
        require(validation.returncode == 0, 'Restored payload validation failed; private output suppressed')
        return {'status': 'RESTORE_FILES_PASS', 'archive': str(archive), 'sha256': expected_hash,
                'restored_files': len(files), 'records': len(list((restored / 'data/records').glob('*.json'))),
                'media': len(list((restored / 'data/media').glob('*.webp'))),
                'scope': 'Isolated extraction, exact inventory/hashes, auth record, project JSON, decoded media and public entrypoints; no live rollback.'}

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=('backup', 'verify'))
    parser.add_argument('--archive', type=Path)
    parser.add_argument('--sha256')
    args = parser.parse_args()
    require(os.geteuid() == 0, 'Root-only private backup operation')
    os.umask(0o077)
    if args.action == 'backup':
        result = backup()
    else:
        require(args.archive and args.sha256, 'Exact backup archive/hash required')
        result = verify(args.archive, args.sha256)
    print(json.dumps(result, indent=2))

if __name__ == '__main__':
    main()
