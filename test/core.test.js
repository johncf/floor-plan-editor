const C = require('../src/core.js');
const base = require('../src/baseline.json');
let fails = 0;
const ok = (cond, msg) => { if (!cond) { fails++; console.log('FAIL', msg); } else console.log('ok  ', msg); };
const mod = (f) => { const p = C.clone(base); f(p); return p; };
const line = (p, id) => [...p.structure.lines.vertical, ...p.structure.lines.horizontal].find((l) => l.id === id);

// Baseline is valid
const e0 = C.validate(base);
ok(e0.length === 0, 'baseline validates ' + JSON.stringify(e0));
ok(C.outOfBounds(base).size === 0, 'no baseline object crosses a wall: ' + [...C.outOfBounds(base)]);
ok(C.lineName(0, true) === 'A' && C.lineName(25, true) === 'Z' && C.lineName(26, true) === 'AA' && C.lineName(27, false) === 'ab', 'line naming');

// Duplicate line position
let p = mod((p) => { line(p, 'H').x = line(p, 'I').x; });
ok(C.validate(p).some((e) => e.includes('distinct')), 'duplicate line position rejected');

// Point order change: move G (7365) right past H (9025) -> order along line e changes
p = mod((p) => { line(p, 'G').x = 9100; });
ok(C.orderErrors(base, p).length > 0, 'order change detected: ' + C.orderErrors(base, p)[0]);

// Small legal move: D right by 100 -> no errors, impacts include kitchen + bedroom
p = mod((p) => { line(p, 'D').x += 100; });
ok(C.validate(p).length === 0 && C.orderErrors(base, p).length === 0, 'small move of D is legal');
const d = C.diffKeys(base, p);
ok(d.has('room:Kitchen / living') && d.has('room:Bedroom') && d.has('seg:D:a|D:e') && d.has('seg:C:a|D:a'), 'impacts of D move: ' + [...d].join(' '));
ok(!d.has('op:door-bedroom'), 'ground-fixed door not impacted by D move');

// Opening blocked: move E right so the bedroom door (6090-6890) falls outside E:e–G:e
p = mod((p) => { line(p, 'E').x = 6200; });
ok(C.validate(p).some((e) => e.includes('door-bedroom')), 'opening outside segment rejected');

// Balcony bottom line d: up to 3590 allowed (touches door), 3580 not
p = mod((p) => { line(p, 'd').y = 3590; });
ok(C.validate(p).length === 0, 'line d moved to touch door end is legal');
p = mod((p) => { line(p, 'd').y = 3580; });
ok(C.validate(p).some((e) => e.includes('door-balcony')), 'line d into balcony door rejected');

// Overlapping openings
p = mod((p) => { p.openings.find((o) => o.id === 'door-utility-2').x = [8000, 8700]; });
ok(C.validate(p).some((e) => e.includes('overlap')), 'overlapping openings rejected');

// Type mismatch
p = mod((p) => { p.openings.find((o) => o.id === 'door-bedroom').type = 'v-door'; });
ok(C.validate(p).some((e) => e.includes('does not match')), 'type/segment mismatch rejected');

// Thickness limits
p = mod((p) => { p.structure.segments[0].thickness = 5; });
ok(C.validate(p).some((e) => e.includes('thickness')), 'thickness 5 rejected');

// Non-neighbour segment
p = mod((p) => { p.structure.segments.push({ points: ['B:a', 'B:d'], thickness: 100 }); });
ok(C.validate(p).some((e) => e.includes('not neighbours')), 'non-neighbour segment rejected');

// Add-on out of bounds
p = mod((p) => { p.objects[1].addons[0].offset = 3600; });
ok(C.validate(p).some((e) => e.includes('padding')), 'add-on beyond counter rejected');

// Object out of bounds after rotation
p = mod((p) => { p.objects.find((o) => o.id === 'bath').rotation = 90; });
ok(C.outOfBounds(p).has('bath'), 'rotated bath flagged out of bounds');

// Anchor change keeps absolute position
const ix = C.index(base);
const bath = base.objects.find((o) => o.id === 'bath');
const c0 = C.objCentre(ix, bath);
const P = ix.pts.get('I:c');
const moved = { ...bath, anchor: 'I:c', dx: c0.x - P.x, dy: c0.y - P.y };
const c1 = C.objCentre(ix, moved);
ok(c0.x === c1.x && c0.y === c1.y, 'anchor change keeps centre');

// Snapping: basin anchored at I:c, place 80 mm from wall I's left face -> snaps to 40 mm gap
const basin = C.clone(base.objects.find((o) => o.id === 'bathroom-basin'));
// I face (left) = 9270 - 50 = 9220 ; basin length 410 -> right edge = cx + 205
basin.dx = (9220 - 80 - 205) - 9270;
const sn = C.snapObject(ix, basin, 40);
ok(9270 + sn.dx + 205 === 9220 - 40, 'snap to 40 mm gap from wall I: dx ' + sn.dx);
basin.dx = (9220 - 400 - 205) - 9270;
ok(C.snapObject(ix, basin, 40).dx === basin.dx, 'no snap when far from wall');

// Clearances of the bath
const bb = C.bboxOf(C.objCorners(ix, bath));
const cl = C.clearances(ix, bb);
ok(cl.left && cl.left.d === 20 && cl.up && cl.up.d === 20 && cl.right.d === 20, 'bath clearances 20/20/20: ' + JSON.stringify([cl.left.d, cl.up.d, cl.right.d, cl.down && cl.down.d]));

// Face ranges: kitchen/bedroom wall D (x 3870, t120), left face: from top wall face 0 to hall-top face 3990? (e line t120 -> 4050-60)
const sD = ix.segByKey.get('D:a|D:e');
ok(JSON.stringify(C.faceRange(ix, sD, -1)) === JSON.stringify([0, 4110]), 'D left face 0→4110 (continues past e on kitchen side): ' + C.faceRange(ix, sD, -1));
ok(JSON.stringify(C.faceRange(ix, sD, 1)) === JSON.stringify([0, 3990]), 'D right face 0→3990 (bedroom): ' + C.faceRange(ix, sD, 1));

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
