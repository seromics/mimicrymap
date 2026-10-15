"""Stage completed selected-virus downloads for website and native save actions."""
import argparse, json, os
from pathlib import Path
from build_selected_virus_summaries import digest, publish, save


def link(source, target, retired):
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists():
        if os.path.samefile(source, target): return
        previous = digest(target.read_bytes())
        if digest(source.read_bytes()) == previous: return
        retired.mkdir(parents=True, exist_ok=True)
        backup = retired / (target.stem + '-' + previous[:12] + target.suffix)
        if backup.exists(): assert digest(backup.read_bytes()) == previous
        else: os.link(target, backup)
    pending = target.with_name(target.name + '.pending-link')
    if pending.exists(): raise ValueError('A download stager already owns ' + str(target))
    os.link(source, pending); os.replace(pending, target)


def refresh_dataset_download(release, dataset_path):
    # The manifest is itself downloadable. Its descriptor must follow changes
    # to the archive list or the website rejects the entire download catalogue.
    path = release / 'downloads.json'
    catalogue = json.loads(path.read_text('utf-8'))
    items = [item for group in catalogue['groups'] for item in group['files']]
    items += catalogue.get('documents', [])
    manifest_bytes = dataset_path.read_bytes()
    changed = 0
    for item in items:
        if item.get('file') and (release / item['file']).resolve() == dataset_path.resolve():
            item.update(bytes=len(manifest_bytes), sha256=digest(manifest_bytes))
            changed += 1
    if changed != 1:
        raise ValueError('Expected one downloadable dataset manifest')
    # Check all local routes before committing the updated catalogue, not just
    # the selected-virus paths served directly by the embedded viewer.
    for item in items:
        if not item.get('file'): continue
        local = (release / item['file']).resolve()
        if not local.is_relative_to(release.resolve()) or not local.is_file():
            raise ValueError('Invalid staged download: ' + item['id'])
        if local.stat().st_size != item['bytes']:
            raise ValueError('Staged download size mismatch: ' + item['id'])
    save(path, catalogue)
    return len(items)


def stage(root, out, release, website=None):
    result = json.loads((out / 'selected-viruses.json').read_text('utf-8'))
    assert len(result['proteomes']) == 120 and result['summary_schema'] == 'mimicryone/native-summary/7'
    # Verify every completed artifact before switching any catalogue.
    for v in result['proteomes']:
        for kind in ('human_to_virus', 'virus_to_human', 'summary'):
            item = v[kind]; source = out / v['slug'] / Path(item['url']).name
            assert source.stat().st_size == item['bytes'] and digest(source.read_bytes()) == item['sha256']
    native_path = root / 'module-staging/reference-downloads.json'
    native = json.loads(native_path.read_text('utf-8'))
    upload = release / 'zenodo/upload'
    dataset_path = upload / 'dataset-manifest.json'
    dataset = json.loads(dataset_path.read_text('utf-8'))
    added = []
    for v in result['proteomes']:
        item = v['summary']; filename = Path(item['url']).name
        source = out / v['slug'] / filename
        relative = 'downloads/selected-viruses/' + filename
        link(source, root / 'module-staging' / relative, out / 'to delete/staged-downloads')
        link(source, upload / filename, out / 'to delete/staged-downloads')
        archive = {'file': filename, 'title': v['label'] + ' ↔ Canonical Human Proteins · Summary CSVs',
                   'modules': ['summary-selected-' + v['slug'].replace('_', '-')],
                   'bytes': item['bytes'], 'sha256': item['sha256'], 'expandedBytes': item['expandedBytes'],
                   'layout': 'seromap.flat-download/1', 'bundle': 'csv'}
        native['archives'] = [a for a in native['archives'] if a['file'] != filename]
        native['archives'].append({**archive, 'source': relative, 'url': None})
        dataset['archives'] = [a for a in dataset['archives'] if a['file'] != filename]
        dataset['archives'].append(archive)
        added.append(filename)
    master = next(a for a in native['archives'] if a['file'] == Path(result['source']['url']).name)
    assert master['sha256'] == result['source']['sha256']
    alias = result['source']['module']
    if alias not in master['modules']: master['modules'].append(alias)
    publish(root / 'mimicrymap/frontend', out, result)
    if website: publish(website / 'atlas/mimicrymap/frontend', out, result)
    save(native_path, native); save(root / 'desktop/reference-downloads.json', native)
    save(dataset_path, dataset)
    website_downloads = refresh_dataset_download(release, dataset_path)
    receipt = {'packages': len(added), 'directionalCsvs': 2 * len(added),
               'totalZipBytes': sum(v['summary']['bytes'] for v in result['proteomes']),
               'allVirusesZipBytes': master['bytes'], 'allVirusesSha256': master['sha256'],
               'sequenceComparisonsRun': False, 'installedModulesChanged': False,
               'websiteDownloadsValidated': website_downloads}
    save(out / 'staging.json', receipt)
    return receipt


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--root', type=Path, required=True)
    p.add_argument('--out', type=Path, required=True)
    p.add_argument('--release', type=Path, required=True)
    p.add_argument('--website', type=Path)
    a = p.parse_args()
    lock = a.out.resolve() / 'stage.lock'
    fd = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
    os.write(fd, str(os.getpid()).encode()); os.close(fd)
    try:
        print(json.dumps(stage(a.root.resolve(), a.out.resolve(), a.release.resolve(), a.website.resolve() if a.website else None)))
    finally:
        lock.unlink()
