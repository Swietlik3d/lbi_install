"""Guarded preview recovery and quarantine of the exact owned synthetic QA data.

No recursive deletes. Unknown project data, intervening publications/configuration
and arbitrary paths cause a refusal before mutation. No password/cookies read.
"""
import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import subprocess

ROOT = Path('/var/www/strony')
DATA = Path('/var/lib/lbi-preview-project-admin')
BACKUPS = Path('/var/backups/lbi-preview')
SITES = ('lbi', 'elektra', 'lekkage', 'gas')
SERVICE = 'lbi-preview-admin.service'
ORIGIN = 'https://lbi-preview.178-105-195-84.sslip.io'
UUID = r'[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}'

def require(condition, message):
    if not condition:
        raise RuntimeError(message)

def safe_release(site, value):
    target = Path(value)
    require(target.parent == ROOT / site / 'releases' and target.is_dir() and target.resolve() == target, 'Release outside fixed root or unsafe')
    return target

def switch(site, target):
    temporary = ROOT / site / '.current-owned-preview-recovery.tmp'
    require(not temporary.exists() and not temporary.is_symlink(), 'Recovery link already exists')
    temporary.symlink_to(target)
    os.replace(temporary, ROOT / site / 'current')

def rollback_static(report_file):
    report = json.loads(report_file.read_text(encoding='utf-8-sig'))
    require(report['status'] == 'DEPLOYED' and set(report['current']) == set(SITES) and set(report['previous']) == set(SITES), 'Exact successful deployment report required')
    previous, current = {}, {}
    for site in SITES:
        previous[site] = safe_release(site, report['previous'][site])
        current[site] = safe_release(site, report['current'][site])
        require((ROOT / site / 'current').resolve(strict=True) == current[site], 'Intervening release blocks recovery: ' + site)
    require(subprocess.run(['systemctl', 'is-active', '--quiet', SERVICE]).returncode != 0, 'Stop the owned panel before restoring all four previews')
    switched = []
    try:
        for site in SITES:
            require((ROOT / site / 'current').resolve() == current[site], 'Current drift during rollback')
            switch(site, previous[site])
            switched.append(site)
    except Exception:
        for site in reversed(switched):
            if (ROOT / site / 'current').resolve() == previous[site]:
                switch(site, current[site])
        raise
    return {'status': 'STATIC_ROLLED_BACK', 'current': {site: str(target) for site, target in previous.items()}}

