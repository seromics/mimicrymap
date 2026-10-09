"""Reproduce the saved comparison; install missing Node.js privately if needed."""
from pathlib import Path
import importlib.util, subprocess, sys
folder = Path(__file__).resolve().parent
root = folder.parent if folder.name == 'run' else folder
spec = importlib.util.spec_from_file_location('mimicry_node_setup', folder / 'ensure-node.py')
setup = importlib.util.module_from_spec(spec); spec.loader.exec_module(setup)
raise SystemExit(subprocess.call([setup.ensure_node(root), str(folder / 'reproduce.cjs'), *sys.argv[1:]]))
