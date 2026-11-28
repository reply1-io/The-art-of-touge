#!/usr/bin/env python3
"""Build engine-builder.single.html: the builder page with the synth and the physics inlined
(the published page runs in a sandboxed frame that may refuse extra script files).
Run from the repo root:  python3 tools/engine-builder/build_builder.py
"""
import re, pathlib

here = pathlib.Path(__file__).resolve().parent
root = here.parent.parent
page = (here / "engine-builder.html").read_text()
parts = [("src/audio/m20-dsp.js", (root / "src/audio/m20-dsp.js").read_text()),
         ("src/audio/M20EngineSound.js", (root / "src/audio/M20EngineSound.js").read_text()),
         ("src/audio/enginePhysics.js", (root / "src/audio/enginePhysics.js").read_text())]

def strip_module(js):
    js = re.sub(r"^import .*?;\n", "", js, flags=re.M | re.S)
    js = re.sub(r"^export \{[^}]*\};\n", "", js, flags=re.M)
    return re.sub(r"^export ", "", js, flags=re.M)

inline = "".join(f"// ---- inlined from {name} ----\n{strip_module(js)}\n" for name, js in parts)
imports = list(re.finditer(r"^import \{[^}]*\} from '\.\./\.\./src/audio/[A-Za-z0-9]+\.js';\n", page, flags=re.M))
assert len(imports) == 2, "expected the two src imports in engine-builder.html"
out = page[:imports[0].start()] + inline + page[imports[-1].end():]
(here / "engine-builder.single.html").write_text(out)
print("wrote tools/engine-builder/engine-builder.single.html", len(out), "bytes")
