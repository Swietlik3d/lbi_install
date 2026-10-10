"""Prepare/activate the explicitly authorized LBI client-preview panel.

Static four-site deployment is a separate validated transaction. This installer
touches only dedicated preview accounts/paths/units and the LBI preview vhost.
Never reads/prints the client password. Upload a hash into a root-only staging
directory; source and configuration are verified before services are activated.
"""
import argparse
from datetime import datetime, timezone
import grp
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import pwd
import re
import shutil
import subprocess
import tarfile
import time
import urllib.error
import urllib.request

BASE = Path('/srv/lbi-preview')
DATA = Path('/var/lib/lbi-preview-project-admin')
PUBLISH = Path('/var/www/strony/lbi')
ENV_DIR = Path('/etc/lbi-preview')
CACHE = Path('/var/cache/lbi-preview-builder')
SPOOL = Path('/var/spool/lbi-preview-builder')
BACKUPS = Path('/var/backups/lbi-preview')
ADMIN = 'lbi-preview-admin'
BUILDER = 'lbi-preview-builder'
BUILD_GROUP = 'lbi-preview-build'
ORIGIN = 'https://lbi-preview.178-105-195-84.sslip.io'
NGINX = Path('/etc/nginx/sites-available/lbi-preview')
UNITS = (ADMIN + '.service', BUILDER + '.service')

def require(condition, message):
    if not condition:
        raise RuntimeError(message)

def digest(file):
    with file.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()

def run(*args, **kwargs):
    return subprocess.run(args, check=True, capture_output=True, text=True, **kwargs)

def real_directory(directory, mode=0o755):
    directory.mkdir(parents=True, exist_ok=True, mode=mode)
    require(directory.resolve() == directory and not directory.is_symlink(), 'Directory must not traverse links: ' + str(directory))
    require(directory.is_dir(), 'Expected directory: ' + str(directory))
    directory.chmod(mode)

def write_atomic(file, value, mode=0o644):
    temporary = file.with_name('.' + file.name + '.preview-install.tmp')
    require(not temporary.exists() and not temporary.is_symlink(), 'Temporary install file already exists')
    with temporary.open('x') as output:
        os.chmod(temporary, mode)
        output.write(value)
        output.flush()
        os.fsync(output.fileno())
    os.replace(temporary, file)

def check_configs(preflight, allow_lbi=None):
    require({file.name for file in Path('/etc/nginx/sites-enabled').iterdir()} == set(preflight['protected_configs']), 'Enabled nginx configuration set changed')
    for name, expected in preflight['protected_configs'].items():
        file = Path('/etc/nginx/sites-enabled') / name
        require(digest(file) == (allow_lbi if name == 'lbi-preview' and allow_lbi else expected), 'Nginx config drift: ' + name)

def wait_panel_http(url, expected_hash, headers=None, public=False):
    # systemctl start/reload may return while app loading or old nginx workers
    # still serve requests. Keep TLS verification and demand the exact UI bytes.
    deadline = time.monotonic() + 30
    request = urllib.request.Request(url, headers=headers or {})
    while True:
        try:
            with urllib.request.urlopen(request, timeout=2) as response:
                ready = (response.status == 200 and response.geturl() == url and
                         hashlib.sha256(response.read(1024 * 1024)).hexdigest() == expected_hash and
                         (not public or 'noindex' in response.headers.get('X-Robots-Tag', '')))
            if ready:
                return
        except urllib.error.URLError:
            pass
        require(time.monotonic() < deadline, 'Panel HTTP readiness timed out')
        units = (*UNITS, 'nginx') if public else UNITS
        require(all(subprocess.run(['systemctl', 'is-active', '--quiet', unit]).returncode == 0 for unit in units), 'Owned service failed during readiness check')
        time.sleep(0.5)

def prepare_source(archive, expected_hash, manifest, destination):
    # A root-private upgrade transaction may use 0077. Public immutable source
    # and dependency parents must still be traversable by the separate UIDs.
    previous_umask = os.umask(0o022)
    try:
        _prepare_public_source(archive, expected_hash, manifest, destination)
    finally:
        os.umask(previous_umask)


