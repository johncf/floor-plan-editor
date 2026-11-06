# Interactive Floor Plan Editor — Plan & Decisions

Status: **draft for review.** Requirements and data model agreed; not yet built.

## 1. Goal

A desktop web page for adjusting the measurements of the second-floor flat plan and laying
out objects (furniture, fixtures). The overall structure stays the same; measurements are
shown on hover only.

Delivery: **a single self-contained HTML file to download** — plain SVG + vanilla
JavaScript, no frameworks, no build step, no external dependencies.

## 2. Units and numbers

- All stored values are **integers in millimetres**.
- The smallest adjustment in the UI is **10 mm (1 cm)**; all edits are entered in metric.
- Imperial (feet-inches) is a **display-only** toggle.

## 3. Structure model

The structure defines **only walls and rooms**. It is grounded in an imagined doorless,
windowless set of walls. Doors, windows and everything else are objects (section 4).

### 3.1 Grid lines

- Every wall segment is horizontal or vertical and has a **grid line through its centre**.
- **Vertical lines** are named `A, B, C, … Z, AA, AB, …`; **horizontal lines** `a, b, c, … z, aa, ab, …`.
- Collinear walls share a grid line and **move together by design**.
- **No two grid lines on the same axis may have the same position** (minimum separation
  10 mm). Lines may cross each other's walls.
- There is no limit on how far a line may move from its original position.

### 3.2 Points (junctions)

- A point is the intersection of exactly one vertical and one horizontal line, written
  `"<V>:<h>"`, e.g. `"A:a"`, `"AB:x"`, `"C:bc"`.
- Points are **not listed** in the JSON; they are the endpoints of segments.
- Points exist only where walls end or meet, not at every line intersection.
- Unique line positions make every point unique.

### 3.3 Wall segments

- A segment is a pair of **neighbouring points on one grid line**, stored in a fixed order:
  **top → bottom** (vertical) or **left → right** (horizontal).
- Each segment has its own **thickness** (10–800 mm), split equally either side of the line
  (e.g. a 50 mm wall is 25 mm each side).
- Walls are rendered extended by half the thickness of the perpendicular walls at each end,
  so corners and T-junctions fill in. Small steps where thicknesses differ are acceptable.

### 3.4 Rooms

- A room is a named, **ordered loop of points**. Consecutive points (including the last →
  first) must form a segment, so collinear junction points are included.
- Optional label position override: `"label": [x, y]` (absolute mm). Otherwise the label
  is placed automatically at a well-inside point.
- Room interiors (for clearances, snapping, out-of-bounds) are the loop offset inward by
  each segment's half-thickness.

## 4. Objects

`objects` is a single list of everything that isn't structure. Every object has a unique `id`.

### 4.1 Doors and windows

Attached to a **segment** (not an anchor), with an explicit, absolute range along it.

```json
{ "id": "door-balcony", "type": "v-door", "segment": ["B:b", "B:d"], "y": [2770, 3590],
  "opens": "left", "hinge": "bottom", "arc": 90 }
{ "id": "win-bed", "type": "v-window", "segment": ["G:a", "G:c"], "y": [250, 1300] }
{ "id": "door-bed", "type": "h-door", "segment": ["E:e", "G:e"], "x": [6090, 6890],
  "opens": "up", "hinge": "right" }
```

- Types: `v-door`, `v-window` (use `y` range), `h-door`, `h-window` (use `x` range).
  Orientation is stated explicitly; the validator rejects a type that disagrees with its segment.
- Doors: `opens` is `up|down` (h-door) or `left|right` (v-door); `hinge` is `left|right`
  (h-door) or `top|bottom` (v-door). Optional `arc` (positive degrees, default 90).
- A double door is two doors side by side.
- Openings **stay fixed relative to the ground** when grid lines move.
- Doors and windows can be **added and removed** in the UI. They are not draggable; they are
  edited in the panel, where you choose which segment end the position is measured from
  (display only — storage is absolute).

### 4.2 General objects (furniture, counters, fixtures)

No distinction between furniture, fixtures, counters, baths, etc.

```json
{ "id": "counter-left", "type": "object", "name": "Kitchen counter",
  "anchor": "B:g", "dx": 380, "dy": -1015, "length": 1870, "depth": 600,
  "rotation": 90, "locked": true,
  "addons": [{ "name": "Sink", "offset": 410, "length": 1040, "depth": 500 }] }
```

- **Anchor**: every object is anchored to a junction point. `dx`, `dy` = offset from the
  anchor to the object's **centre**. The anchor may lie outside the object.
- **Default anchor** on creation: the point nearest the object's centre.
- **Changing the anchor** recomputes `dx`, `dy` so the object does not move.
- When grid lines move, points move, so **anchored objects move with them**.
- **Length / depth**: at rotation 0, `length` is the horizontal size (its start edge is the
  left edge; increasing length pushes the right edge right) and `depth` is the vertical size
  (increasing it moves the bottom edge).
