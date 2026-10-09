"""Package tracked research source; never include local studies or build outputs."""
from pathlib import Path
import hashlib
import json
import subprocess
import zipfile

root = Path(__file__).resolve().parents[1]
version = json.loads((root / 'package.json').read_text(encoding='utf-8'))['version']
names = subprocess.check_output(['git', 'ls-files', '-z'], cwd=root).decode().split('\0')
names = [n for n in names if n and not n.startswith('.github/') and not (n.startswith('examples/') and n.endswith('.zip'))]
blocked = [n for n in names if n.endswith(('.sqlite', '.db', '.npz', '.npy', '.sero')) or n.startswith(('outputs/', 'dist/', '.venv'))]
if blocked:
    raise SystemExit('Unexpected data/environment files: ' + ', '.join(blocked))
destination = root / 'dist'
destination.mkdir(exist_ok=True)
archive = destination / f'mimicrymap-research-{version}.zip'
with zipfile.ZipFile(archive, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=6) as z:
    for name in sorted(names):
        z.write(root / name, f'mimicrymap-{version}/{name}')
digest = hashlib.sha256(archive.read_bytes()).hexdigest()
(destination / 'SHA256SUMS.txt').write_text(f'{digest}  {archive.name}\n', encoding='utf-8')
print(f'{archive.name}: {archive.stat().st_size:,} bytes; {len(names)} files')
