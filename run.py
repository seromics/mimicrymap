"""Run the two FASTA inputs using settings.json. Missing Node.js installs locally."""
from pathlib import Path
import importlib.util, subprocess, sys

root = Path(__file__).resolve().parent if '__file__' in globals() else Path.cwd()
if not (root / 'settings.json').is_file():
    raise SystemExit('Open the pipeline folder first; it must contain settings.json and inputs/.')
helper = root / 'run/ensure-node.py'
if not helper.is_file():
    helper = root.parent / 'frontend/reproduce/ensure-node.py'
spec = importlib.util.spec_from_file_location('mimicry_node_setup', helper)
setup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(setup)
node = setup.ensure_node(root)
status = subprocess.call([node, str(root / 'run.cjs')])
if status:
    raise SystemExit(status)
