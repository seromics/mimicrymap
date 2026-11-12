"""Archive the generated static viewer, examples, exports and notices."""
from pathlib import Path
import json
import zipfile

root = Path(__file__).resolve().parents[1]
source = root / 'dist/viewer'
if not (source / 'viewer/index.html').is_file():
    raise SystemExit('Run npm run viewer:build first.')
version = json.loads((root / 'package.json').read_text())['version']
output = root / f'dist/mimicrymap-viewer-{version}.zip'
with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
    for file in sorted(source.rglob('*')):
        if file.is_file():
            archive.write(file, 'mimicrymap-viewer/' + file.relative_to(source).as_posix())
print(f'{output}: {output.stat().st_size:,} bytes')
