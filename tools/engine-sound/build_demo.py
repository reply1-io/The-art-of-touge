#!/usr/bin/env python3
"""Build engine-sound-demo.single.html: the demo page with the engine code inlined.

The published page runs in a sandboxed frame that may refuse to load extra script
files, so the shipped page carries everything in one file.
Run from the repo root:  python3 tools/engine-sound/build_demo.py
"""
import re, pathlib

here = pathlib.Path(__file__).resolve().parent
root = here.parent.parent
page = (here / "engine-sound-demo.html").read_text()
dsp = (root / "src/audio/m20-dsp.js").read_text()
wrap = (root / "src/audio/M20EngineSound.js").read_text()

def strip_module(js):
    js = re.sub(r"^import .*?;\n", "", js, flags=re.M | re.S)
    js = re.sub(r"^export \{[^}]*\};\n", "", js, flags=re.M)
    return re.sub(r"^export ", "", js, flags=re.M)

inline = "// ---- inlined from src/audio/m20-dsp.js ----\n" + strip_module(dsp) + \
         "\n// ---- inlined from src/audio/M20EngineSound.js ----\n" + strip_module(wrap)
imp = re.search(r"^import \{[^}]*\} from '\.\./\.\./src/audio/M20EngineSound\.js';\n", page, flags=re.M)
assert imp, "import line not found in engine-sound-demo.html"
out = page[:imp.start()] + inline + "\n" + page[imp.end():]
(here / "engine-sound-demo.single.html").write_text(out)
print("wrote tools/engine-sound/engine-sound-demo.single.html", len(out), "bytes")
