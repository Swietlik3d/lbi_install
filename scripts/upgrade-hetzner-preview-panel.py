"""Guarded immutable-source upgrade of the already installed LBI preview panel.

Preserves private state, static releases, enabled state and all nginx configs.
Only the two dedicated units and their non-secret source-path environment are
switched. A failed activation restores their previous configuration.
"""
import argparse
from datetime import datetime, timezone
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import subprocess

spec = importlib.util.spec_from_file_location('preview_install', Path(__file__).with_name('install-hetzner-preview-panel.py'))
install = importlib.util.module_from_spec(spec)
spec.loader.exec_module(install)
require = install.require


def guard_sites(preflight):
    require(set(preflight['sites']) == {'lbi', 'elektra', 'lekkage', 'gas'}, 'Exact four-site snapshot required')
    install.check_configs(preflight)
    for site, entry in preflight['sites'].items():
        current = Path('/var/www/strony') / site / 'current'
        require(current.is_symlink() and str(current.resolve(strict=True)) == entry['target'], 'Intervening preview release')
        require(install.digest(current / 'index.html') == entry['sha256'], 'Intervening preview content')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--preflight', type=Path, required=True)
    parser.add_argument('--state', type=Path, required=True)
    parser.add_argument('--before-source', type=Path, required=True)
    parser.add_argument('--commit', required=True)
    parser.add_argument('--source-archive', type=Path, required=True)
    parser.add_argument('--source-manifest', type=Path, required=True)
    parser.add_argument('--source-sha256', required=True)
    args = parser.parse_args()
    require(os.geteuid() == 0, 'Root-only preview upgrade')
    os.umask(0o077)
    staging = args.state.parent
    require(staging.resolve() == staging and staging.is_dir() and staging.stat().st_uid == 0 and staging.stat().st_mode & 0o077 == 0, 'Private root-owned staging required')
    require(not args.state.exists() and not args.state.is_symlink(), 'Upgrade state already exists')
    for file in (args.preflight, args.source_archive, args.source_manifest):
        require(file.parent == staging and file.resolve() == file and file.is_file() and not file.is_symlink() and file.stat().st_uid == 0, 'Unsafe upgrade input')
    require(re.fullmatch('[a-f0-9]{40}', args.commit) and re.fullmatch('[a-f0-9]{64}', args.source_sha256), 'Exact source identity required')
    before = args.before_source
    require(before.parent == install.BASE and re.fullmatch('source-[a-f0-9]{40}', before.name) and before.resolve() == before and before.is_dir(), 'Previous immutable source unsafe')
    require(install.BASE.resolve() == install.BASE and install.BASE.stat().st_uid == 0 and install.BASE.stat().st_mode & 0o022 == 0, 'Immutable source parent unsafe')
    source = install.BASE / ('source-' + args.commit)
    require(source != before, 'Source must change')
    preflight = json.loads(args.preflight.read_text(encoding='utf-8-sig'))
    guard_sites(preflight)
    require(all(subprocess.run(['systemctl', 'is-active', '--quiet', unit]).returncode == 0 and subprocess.run(['systemctl', 'is-enabled', '--quiet', unit]).returncode == 0 for unit in install.UNITS), 'Existing panel must be active and enabled')
    require(not (install.DATA / 'publication-pending.json').exists(), 'Pending publication blocks upgrade')
    files = (install.ENV_DIR / 'project-admin.env', *(Path('/etc/systemd/system') / unit for unit in install.UNITS))
    originals, replacements = {}, {}
    for file in files:
        require(file.resolve() == file and file.is_file() and not file.is_symlink() and file.stat().st_uid == 0, 'Owned configuration unsafe')
        value = file.read_text()
        require(str(before) in value and str(source) not in value, 'Previous source configuration mismatch')
        originals[file] = value
        replacements[file] = value.replace(str(before), str(source))
    env = originals[files[0]].splitlines()
    require('LBI_ADMIN_SOURCE_DIR=' + str(before) in env and 'LBI_ADMIN_PREVIEW_PROFILE=' + str(before / 'deploy/hetzner-preview.json') in env, 'Exact previous source/profile required')
    manifest = json.loads(args.source_manifest.read_text(encoding='utf-8-sig'))
    require(manifest.get('sourceCommit') == args.commit and manifest.get('committedTree') is True, 'Exact committed source manifest required')
    state = {'createdAt': datetime.now(timezone.utc).isoformat(), 'status': 'PREPARING', 'before_source': str(before), 'source': str(source), 'source_commit': args.commit, 'source_sha256': args.source_sha256}
    stopped = False
    modified = []
    backup = None
    try:
        install.prepare_source(args.source_archive, args.source_sha256, manifest, source)
        # Refuse incomplete/new syntax errors before touching a running service.
        for script in ('index.mjs', 'builder.mjs', 'isolated-builder.mjs'):
            install.run('/usr/bin/node', '--check', str(source / 'server/project-admin' / script))
        guard_sites(preflight)
        require(not (install.DATA / 'publication-pending.json').exists(), 'Publication started during preparation')
        for file, value in originals.items():
            require(file.read_text() == value, 'Configuration changed during preparation')
        require(install.BACKUPS.resolve() == install.BACKUPS and install.BACKUPS.stat().st_mode & 0o077 == 0, 'Private backup root required')
        backup = install.BACKUPS / ('source-upgrade-' + args.commit[:12])
        backup.mkdir(mode=0o700)
        for file in files:
            shutil.copyfile(file, backup / file.name)
            (backup / file.name).chmod(0o600)
        state['backup'] = str(backup)
        state['status'] = 'UPGRADING'
        stopped = True
        install.run('systemctl', 'stop', *install.UNITS)
        require(not (install.DATA / 'publication-pending.json').exists(), 'Pending publication after stop')
        guard_sites(preflight)
        for file, value in replacements.items():
            require(file.read_text() == originals[file], 'Configuration drift before switch')
            install.write_atomic(file, value, 0o600 if file == files[0] else 0o644)
            modified.append(file)
        install.run('systemd-analyze', 'verify', *(str(file) for file in files[1:]))
        install.run('systemctl', 'daemon-reload')
        install.run('systemctl', 'start', install.UNITS[1])
        install.run('systemctl', 'start', install.UNITS[0])
        frontend_hash = install.digest(source / 'public/beheer/projecten/index.html')
        install.wait_panel_http('http://127.0.0.1:4335/beheer/projecten/', frontend_hash, {'Host': install.ORIGIN.split('://')[1]})
        install.wait_panel_http(install.ORIGIN + '/beheer/projecten/', frontend_hash, public=True)
        for unit in install.UNITS:
            install.run('systemctl', 'is-active', unit)
        guard_sites(preflight)
        state['status'] = 'ACTIVE'
        state['static_and_nginx_unchanged'] = True
    except Exception:
        errors = []
        if stopped:
            stop = subprocess.run(['systemctl', 'stop', *install.UNITS], capture_output=True)
            if stop.returncode:
                errors.append('Owned services failed to stop')
            for file in reversed(modified):
                try:
                    require(file.read_text() == replacements[file], 'Intervening configuration blocks rollback')
                    install.write_atomic(file, originals[file], 0o600 if file == files[0] else 0o644)
                except Exception:
                    errors.append('Configuration recovery: ' + file.name)
            if not errors:
                try:
                    install.run('systemctl', 'daemon-reload')
                    install.run('systemctl', 'start', install.UNITS[1])
                    install.run('systemctl', 'start', install.UNITS[0])
                    install.wait_panel_http(install.ORIGIN + '/beheer/projecten/', install.digest(before / 'public/beheer/projecten/index.html'), public=True)
                    for unit in install.UNITS:
                        install.run('systemctl', 'is-active', unit)
                except Exception:
                    errors.append('Previous service recovery failed')
            if errors:
                subprocess.run(['systemctl', 'stop', *install.UNITS], capture_output=True)
        state['status'] = 'UPGRADE_ROLLBACK_INCOMPLETE' if errors else ('UPGRADE_ROLLED_BACK' if stopped else 'PREPARATION_FAILED_NO_SWITCH')
        state['rollback_errors'] = errors
        raise
    finally:
        install.write_atomic(args.state, json.dumps(state, indent=2) + '\n', 0o600)
    print(json.dumps(state, indent=2))


if __name__ == '__main__':
    main()
