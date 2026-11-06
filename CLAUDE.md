# Floor plan editor

Interactive editor for a second-floor flat plan: adjust wall positions and thicknesses,
doors and windows, and lay out furniture. Delivered as ONE self-contained HTML file.

**Read `docs/plan.md` first** — it holds every agreed requirement and design decision.
Don't change agreed behaviour without asking the user.

## Layout

- `src/core.js` — pure model: indexing, geometry, validation, point-order checks, change
  detection (for highlights), snapping, clearances. No DOM. Works in Node and the browser
  (`window.FPE`).
- `src/ui.js` — rendering (SVG), selection, side panel with Apply/Cancel, hover
  measurements, dragging, undo/redo, autosave, import/export.
- `src/template.html` — markup + CSS, with `/*BASELINE*/`, `/*CORE*/`, `/*UI*/` placeholders.
- `src/baseline.json` — the original plan in the file format.
- `build.py` — inlines everything into `dist/floor-plan-editor.html`.
- `test/core.test.js` — Node tests of the core model against the baseline.
- `test/browser_test.py` — Playwright smoke test of the built page.

## Commands

```
python3 build.py                 # build dist/floor-plan-editor.html
node test/core.test.js           # core model tests
python3 test/browser_test.py     # browser smoke test (after building)
```

Always rebuild and run both test suites after changes.

## Key rules (summary — details in docs/plan.md)

- All stored values are integer **mm**; UI edits in 10 mm steps; imperial is display-only.
- File format: top-level `version`, `structure` (lines, segments, rooms), `openings`, `objects`.
- Grid lines: vertical `A, B, …, AA`; horizontal `a, b, …, aa`. Points are `"V:h"`.
  No two lines on an axis share a position. Collinear walls move together.
- A line move is legal if point order along every line is preserved and every opening
  stays inside its segment (openings are fixed to the ground). No distance limit.
- Wall thickness 10–800 mm, centred on the line.
- Objects are anchored to a junction point by their centre (`dx`, `dy`); changing the
  anchor must not move them. Locked objects are neither draggable nor editable.
- Add-ons slide along the object's length, 50 mm padding, may overlap each other.
- Out-of-bounds objects are highlighted, never moved.
- Snapping (optional, global gap, default 40 mm) is greedy and only against the walls
  on the anchor point's two lines.
- Measurements appear only on hover.

## Future todos (agreed, not started)

- Per-segment alignment to its grid line (centre / one face / other face).
- Take wall thickness into account in opening constraints.
