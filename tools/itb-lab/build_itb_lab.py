#!/usr/bin/env python3
"""Build itb-lab.single.html: the ITB lab page with the synth inlined.
Run from the repo root:  python3 tools/itb-lab/build_itb_lab.py
"""
import re, pathlib

here = pathlib.Path(__file__).resolve().parent
root = here.parent.parent
page = (here / "itb-lab.html").read_text()
parts = ["src/audio/m20-dsp.js", "src/audio/M20EngineSound.js"]

def strip_module(js):
    js = re.sub(r"^import .*?;\n", "", js, flags=re.M | re.S)
    js = re.sub(r"^export \{[^}]*\};\n", "", js, flags=re.M)
    return re.sub(r"^export ", "", js, flags=re.M)

inline = "".join(f"// ---- inlined from {p} ----\n{strip_module((root / p).read_text())}\n" for p in parts)
imports = list(re.finditer(r"^import \{[^}]*\} from '\.\./\.\./src/audio/[A-Za-z0-9]+\.js';\n", page, flags=re.M))
assert len(imports) == 1, "expected one src import in itb-lab.html"
out = page[:imports[0].start()] + inline + page[imports[0].end():]
(here / "itb-lab.single.html").write_text(out)
print("wrote tools/itb-lab/itb-lab.single.html", len(out), "bytes")
