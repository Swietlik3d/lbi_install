"""Read-only inventory for the four LBI preview hosts; never reads credentials."""
import hashlib
import json
import os
from pathlib import Path
import pwd
import grp
import subprocess
from datetime import datetime, timezone

ROOT = Path('/var/www/strony')
SITES = ('lbi', 'elektra', 'lekkage', 'gas')

def sha256(file):
    with file.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()

def command(*args):
    result = subprocess.run(args, capture_output=True, text=True, check=False)
    return {'exit_code': result.returncode, 'stdout': result.stdout.strip(), 'stderr': result.stderr.strip()}

def metadata(path):
    if not path.exists() and not path.is_symlink():
        return {'exists': False}
    item = path.lstat()
    return {'exists': True, 'symlink': path.is_symlink(), 'owner': pwd.getpwuid(item.st_uid).pw_name,
            'group': grp.getgrgid(item.st_gid).gr_name, 'mode': oct(item.st_mode & 0o7777),
            'resolved': str(path.resolve())}

report = {'checkedAt': datetime.now(timezone.utc).isoformat(), 'sites': {}, 'protected_configs': {},
          'nginx': command('systemctl', 'is-active', 'nginx'), 'nginx_test': command('nginx', '-t'),
          'node': command('node', '--version'), 'listeners': command('ss', '-lnt'), 'accounts': {}, 'paths': {}}
for site in SITES:
    link = ROOT / site / 'current'
    if not link.is_symlink():
        raise RuntimeError('Current preview must be a symlink: ' + site)
    target = link.resolve(strict=True)
    if target.parent != ROOT / site / 'releases':
        raise RuntimeError('Unexpected preview release: ' + str(target))
    report['sites'][site] = {'target': str(target), 'sha256': sha256(target / 'index.html'),
                            'root': metadata(ROOT / site), 'release': metadata(target)}
for config in sorted(Path('/etc/nginx/sites-enabled').iterdir()):
    report['protected_configs'][config.name] = sha256(config)
report['lbi_nginx_config'] = Path('/etc/nginx/sites-available/lbi-preview').read_text()
for name in ('lbi-preview-admin', 'lbi-preview-builder'):
    try:
        entry = pwd.getpwnam(name)
        report['accounts'][name] = {'exists': True, 'uid': entry.pw_uid, 'gid': entry.pw_gid,
                                    'home': entry.pw_dir, 'shell': entry.pw_shell}
    except KeyError:
        report['accounts'][name] = {'exists': False}
for directory in ('/srv/lbi-preview', '/var/lib/lbi-preview-project-admin', '/etc/lbi-preview',
                  '/var/cache/lbi-preview-builder', '/var/spool/lbi-preview-builder', '/var/backups/lbi-preview'):
    report['paths'][directory] = metadata(Path(directory))
stats = os.statvfs(ROOT)
report['space'] = {'available': stats.f_bavail * stats.f_frsize, 'root_free': stats.f_bfree * stats.f_frsize}
print(json.dumps(report, indent=2))
