"""Extract reference FASTAs without using archive paths as output paths."""
import json
import pathlib
import shutil
import sys
import zipfile

source, destination = map(pathlib.Path, sys.argv[1:])
destination.mkdir(parents=True, exist_ok=False)
files = []
with zipfile.ZipFile(source) as archive:
    entries = [e for e in archive.infolist() if not e.is_dir()
               and pathlib.PurePosixPath(e.filename).suffix.lower() in {'.fasta', '.fa', '.faa', '.fas'}
               and not any(p.startswith('.') or p == '__MACOSX' for p in pathlib.PurePosixPath(e.filename).parts)]
    if not entries:
        raise ValueError('The ZIP contains no protein FASTA files.')
    for index, entry in enumerate(entries):
        target = destination / str(index + 1) / pathlib.PurePosixPath(entry.filename.replace('\\', '/')).name
        target.parent.mkdir()
        with archive.open(entry) as reader, target.open('xb') as writer:
            shutil.copyfileobj(reader, writer)
        files.append(str(target))
print(json.dumps(files))