def _prepare_public_source(archive, expected_hash, manifest, destination):
    require(digest(archive) == expected_hash, 'Public source archive hash mismatch')
    require(not destination.exists(), 'Immutable source version already exists')
    inventory = {item['path']: item for item in manifest['files']}
    require(len(inventory) == len(manifest['files']) <= 20000, 'Invalid source manifest')
    require(sum(item['size'] for item in inventory.values()) <= 256 * 1024 * 1024, 'Source exceeds quota')
    with tarfile.open(archive, 'r:gz') as packed:
        files = {}
        for member in packed.getmembers():
            name = PurePosixPath(member.name)
            require(not name.is_absolute() and '..' not in name.parts, 'Unsafe source path')
            require(member.isdir() or member.isfile(), 'Source links/special files forbidden')
            require(name.parts and name.parts[0] == 'source', 'Unexpected source archive root')
            if member.isfile():
                relative = str(PurePosixPath(*name.parts[1:]))
                require(relative in inventory and relative not in files, 'Unexpected or duplicate source member')
                require(member.size == inventory[relative]['size'], 'Source size mismatch')
                files[relative] = member
        require(set(files) == set(inventory), 'Incomplete source archive')
        real_directory(destination)
        for relative, member in files.items():
            content = packed.extractfile(member).read()
            require(hashlib.sha256(content).hexdigest() == inventory[relative]['sha256'], 'Source SHA mismatch')
            target = destination / relative
            real_directory(target.parent)
            with target.open('xb') as output:
                output.write(content)
            target.chmod(0o644)
    # npm rejects one file being loaded as both the user and global config.
    # Use distinct fresh empty files so no operator/provider config is inherited.
    npm_configs = (BASE / (destination.name + '-empty-user.npmrc'),
                   BASE / (destination.name + '-empty-global.npmrc'))
    for config in npm_configs:
        with config.open('x') as output:
            os.chmod(config, 0o600)
            output.write('')
    environment = {'PATH': '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin', 'LANG': 'C.UTF-8',
                   'npm_config_userconfig': str(npm_configs[0]), 'npm_config_globalconfig': str(npm_configs[1]),
                   'npm_config_cache': str(BASE / 'install-npm-cache'), 'npm_config_registry': 'https://registry.npmjs.org'}
    install = run('/usr/bin/npm', 'ci', '--ignore-scripts', '--no-fund', '--no-audit', cwd=destination, env=environment, timeout=600)
    (destination.parent / (destination.name + '-npm-install.log')).write_text(install.stdout)
    # npm's packaged executable modes are intentionally preserved.
    run('/usr/bin/node', '-e', 'const p=require("./node_modules/astro/package.json");if(p.version!=="7.3.8")process.exit(1);require("sharp");', cwd=destination, env=environment)

