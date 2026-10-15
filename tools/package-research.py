"""Package tracked and explicitly promoted source, never local data or outputs."""
from pathlib import Path
import hashlib
import json
import subprocess
import zipfile

root = Path(__file__).resolve().parents[1]
version = json.loads((root / 'package.json').read_text(encoding='utf-8'))['version']
names = subprocess.check_output(['git', 'ls-files', '-z'], cwd=root).decode().split('\0')
manifest = json.loads((root / 'source-manifest.json').read_text(encoding='utf-8'))
for item in manifest['files']:
    file = (root / item['path']).resolve()
    if not file.is_relative_to(root.resolve()) or not file.is_file():
        raise SystemExit('Invalid promoted source path: ' + item['path'])
    if hashlib.sha256(file.read_bytes()).hexdigest() != item['sha256']:
        raise SystemExit('Promoted source changed: ' + item['path'])
    names.append(item['path'])
names = sorted(set(names))
names = [n for n in names if n and not n.startswith('.github/') and not (n.startswith('examples/') and n.endswith('.zip'))]
blocked = [n for n in names if n.endswith(('.sqlite', '.db', '.npz', '.npy', '.sero')) or n.startswith(('outputs/', 'dist/', '.venv'))]
if blocked:
    raise SystemExit('Unexpected data/environment files: ' + ', '.join(blocked))
destination = root / 'dist'
destination.mkdir(exist_ok=True)
archive = destination / f'mimicrymap-research-{version}.zip'
pending = archive.with_suffix('.partial.zip')
with zipfile.ZipFile(pending, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=6) as z:
    for name in sorted(names):
        z.write(root / name, f'mimicrymap-{version}/{name}')
with zipfile.ZipFile(pending) as z:
    if z.testzip() is not None or len(z.namelist()) != len(names):
        raise SystemExit('Research archive verification failed; current archive retained')
pending.replace(archive)
digest = hashlib.sha256(archive.read_bytes()).hexdigest()
(destination / 'SHA256SUMS.txt').write_text(f'{digest}  {archive.name}\n', encoding='utf-8')
print(f'{archive.name}: {archive.stat().st_size:,} bytes; {len(names)} files')