def clean_qa(report_file, original_release):
    report = json.loads(report_file.read_text(encoding='utf-8-sig'))
    require(report.get('status') == 'PASS' and report.get('origin') == ORIGIN, 'Successful exact preview QA report required')
    marker = report['marker']
    require(marker.startswith('LBI PREVIEW QA ') and len(marker) <= 100, 'Explicit bounded QA marker required')
    project_id, draft_id, cover = report['projectId'], report['draftId'], report['cover']
    require(re.fullmatch(UUID, project_id) and re.fullmatch(UUID, draft_id) and project_id != draft_id, 'QA IDs invalid')
    require(re.fullmatch(UUID + r'\.webp', cover), 'QA media name invalid')
    original = safe_release('lbi', str(original_release))
    require(str(original) == report.get('beforeCurrent'), 'Original release must match the exact pre-QA current')
    require(DATA.is_dir() and DATA.resolve() == DATA and BACKUPS.resolve() == BACKUPS, 'Private paths unsafe')
    active = subprocess.run(['systemctl', 'is-active', '--quiet', SERVICE]).returncode == 0
    if active:
        subprocess.run(['systemctl', 'stop', SERVICE], check=True)
    moved = []
    published = None
    current_switched = False
    restart_safe = True
    quarantine = None
    try:
        require(not (DATA / 'publication-pending.json').exists(), 'Publication journal pending; refuse cleanup')
        actual_ids = {file.stem for file in (DATA / 'records').glob('*.json')}
        require(actual_ids == set(report['afterProjectIds']), 'Project inventory changed since QA')
        require(actual_ids - {project_id, draft_id} == set(report['beforeProjectIds']), 'QA inventory does not preserve existing projects')
        records = {}
        for identifier in (project_id, draft_id):
            file = DATA / 'records' / (identifier + '.json')
            require(file.is_file() and not file.is_symlink() and file.resolve() == file, 'QA record path unsafe')
            record = json.loads(file.read_text())
            require(record.get('draft', {}).get('id') == identifier and record['draft'].get('title', '').startswith(marker), 'QA record identity/marker changed')
            records[identifier] = record
        publication = records[project_id].get('published')
        require(publication and publication['publishedAt'] == report['publishedAt'], 'QA publication identity changed')
        require(not records[draft_id].get('published') and records[project_id]['draft']['cover'] == cover, 'Synthetic private draft or media identity changed')
        published = safe_release('lbi', str(ROOT / 'lbi/releases' / publication['release']))
        require(published != original and (ROOT / 'lbi/current').resolve(strict=True) == published, 'Intervening publication blocks cleanup')
        # Include other existing records when checking shared media references.
        for file in (DATA / 'records').glob('*.json'):
            if file.stem in (project_id, draft_id):
                continue
            other = json.loads(file.read_text())
            require(other.get('draft', {}).get('cover') != cover and (other.get('published') or {}).get('project', {}).get('cover') != cover, 'Synthetic media shared by another project')
        plan = [(DATA / 'records' / (identifier + '.json'), 'records/' + identifier + '.json') for identifier in (project_id, draft_id)]
        media_metadata = cover.removesuffix('.webp') + '.json'
        metadata = json.loads((DATA / 'media' / media_metadata).read_text())
        require(metadata.get('id') == cover.removesuffix('.webp') and metadata.get('filename') == cover, 'Synthetic media metadata identity changed')
        plan.extend([(DATA / 'media' / cover, 'media/' + cover), (DATA / 'media' / media_metadata, 'media/' + media_metadata), (DATA / 'snapshots' / project_id, 'snapshots/' + project_id), (published, 'public-release')])
        for path, _ in plan:
            require(path.exists() and path.resolve() == path and not path.is_symlink(), 'Synthetic cleanup path unsafe')
        quarantine = BACKUPS / ('qa-quarantine-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ'))
        quarantine.mkdir(mode=0o700)
        # Keep the currently served static release until all data is quarantined.
        switch('lbi', original)
        current_switched = True
        for old, relative in plan:
            target = quarantine / relative
            target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            os.rename(old, target)
            moved.append((old, target))
        require({file.stem for file in (DATA / 'records').glob('*.json')} == set(report['beforeProjectIds']), 'Post-cleanup record inventory mismatch')
        return {'status': 'QA_QUARANTINED', 'quarantine': str(quarantine), 'restored_current': str(original),
                'owned_records': 2, 'owned_media': 1, 'other_records_changed': False}
    except Exception:
        recovery_errors = []
        for old, target in reversed(moved):
            try:
                require(not old.exists() and not old.is_symlink(), 'Intervening data blocks cleanup recovery')
                os.rename(target, old)
            except Exception:
                recovery_errors.append('Could not restore owned path: ' + str(old))
        if current_switched and not recovery_errors:
            try:
                require((ROOT / 'lbi/current').resolve() == original, 'Intervening current blocks cleanup recovery')
                switch('lbi', published)
            except Exception:
                recovery_errors.append('Could not restore owned QA current')
        restart_safe = not recovery_errors
        outcome = {'status': 'CLEANUP_RECOVERY_INCOMPLETE' if recovery_errors else 'CLEANUP_ABORTED_RESTORED',
                   'errors': recovery_errors, 'admin_left_stopped': active and not restart_safe}
        recovery_file = (quarantine or BACKUPS) / ('cleanup-recovery-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ') + '.json')
        recovery_file.write_text(json.dumps(outcome, indent=2) + '\n')
        recovery_file.chmod(0o600)
        raise
    finally:
        if active and restart_safe:
            subprocess.run(['systemctl', 'start', SERVICE], check=True)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=('rollback-static', 'clean-qa'))
    parser.add_argument('--report', type=Path, required=True)
    parser.add_argument('--original-release', type=Path)
    args = parser.parse_args()
    require(os.geteuid() == 0, 'Root-only exact preview recovery')
    os.umask(0o077)
    if args.action == 'rollback-static':
        result = rollback_static(args.report)
    else:
        require(args.original_release, 'Exact pre-QA LBI release required')
        result = clean_qa(args.report, args.original_release)
    print(json.dumps(result, indent=2))

if __name__ == '__main__':
    main()