def prepare(args, preflight, state):
    require(os.geteuid() == 0, 'Root required for dedicated preview installation')
    check_configs(preflight)
    for site, item in preflight['sites'].items():
        current = Path('/var/www/strony') / site / 'current'
        require(str(current.resolve(strict=True)) == item['target'], 'Current site drift before preparation')
        require(digest(current / 'index.html') == item['sha256'], 'Homepage drift before preparation')
    for account in (ADMIN, BUILDER):
        require(not preflight['accounts'][account]['exists'], 'This first-install workflow does not overwrite an existing panel')
        try:
            pwd.getpwnam(account)
        except KeyError:
            pass
        else:
            raise RuntimeError('Preview account appeared since preflight')
    for file in (ENV_DIR / 'project-admin.env', *(Path('/etc/systemd/system') / unit for unit in UNITS)):
        require(not file.exists() and not file.is_symlink(), 'Existing preview service/config must not be overwritten')
    for directory in (BASE, DATA, ENV_DIR, CACHE, SPOOL, BACKUPS):
        require(not directory.exists() and not directory.is_symlink(), 'First install requires unused preview paths: ' + str(directory))
    require(not Path('/etc/tmpfiles.d/lbi-preview-builder.conf').exists(), 'Preview tmpfiles configuration already exists')
    require(not any(line.startswith(BUILD_GROUP + ':') for line in Path('/etc/group').read_text().splitlines()), 'Preview build group already exists')
    require(args.password_hash.parent == args.state.parent and args.password_hash.resolve() == args.password_hash,
            'Password hash must be inside the exact private install staging directory')
    require(args.password_hash.is_file() and not args.password_hash.is_symlink(), 'Password hash must be a regular private staging file')
    require(args.password_hash.stat().st_uid == 0 and args.password_hash.stat().st_mode & 0o077 == 0,
            'Staged password hash must be root-owned and private')
    password_record = json.loads(args.password_hash.read_text())
    require(password_record.get('algorithm') == 'scrypt', 'Expected a scrypt password record')
    real_directory(BASE)
    real_directory(BACKUPS, 0o700)
    backup = BACKUPS / ('install-' + args.commit[:12])
    require(not backup.exists(), 'Installation backup already exists')
    real_directory(backup, 0o700)
    shutil.copyfile(NGINX, backup / 'lbi-preview.nginx.before')
    (backup / 'preflight-before.json').write_text(json.dumps(preflight, indent=2) + '\n')
    (backup / 'preflight-before.json').chmod(0o600)
    source = BASE / ('source-' + args.commit)
    manifest = json.loads(args.source_manifest.read_text(encoding='utf-8-sig'))
    require(manifest.get('sourceCommit') == args.commit and manifest.get('committedTree') is True,
            'Preview source must be an exact committed Git tree matching --commit')
    prepare_source(args.source_archive, args.source_sha256, manifest, source)
    run('/usr/bin/node', '--input-type=module', '-e',
        'import fs from "node:fs";import {validatePasswordRecord} from "./server/project-admin/security.mjs";validatePasswordRecord(JSON.parse(fs.readFileSync(process.argv[1],"utf8")));',
        str(args.password_hash), cwd=source)
    run('groupadd', '--system', BUILD_GROUP)
    run('useradd', '--system', '--no-create-home', '--home-dir', '/nonexistent', '--shell', '/usr/sbin/nologin', '--user-group', ADMIN)
    run('usermod', '--append', '--groups', BUILD_GROUP, ADMIN)
    run('useradd', '--system', '--no-create-home', '--home-dir', '/nonexistent', '--shell', '/usr/sbin/nologin', '--gid', BUILD_GROUP, BUILDER)
    real_directory(DATA, 0o700)
    real_directory(DATA / 'auth', 0o700)
    shutil.copyfile(args.password_hash, DATA / 'auth/password.json')
    (DATA / 'auth/password.json').chmod(0o600)
    admin_uid, admin_gid = pwd.getpwnam(ADMIN).pw_uid, pwd.getpwnam(ADMIN).pw_gid
    for target in (DATA, DATA / 'auth', DATA / 'auth/password.json'):
        os.chown(target, admin_uid, admin_gid)
    real_directory(ENV_DIR, 0o700)
    environment = '\n'.join([
        'LBI_ADMIN_ORIGIN=' + ORIGIN,
        'LBI_ADMIN_SOURCE_DIR=' + str(source),
        'LBI_ADMIN_DATA_DIR=' + str(DATA),
        'LBI_ADMIN_PUBLISH_ROOT=' + str(PUBLISH),
        'LBI_ADMIN_PORT=4335',
        'LBI_ADMIN_BUILDER_SOCKET=/run/lbi-preview-builder/builder.sock',
        'LBI_ADMIN_BUILDER_REQUEST_DIR=/var/spool/lbi-preview-builder/requests',
        'LBI_ADMIN_PREVIEW_PROFILE=' + str(source / 'deploy/hetzner-preview.json'), '',
    ])
    write_atomic(ENV_DIR / 'project-admin.env', environment, 0o600)
    replacements = [
        ('/srv/lbi/source', str(source)), ('/var/lib/lbi-project-admin', str(DATA)),
        ('/srv/lbi/published', str(PUBLISH)), ('/etc/lbi', str(ENV_DIR)),
        ('/var/cache/lbi-project-builder', str(CACHE)), ('/var/spool/lbi-project-builder', str(SPOOL)),
        ('/run/lbi-project-builder', '/run/lbi-preview-builder'),
        ('lbi-project-builder', BUILDER), ('lbi-project-admin', ADMIN), ('lbi-project-build', BUILD_GROUP),
    ]
    def template(file):
        value = (source / 'deploy' / file).read_text()
        for old, new in replacements:
            value = value.replace(old, new)
        return value
    tmpfiles = Path('/etc/tmpfiles.d/lbi-preview-builder.conf')
    write_atomic(tmpfiles, template('project-admin-builder.tmpfiles.example'))
    run('systemd-tmpfiles', '--create', str(tmpfiles))
    for unit, file in ((UNITS[0], 'project-admin.service.example'), (UNITS[1], 'project-admin-builder.service.example')):
        write_atomic(Path('/etc/systemd/system') / unit, template(file))
    run('systemd-analyze', 'verify', *(str(Path('/etc/systemd/system') / unit) for unit in UNITS))
    run('systemctl', 'daemon-reload')
    state.update({'status': 'PREPARED', 'source': str(source), 'backup': str(backup), 'source_sha256': args.source_sha256,
                  'source_commit': args.commit, 'previous': {site: item['target'] for site, item in preflight['sites'].items()}})

