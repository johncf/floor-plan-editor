/* Floor plan editor — UI. Depends on window.FPE (core.js). */
(function () {
  'use strict';
  const C = window.FPE;
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const BASELINE = JSON.parse(document.getElementById('baseline').textContent);
  const LS_PLAN = 'floor-plan-editor.plan', LS_SET = 'floor-plan-editor.settings';

  const PRESETS = [
    ['Single bed', 900, 1900], ['Small double bed', 1200, 1900], ['Double bed', 1350, 1900],
    ['King bed', 1500, 2000], ['Super king bed', 1800, 2000], ['Bedside table', 450, 400],
    ['Wardrobe', 1000, 600], ['Double wardrobe', 1500, 600], ['Chest of drawers', 800, 450],
    ['Desk', 1200, 600], ['Desk chair', 600, 600], ['Sofa, 3-seat', 2000, 900], ['Sofa, 2-seat', 1600, 900],
    ['Armchair', 850, 850], ['Coffee table', 1100, 600], ['TV unit', 1500, 400],
    ['Dining table for 4', 1200, 800], ['Dining table for 6', 1600, 900], ['Dining chair', 450, 500],
    ['Kitchen counter', 1200, 600], ['Fridge freezer', 600, 650], ['Washing machine', 600, 600],
    ['Rug', 2000, 1400], ['Custom box', 1000, 600],
  ];

  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* storage unavailable */ } },
  };

  let plan;               // committed plan
  let draft = null;       // previewed edit from the panel
  let draftErrors = [];
  let live = null;        // plan while an object is being dragged
  let sel = null;         // {kind:'seg', key} | {kind:'op', id} | {kind:'obj', id}
  let form = null;        // panel edit state
  let hover = null;       // data-k of the hovered element
  const undoStack = [], redoStack = [];
  const settings = { units: 'metric', snap: true, gap: 40, exportDims: true };
  let view = { x: 0, y: 0, w: 1000, h: 1000 };
  let dragState = null, panState = null, downInfo = null;

  const svg = $('#plan'), gDraw = $('#drawing'), gOver = $('#overlay'), panel = $('#panel');
  const shown = () => draft || live || plan;
  const fmt = (mm) => C.fmtLen(mm, settings.units);

  /* ---------------- persistence ---------------- */

  function load() {
    try { const s = JSON.parse(store.get(LS_SET) || 'null'); if (s) Object.assign(settings, s); } catch (e) { /* ignore */ }
    let p = null;
    try { p = JSON.parse(store.get(LS_PLAN) || 'null'); } catch (e) { p = null; }
    plan = p && C.validate(p).length === 0 ? p : C.clone(BASELINE);
  }
  const save = () => store.set(LS_PLAN, JSON.stringify(plan));
  const saveSettings = () => store.set(LS_SET, JSON.stringify(settings));

  /* ---------------- view ---------------- */

  const stageRect = () => svg.getBoundingClientRect();
  function k() { const r = stageRect(); return Math.max(view.w / r.width, view.h / r.height) || 1; }
  function setViewBox() { svg.setAttribute('viewBox', `${view.x} ${view.y} ${view.w} ${view.h}`); }
  function toPlan(ev) {
    const r = stageRect(), kk = k();
    const ox = (r.width * kk - view.w) / 2, oy = (r.height * kk - view.h) / 2;
    return { x: view.x - ox + (ev.clientX - r.left) * kk, y: view.y - oy + (ev.clientY - r.top) * kk };
  }
  function planBBox(p) {
    const ix = C.index(p);
    let bb = null;
    for (const s of ix.segs) {
      if (!s.orient) continue;
      const r = C.segRect(ix, s);
      bb = bb ? { x1: Math.min(bb.x1, r.x1), y1: Math.min(bb.y1, r.y1), x2: Math.max(bb.x2, r.x2), y2: Math.max(bb.y2, r.y2) } : { ...r };
    }
    return bb || { x1: 0, y1: 0, x2: 1000, y2: 1000 };
  }
  function fit() {
    const bb = planBBox(plan), m = 700;
    view = { x: bb.x1 - m, y: bb.y1 - m, w: bb.x2 - bb.x1 + 2 * m, h: bb.y2 - bb.y1 + 2 * m };
    setViewBox();
    render();
  }

  /* ---------------- drawing ---------------- */

  function drawPlan(p, ix, o) {
    const kk = o.k, hl = o.hl || new Set(), out = [];
    const isSel = (kind, id) => !!(o.sel && o.sel.kind === kind && (o.sel.key || o.sel.id) === id);
    for (const r of p.structure.rooms) {
      const poly = C.roomPoly(ix, r);
      if (!poly) continue;
      const cls = ['room'];
      if (/balcony|terrace|garden|patio/i.test(r.name)) cls.push('outdoor');
      if (hl.has('room:' + r.name)) cls.push('hl');
      out.push(`<polygon class="${cls.join(' ')}" points="${poly.map((q) => q.x + ',' + q.y).join(' ')}"/>`);
    }
    const rank = { '': 0, hl: 1, sel: 2 };
    const walls = ix.segs.filter((s) => s.orient)
      .map((s) => ({ s, cls: isSel('seg', s.key) ? 'sel' : hl.has('seg:' + s.key) ? 'hl' : '' }))
      .sort((a, b) => rank[a.cls] - rank[b.cls]);
    for (const { s, cls } of walls) {
      const R = C.segRect(ix, s);
      out.push(`<rect class="wall ${cls}" data-k="seg:${s.key}" x="${R.x1}" y="${R.y1}" width="${R.x2 - R.x1}" height="${R.y2 - R.y1}"/>`);
    }
    for (const op of p.openings) out.push(drawOpening(ix, op, hl.has('op:' + op.id), isSel('op', op.id)));
    for (const ob of p.objects) {
      out.push(drawObject(ix, ob, {
        hl: hl.has('obj:' + ob.id), oob: o.oob && o.oob.has(ob.id), sel: isSel('obj', ob.id), k: kk,
        dragging: o.dragging === ob.id,
      }));
    }
    for (const r of p.structure.rooms) {
      const poly = C.roomPoly(ix, r);
      if (!poly) continue;
      const L = r.label ? { x: r.label[0], y: r.label[1] } : C.labelPoint(poly);
      out.push(`<text class="roomlabel" x="${L.x}" y="${L.y}" font-size="${13 * kk}">${esc(r.name)}</text>`);
    }
    return out.join('');
  }

  function drawOpening(ix, op, isHl, selected) {
    const s = C.opSeg(ix, op), r = C.opRange(op);
    if (!s || !Array.isArray(r)) return '';
    const c = C.lineCoord(ix, s), h = s.t / 2, v = s.orient === 'v';
    const [r0, r1] = r;
    const gap = v ? `x="${c - h}" y="${r0}" width="${s.t}" height="${r1 - r0}"` : `x="${r0}" y="${c - h}" width="${r1 - r0}" height="${s.t}"`;
    let g = `<g class="opening${isHl ? ' hl' : ''}${selected ? ' sel' : ''}" data-k="op:${esc(op.id)}"><rect class="gap" ${gap}/>`;
    if (op.type.endsWith('window')) {
      g += v ? `<line class="wl" x1="${c}" y1="${r0}" x2="${c}" y2="${r1}"/>` : `<line class="wl" x1="${r0}" y1="${c}" x2="${r1}" y2="${c}"/>`;
    } else {
      const w = r1 - r0, arc = op.arc || 90, th = (arc * Math.PI) / 180;
      let H, u, n;
      if (v) {
        H = { x: op.opens === 'left' ? c - h : c + h, y: op.hinge === 'top' ? r0 : r1 };
        u = { x: 0, y: op.hinge === 'top' ? 1 : -1 };
        n = { x: op.opens === 'left' ? -1 : 1, y: 0 };
      } else {
        H = { x: op.hinge === 'left' ? r0 : r1, y: op.opens === 'up' ? c - h : c + h };
        u = { x: op.hinge === 'left' ? 1 : -1, y: 0 };
        n = { x: 0, y: op.opens === 'up' ? -1 : 1 };
      }
      const Cp = { x: H.x + w * u.x, y: H.y + w * u.y };
      const L = { x: H.x + w * (u.x * Math.cos(th) + n.x * Math.sin(th)), y: H.y + w * (u.y * Math.cos(th) + n.y * Math.sin(th)) };
      const sweep = u.x * n.y - u.y * n.x > 0 ? 1 : 0;
      g += `<line class="leaf" x1="${H.x}" y1="${H.y}" x2="${L.x}" y2="${L.y}"/>`;
      g += `<path class="arc" d="M${Cp.x},${Cp.y} A${w},${w} 0 ${arc > 180 ? 1 : 0} ${sweep} ${L.x},${L.y}"/>`;
    }
    return g + '</g>';
  }

  function drawObject(ix, ob, f) {
    const c = C.objCentre(ix, ob);
    if (!c) return '';
    const L = ob.length, D = ob.depth, kk = f.k;
    const cls = ['obj'];
    if (ob.locked) cls.push('locked');
    if (f.oob) cls.push('oob');
    if (f.hl) cls.push('hl');
    if (f.sel) cls.push('sel');
    if (f.dragging) cls.push('dragging');
    let g = `<g class="${cls.join(' ')}" data-k="obj:${esc(ob.id)}"><g transform="rotate(${ob.rotation || 0} ${c.x} ${c.y})">`;
    g += `<rect class="body" x="${c.x - L / 2}" y="${c.y - D / 2}" width="${L}" height="${D}"/>`;
    (ob.addons || []).forEach((a, i) => {
      const ax = c.x - L / 2 + a.offset;
      g += `<rect class="addon" data-k="addon:${esc(ob.id)}:${i}" x="${ax}" y="${c.y - a.depth / 2}" width="${a.length}" height="${a.depth}"/>`;
      const fs = Math.min(10 * kk, a.depth * 0.4, (a.length / Math.max(a.name.length, 1)) * 1.6);
      g += `<text class="addonlabel" x="${ax + a.length / 2}" y="${c.y}" font-size="${fs}">${esc(a.name)}</text>`;
    });
    g += '</g>';
    if (!(ob.addons && ob.addons.length)) {
      const fs = Math.min(11 * kk, Math.min(L, D) * 0.35, (Math.max(L, D) / Math.max(ob.name.length, 1)) * 1.5);
      g += `<text class="objlabel" x="${c.x}" y="${c.y}" font-size="${fs}">${esc(ob.name)}</text>`;
    }
    return g + '</g>';
  }

  /* ---------------- measurements ---------------- */

  function tickPair(x1, y1, x2, y2, t) {
    return `<line x1="${x1 - t}" y1="${y1 + t}" x2="${x1 + t}" y2="${y1 - t}"/><line x1="${x2 - t}" y1="${y2 + t}" x2="${x2 + t}" y2="${y2 - t}"/>`;
  }
  const labelFits = (len, label, kk) => label.length * 10.5 * kk * 0.52 + 6 * kk <= Math.abs(len);
  function dimH(x1, x2, y, label, side, kk, cls = '', row = 0) {
    if (Math.abs(x2 - x1) < 0.5) return '';
    const fs = 10.5 * kk, ty = (side < 0 ? y - 3 * kk : y + fs + 1.5 * kk) + side * row * fs * 1.15;
    return `<g class="dim ${cls}"><line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}"/>${tickPair(x1, y, x2, y, 3.5 * kk)}` +
      `<text x="${(x1 + x2) / 2}" y="${ty}" font-size="${fs}" stroke-width="${3 * kk}" text-anchor="middle">${esc(label)}</text></g>`;
  }
  function dimV(y1, y2, x, label, side, kk, cls = '', row = 0) {
    if (Math.abs(y2 - y1) < 0.5) return '';
    const fs = 10.5 * kk, tx = (side < 0 ? x - 3 * kk : x + fs + 1.5 * kk) + side * row * fs * 1.15, ym = (y1 + y2) / 2;
    return `<g class="dim ${cls}"><line x1="${x}" y1="${y1}" x2="${x}" y2="${y2}"/>${tickPair(x, y1, x, y2, 3.5 * kk)}` +
      `<text x="${tx}" y="${ym}" font-size="${fs}" stroke-width="${3 * kk}" text-anchor="middle" transform="rotate(-90 ${tx} ${ym})">${esc(label)}</text></g>`;
  }
  function metaText(x, y, label, kk, anchor = 'middle') {
    return `<g class="dim meta"><text x="${x}" y="${y}" font-size="${10 * kk}" stroke-width="${3 * kk}" text-anchor="${anchor}">${esc(label)}</text></g>`;
  }

  // Face lengths of a wall, split at its openings, on the given sides.
  function segFaceDims(p, ix, s, kk, sides) {
    const out = [], v = s.orient === 'v', c = C.lineCoord(ix, s);
    const ops = p.openings.filter((o) => C.opSeg(ix, o) === s).map(C.opRange).filter(Array.isArray);
    for (const side of sides) {
      const [f0, f1] = C.faceRange(ix, s, side);
      const fc = c + (side * s.t) / 2;
      const cuts = [f0, f1];
      for (const r of ops) for (const q of r) if (q > f0 + 0.5 && q < f1 - 0.5) cuts.push(q);
      cuts.sort((a, b) => a - b);
      const pieces = [];
      for (let i = 1; i < cuts.length; i++) if (cuts[i] - cuts[i - 1] > 0.5) pieces.push([cuts[i - 1], cuts[i]]);
      const rows = chain(pieces.map(([a, b]) => [a, b, '']), fc + side * 12 * kk, side, kk, v, out);
      if (pieces.length > 1) {
        const pos = fc + side * (30 + rows * 12) * kk;
        out.push(v ? dimV(f0, f1, pos, fmt(f1 - f0), side, kk) : dimH(f0, f1, pos, fmt(f1 - f0), side, kk));
      }
    }
    return out.join('');
  }

  // A row of adjacent dimensions; labels that don't fit their piece are staggered outward.
  // Returns the number of extra label rows used.
  function chain(pieces, pos, side, kk, vertical, out, cls = '') {
    let row = 0, maxRow = 0;
    for (const [a, b, pre] of pieces) {
      const label = pre + fmt(b - a);
      if (Math.abs(b - a) < 0.5) continue;
      row = labelFits(b - a, label, kk) ? 0 : (row === 1 ? 2 : 1);
      maxRow = Math.max(maxRow, row);
      out.push(vertical ? dimV(a, b, pos, label, side, kk, cls, row) : dimH(a, b, pos, label, side, kk, cls, row));
    }
    return maxRow;
  }

  function hoverSeg(p, ix, s, kk) {
    let g = segFaceDims(p, ix, s, kk, [-1, 1]);
    const c = C.lineCoord(ix, s), [lo, hi] = C.segRange(ix, s), v = s.orient === 'v';
    // Caption outside the dimension rows on the left/top side.
    const caption = `Line ${s.line}, ${fmt(s.t)} thick`, mid = (lo + hi) / 2, off = c - s.t / 2 - 62 * kk;
    g += v
      ? `<g class="dim meta"><text x="${off}" y="${mid}" font-size="${10 * kk}" stroke-width="${3 * kk}" text-anchor="middle" transform="rotate(-90 ${off} ${mid})">${esc(caption)}</text></g>`
      : metaText(mid, off, caption, kk);
    return g;
  }

  function hoverOpening(p, ix, op, kk) {
    const s = C.opSeg(ix, op), r = C.opRange(op);
    if (!s || !Array.isArray(r)) return '';
    const v = s.orient === 'v', c = C.lineCoord(ix, s), [lo, hi] = C.segRange(ix, s), [r0, r1] = r;
    const isDoor = op.type.endsWith('door');
    const side = isDoor ? (op.opens === 'up' || op.opens === 'left' ? 1 : -1) : -1;
    const pos = c + side * (s.t / 2 + 12 * kk);
    const out = [];
    chain([[lo, r0, ''], [r0, r1, isDoor ? 'door ' : 'window '], [r1, hi, '']], pos, side, kk, v, out);
    return out.join('');
  }

  function hoverObject(p, ix, ob, kk, ai) {
    const c = C.objCentre(ix, ob);
    if (!c) return '';
    const L = ob.length, D = ob.depth;
    let g = `<g transform="rotate(${ob.rotation || 0} ${c.x} ${c.y})">`;
    if (ai === null) {
      g += dimH(c.x - L / 2, c.x + L / 2, c.y - D / 2 - 10 * kk, fmt(L), -1, kk);
      g += dimV(c.y - D / 2, c.y + D / 2, c.x + L / 2 + 10 * kk, fmt(D), 1, kk);
    } else {
      const a = ob.addons[ai];
      if (!a) return '';
      const x0 = c.x - L / 2, ax = x0 + a.offset, y = c.y + D / 2 + 10 * kk;
      const out = [];
      chain([[x0, ax, ''], [ax, ax + a.length, a.name + ' '], [ax + a.length, c.x + L / 2, '']], y, 1, kk, false, out);
      g += out.join('');
      g += dimV(c.y - a.depth / 2, c.y + a.depth / 2, x0 - 10 * kk, fmt(a.depth), -1, kk);
    }
    g += '</g>';
    if (ai === null) {
      const bb = C.bboxOf(C.objCorners(ix, ob));
      if ((ob.rotation || 0) % 90 !== 0)
        g += `<rect class="hovering" style="stroke-dasharray:3 3" x="${bb.x1}" y="${bb.y1}" width="${bb.x2 - bb.x1}" height="${bb.y2 - bb.y1}"/>`;
      const cl = C.clearances(ix, bb);
      if (cl.left) g += dimH(cl.left.face, bb.x1, cl.left.mid, fmt(cl.left.d), -1, kk, 'clear');
      if (cl.right) g += dimH(bb.x2, cl.right.face, cl.right.mid, fmt(cl.right.d), -1, kk, 'clear');
      if (cl.up) g += dimV(cl.up.face, bb.y1, cl.up.mid, fmt(cl.up.d), -1, kk, 'clear');
      if (cl.down) g += dimV(bb.y2, cl.down.face, cl.down.mid, fmt(cl.down.d), -1, kk, 'clear');
    }
    return g;
  }

  function drawHover(p, ix, key, kk) {
    const i = key.indexOf(':'), kind = key.slice(0, i), rest = key.slice(i + 1);
    if (kind === 'seg') { const s = ix.segByKey.get(rest); return s ? hoverSeg(p, ix, s, kk) : ''; }
    if (kind === 'op') { const op = p.openings.find((o) => o.id === rest); return op ? hoverOpening(p, ix, op, kk) : ''; }
    if (kind === 'obj') { const ob = p.objects.find((o) => o.id === rest); return ob ? hoverObject(p, ix, ob, kk, null) : ''; }
    if (kind === 'addon') {
      const j = rest.lastIndexOf(':'), ob = p.objects.find((o) => o.id === rest.slice(0, j));
      return ob ? hoverObject(p, ix, ob, kk, +rest.slice(j + 1)) : '';
    }
    return '';
  }

  /* ---------------- render ---------------- */

  function render() {
    const p = shown(), ix = C.index(p);
    const hl = draft ? C.diffKeys(plan, draft) : new Set();
    gDraw.innerHTML = drawPlan(p, ix, { hl, oob: C.outOfBounds(p, ix), sel, k: k(), dragging: dragState && dragState.id });
    renderOverlay(p, ix);
    updateToolbar();
  }
  function renderOverlay(p, ix) {
    p = p || shown();
    ix = ix || C.index(p);
    gOver.innerHTML = hover ? drawHover(p, ix, hover, k()) : '';
  }

  /* ---------------- commits, undo ---------------- */

  function ensureSel() {
    if (!sel) return;
    if (sel.kind === 'seg' && !C.index(plan).segByKey.has(sel.key)) sel = null;
    else if (sel.kind === 'op' && !plan.openings.some((o) => o.id === sel.id)) sel = null;
    else if (sel.kind === 'obj' && !plan.objects.some((o) => o.id === sel.id)) sel = null;
  }
  function settle() { draft = null; draftErrors = []; form = null; save(); ensureSel(); render(); renderPanel(); }
  function commit(np) {
    undoStack.push(JSON.stringify(plan));
    if (undoStack.length > 300) undoStack.shift();
    redoStack.length = 0;
    plan = np;
    settle();
  }
  function undo() {
    if (draft) { cancel(); return; }
    if (!undoStack.length) return;
    redoStack.push(JSON.stringify(plan));
    plan = JSON.parse(undoStack.pop());
    settle();
  }
  function redo() {
    if (draft) cancel();
    if (!redoStack.length) return;
    undoStack.push(JSON.stringify(plan));
    plan = JSON.parse(redoStack.pop());
    settle();
  }
  function select(s) {
    sel = s;
    draft = null; draftErrors = []; form = null;
    render();
    renderPanel();
  }
  function apply() { if (draft && !draftErrors.length) commit(draft); }
  function cancel() { draft = null; draftErrors = []; form = null; render(); renderPanel(); }

  /* ---------------- notices ---------------- */

  let noticeTimer = null;
  function notify(msg, isErr) {
    const n = $('#notice');
    n.innerHTML = msg;
    n.className = isErr ? 'err' : '';
    n.hidden = false;
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => { n.hidden = true; }, isErr ? 12000 : 4000);
  }

  /* ---------------- panel ---------------- */

  function getVal(n) { const m = n.match(/^a(\d+)-(\w+)$/); return m ? form.addons[+m[1]][m[2]] : form.v[n]; }
  function setVal(n, x) { const m = n.match(/^a(\d+)-(\w+)$/); if (m) form.addons[+m[1]][m[2]] = x; else form.v[n] = x; }

  function numField(name, label, unit = 'cm') {
    const val = getVal(name), disp = unit === 'cm' ? val / 10 : val;
    return `<div class="row"><label for="f-${name}">${esc(label)}</label><span class="stepper">` +
      `<button type="button" data-step="-1" data-f="${name}" aria-label="Decrease ${esc(label)}">−</button>` +
      `<input id="f-${name}" data-f="${name}" data-unit="${unit}" type="number" step="any" value="${disp}">` +
      `<button type="button" data-step="1" data-f="${name}" aria-label="Increase ${esc(label)}">+</button>` +
      `<span class="unit">${unit === 'cm' ? 'cm' : '°'}</span></span><span class="conv" data-conv="${name}"></span></div>`;
  }
  const statusHTML = () => '<div class="impact" id="impact"></div><div class="errs" id="errs"></div>';
  const actionsHTML = (extra = '') =>
    `<div class="actions"><button class="btn primary" id="apply" disabled>Apply</button><button class="btn" id="cancel" disabled>Cancel</button>${extra}</div>`;

  function wireFields(onChange) {
    const stepBy = (name, dir, unit, inp) => {
      setVal(name, getVal(name) + dir * (unit === 'cm' ? 10 : 1));
      inp.value = unit === 'cm' ? getVal(name) / 10 : getVal(name);
    };
    panel.querySelectorAll('input[data-f]').forEach((inp) => {
      const name = inp.dataset.f, unit = inp.dataset.unit;
      inp.addEventListener('input', () => {
        const v = parseFloat(inp.value);
        if (!Number.isFinite(v)) return;
        setVal(name, unit === 'cm' ? Math.round(v) * 10 : Math.round(v));
        onChange();
      });
      inp.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); stepBy(name, e.key === 'ArrowUp' ? 1 : -1, unit, inp); onChange(); }
        else if (e.key === 'Enter') apply();
      });
    });
    panel.querySelectorAll('button[data-step]').forEach((b) => b.addEventListener('click', () => {
      const inp = panel.querySelector(`input[data-f="${b.dataset.f}"]`);
      stepBy(b.dataset.f, +b.dataset.step, inp.dataset.unit, inp);
      onChange();
    }));
    const ap = $('#apply'), ca = $('#cancel');
    if (ap) ap.addEventListener('click', apply);
    if (ca) ca.addEventListener('click', cancel);
  }

  function refreshDraft(build) {
    const d = build();
    if (!d || JSON.stringify(d) === JSON.stringify(plan)) { draft = null; draftErrors = []; }
    else { draft = d; draftErrors = [...new Set([...C.validate(d), ...C.orderErrors(plan, d)])]; }
    render();
    updateStatus();
  }

  function updateStatus() {
    panel.querySelectorAll('[data-conv]').forEach((el) => {
      const inp = panel.querySelector(`input[data-f="${el.dataset.conv}"]`);
      el.textContent = inp && inp.dataset.unit === 'cm' ? fmt(getVal(el.dataset.conv)) : '';
    });
    const errs = $('#errs'), imp = $('#impact'), ap = $('#apply'), ca = $('#cancel');
    if (errs) errs.innerHTML = draftErrors.map((e) => `<p>${esc(e)}</p>`).join('');
    if (imp) {
      const n = draft ? C.diffKeys(plan, draft).size : 0;
      imp.innerHTML = draft && n ? `<span class="swatch"></span>${n} ${n === 1 ? 'part' : 'parts'} of the plan change with this edit.` : '';
    }
    if (ap) ap.disabled = !draft || draftErrors.length > 0;
    if (ca) ca.disabled = !draft;
    panel.querySelectorAll('[data-needs-clean]').forEach((b) => { b.disabled = !!draft; });
  }

  function renderPanel() {
    ensureSel();
    if (!sel) { panel.innerHTML = helpHTML(); $('#reset').addEventListener('click', resetPlan); return; }
    const ix = C.index(plan);
    if (sel.kind === 'seg') panelSeg(ix);
    else if (sel.kind === 'op') panelOp(ix);
    else panelObj(ix);
  }

  function helpHTML() {
    return `<h2>Select something to edit</h2>
      <p>Click a wall to move its grid line or change its thickness. Click a door or window to resize or reposition it.
      Click an object to edit it, or drag it to move it.</p>
      <p>Edits show as a preview first, with every part of the plan they change marked in yellow. Apply keeps the change; Cancel discards it.</p>
      <div class="legend">
        <div><i style="background:var(--pencil-blue)"></i>Selected</div>
        <div><i style="background:var(--marker)"></i>Changes with the current edit</div>
        <div><i style="background:#fde4e1;border:1px dashed var(--red-pencil)"></i>Object crosses a wall</div>
        <div><i style="background:#eeefea;border:1px solid #8e9188"></i>Locked object</div>
      </div>
      <h3>Keyboard</h3>
      <p><kbd>Ctrl</kbd>+<kbd>Z</kbd> undo, <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd> redo, <kbd>Esc</kbd> cancel the edit or deselect,
      <kbd>Delete</kbd> remove the selected door, window or object.</p>
      <p class="muted">Changes are saved automatically in this browser. Export JSON to keep a copy or open the plan on another computer.</p>
      <h3>Start over</h3>
      <p class="muted">Replaces your plan with the original. You can undo this.</p>
      <div class="actions"><button class="btn danger" id="reset">Reset plan</button></div>`;
  }

  function lineOf(p, s) {
    return s.orient === 'v' ? p.structure.lines.vertical.find((l) => l.id === s.line) : p.structure.lines.horizontal.find((l) => l.id === s.line);
  }

  function panelSeg(ix) {
    const s = ix.segByKey.get(sel.key);
    const isV = s.orient === 'v', line = lineOf(plan, s);
    if (!form) form = { kind: 'seg', v: { pos: isV ? line.x : line.y, t: s.t } };
    const [lo, hi] = C.segRange(ix, s);
    const n = ix.segs.filter((q) => q.orient === s.orient && q.line === s.line).length;
    panel.innerHTML = `<h2>Wall ${s.a} to ${s.b}</h2>
      <p class="sub">${isV ? 'Vertical' : 'Horizontal'} wall on grid line ${s.line}, ${fmt(hi - lo)} between its end points.</p>
      ${numField('pos', `Line ${s.line} ${isV ? 'x' : 'y'}`)}
      <p class="muted" style="font-size:12.5px;margin:0 0 8px 96px">Moves ${n === 1 ? 'this wall' : `all ${n} walls on line ${s.line}`}, and stretches the walls that meet it.</p>
      ${numField('t', 'Thickness')}
      ${statusHTML()}${actionsHTML()}
      <h3>Doors and windows</h3>
      <p class="muted">Adds one to the largest free stretch of this wall.</p>
      <div class="actions"><button class="btn" id="add-door" data-needs-clean>Add door</button><button class="btn" id="add-window" data-needs-clean>Add window</button></div>`;
    wireFields(() => refreshDraft(() => {
      const d = C.clone(plan);
      const L = lineOf(d, s);
      if (isV) L.x = form.v.pos; else L.y = form.v.pos;
      d.structure.segments[s.i].thickness = form.v.t;
      return d;
    }));
    $('#add-door').addEventListener('click', () => addOpening('door'));
    $('#add-window').addEventListener('click', () => addOpening('window'));
    updateStatus();
  }

  function addOpening(kind) {
    const ix = C.index(plan), s = ix.segByKey.get(sel.key);
    const gaps = C.freeGaps(plan, ix, s);
    const g = gaps.reduce((a, b) => (!a || b[1] - b[0] > a[1] - a[0] ? b : a), null);
    if (!g || g[1] - g[0] < 10) { notify('This wall has no free space for another opening.', true); return; }
    const w = Math.min(kind === 'door' ? 800 : 1000, g[1] - g[0]);
    let r0 = Math.round(((g[0] + g[1]) / 2 - w / 2) / 10) * 10;
    r0 = Math.max(g[0], Math.min(r0, g[1] - w));
    const isV = s.orient === 'v';
    const op = { id: C.uniqueId(plan, kind), type: (isV ? 'v-' : 'h-') + kind, segment: [s.a, s.b] };
    op[isV ? 'y' : 'x'] = [r0, r0 + w];
    if (kind === 'door') { op.opens = isV ? 'right' : 'down'; op.hinge = isV ? 'top' : 'left'; }
    const d = C.clone(plan);
    d.openings.push(op);
    const errs = C.validate(d);
    if (errs.length) { notify(esc(errs[0]), true); return; }
    commit(d);
    select({ kind: 'op', id: op.id });
  }

  function panelOp(ix) {
    const op = plan.openings.find((o) => o.id === sel.id);
    const s = C.opSeg(ix, op), [lo, hi] = C.segRange(ix, s), [r0, r1] = C.opRange(op);
    const isV = s.orient === 'v', isDoor = op.type.endsWith('door');
    if (!form) form = { kind: 'op', from: 'a', opens: op.opens, hinge: op.hinge, v: { off: r0 - lo, w: r1 - r0, arc: op.arc || 90 } };
    const range = () => (form.from === 'a' ? [lo + form.v.off, lo + form.v.off + form.v.w] : [hi - form.v.off - form.v.w, hi - form.v.off]);
    const endA = `${s.a}, ${isV ? 'top' : 'left'} end`, endB = `${s.b}, ${isV ? 'bottom' : 'right'} end`;
    const opt = (val, cur, label) => `<option value="${val}"${val === cur ? ' selected' : ''}>${label}</option>`;
    const opens = isV ? ['left', 'right'] : ['up', 'down'], hinges = isV ? ['top', 'bottom'] : ['left', 'right'];
    panel.innerHTML = `<h2>${isDoor ? 'Door' : 'Window'} ${esc(op.id)}</h2>
      <p class="sub">In wall ${s.a} to ${s.b}. It stays where it is when grid lines move.</p>
      <div class="row"><label for="f-from">Measure from</label><select id="f-from" style="grid-column: span 2">${opt('a', form.from, endA)}${opt('b', form.from, endB)}</select></div>
      ${numField('off', 'Distance')}
      ${numField('w', 'Width')}
      ${isDoor ? `<div class="row"><label for="f-opens">Opens</label><select id="f-opens" style="grid-column: span 2">${opens.map((o) => opt(o, form.opens, o)).join('')}</select></div>
      <div class="row"><label for="f-hinge">Hinge</label><select id="f-hinge" style="grid-column: span 2">${hinges.map((o) => opt(o, form.hinge, o + ' side')).join('')}</select></div>
      ${numField('arc', 'Swing', 'deg')}` : ''}
      ${statusHTML()}${actionsHTML(`<button class="btn danger" id="del" data-needs-clean>Delete ${isDoor ? 'door' : 'window'}</button>`)}`;
    const build = () => {
      const d = C.clone(plan), o = d.openings.find((x) => x.id === op.id);
      o[isV ? 'y' : 'x'] = range();
      if (isDoor) {
        o.opens = form.opens; o.hinge = form.hinge;
        if (op.arc !== undefined || form.v.arc !== 90) o.arc = form.v.arc;
      }
      return d;
    };
    const onChange = () => refreshDraft(build);
    wireFields(onChange);
    $('#f-from').addEventListener('change', (e) => {
      const [a, b] = range();
      form.from = e.target.value;
      form.v.off = form.from === 'a' ? a - lo : hi - b;
      $('#f-off').value = form.v.off / 10;
      updateStatus();
    });
    if (isDoor) {
      $('#f-opens').addEventListener('change', (e) => { form.opens = e.target.value; onChange(); });
      $('#f-hinge').addEventListener('change', (e) => { form.hinge = e.target.value; onChange(); });
    }
    $('#del').addEventListener('click', () => deleteSelected());
    updateStatus();
  }

  function panelObj(ix) {
    const ob = plan.objects.find((o) => o.id === sel.id);
    if (ob.locked) {
      panel.innerHTML = `<h2>${esc(ob.name)}</h2>
        <div class="lockbox"><p>This object is locked, so it can't be moved or edited.</p>
        <div class="actions"><button class="btn primary" id="unlock">Unlock</button></div></div>`;
      $('#unlock').addEventListener('click', () => setLocked(ob.id, false));
      return;
    }
    if (!form) {
      form = { kind: 'obj', name: ob.name, anchor: ob.anchor,
        v: { dx: ob.dx, dy: ob.dy, length: ob.length, depth: ob.depth, rotation: ob.rotation || 0 },
        addons: C.clone(ob.addons || []) };
    }
    const pts = [...ix.pts.keys()].sort((a, b) => {
      const A = C.parsePoint(a), B = C.parsePoint(b);
      return A.v.length - B.v.length || A.v.localeCompare(B.v) || A.h.length - B.h.length || A.h.localeCompare(B.h);
    });
    const addonCards = form.addons.map((a, i) => `<div class="addon-card">
        <div class="addon-head"><input type="text" data-addon-name="${i}" value="${esc(a.name)}" aria-label="Add-on name" style="width:60%">
        <button class="btn danger" data-addon-del="${i}">Remove</button></div>
        ${numField(`a${i}-offset`, 'From start')}${numField(`a${i}-length`, 'Length')}${numField(`a${i}-depth`, 'Depth')}</div>`).join('');
    panel.innerHTML = `<h2>${esc(form.name || 'Object')}</h2>
      <p class="sub">Positioned by its centre, relative to junction point ${esc(form.anchor)}.</p>
      <div class="row"><label for="f-name">Name</label><input type="text" id="f-name" value="${esc(form.name)}" style="grid-column: span 2"></div>
      <div class="row"><label for="f-anchor">Anchor</label><select id="f-anchor" style="grid-column: span 2">${pts.map((p) => `<option${p === form.anchor ? ' selected' : ''}>${p}</option>`).join('')}</select></div>
      ${numField('dx', 'Across (x)')}${numField('dy', 'Down (y)')}
      ${numField('length', 'Length')}${numField('depth', 'Depth')}${numField('rotation', 'Rotation', 'deg')}
      <h3>Add-ons</h3>
      <p class="muted">Slide along the length and must stay ${C.ADDON_PAD / 10} cm inside the object's edges.</p>
      ${addonCards}
      <div class="actions"><button class="btn" id="add-addon">Add add-on</button></div>
      ${statusHTML()}${actionsHTML()}
      <div class="actions"><button class="btn" id="lock" data-needs-clean>Lock</button><button class="btn danger" id="del" data-needs-clean>Delete object</button></div>`;
    const build = () => {
      const d = C.clone(plan), o = d.objects.find((x) => x.id === ob.id);
      Object.assign(o, { name: form.name, anchor: form.anchor, dx: form.v.dx, dy: form.v.dy, length: form.v.length,
        depth: form.v.depth, rotation: form.v.rotation, addons: C.clone(form.addons) });
      return d;
    };
    const onChange = () => refreshDraft(build);
    wireFields(onChange);
    $('#f-name').addEventListener('input', (e) => { form.name = e.target.value; onChange(); });
    $('#f-anchor').addEventListener('change', (e) => {
      const P0 = ix.pts.get(form.anchor), P1 = ix.pts.get(e.target.value);
      const cx = P0.x + form.v.dx, cy = P0.y + form.v.dy;
      form.anchor = e.target.value;
      form.v.dx = cx - P1.x; form.v.dy = cy - P1.y;
      $('#f-dx').value = form.v.dx / 10; $('#f-dy').value = form.v.dy / 10;
      panel.querySelector('.sub').textContent = `Positioned by its centre, relative to junction point ${form.anchor}.`;
      onChange();
    });
    panel.querySelectorAll('[data-addon-name]').forEach((inp) => inp.addEventListener('input', () => { form.addons[+inp.dataset.addonName].name = inp.value; onChange(); }));
    panel.querySelectorAll('[data-addon-del]').forEach((b) => b.addEventListener('click', () => { form.addons.splice(+b.dataset.addonDel, 1); panelObj(ix); onChange(); }));
    $('#add-addon').addEventListener('click', () => {
      const L = form.v.length, D = form.v.depth;
      form.addons.push({ name: 'Add-on', offset: C.ADDON_PAD, length: Math.max(10, Math.min(600, L - 2 * C.ADDON_PAD)), depth: Math.max(10, Math.min(500, D - 2 * C.ADDON_PAD)) });
      panelObj(ix);
      onChange();
    });
    $('#lock').addEventListener('click', () => setLocked(ob.id, true));
    $('#del').addEventListener('click', () => deleteSelected());
    updateStatus();
  }

  function setLocked(id, locked) {
    const d = C.clone(plan);
    d.objects.find((o) => o.id === id).locked = locked;
    commit(d);
  }

  function deleteSelected() {
    if (!sel || draft) return;
    const d = C.clone(plan);
    if (sel.kind === 'op') d.openings = d.openings.filter((o) => o.id !== sel.id);
    else if (sel.kind === 'obj') {
      const ob = d.objects.find((o) => o.id === sel.id);
      if (!ob || ob.locked) return;
      d.objects = d.objects.filter((o) => o.id !== sel.id);
    } else return;
    sel = null;
    commit(d);
  }

  function addObject() {
    const [name, length, depth] = PRESETS[+$('#preset').value];
    const cx = view.x + view.w / 2, cy = view.y + view.h / 2;
    const ix = C.index(plan), P = C.nearestPoint(ix, cx, cy);
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const ob = { id: C.uniqueId(plan, slug), type: 'object', name, anchor: P.id,
      dx: Math.round((cx - P.x) / 10) * 10, dy: Math.round((cy - P.y) / 10) * 10,
      length, depth, rotation: 0, locked: false, addons: [] };
    const d = C.clone(plan);
    d.objects.push(ob);
    commit(d);
    select({ kind: 'obj', id: ob.id });
  }

  /* ---------------- import / export ---------------- */

  function download(name, text, type) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  function prettyJSON(p) {
    const list = (arr, ind) => (arr.length ? '\n' + arr.map((x) => ind + JSON.stringify(x)).join(',\n') + '\n' + ind.slice(2) : '');
    return `{
  "version": ${p.version},
  "structure": {
    "lines": {
      "vertical": [${list(p.structure.lines.vertical, '        ')}],
      "horizontal": [${list(p.structure.lines.horizontal, '        ')}]
    },
    "segments": [${list(p.structure.segments, '      ')}],
    "rooms": [${list(p.structure.rooms, '      ')}]
  },
  "openings": [${list(p.openings, '    ')}],
  "objects": [${list(p.objects, '    ')}]
}
`;
  }

  function importFile(file) {
    const r = new FileReader();
    r.onload = () => {
      let p;
      try { p = JSON.parse(r.result); } catch (e) { notify(`That file isn't valid JSON: ${esc(e.message)}`, true); return; }
      const errs = C.validate(p);
      if (errs.length) {
        notify(`That plan wasn't imported because it has ${errs.length} ${errs.length === 1 ? 'problem' : 'problems'}:<br>` +
          errs.slice(0, 6).map(esc).join('<br>') + (errs.length > 6 ? `<br>…and ${errs.length - 6} more.` : ''), true);
        return;
      }
      sel = null;
      commit(p);
      fit();
      notify(`Imported ${esc(file.name)}. Undo restores the previous plan.`);
    };
    r.readAsText(file);
  }

  const EXPORT_CSS = `
.room{fill:#fbfbf9}.room.outdoor{fill:#eceeea}
.roomlabel{fill:#5b616b;font-weight:600;text-anchor:middle;dominant-baseline:middle}
.wall{fill:#2a2d33}
.opening .gap{fill:#fff;stroke:#2a2d33;stroke-width:8}
.opening .wl{stroke:#2a2d33;stroke-width:8}
.opening .leaf{stroke:#2a2d33;stroke-width:16}
.opening .arc{fill:none;stroke:#5b616b;stroke-width:8;stroke-dasharray:30 22}
.obj .body{fill:#fff;stroke:#55606e;stroke-width:12}
.obj.locked .body{fill:#eeefea;stroke:#8e9188}
.addon{fill:#e4e9ef;stroke:#55606e;stroke-width:8}
.objlabel{fill:#2a2d33;text-anchor:middle;dominant-baseline:middle}
.addonlabel{fill:#5b616b;text-anchor:middle;dominant-baseline:middle}
.dim line{stroke:#c8372d;stroke-width:6}
.dim text{fill:#c8372d;stroke:#fff;paint-order:stroke;stroke-linejoin:round}
.scale rect{stroke:#2a2d33;stroke-width:8}.scale text{fill:#2a2d33}`;

  function exportDims(p, ix, kk) {
    const polys = p.structure.rooms.map((r) => C.roomPoly(ix, r)).filter(Boolean);
    let out = '';
    for (const s of ix.segs) {
      if (!s.orient) continue;
      const [lo, hi] = C.segRange(ix, s), mid = (lo + hi) / 2, c = C.lineCoord(ix, s);
      const sides = [-1, 1].filter((side) => {
        const off = c + side * (s.t / 2 + 20);
        const pt = s.orient === 'v' ? { x: off, y: mid } : { x: mid, y: off };
        return polys.some((poly) => C.pointInPolygon(pt, poly));
      });
      out += segFaceDims(p, ix, s, kk, sides);
    }
    return out;
  }

  function scaleBar(x0, y0, kk) {
    const imperial = settings.units === 'imperial';
    const n = imperial ? 6 : 4, step = imperial ? 304.8 : 500, h = 50;
    let g = '<g class="scale">';
    for (let i = 0; i < n; i++) g += `<rect x="${x0 + i * step}" y="${y0}" width="${step}" height="${h}" fill="${i % 2 ? '#fff' : '#2a2d33'}"/>`;
    const labels = imperial ? [[0, '0'], [3, '3 ft'], [6, '6 ft']] : [[0, '0'], [2, '1 m'], [4, '2 m']];
    for (const [i, t] of labels) g += `<text x="${x0 + i * step}" y="${y0 - 25}" font-size="${10 * kk}" text-anchor="middle">${t}</text>`;
    return g + '</g>';
  }

  function exportSVG() {
    const p = plan, ix = C.index(p), bb = planBBox(p), m = 900, kk = 6;
    const vb = { x: bb.x1 - m, y: bb.y1 - m, w: bb.x2 - bb.x1 + 2 * m, h: bb.y2 - bb.y1 + 2 * m + 300 };
    let body = drawPlan(p, ix, { hl: new Set(), oob: new Set(), sel: null, k: kk });
    if (settings.exportDims) body += exportDims(p, ix, kk);
    body += scaleBar(vb.x + 400, vb.y + vb.h - 300, kk);
    body = body.replace(/ data-k="[^"]*"/g, '');
    const text = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb.x} ${vb.y} ${vb.w} ${vb.h}" width="${Math.round(vb.w / 10)}" height="${Math.round(vb.h / 10)}" font-family="Archivo, Helvetica, Arial, sans-serif">