- **Rotation**: whole degrees, around the centre; edited in an input box.
- **Draggable** with the mouse, unless `locked`.
- **Locked**: neither draggable nor editable; selecting it shows only an **Unlock** button.
- **Out of bounds**: if any part of the rotated object crosses a wall face, it is
  **highlighted** — never moved automatically.

### 4.3 Add-ons

- An object can have any number of add-ons (e.g. sink, hob on a counter).
- An add-on slides **along the object's length only**: `offset` (from the start edge) and
  `length`; it is centred across the depth with its own `depth`.
- Add-ons must stay **within the object**, with **50 mm padding** from its edges.
  Out-of-bounds add-on edits are **blocked** (unlike objects).
- Add-ons may overlap each other.

### 4.4 Preset library

Small library at standard UK sizes, e.g. single / double / king bed, sofa, armchair,
wardrobe, chest of drawers, bedside table, desk, dining table, kitchen counter. Plus a
custom box (name, length, depth).

### 4.5 Snapping

- While dragging, snapping considers **only the two walls through the object's anchor
  point**: the wall on its vertical line and the wall on its horizontal line.
- Greedy: if the facing side of the object's rotated bounding box comes within **100 mm** of
  that wall's face, it jumps to sit exactly the snap gap from the face. Horizontal and
  vertical are handled independently.
- **Global settings**: snapping on/off, snap gap (default **40 mm**).

## 5. JSON file format

Three top-level keys:

```json
{
  "version": 1,
  "structure": {
    "lines": {
      "vertical":   [{ "id": "A", "x": -1690 }, ...],
      "horizontal": [{ "id": "a", "y": -75 }, ...]
    },
    "segments": [{ "points": ["A:a", "A:d"], "thickness": 100 }, ...],
    "rooms": [{ "name": "Kitchen / living", "ring": ["B:b", "C:b", ...], "label": [1900, 2600] }, ...]
  },
  "objects": [ ... doors, windows, counters, furniture, baths, showers ... ]
}
```

## 6. Constraints and validation

Checked on load/import (schema validation) and before every Apply.

**Structure**
- Line ids follow the naming scheme; positions are integers.
- No two lines on the same axis share a position.
- Segment points share exactly one line, are stored in order, and are **neighbours** on that
  line (no other point between them).
- Segment thickness 10–800 mm.
- **Point order along every grid line is preserved** when a line moves. (Walls crossing
  without touching is allowed — the user judges the result.)
- Each room ring is closed and every consecutive pair is a segment.

**Openings** — for a door/window on a vertical segment from `X:a` to `X:b` with range
`[y1, y2]`: `a ≤ y1 < y2 ≤ b` (wall thickness ignored), likewise for horizontal segments.
- Must hold after any grid-line move — moves that would break it are blocked.
- Openings on the same segment must not overlap (touching is allowed).
- Type and `x`/`y` key must match the segment's orientation; swing values must match the type.

**Objects**
- Anchor must be an existing point; `length`, `depth` ≥ 10 mm.
- Add-ons within the object with 50 mm padding.

## 7. Editing workflow (UI)

- **Click** a component to select it; a side panel shows its editable values.
- **Wall segment**: its grid line's position (moves the whole line) and its own thickness.
- **Door / window**: width, position (measured from a chosen end of its segment), swing,
  arc; delete. "Add door/window" on a selected segment.
- **Object**: name, length, depth, rotation, anchor, lock, add-ons; delete.
- Panel edits are **previewed live** with the **impacted components highlighted**, then
  **Apply** or **Cancel**. Invalid values are blocked with the reason shown.
- A grid-line move highlights: segments on the line, segments ending on it, affected rooms,
  openings on its segments, and objects anchored to its points.
- Dragging objects applies immediately.
- **Undo / redo** for every change.

## 8. Measurements on hover

No dimension lines by default. Hovering shows only the measurements involving that component:
- **Wall segment**: face lengths, thickness, line position, lengths between openings.
- **Door / window**: width and distances to both ends of its segment.
- **Object**: length, depth, and clearance to the nearest wall face on each side.
- **Add-on**: size and distances to the object's ends.

## 9. Saving and export

- **Autosave** to browser storage (this browser only); global settings saved alongside.
- **Export / import JSON** (format in section 5; validated on import).
- **Export SVG**: the plan as drawn (walls, openings, objects, room labels).
  - Optional checkbox adds **wall dimensions only**, drawn with simple logic.
  - A **scale bar** in one corner, as on a map.

## 10. Platform

Desktop only (mouse). No touch support.

## 11. Engineering approach

1. Convert the current plan to the JSON format (baseline in section 13).
2. Write the validator and the constraint logic (line moves, impacts, openings) as plain
   functions; test them against the baseline before any UI.
3. Build rendering, selection, panel, hover measurements, objects, drag and snap,
   persistence and export on top.

Libraries considered and not used: react-planner (built around freehand wall drawing,
heavy), Kiwi.js constraint solver (unpredictable impact preview; not needed with grid
lines), interact.js (unnecessary for simple dragging).

## 12. Future todos

- Per-segment alignment to its grid line (centre / one face / other face).
- Take wall thickness into account in opening constraints (openings currently measured
  between points, not wall faces).

## 13. Baseline (from the current dimensioned SVG)

