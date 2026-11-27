import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

// The engine-sound demo is published as one file with the synth inlined. A name clash between the
// inlined synth and the page script (or any syntax error) stops the whole page, silently: no sound.
test('the single-file engine-sound demo parses (no duplicate names, no syntax errors)', () => {
  const html = readFileSync(new URL('../tools/engine-sound/engine-sound-demo.single.html', import.meta.url), 'utf8');
  const scripts = [...html.matchAll(/<script type="module">([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  assert.ok(scripts.length >= 1, 'has a module script');
  const dir = mkdtempSync(join(tmpdir(), 'demo-'));
  scripts.forEach((src, i) => {
    const f = join(dir, `page${i}.mjs`);
    writeFileSync(f, src);
    execFileSync(process.execPath, ['--check', f]); // throws on a SyntaxError (e.g. a redeclared const)
  });
});
