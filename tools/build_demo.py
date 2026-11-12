#!/usr/bin/env python3
"""Build dist/engine-sound-demo.html: the demo page with the engine code inlined.

The published page runs in a sandboxed frame that may refuse to load extra script
files, so the shipped page carries everything in one file.
Run from the repo root:  python3 tools/build_demo.py
"""
import re, pathlib

root = pathlib.Path(__file__).resolve().parent.parent
page = (root / "engine-sound-demo.html").read_text()
dsp = (root / "src/audio/m20-dsp.js").read_text()
wrap = (root / "src/audio/M20EngineSound.js").read_text()

def strip_module(js):
    js = re.sub(r"^import .*?;\n", "", js, flags=re.M | re.S)
    js = re.sub(r"^export \{[^}]*\};\n", "", js, flags=re.M)
    return re.sub(r"^export ", "", js, flags=re.M)

inline = "// ---- inlined from src/audio/m20-dsp.js ----\n" + strip_module(dsp) + \
         "\n// ---- inlined from src/audio/M20EngineSound.js ----\n" + strip_module(wrap)
imp = re.search(r"^import \{[^}]*\} from '\./src/audio/M20EngineSound\.js';\n", page, flags=re.M)
assert imp, "import line not found in engine-sound-demo.html"
out = page[:imp.start()] + inline + "\n" + page[imp.end():]
(root / "dist").mkdir(exist_ok=True)
(root / "dist/engine-sound-demo.html").write_text(out)
print("wrote dist/engine-sound-demo.html", len(out), "bytes")