def activate(preflight, state):
    require(state.get('status') in ('PREPARED', 'ACTIVATION_ROLLED_BACK') and not state.get('rollback_errors'), 'Prepared or completely rolled-back installation state required')
    if state.get('status') == 'ACTIVATION_ROLLED_BACK':
        require(all(subprocess.run(['systemctl', 'is-active', '--quiet', unit]).returncode != 0 for unit in UNITS), 'Recovered services must still be stopped before an explicit retry')
    check_configs(preflight)
    backup = Path(state['backup'])
    original = (backup / 'lbi-preview.nginx.before').read_text()
    require(digest(NGINX) == preflight['protected_configs']['lbi-preview'], 'LBI config drift')
    # Only add locations to the existing TLS host; preserve ACME/certificates.
    anchor = '    location ^~ /admin/ {'
    require(original.count(anchor) == 1 and 'location ^~ /beheer/' not in original, 'Unexpected LBI vhost layout')
    headers = '''        add_header X-Robots-Tag "noindex, nofollow, noarchive" always;
        add_header X-Content-Type-Options "nosniff" always;
        add_header Cache-Control "no-store" always;
'''
    proxy = '''        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_pass http://127.0.0.1:4335;
        proxy_buffering off;
'''
    locations = '    location = /beheer/api/login {\n        limit_req zone=lbi_preview_login_per_ip burst=3 nodelay;\n        limit_req_status 429;\n        client_max_body_size 16k;\n' + proxy + headers + '    }\n\n'
    locations += '    location ^~ /beheer/ {\n        client_max_body_size 10m;\n        proxy_read_timeout 300s;\n        proxy_send_timeout 300s;\n' + proxy + headers + '    }\n\n'
    changed = 'limit_req_zone $binary_remote_addr zone=lbi_preview_login_per_ip:10m rate=5r/m;\n\n' + original.replace(anchor, locations + anchor)
    state['nginx_after_sha256'] = hashlib.sha256(changed.encode()).hexdigest()
    state['ownership_before'] = []
    admin = pwd.getpwnam(ADMIN)
    for target in (PUBLISH, PUBLISH / 'releases'):
        require(target.is_dir() and target.resolve() == target, 'Publish directory unsafe')
        entry = target.stat()
        state['ownership_before'].append({'path': str(target), 'uid': entry.st_uid, 'gid': entry.st_gid, 'mode': entry.st_mode & 0o7777})
    try:
        for entry in state['ownership_before']:
            os.chown(entry['path'], admin.pw_uid, admin.pw_gid)
            os.chmod(entry['path'], 0o755)
        run('systemctl', 'start', BUILDER + '.service')
        run('systemctl', 'start', ADMIN + '.service')
        run('systemctl', 'is-active', *UNITS)
        frontend_hash = digest(Path(state['source']) / 'public/beheer/projecten/index.html')
        wait_panel_http('http://127.0.0.1:4335/beheer/projecten/', frontend_hash, {'Host': ORIGIN.split('://')[1]})
        write_atomic(NGINX, changed)
        run('nginx', '-t')
        check_configs(preflight, state['nginx_after_sha256'])
        run('systemctl', 'reload', 'nginx')
        wait_panel_http(ORIGIN + '/beheer/projecten/', frontend_hash, public=True)
        run('systemctl', 'enable', *UNITS)
        state['status'] = 'ACTIVE'
    except Exception:
        subprocess.run(['systemctl', 'disable', *UNITS], capture_output=True)
        recovery_errors = []
        try:
            if digest(NGINX) == state['nginx_after_sha256']:
                write_atomic(NGINX, original)
                run('nginx', '-t')
                run('systemctl', 'reload', 'nginx')
            else:
                require(digest(NGINX) == preflight['protected_configs']['lbi-preview'], 'Intervening nginx edit blocks rollback')
        except Exception as error:
            recovery_errors.append(type(error).__name__ + ': nginx recovery')
        stopped = subprocess.run(['systemctl', 'stop', *UNITS], capture_output=True)
        if stopped.returncode:
            recovery_errors.append('Service stop failed')
        for entry in state['ownership_before']:
            try:
                os.chown(entry['path'], entry['uid'], entry['gid'])
                os.chmod(entry['path'], entry['mode'])
            except Exception:
                recovery_errors.append('Ownership recovery failed: ' + entry['path'])
        state['status'] = 'ACTIVATION_ROLLBACK_INCOMPLETE' if recovery_errors else 'ACTIVATION_ROLLED_BACK'
        state['rollback_errors'] = recovery_errors
        raise

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=('prepare', 'activate'))
    parser.add_argument('--preflight', type=Path, required=True)
    parser.add_argument('--state', type=Path, required=True)
    parser.add_argument('--commit')
    parser.add_argument('--source-archive', type=Path)
    parser.add_argument('--source-manifest', type=Path)
    parser.add_argument('--source-sha256')
    parser.add_argument('--password-hash', type=Path)
    args = parser.parse_args()
    parent = args.state.parent
    require(parent.is_dir() and parent.resolve() == parent and not args.state.is_symlink(), 'Install state must be in a real private staging directory')
    require(parent.stat().st_uid == 0 and parent.stat().st_mode & 0o077 == 0, 'Install staging directory must be root-only')
    preflight = json.loads(args.preflight.read_text(encoding='utf-8-sig'))
    state = json.loads(args.state.read_text()) if args.state.exists() else {'createdAt': datetime.now(timezone.utc).isoformat()}
    try:
        if args.action == 'prepare':
            require(not args.state.exists(), 'Installation state already exists')
            require(args.commit and re.fullmatch('[a-f0-9]{40}', args.commit), 'Exact Git commit required')
            require(args.source_sha256 and re.fullmatch('[a-f0-9]{64}', args.source_sha256), 'Exact source hash required')
            require(args.source_archive and args.source_manifest and args.password_hash, 'Source and private hash inputs required')
            state['status'] = 'PREPARING'
            try:
                prepare(args, preflight, state)
            except Exception:
                state['status'] = 'PREPARATION_FAILED_NO_ACTIVATION'
                # Preserve dedicated paths for inspection. Nothing is started,
                # enabled, or exposed; reruns refuse to overwrite this state.
                raise
        else:
            activate(preflight, state)
    finally:
        write_atomic(args.state, json.dumps(state, indent=2) + '\n', 0o600)
    print(json.dumps(state, indent=2))

if __name__ == '__main__':
    main()
