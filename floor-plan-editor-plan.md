# Interactive Floor Plan Editor — Plan & Decisions

Status: requirements agreed; core structure representation **under discussion** (see last section).

## 1. Goal

A desktop web page for making **minor** adjustments to the second-floor flat plan
(the one in `floor_plan_dimensions.svg`) and laying out furniture. Measurements are
shown on hover only. The overall structure of the flat must stay the same.

Delivery: **a single self-contained HTML file to download** (no build step, no frameworks).

## 2. Core concept: grid lines

- The plan is grounded in an imagined **doorless, windowless set of walls**.
- Every wall segment is straight and either horizontal or vertical.
- **Every wall segment has a grid line through its centre**:
  - a vertical wall → a vertical grid line (an x position);
  - a horizontal wall → a horizontal grid line (a y position).
- Changing a dimension = **moving a grid line**. Everything attached to that line
  (wall segments on it, walls that end on it, rooms bounded by it, fixtures) is
  impacted and is **highlighted before the change is applied**.
- External walls are grid lines like any other: moving one moves the envelope.

### Movement limits

- Each grid line may move **at most 50 cm** from its original position.
- Grid lines may never cross or change order relative to the lines they interact with
  (structure is preserved).
- **Doors and windows stay fixed relative to the ground.** A grid line cannot be moved
  further if a door or window is in the way (e.g. a wall end would cut into an opening).

## 3. Components and what is editable

Rooms are **not** selectable; they are derived from the walls.

| Component | Editable properties | Notes |
|---|---|---|
| Wall segment | Position (via its grid line), **thickness** (all walls, internal and external) | Shows impacted components before applying |
| Door | Width, position along its wall | Anchor = which end of the wall the position is measured from |
| Window | Width, position along its wall | Anchor = which end of the wall the position is measured from |
| Kitchen counter | — (permanent fixture) | L-shaped, anchored at the kitchen's bottom-left corner |
| Hob | Horizontal position + horizontal size only | Must stay within the counter, with padding |
| Kitchen sink | Vertical position + vertical size only | Must stay within the counter, with padding |
| Bathroom WC, basin | Rectangles (editing rules TBD — see open questions) | |
| Ensuite WC, basin | Rectangles (editing rules TBD) | |
| Furniture box | Drag to move; width, depth, **rotation** (input box), name | Click-and-drag is allowed **only** for furniture |

- Anchors are only used for doors and windows (which wall end the position is measured from).
  No anchors for walls.
- No click-and-drag for anything except furniture. Selecting a component opens an edit
  panel with input boxes.

## 4. Editing workflow

1. Click a component to select it → side panel shows its editable values.
2. While typing, the **impacted components are highlighted** (live preview).
3. **Apply** commits the change; **Cancel** reverts.
4. Invalid values (beyond ±50 cm, crossing lines, cutting into an opening, fixture leaving
   its counter) are blocked, with the reason shown.
5. Undo / redo.

## 5. Measurements display

- **No dimension lines by default.**
- **Hover** a component → show only the measurements involving it:
  - wall: length of each face, thickness, segments between openings;
  - door/window: width and distances to both wall ends;
  - fixtures: size and position within the counter / room;
  - furniture: size **and clearance to the nearest wall on each side**.

## 6. Furniture

- Small **preset library** (standard UK sizes), e.g. single bed, double bed, king bed,
  sofa, armchair, wardrobe, chest of drawers, desk, dining table, bedside table.
- Custom box: name, width, depth.
- Click-and-drag to move.
- **Rotation**: an input box (degrees).
- **Snap to walls** with a configurable gap (default **4 cm**); snapping can be turned off.
- No overlap/collision warnings.

## 7. Units, storage, export

- Unit toggle: **metric ↔ imperial** (feet-inches). Display only.
- **Underlying storage is always metres.**
- **Autosave** to browser storage (this browser only).
- **Export / import JSON** (moving a layout between devices / backup).
- **Export the plan as SVG.**

## 8. Platform

- Desktop only (mouse). No touch support required.

## 9. Engineering approach

- One plan data structure (JSON, metres), kept separate from rendering.
- Constraint logic (impact detection, limits, validity) as plain functions, tested
  against the baseline plan before building the UI on top.
- Plain SVG + vanilla JavaScript, no external dependencies (pointer events for furniture drag).
- Libraries considered and not used:
  - react-planner — built around freehand wall drawing; heavy, older codebase.
  - Kiwi.js (Cassowary solver) — solver chooses what moves, making the impact preview
    unpredictable; the grid-line model makes it unnecessary.
  - interact.js — not needed for simple rectangle dragging.