<style>${EXPORT_CSS}</style>
<rect x="${vb.x}" y="${vb.y}" width="${vb.w}" height="${vb.h}" fill="#fff"/>
${body}
</svg>
`;
    download('floor-plan.svg', text, 'image/svg+xml');
  }

  /* ---------------- toolbar ---------------- */

  function updateToolbar() {
    $('#undo').disabled = !undoStack.length && !draft;
    $('#redo').disabled = !redoStack.length;
    $('#u-metric').setAttribute('aria-pressed', settings.units === 'metric');
    $('#u-imperial').setAttribute('aria-pressed', settings.units === 'imperial');
  }

  function setUnits(u) {
    settings.units = u;
    saveSettings();
    render();
    renderPanel(); // the panel keeps its form state, so unapplied edits survive
  }

  function wireToolbar() {
    $('#undo').addEventListener('click', undo);
    $('#redo').addEventListener('click', redo);
    $('#fit').addEventListener('click', fit);
    $('#u-metric').addEventListener('click', () => setUnits('metric'));
    $('#u-imperial').addEventListener('click', () => setUnits('imperial'));
    const snap = $('#snap'), gap = $('#gap'), dims = $('#export-dims');
    snap.checked = settings.snap;
    gap.value = settings.gap / 10;
    dims.checked = settings.exportDims;
    gap.disabled = !settings.snap;
    snap.addEventListener('change', () => { settings.snap = snap.checked; gap.disabled = !snap.checked; saveSettings(); });
    gap.addEventListener('input', () => { const v = parseFloat(gap.value); if (Number.isFinite(v) && v >= 0) { settings.gap = Math.round(v) * 10; saveSettings(); } });
    dims.addEventListener('change', () => { settings.exportDims = dims.checked; saveSettings(); });
    $('#preset').innerHTML = PRESETS.map(([n, l, d], i) => `<option value="${i}">${n} (${l / 10} × ${d / 10} cm)</option>`).join('');
    $('#add-obj').addEventListener('click', addObject);
    $('#import').addEventListener('click', () => $('#import-file').click());
    $('#import-file').addEventListener('change', (e) => { const f = e.target.files[0]; if (f) importFile(f); e.target.value = ''; });
    $('#export-json').addEventListener('click', () => download('floor-plan.json', prettyJSON(plan), 'application/json'));
    $('#export-svg').addEventListener('click', exportSVG);

  }

  function resetPlan() {
    if (!confirm('Replace the current plan with the original plan? You can undo this.')) return;
    sel = null;
    commit(C.clone(BASELINE));
    fit();
  }

  /* ---------------- pointer input ---------------- */

  function keyToSelection(key) {
    if (!key) return null;
    if (key.startsWith('addon:')) key = 'obj:' + key.slice(6, key.lastIndexOf(':'));
    if (key.startsWith('seg:')) return { kind: 'seg', key: key.slice(4) };
    if (key.startsWith('op:')) return { kind: 'op', id: key.slice(3) };
    if (key.startsWith('obj:')) return { kind: 'obj', id: key.slice(4) };
    return null;
  }

  function wirePointer() {
    svg.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const el = e.target.closest('[data-k]');
      const target = keyToSelection(el ? el.dataset.k : null);
      downInfo = { target, x: e.clientX, y: e.clientY, moved: false };
      svg.setPointerCapture(e.pointerId);
      if (target && target.kind === 'obj') {
        if (!(sel && sel.kind === 'obj' && sel.id === target.id)) select(target);
        const ob = plan.objects.find((o) => o.id === target.id);
        if (ob && !ob.locked) dragState = { id: ob.id, start: toPlan(e), dx: ob.dx, dy: ob.dy };
      } else if (!target) {
        panState = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
      }
    });

    svg.addEventListener('pointermove', (e) => {
      if (downInfo && !downInfo.moved && Math.hypot(e.clientX - downInfo.x, e.clientY - downInfo.y) > 3) downInfo.moved = true;
      if (dragState) {
        if (!downInfo.moved) return;
        const pt = toPlan(e), base = C.clone(plan), ob = base.objects.find((o) => o.id === dragState.id);
        ob.dx = dragState.dx + Math.round((pt.x - dragState.start.x) / 10) * 10;
        ob.dy = dragState.dy + Math.round((pt.y - dragState.start.y) / 10) * 10;
        if (settings.snap) Object.assign(ob, C.snapObject(C.index(base), ob, settings.gap));
        live = base;
        hover = 'obj:' + ob.id;
        render();
        return;
      }
      if (panState) {
        if (!downInfo.moved) return;
        const kk = k();
        view.x = panState.vx - (e.clientX - panState.x) * kk;
        view.y = panState.vy - (e.clientY - panState.y) * kk;
        setViewBox();
        svg.classList.add('panning');
        return;
      }
      if (!downInfo) {
        const el = e.target.closest('[data-k]'), key = el ? el.dataset.k : null;
        if (key !== hover) { hover = key; renderOverlay(); }
      }
    });

    const end = (commitDrag) => {
      const info = downInfo;
      downInfo = null;
      svg.classList.remove('panning');
      if (dragState) {
        dragState = null;
        const np = live;
        live = null;
        if (np && commitDrag) commit(np); else render();
      } else if (panState) {
        panState = null;
        if (info && !info.moved && commitDrag) select(null);
      } else if (info && !info.moved && info.target && commitDrag) {
        select(info.target);
      }
    };
    svg.addEventListener('pointerup', () => end(true));
    svg.addEventListener('pointercancel', () => end(false));
    svg.addEventListener('pointerleave', () => { if (!downInfo && hover) { hover = null; renderOverlay(); } });

    svg.addEventListener('wheel', (e) => {
      e.preventDefault();
      const f = Math.exp(Math.max(-60, Math.min(60, e.deltaY)) * 0.004);
      const nw = view.w * f;
      if (nw < 800 || nw > 120000) return;
      const pt = toPlan(e);
      view = { x: pt.x - (pt.x - view.x) * f, y: pt.y - (pt.y - view.y) * f, w: nw, h: view.h * f };
      setViewBox();
      render();
    }, { passive: false });
  }

  function wireKeys() {
    document.addEventListener('keydown', (e) => {
      const inField = /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName);
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z' && !inField) { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
      else if (mod && e.key.toLowerCase() === 'y' && !inField) { e.preventDefault(); redo(); }
      else if (e.key === 'Escape') { if (draft) cancel(); else if (!inField) select(null); }
      else if ((e.key === 'Delete' || e.key === 'Backspace') && !inField) { e.preventDefault(); deleteSelected(); }
    });
  }

  /* ---------------- start ---------------- */

  load();
  wireToolbar();
  wirePointer();
  wireKeys();
  window.addEventListener('resize', () => render());
  fit();
  renderPanel();
})();
