"""Find Node.js or install the pinned, verified runtime privately in this package."""
from pathlib import Path
import csv, hashlib, os, platform, shutil, subprocess, sys, tarfile, tempfile, urllib.request

def ensure_node(root):
    root = Path(root)
    def compatible(command):
        if not command:
            return False
        try:
            version = subprocess.check_output([str(command), '--version'], text=True, stderr=subprocess.DEVNULL, timeout=15).strip()
            return int(version.lstrip('v').split('.')[0]) >= 20
        except (OSError, ValueError, subprocess.SubprocessError):
            return False
    for command in [os.environ.get('MIMICRY_NODE'), shutil.which('node')]:
        if compatible(command):
            return str(command)
    system = {'Windows': 'win', 'Linux': 'linux', 'Darwin': 'darwin'}.get(platform.system())
    machine = platform.machine().lower()
    arch = 'arm64' if machine in ('arm64', 'aarch64') else 'x64' if machine in ('amd64', 'x86_64') else None
    with Path(__file__).with_name('node-runtime.tsv').open(encoding='utf-8') as source:
        entry = next((r for r in csv.DictReader(source, delimiter='\t') if r['platform'] == system and r['arch'] == arch), None)
    if not entry:
        raise RuntimeError('Automatic Node.js setup supports Windows, macOS and Linux on x64/arm64. Install Node.js 20+ for this platform.')
    cache = root / '.runtime' / ('node-' + entry['version'] + '-' + system + '-' + arch)
    node = cache / ('node.exe' if system == 'win' else 'node')
    if compatible(node):
        return str(node)
    cache.mkdir(parents=True, exist_ok=True)
    print('Node.js is missing or older than 20. Installing a private copy in ' + str(cache), file=sys.stderr)
    fd, downloaded = tempfile.mkstemp(prefix='download-', dir=cache)
    os.close(fd)
    pending = Path(downloaded)
    try:
        with urllib.request.urlopen(entry['url'], timeout=120) as source, pending.open('wb') as out:
            shutil.copyfileobj(source, out)
        if hashlib.sha256(pending.read_bytes()).hexdigest() != entry['sha256']:
            raise RuntimeError('Node.js download checksum mismatch; the downloaded program was not executed.')
        if system == 'win':
            pending.replace(node)
        else:
            with tarfile.open(pending, 'r:gz') as archive:
                member = archive.getmember(entry['member'])
                if not member.isfile():
                    raise RuntimeError('Node.js archive member is not a regular file.')
                with archive.extractfile(member) as source, node.open('wb') as out:
                    shutil.copyfileobj(source, out)
            node.chmod(0o755)
    finally:
        pending.unlink(missing_ok=True)
    if not compatible(node):
        raise RuntimeError('The downloaded Node.js runtime could not start on this system.')
    return str(node)