## 10. Baseline geometry (from the current dimensioned SVG)

Origin = inside top-left corner of the kitchen/living room; x right, y down; metres.
Scaled from the estate agent's plan; approx ±0.05–0.10 m.

### Horizontal walls (grid line = y of centre)

| Wall | Centre y | Thickness | x from → to | Openings (x ranges) |
|---|---|---|---|---|
| Top external (kitchen + bedroom) | −0.075 | 0.15 | −0.16 → 7.44 | — |
| Top external (bath / ensuite / master) | 1.595 | 0.15 | 7.29 → 13.87 | — |
| Bottom external | 6.05 | 0.16 | −0.16 → 13.87 | Entrance door 6.09–6.89 |
| Bedroom / bathroom / ensuite bottom (hall top) | 4.05 | 0.12 | 3.81 → 10.81 | Bedroom door 6.09–6.89; bathroom door 7.62–8.32 |
| Utility cupboard top | 5.25 | 0.12 | 7.12 → 8.96 | Double doors 7.40–8.80 |
| Balcony top | −0.08 | 0.10 | −1.74 → −0.16 | — |
| Balcony bottom | 4.02 | 0.10 | −1.74 → −0.16 | — |

### Vertical walls (grid line = x of centre)

| Wall | Centre x | Thickness | y from → to | Openings (y ranges) |
|---|---|---|---|---|
| Kitchen left external | −0.08 | 0.16 | −0.15 → 6.13 | Window 0.79–2.77; balcony door 2.77–3.59; window 4.69–5.58 |
| Balcony left | −1.69 | 0.10 | −0.13 → 4.07 | — |
| Storage side | 0.75 | 0.08 | 0.00 → 0.58 | — |
| Kitchen / bedroom | 3.87 | 0.12 | 0.00 → 4.11 | — |
| Bedroom right external / bathroom left | 7.365 | 0.15 | −0.15 → 4.11 | Window 0.25–1.30 |
| Bathroom / ensuite | 9.27 | 0.10 | 1.67 → 3.99 | — |
| Ensuite / master | 10.76 | 0.10 | 1.67 → 3.99 | Door 3.20–3.99 |
| Kitchen / hall | 5.665 | 0.13 | 4.11 → 5.97 | Door 4.11–4.95 |
| Utility left | 7.18 | 0.12 | 5.19 → 5.97 | — |
| Hall / master | 9.025 | 0.13 | 4.11 → 5.97 | Door 4.11–4.99 |
| Master right external | 13.785 | 0.17 | 1.52 → 6.13 | Window 4.07–5.43 |

### Doors (swing)

| Door | Width | Opens into |
|---|---|---|
| Entrance | 0.80 | Hall |
| Bedroom | 0.80 | Bedroom |
| Bathroom | 0.70 | Hall |
| Ensuite | 0.79 | Master bedroom |
| Master bedroom | 0.88 | Master bedroom |
| Kitchen / hall | 0.84 | Kitchen |
| Balcony | 0.82 | Balcony |
| Utility (double) | 2 × 0.70 | Hall |
| Storage | 0.71 | Kitchen (forms the whole storage front — no wall) |

### Fixtures

| Fixture | Position / size |
|---|---|
| Counter, left run | x 0.00–0.60, y 4.10–5.97 |
| Counter, bottom run | x 0.00–4.12, y 5.37–5.97 |
| Hob | x 1.56–2.16 (on bottom run) |
| Kitchen sink | y 4.51–5.55 (on left run) |
| Bath | x 7.46–9.20, y 1.69–2.37 |
| Shower tray | x 9.34–10.69, y 1.69–2.45 |
| Bathroom basin / WC | approx. x 8.78–9.19, y 2.54–3.05 / x 8.68–9.19, y 3.25–3.81 |
| Ensuite WC / basin | approx. x 9.37–9.91, y 2.74–3.10 / x 9.40–9.86, y 3.25–3.81 |

## 11. Open questions — core structure representation (to discuss next)

- How grid lines, wall segments, junctions and openings reference each other
  (e.g. does a wall store its grid line plus the two grid lines it starts/ends on?).
- How wall ends are defined: on another wall's grid line, or on its face?
- Walls that are collinear but separate (e.g. the two top external walls at different
  thicknesses / offsets) — one grid line or two?
- How rooms are derived from walls (needed for hover clearances and snapping).
- How doors and windows staying fixed to the ground interact with wall thickness changes.
- Openings that run to the end of a wall (ensuite door, kitchen/hall door, storage front).
- Editing rules for bath, shower, WCs and basins (fixed? movable within their room?).
- What fixtures are attached to (counter → kitchen walls?) when grid lines move.
