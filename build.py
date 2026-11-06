"""Inline src/ into a single self-contained dist/floor-plan-editor.html."""
import json, pathlib
root = pathlib.Path(__file__).parent
src = root / 'src'
t = (src / 'template.html').read_text()
base = json.dumps(json.loads((src / 'baseline.json').read_text()), separators=(',', ':'))
assert '</script' not in base
t = (t.replace('/*BASELINE*/', base)
      .replace('/*CORE*/', (src / 'core.js').read_text())
      .replace('/*UI*/', (src / 'ui.js').read_text()))
out = root / 'dist' / 'floor-plan-editor.html'
out.parent.mkdir(exist_ok=True)
out.write_text(t)
print(f'wrote {out} ({len(t)} bytes)')
