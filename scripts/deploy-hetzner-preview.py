"""Validate a prepared static bundle, stage releases, and atomically update existing preview links.

Run on the existing Hetzner host with an archive, its SHA-256, and a captured preflight JSON.
No service restarts, nginx edits, application operations, or old release deletions.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import ssl
import subprocess
import tarfile
import urllib.error
import urllib.request
import urllib.parse

ROOT = Path('/var/www/strony')
SITES = ('lbi', 'elektra', 'lekkage', 'gas')
HOSTS = {site: f'https://{site}-preview.178-105-195-84.sslip.io' for site in SITES}


def digest(path):
    with path.open('rb') as handle:
        return hashlib.file_digest(handle, 'sha256').hexdigest()


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def request(url):
    try:
        with urllib.request.urlopen(url, timeout=25, context=ssl.create_default_context()) as response:
            return response.status, response.headers, response.read()
    except urllib.error.HTTPError as error:
        return error.code, error.headers, error.read()


def replace_link(site, destination, release):
    parent = ROOT / site
    temporary = parent / f'.current-{release}.tmp'
    require(not temporary.exists() and not temporary.is_symlink(), f'Temporary link exists: {temporary}')
    temporary.symlink_to(destination)
    os.replace(temporary, parent / 'current')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--archive', type=Path, required=True)
    parser.add_argument('--sha256', required=True)
    parser.add_argument('--preflight', type=Path, required=True)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    require(re.fullmatch(r'[a-f0-9]{64}', args.sha256), 'Invalid archive hash')
    require(digest(args.archive) == args.sha256, 'Archive SHA-256 mismatch')
    before = json.loads(args.preflight.read_text(encoding='utf-8-sig'))
    require({file.name for file in Path('/etc/nginx/sites-enabled').iterdir()} == set(before['protected_configs']), 'Enabled nginx configuration set changed')
    previous = {}
    for site in SITES:
        link = ROOT / site / 'current'
        require(link.is_symlink(), f'Current is not a symlink: {site}')
        target = link.resolve(strict=True)
        require(target.parent == ROOT / site / 'releases', f'Unexpected target: {target}')
        require(str(target) == before['sites'][site]['target'], f'Current changed since preflight: {site}')
        require(digest(target / 'index.html') == before['sites'][site]['sha256'], f'Current content changed: {site}')
        previous[site] = target
    for name, expected in before['protected_configs'].items():
        require(digest(Path('/etc/nginx/sites-enabled') / name) == expected, f'Configuration changed: {name}')
    subprocess.run(['nginx', '-t'], check=True, capture_output=True)
    with tarfile.open(args.archive, 'r:gz') as archive:
        members = archive.getmembers()
        regular = {}
        for member in members:
            entry = PurePosixPath(member.name)
            require(not entry.is_absolute() and '..' not in entry.parts, 'Unsafe archive path')
            require(member.isfile() or member.isdir(), 'Links/special files are not allowed')
            parts = entry.parts
            if not parts:
                require(member.isdir(), 'Archive root must be a directory')
                continue
            require(parts[0] in SITES or (parts == ('manifest.json',) and member.isfile()), 'Unexpected archive root')
            require(not any(part.startswith('.') or part in ('admin', 'beheer', 'concept') for part in parts), 'Excluded path in archive')
            if member.isfile():
                name = str(entry)
                require(name not in regular, 'Duplicate archive member')
                regular[name] = member
        require('manifest.json' in regular, 'Missing manifest')
        manifest = json.load(archive.extractfile(regular['manifest.json']))
        release = manifest['release']
        require(re.fullmatch(r'\d{8}T\d{6}Z', release), 'Invalid release ID')
        require(set(manifest['sites']) == set(SITES), 'Site set mismatch')
        require(all(manifest['sites'][site]['origin'] == HOSTS[site] for site in SITES), 'Preview origin mismatch')
        files = {item['path']: item for item in manifest['files']}
        require(len(files) == len(manifest['files']), 'Duplicate manifest member')
        require(all(re.fullmatch(r'(lbi|elektra|lekkage|gas)/.+', name) for name in files), 'Manifest file outside site root')
        require(set(regular) == set(files) | {'manifest.json'}, 'Manifest inventory mismatch')
        for site in SITES:
            require(f'{site}/index.html' in files and f'{site}/robots.txt' in files, f'Missing site entrypoints: {site}')
        total = 0
        for name, item in files.items():
            member = regular[name]
            require(member.size == item['bytes'], f'File size mismatch: {name}')
            content = archive.extractfile(member).read()
            require(hashlib.sha256(content).hexdigest() == item['sha256'], f'File hash mismatch: {name}')
            total += member.size
        space = os.statvfs(ROOT)
        available = space.f_bavail * space.f_frsize
        root_free = space.f_bfree * space.f_frsize
        # This deploy runs as root. Keep a large reserve even if ext4's ordinary-user
        # reserve is exhausted; never delete another service's data to make room.
        usable = root_free if os.geteuid() == 0 else available
        require(usable > total * 2 + 256 * 1024 * 1024, 'Insufficient space for deployment and reserve')
        release_paths = {site: ROOT / site / 'releases' / release for site in SITES}
        require(all(not p.exists() for p in release_paths.values()), 'Release already exists')
        report = {'release': release, 'status': 'VALIDATED', 'archive_sha256': args.sha256, 'files': len(files), 'bytes': total, 'previous': {s: str(p) for s, p in previous.items()}, 'space': {'available': available, 'root_free': root_free}, 'configurations_changed': False}
        if not args.apply:
            print(json.dumps(report, indent=2))
            return
        for directory in release_paths.values():
            directory.mkdir(mode=0o755)
        # Extract only manifest-approved regular files; never trust archive permissions.
        for name, item in files.items():
            site, relative = name.split('/', 1)
            destination = release_paths[site] / relative
            destination.parent.mkdir(parents=True, exist_ok=True, mode=0o755)
            with destination.open('xb') as output, archive.extractfile(regular[name]) as source:
                shutil.copyfileobj(source, output)
            destination.chmod(0o644)
            require(digest(destination) == item['sha256'], f'Extracted file mismatch: {name}')
    rollback_file = ROOT / f'lbi-preview-rollback-{release}.json'
    require(not rollback_file.exists(), 'Rollback record already exists')
    rollback_file.write_text(json.dumps(report, indent=2) + '\n')
    switched = []
    try:
        for site in SITES:
            # Recheck before each swap to avoid overwriting an intervening deployment.
            require((ROOT / site / 'current').resolve() == previous[site], f'Current changed before switch: {site}')
            replace_link(site, release_paths[site], release)
            switched.append(site)
        for site in SITES:
            status, headers, body = request(HOSTS[site] + '/')
            require(status == 200, f'Homepage HTTP {status}: {site}')
            require(hashlib.sha256(body).hexdigest() == files[site + '/index.html']['sha256'], f'Live homepage hash mismatch: {site}')
            require('noindex' in headers.get('X-Robots-Tag', ''), f'Noindex header missing: {site}')
            require(b'noindex,nofollow,noarchive' in body, f'Noindex meta missing: {site}')
            status, _, body = request(HOSTS[site] + '/robots.txt')
            require(status == 200 and body == b'User-agent: *\nDisallow: /\n', f'Robots mismatch: {site}')
            status, _, _ = request(HOSTS[site] + '/admin/')
            require(status == 404, f'Admin is public: {site}')
        for name, expected in before['protected_configs'].items():
            require(digest(Path('/etc/nginx/sites-enabled') / name) == expected, f'Configuration changed: {name}')
        def verify_live_file(item):
            name, metadata = item
            site, relative = name.split('/', 1)
            status, headers, content = request(HOSTS[site] + '/' + urllib.parse.quote(relative, safe='/'))
            expected_status = 404 if relative == '404.html' else 200
            require(status == expected_status, f'Live file HTTP {status}: {name}')
            require(hashlib.sha256(content).hexdigest() == metadata['sha256'], f'Live file hash mismatch: {name}')
            require('noindex' in headers.get('X-Robots-Tag', ''), f'Noindex header missing: {name}')
            if relative.endswith('.js'):
                require('javascript' in headers.get('Content-Type', ''), f'JavaScript MIME mismatch: {name}')
        with ThreadPoolExecutor(max_workers=4) as pool:
            list(pool.map(verify_live_file, files.items()))
        report['live_files_verified'] = len(files)
    except Exception as deployment_error:
        rollback_errors = {}
        for site in reversed(switched):
            try:
                require((ROOT / site / 'current').resolve() == release_paths[site], f'Intervening deployment blocks rollback: {site}')
                replace_link(site, previous[site], release + '-rollback')
            except Exception as rollback_error:
                rollback_errors[site] = str(rollback_error)
        report['status'] = 'ROLLBACK_FAILED' if rollback_errors else 'ROLLED_BACK'
        report['deployment_error'] = str(deployment_error)
        report['rollback_errors'] = rollback_errors
        rollback_file.write_text(json.dumps(report, indent=2) + '\n')
        raise
    report['status'] = 'DEPLOYED'
    report['current'] = {site: str(p) for site, p in release_paths.items()}
    rollback_file.write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
