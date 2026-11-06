/* Floor plan editor — core model (pure functions, no DOM). All values are integer mm. */
(function (root) {
  'use strict';

  const VRE = /^[A-Z]+$/;
  const HRE = /^[a-z]+$/;
  const OPENING_TYPES = ['v-door', 'v-window', 'h-door', 'h-window'];
  const ADDON_PAD = 50;
  const T_MIN = 10, T_MAX = 800;

  const clone = (o) => JSON.parse(JSON.stringify(o));

  function parsePoint(id) {
    if (typeof id !== 'string') return null;
    const m = id.match(/^([A-Z]+):([a-z]+)$/);
    return m ? { v: m[1], h: m[2] } : null;
  }

  // 0 -> A, 25 -> Z, 26 -> AA ...
  function lineName(i, upper) {
    let s = '';
    let n = i + 1;
    while (n > 0) {
      const r = (n - 1) % 26;
      s = String.fromCharCode((upper ? 65 : 97) + r) + s;
      n = Math.floor((n - 1) / 26);
    }
    return s;
  }

  /* ---------- indexing ---------- */

  function index(plan) {
    const st = plan.structure;
    const V = new Map(), H = new Map();
    for (const l of st.lines.vertical) V.set(l.id, l.x);
    for (const l of st.lines.horizontal) H.set(l.id, l.y);
    const pts = new Map(), segs = [], segByKey = new Map(), atPoint = new Map();
    st.segments.forEach((s, i) => {
      const [a, b] = Array.isArray(s.points) ? s.points : [];
      const pa = parsePoint(a), pb = parsePoint(b);
      let orient = null;
      if (pa && pb) {
        if (pa.v === pb.v && pa.h !== pb.h) orient = 'v';
        else if (pa.h === pb.h && pa.v !== pb.v) orient = 'h';
      }
      const seg = {
        i, a, b, key: a + '|' + b, t: s.thickness, orient,
        line: orient === 'v' ? pa.v : orient === 'h' ? pa.h : null,
      };
      segs.push(seg);
      segByKey.set(seg.key, seg);
      for (const p of [a, b]) {
        const pp = parsePoint(p);
        if (!pp) continue;
        if (!pts.has(p)) pts.set(p, { id: p, v: pp.v, h: pp.h, x: V.get(pp.v), y: H.get(pp.h) });
        if (!atPoint.has(p)) atPoint.set(p, []);
        atPoint.get(p).push(seg);
      }
    });
    return { plan, V, H, pts, segs, segByKey, atPoint };
  }

  const segBetween = (ix, p, q) => ix.segByKey.get(p + '|' + q) || ix.segByKey.get(q + '|' + p) || null;
  const lineCoord = (ix, s) => (s.orient === 'v' ? ix.V.get(s.line) : ix.H.get(s.line));
  const along = (ix, p, orient) => (orient === 'v' ? ix.pts.get(p).y : ix.pts.get(p).x);
  const segRange = (ix, s) => [along(ix, s.a, s.orient), along(ix, s.b, s.orient)];
  const otherEnd = (s, p) => (s.a === p ? s.b : s.a);

  // Map 'V:X' / 'H:x' -> point ids on that line, sorted by position along it.
  function pointsOnLines(ix) {
    const m = new Map();
    for (const p of ix.pts.values()) {
      for (const k of ['V:' + p.v, 'H:' + p.h]) {
        if (!m.has(k)) m.set(k, []);
        m.get(k).push(p);
      }
    }
    const out = new Map();
    for (const [k, arr] of m) {
      arr.sort((p, q) => (k[0] === 'V' ? p.y - q.y : p.x - q.x));
      out.set(k, arr.map((p) => p.id));
    }
    return out;
  }

  /* ---------- geometry ---------- */

  // Half of the thickest wall perpendicular to s at point p (0 if none).
  function endExt(ix, s, p) {
    let e = 0;
    for (const q of ix.atPoint.get(p) || []) if (q.orient && q.orient !== s.orient) e = Math.max(e, q.t / 2);
    return e;
  }

  // Rendered rectangle of a wall segment (extended to fill junctions).
  function segRect(ix, s) {
    const c = lineCoord(ix, s), h = s.t / 2;
    const [lo, hi] = segRange(ix, s);
    const ea = endExt(ix, s, s.a), eb = endExt(ix, s, s.b);
    return s.orient === 'v'
      ? { x1: c - h, y1: lo - ea, x2: c + h, y2: hi + eb }
      : { x1: lo - ea, y1: c - h, x2: hi + eb, y2: c + h };
  }

  // Where a face (side -1 = left/top, +1 = right/bottom) of segment s ends at point p.
  // dir = -1 at the start point (a), +1 at the end point (b).
  function faceEnd(ix, s, p, side, dir) {
    const P = ix.pts.get(p);
    const pc = s.orient === 'v' ? P.y : P.x;
    const c = s.orient === 'v' ? P.x : P.y;
    const segsHere = ix.atPoint.get(p) || [];
    const onSide = segsHere.filter((q) => {
      if (!q.orient || q.orient === s.orient) return false;
      const O = ix.pts.get(otherEnd(q, p));
      const oc = s.orient === 'v' ? O.x : O.y;
      return side < 0 ? oc < c : oc > c;
    });
    if (onSide.length) return pc - dir * Math.max(...onSide.map((q) => q.t)) / 2;
    if (segsHere.some((q) => q !== s && q.orient === s.orient)) return pc;
    return pc + dir * endExt(ix, s, p);
  }

  const faceRange = (ix, s, side) => [faceEnd(ix, s, s.a, side, -1), faceEnd(ix, s, s.b, side, 1)];

  const opRange = (o) => (o.type && o.type[0] === 'v' ? o.y : o.x);
  const opSeg = (ix, o) => (Array.isArray(o.segment) ? ix.segByKey.get(o.segment[0] + '|' + o.segment[1]) || null : null);

  function objCentre(ix, o) {
    const P = ix.pts.get(o.anchor);
    return P ? { x: P.x + o.dx, y: P.y + o.dy } : null;
  }

  function objCorners(ix, o) {
    const c = objCentre(ix, o);
    if (!c) return null;
    const r = ((o.rotation || 0) * Math.PI) / 180;
    const cs = Math.cos(r), sn = Math.sin(r);
    const L = o.length / 2, D = o.depth / 2;
    return [[-L, -D], [L, -D], [L, D], [-L, D]].map(([lx, ly]) => ({
      x: c.x + lx * cs - ly * sn,
      y: c.y + lx * sn + ly * cs,
    }));
  }

  function bboxOf(pts) {
    const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
    return { x1: Math.min(...xs), y1: Math.min(...ys), x2: Math.max(...xs), y2: Math.max(...ys) };
  }

  const rectPoly = (r) => [{ x: r.x1, y: r.y1 }, { x: r.x2, y: r.y1 }, { x: r.x2, y: r.y2 }, { x: r.x1, y: r.y2 }];

  // Separating-axis test for two convex polygons; touching (within eps) does not count.
  function polysOverlap(A, B, eps = 0.5) {
    for (const poly of [A, B]) {
      for (let i = 0; i < poly.length; i++) {
        const p = poly[i], q = poly[(i + 1) % poly.length];
        const nx = -(q.y - p.y), ny = q.x - p.x;
        const len = Math.hypot(nx, ny) || 1;
        const proj = (P) => P.map((v) => (v.x * nx + v.y * ny) / len);
        const a = proj(A), b = proj(B);
        if (Math.max(...a) <= Math.min(...b) + eps || Math.max(...b) <= Math.min(...a) + eps) return false;
      }
    }
    return true;
  }

  // Ids of objects that cross any wall.
  function outOfBounds(plan, ix) {
    ix = ix || index(plan);
    const rects = ix.segs.filter((s) => s.orient).map((s) => rectPoly(segRect(ix, s)));
    const out = new Set();
    for (const o of plan.objects) {
      const c = objCorners(ix, o);
      if (!c) continue;
      if (rects.some((r) => polysOverlap(c, r))) out.add(o.id);
    }
    return out;
  }

  function pointInPolygon(pt, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i], b = poly[j];
      if ((a.y > pt.y) !== (b.y > pt.y) && pt.x < ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
    }
    return inside;
  }

  function distToSeg(p, a, b) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const l2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
    return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
  }

  function roomPoly(ix, r) {
    const poly = r.ring.map((id) => ix.pts.get(id));
    return poly.some((p) => !p || p.x === undefined || p.y === undefined) ? null : poly;
  }

  // A point well inside the polygon (approximate pole of inaccessibility).
  function labelPoint(poly) {
    const bb = bboxOf(poly);
    let best = null, bestD = -1;
    const N = 40;
    for (let i = 0; i <= N; i++) {
      for (let j = 0; j <= N; j++) {
        const p = { x: bb.x1 + ((bb.x2 - bb.x1) * i) / N, y: bb.y1 + ((bb.y2 - bb.y1) * j) / N };
        if (!pointInPolygon(p, poly)) continue;
        let d = Infinity;
        for (let k = 0; k < poly.length; k++) d = Math.min(d, distToSeg(p, poly[k], poly[(k + 1) % poly.length]));
        if (d > bestD) { bestD = d; best = p; }
      }
    }
    return best || { x: (bb.x1 + bb.x2) / 2, y: (bb.y1 + bb.y2) / 2 };
  }

  // Free stretches of a segment not covered by openings, as [from, to] in its range coordinates.
  function freeGaps(plan, ix, s) {
    const [lo, hi] = segRange(ix, s);
    const used = plan.openings.filter((o) => opSeg(ix, o) === s).map(opRange).filter(Array.isArray)
      .sort((a, b) => a[0] - b[0]);
    const gaps = [];
    let cur = lo;
    for (const r of used) {
      if (r[0] > cur) gaps.push([cur, r[0]]);
      cur = Math.max(cur, r[1]);
    }
    if (hi > cur) gaps.push([cur, hi]);
    return gaps;
  }

  // Nearest wall face in each direction from a bounding box (walls overlapping it in the other axis).
  function clearances(ix, bb) {
    const res = { left: null, right: null, up: null, down: null };
    for (const s of ix.segs) {
      if (!s.orient) continue;
      const r = segRect(ix, s);
      const oy = r.y1 < bb.y2 && r.y2 > bb.y1, ox = r.x1 < bb.x2 && r.x2 > bb.x1;
      const my = (Math.max(r.y1, bb.y1) + Math.min(r.y2, bb.y2)) / 2;
      const mx = (Math.max(r.x1, bb.x1) + Math.min(r.x2, bb.x2)) / 2;
      const consider = (dir, d, face, mid) => {
        if (d >= -0.5 && (!res[dir] || d < res[dir].d)) res[dir] = { d: Math.max(0, d), face, mid };
      };
      if (oy && r.x2 <= bb.x1 + 0.5) consider('left', bb.x1 - r.x2, r.x2, my);
      if (oy && r.x1 >= bb.x2 - 0.5) consider('right', r.x1 - bb.x2, r.x1, my);
      if (ox && r.y2 <= bb.y1 + 0.5) consider('up', bb.y1 - r.y2, r.y2, mx);
      if (ox && r.y1 >= bb.y2 - 0.5) consider('down', r.y1 - bb.y2, r.y1, mx);
    }
    return res;
  }

  // Greedy snap against the two walls through the object's anchor point.
  function snapObject(ix, o, gap, threshold = 100) {
    const P = ix.pts.get(o.anchor);
    if (!P) return { dx: o.dx, dy: o.dy };
    const bb = bboxOf(objCorners(ix, o));
    const cx = P.x + o.dx, cy = P.y + o.dy;
    let bestX = null, bestY = null;
    for (const s of ix.segs) {
      if (s.orient === 'v' && s.line === P.v) {
        const r = segRect(ix, s);
        if (r.y1 >= bb.y2 || r.y2 <= bb.y1) continue;
        let shift = null;
        if (cx >= P.x) { const d = bb.x1 - r.x2; if (Math.abs(d - gap) <= threshold) shift = gap - d; }
        else { const d = r.x1 - bb.x2; if (Math.abs(d - gap) <= threshold) shift = d - gap; }
        if (shift !== null && (bestX === null || Math.abs(shift) < Math.abs(bestX))) bestX = shift;
      }
      if (s.orient === 'h' && s.line === P.h) {
        const r = segRect(ix, s);
        if (r.x1 >= bb.x2 || r.x2 <= bb.x1) continue;
        let shift = null;
        if (cy >= P.y) { const d = bb.y1 - r.y2; if (Math.abs(d - gap) <= threshold) shift = gap - d; }
        else { const d = r.y1 - bb.y2; if (Math.abs(d - gap) <= threshold) shift = d - gap; }
        if (shift !== null && (bestY === null || Math.abs(shift) < Math.abs(bestY))) bestY = shift;
      }
    }
    return { dx: Math.round(o.dx + (bestX || 0)), dy: Math.round(o.dy + (bestY || 0)) };
  }

  /* ---------- validation ---------- */

  function validate(plan) {
    const E = [];
    const err = (m) => E.push(m);
    if (!plan || typeof plan !== 'object') return ['The file is not a JSON object'];
    if (plan.version !== 1) err('"version" must be 1');
    const st = plan.structure;
    if (!st || !st.lines || !Array.isArray(st.lines.vertical) || !Array.isArray(st.lines.horizontal) ||
        !Array.isArray(st.segments) || !Array.isArray(st.rooms)) {
      err('"structure" must contain lines.vertical, lines.horizontal, segments and rooms');
      return E;
    }
    if (!Array.isArray(plan.openings)) err('"openings" must be a list');
    if (!Array.isArray(plan.objects)) err('"objects" must be a list');
    if (E.length) return E;

    // Lines
    for (const [arr, re, key, label] of [[st.lines.vertical, VRE, 'x', 'Vertical'], [st.lines.horizontal, HRE, 'y', 'Horizontal']]) {
      const ids = new Set(), pos = new Map();
      for (const l of arr) {
        if (!l || !re.test(l.id)) { err(`${label} line id "${l && l.id}" is invalid`); continue; }
        if (ids.has(l.id)) err(`Duplicate line id ${l.id}`);
        ids.add(l.id);
        if (!Number.isInteger(l[key])) { err(`Line ${l.id}: "${key}" must be an integer (mm)`); continue; }
        if (pos.has(l[key])) err(`Lines ${pos.get(l[key])} and ${l.id} are both at ${l[key]} mm — grid lines must be at distinct positions`);
        else pos.set(l[key], l.id);
      }
    }
    if (E.length) return E;

    const ix = index(plan);

    // Segments
    const seen = new Set();
    for (const s of ix.segs) {
      const name = `${s.a}–${s.b}`;
      const pa = parsePoint(s.a), pb = parsePoint(s.b);
      if (!pa || !pb) { err(`Segment ${name}: invalid point id`); continue; }
      if (!ix.V.has(pa.v) || !ix.H.has(pa.h) || !ix.V.has(pb.v) || !ix.H.has(pb.h)) { err(`Segment ${name}: uses an unknown grid line`); continue; }
      if (!s.orient) { err(`Segment ${name}: its points must share exactly one grid line`); continue; }
      const [lo, hi] = segRange(ix, s);
      if (lo >= hi) err(`Segment ${name}: points must be ordered ${s.orient === 'v' ? 'top → bottom' : 'left → right'}`);
      if (!Number.isInteger(s.t) || s.t < T_MIN || s.t > T_MAX) err(`Segment ${name}: thickness must be a whole number of mm, ${T_MIN}–${T_MAX}`);
      const k = [s.a, s.b].sort().join('|');
      if (seen.has(k)) err(`Duplicate segment ${name}`);
      seen.add(k);
    }
    if (E.length) return E;
    const lines = pointsOnLines(ix);
    for (const s of ix.segs) {
      const arr = lines.get((s.orient === 'v' ? 'V:' : 'H:') + s.line);
      const i = arr.indexOf(s.a), j = arr.indexOf(s.b);
      if (j !== i + 1) err(`Segment ${s.a}–${s.b}: points are not neighbours on line ${s.line} (${arr.slice(i + 1, j).join(', ')} in between)`);
    }

    // Rooms
    const roomNames = new Set();
    st.rooms.forEach((r, ri) => {
      const nm = r && typeof r.name === 'string' && r.name ? r.name : `#${ri + 1}`;
      if (!r || typeof r.name !== 'string' || !r.name) err(`Room ${nm}: a name is required`);
      else if (roomNames.has(r.name)) err(`Duplicate room name "${r.name}"`);
      roomNames.add(nm);
      if (!r || !Array.isArray(r.ring) || r.ring.length < 4) { err(`Room ${nm}: the ring needs at least 4 points`); return; }
      if (new Set(r.ring).size !== r.ring.length) err(`Room ${nm}: the ring repeats a point`);
      for (let k = 0; k < r.ring.length; k++) {
        const p = r.ring[k], q = r.ring[(k + 1) % r.ring.length];
        if (!segBetween(ix, p, q)) err(`Room ${nm}: ${p} → ${q} is not a wall segment`);
      }
      if (r.label !== undefined && !(Array.isArray(r.label) && r.label.length === 2 && r.label.every(Number.isInteger)))
        err(`Room ${nm}: "label" must be [x, y] in whole mm`);
    });

    // Openings
    const ids = new Set();
    const useId = (id, nm, kind) => {
      if (typeof id !== 'string' || !id) err(`${kind} ${nm}: an id is required`);
      else if (ids.has(id)) err(`Duplicate id "${id}"`);
      else ids.add(id);
    };
    const bySeg = new Map();
    plan.openings.forEach((o, oi) => {
      const nm = (o && o.id) || `#${oi + 1}`;
      if (!o || typeof o !== 'object') { err(`Opening ${nm}: must be an object`); return; }
      useId(o.id, nm, 'Opening');
      if (!OPENING_TYPES.includes(o.type)) { err(`Opening ${nm}: unknown type "${o.type}"`); return; }
      const orient = o.type[0], isDoor = o.type.endsWith('door');
      const key = orient === 'v' ? 'y' : 'x', wrong = orient === 'v' ? 'x' : 'y';
      if (!Array.isArray(o.segment) || o.segment.length !== 2) { err(`Opening ${nm}: "segment" must be a pair of points`); return; }
      const s = opSeg(ix, o);
      if (!s) { err(`Opening ${nm}: segment ${o.segment.join('–')} does not exist (points must be in stored order)`); return; }
      if (s.orient !== orient) { err(`Opening ${nm}: type ${o.type} does not match the ${s.orient === 'v' ? 'vertical' : 'horizontal'} segment ${s.a}–${s.b}`); return; }
      if (o[wrong] !== undefined) err(`Opening ${nm}: use "${key}", not "${wrong}", on a ${s.orient === 'v' ? 'vertical' : 'horizontal'} segment`);
      const r = o[key];
      if (!Array.isArray(r) || r.length !== 2 || !r.every(Number.isInteger)) { err(`Opening ${nm}: "${key}" must be [from, to] in whole mm`); return; }
      const [lo, hi] = segRange(ix, s);
      if (!(r[0] < r[1])) err(`Opening ${nm}: "${key}" must have from < to`);
      else if (!(lo <= r[0] && r[1] <= hi)) err(`Opening ${nm}: ${key} ${r[0]}–${r[1]} must lie within its segment (${lo}–${hi})`);
      if (isDoor) {
        const opens = orient === 'h' ? ['up', 'down'] : ['left', 'right'];
        const hinge = orient === 'h' ? ['left', 'right'] : ['top', 'bottom'];
        if (!opens.includes(o.opens)) err(`Door ${nm}: "opens" must be ${opens.join(' or ')}`);
        if (!hinge.includes(o.hinge)) err(`Door ${nm}: "hinge" must be ${hinge.join(' or ')}`);
        if (o.arc !== undefined && !(typeof o.arc === 'number' && o.arc > 0 && o.arc <= 360)) err(`Door ${nm}: "arc" must be a positive number of degrees (max 360)`);
      } else if (o.opens !== undefined || o.hinge !== undefined || o.arc !== undefined) {
        err(`Window ${nm}: "opens", "hinge" and "arc" only apply to doors`);
      }
      if (!bySeg.has(s.key)) bySeg.set(s.key, []);
      bySeg.get(s.key).push({ nm, r });
    });
    for (const list of bySeg.values()) {
      list.sort((p, q) => p.r[0] - q.r[0]);
      for (let i = 1; i < list.length; i++)
        if (list[i].r[0] < list[i - 1].r[1]) err(`Openings ${list[i - 1].nm} and ${list[i].nm} overlap`);
    }

    // Objects
    plan.objects.forEach((o, oi) => {
      const nm = (o && o.id) || `#${oi + 1}`;
      if (!o || typeof o !== 'object') { err(`Object ${nm}: must be an object`); return; }
      useId(o.id, nm, 'Object');
      if (o.type !== 'object') err(`Object ${nm}: "type" must be "object"`);
      if (typeof o.name !== 'string') err(`Object ${nm}: "name" must be text`);
      if (!ix.pts.has(o.anchor)) err(`Object ${nm}: anchor "${o.anchor}" is not a junction point`);
      for (const k of ['dx', 'dy', 'rotation']) if (!Number.isInteger(o[k])) err(`Object ${nm}: "${k}" must be a whole number`);
      for (const k of ['length', 'depth']) if (!Number.isInteger(o[k]) || o[k] < 10) err(`Object ${nm}: "${k}" must be a whole number of mm, at least 10`);
      if (typeof o.locked !== 'boolean') err(`Object ${nm}: "locked" must be true or false`);
      if (o.addons !== undefined && !Array.isArray(o.addons)) { err(`Object ${nm}: "addons" must be a list`); return; }
      (o.addons || []).forEach((a, ai) => {
        const an = `${nm} add-on ${(a && a.name) || ai + 1}`;
        if (!a || typeof a.name !== 'string') err(`${an}: "name" must be text`);
        if (!a || !['offset', 'length', 'depth'].every((k) => Number.isInteger(a[k]))) { err(`${an}: offset, length and depth must be whole mm`); return; }
        if (a.length < 10 || a.depth < 10) err(`${an}: length and depth must be at least 10 mm`);
        if (Number.isInteger(o.length) && (a.offset < ADDON_PAD || a.offset + a.length > o.length - ADDON_PAD))
          err(`${an}: must stay within the object's length with ${ADDON_PAD} mm padding (allowed ${ADDON_PAD}–${o.length - ADDON_PAD})`);
        if (Number.isInteger(o.depth) && a.depth > o.depth - 2 * ADDON_PAD)
          err(`${an}: depth can be at most ${o.depth - 2 * ADDON_PAD} mm (object depth minus padding)`);
      });
    });

    return E;
  }

  // Errors if any point changed order along any grid line between two plans with the same structure.
  function orderErrors(before, after) {
    const lb = pointsOnLines(index(before)), la = pointsOnLines(index(after));
    const E = [];
    for (const [k, arr] of lb) {
      const arr2 = la.get(k);
      if (!arr2 || arr2.length !== arr.length) continue;
      if (arr.some((p, i) => p !== arr2[i]))
        E.push(`Point order along line ${k.slice(2)} would change: ${arr.join(', ')} → ${arr2.join(', ')}`);
    }
    return E;
  }

  /* ---------- change detection (for highlighting) ---------- */

  function geomKeys(plan) {
    const ix = index(plan);
    const m = new Map();
    for (const s of ix.segs) {
      if (!s.orient) continue;
      const r = segRect(ix, s);
      m.set('seg:' + s.key, [r.x1, r.y1, r.x2, r.y2].join(','));
    }
    for (const o of plan.openings) {
      const s = opSeg(ix, o);
      m.set('op:' + o.id, JSON.stringify(o) + '|' + (s ? lineCoord(ix, s) + ',' + s.t : ''));
    }
    for (const o of plan.objects) {
      const c = objCentre(ix, o);
      m.set('obj:' + o.id, JSON.stringify([c && c.x, c && c.y, o.length, o.depth, o.rotation, o.addons, o.name]));
    }
    for (const r of plan.structure.rooms) {
      m.set('room:' + r.name, r.ring.map((p) => { const P = ix.pts.get(p); return P ? P.x + ',' + P.y : '?'; }).join(' '));
    }
    return m;
  }

  function diffKeys(a, b) {
    const A = geomKeys(a), B = geomKeys(b), out = new Set();
    for (const [k, v] of B) if (A.get(k) !== v) out.add(k);
    for (const k of A.keys()) if (!B.has(k)) out.add(k);
    return out;
  }

  function uniqueId(plan, prefix) {
    const used = new Set([...plan.openings, ...plan.objects].map((o) => o.id));
    for (let i = 1; ; i++) if (!used.has(prefix + '-' + i)) return prefix + '-' + i;
  }

  function nearestPoint(ix, x, y) {
    let best = null, bd = Infinity;
    for (const p of ix.pts.values()) {
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }

  /* ---------- formatting ---------- */

  function fmtLen(mm, units) {
    const neg = mm < 0 ? '−' : '';
    const a = Math.abs(mm);
    if (units === 'imperial') {
      const inches = Math.round(a / 25.4);
      return `${neg}${Math.floor(inches / 12)}′${inches % 12}″`;
    }
    return `${neg}${(a / 1000).toFixed(a % 10 === 0 ? 2 : 3)} m`;
  }

  const api = {
    ADDON_PAD, T_MIN, T_MAX, OPENING_TYPES,
    clone, parsePoint, lineName, index, segBetween, lineCoord, segRange, pointsOnLines,
    endExt, segRect, faceRange, opRange, opSeg, objCentre, objCorners, bboxOf, rectPoly,
    polysOverlap, outOfBounds, pointInPolygon, roomPoly, labelPoint, freeGaps, clearances,
    snapObject, validate, orderErrors, geomKeys, diffKeys, uniqueId, nearestPoint, fmtLen,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FPE = api;
})(typeof window !== 'undefined' ? window : globalThis);