Scaled from the estate agent's plan; roughly ±50–100 mm. Origin = inside top-left corner of
the kitchen/living room; x right, y down; mm.

### Grid lines

| Vertical | x | | Horizontal | y |
|---|---|---|---|---|
| A — balcony left | −1690 | | a — top (kitchen, store, bedroom, balcony) | −75 |
| B — kitchen left external | −80 | | b — store front | 580 |
| C — store side | 750 | | c — top of bath / ensuite / master | 1595 |
| D — kitchen / bedroom | 3870 | | d — balcony bottom | 4020 |
| E — kitchen / hall | 5665 | | e — hall top (bedroom / bath / ensuite bottom) | 4050 |
| F — utility left | 7180 | | f — utility top | 5250 |
| G — bedroom right external | 7365 | | g — bottom external | 6050 |
| H — hall / master | 9025 | | | |
| I — bath / ensuite | 9270 | | | |
| J — ensuite / master | 10760 | | | |
| K — master right external | 13785 | | | |

### Segments (thickness, mm)

| Line | Segments |
|---|---|
| A | A:a–A:d (100) |
| B | B:a–B:b, B:b–B:d, B:d–B:g (160) |
| C | C:a–C:b (80) |
| D | D:a–D:e (120) |
| E | E:e–E:g (130) |
| F | F:f–F:g (120) |
| G | G:a–G:c, G:c–G:e (150) |
| H | H:e–H:f, H:f–H:g (130) |
| I | I:c–I:e (100) |
| J | J:c–J:e (100) |
| K | K:c–K:g (170) |
| a | A:a–B:a (100); B:a–C:a, C:a–D:a, D:a–G:a (150) |
| b | B:b–C:b (80) |
| c | G:c–I:c, I:c–J:c, J:c–K:c (150) |
| d | A:d–B:d (100) |
| e | D:e–E:e, E:e–G:e, G:e–H:e, H:e–I:e, I:e–J:e (120) |
| f | F:f–H:f (120) |
| g | B:g–E:g, E:g–F:g, F:g–H:g, H:g–K:g (160) |

### Rooms

| Room | Ring |
|---|---|
| Kitchen / living | B:b, C:b, C:a, D:a, D:e, E:e, E:g, B:g, B:d |
| Store | B:a, C:a, C:b, B:b |
| Balcony | A:a, B:a, B:b, B:d, A:d |
| Bedroom | D:a, G:a, G:c, G:e, E:e, D:e |
| Bathroom | G:c, I:c, I:e, H:e, G:e |
| Ensuite | I:c, J:c, J:e, I:e |
| Master bedroom | J:c, K:c, K:g, H:g, H:f, H:e, I:e, J:e |
| Entrance hall | E:e, G:e, H:e, H:f, F:f, F:g, E:g |
| Utility cupboard | F:f, H:f, H:g, F:g |

### Doors and windows

| Id | Type | Segment | Range | Opens / hinge |
|---|---|---|---|---|
| win-kitchen-1 | v-window | B:b–B:d | y 790–2770 | |
| door-balcony | v-door | B:b–B:d | y 2770–3590 | left / bottom |
| win-kitchen-2 | v-window | B:d–B:g | y 4690–5580 | |
| door-store | h-door | B:b–C:b | x −80–750 | down / left |
| win-bedroom | v-window | G:a–G:c | y 250–1300 | |
| door-bedroom | h-door | E:e–G:e | x 6090–6890 | up / right |
| door-bathroom | h-door | G:e–H:e | x 7620–8320 | down / left |
| door-ensuite | v-door | J:c–J:e | y 3200–3990 | right / bottom |
| door-kitchen | v-door | E:e–E:g | y 4110–4950 | left / bottom |
| door-master | v-door | H:e–H:f | y 4110–4990 | right / bottom |
| door-entrance | h-door | E:g–F:g | x 6090–6890 | up / right |
| door-utility-1 | h-door | F:f–H:f | x 7400–8100 | up / left |
| door-utility-2 | h-door | F:f–H:f | x 8100–8800 | up / right |
| win-master | v-window | K:c–K:g | y 4070–5430 | |

### Objects

| Id | Anchor | dx, dy | Length × depth | Rotation | Add-ons |
|---|---|---|---|---|---|
| counter-left | B:g | 380, −1015 | 1870 × 600 | 90 | Sink: offset 410, length 1040 |
| counter-bottom | B:g | 2140, −380 | 4120 × 600 | 0 | Hob: offset 1560, length 600 |
| bath | G:c | 965, 435 | 1740 × 680 | 0 | |
| shower-tray | I:c | 745, 475 | 1350 × 760 | 0 | |
| bathroom-basin | I:c | −285, 1200 | 410 × 510 | 0 | |
| bathroom-wc | H:e | −90, −520 | 510 × 560 | 0 | |
| ensuite-wc | I:e | 370, −1130 | 540 × 360 | 0 | |
| ensuite-basin | I:e | 360, −520 | 460 × 560 | 0 | |

Counters, bath and shower tray are locked by default. Basin and WC positions are rough
estimates from the agent's plan.
