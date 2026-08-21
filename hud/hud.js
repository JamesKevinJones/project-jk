/* J.K. Console — client
 *
 * GSAP + ScrollTrigger drive a five-beat scroll story over the vault's real
 * link graph, then the page lands on the live console.
 *
 * The graph is interactive: hover inspects a note, click opens it with its
 * actual neighbours. It is drawn on canvas, which a screen reader cannot use,
 * so every fact it shows also exists as text in the console tables below and
 * the canvas carries a text alternative rather than being the only route.
 */

'use strict';

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};
const num = (n) => n.toLocaleString('en-GB');
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;

// beat starts at -1, not 0: setBeat() early-returns when the beat is unchanged,
// so initialising to 0 meant the opening beat never painted its caption.
let STATE = null, filter = '', selectedJob = null, beat = -1;

if (window.gsap && window.ScrollTrigger) gsap.registerPlugin(ScrollTrigger);

/* ═══════════════════════ the link graph ═══════════════════════ */

const Graph = (() => {
  const cv = $('constellation');
  const ctx = cv.getContext('2d');
  let nodes = [], edges = [], adj = new Map();
  let w = 0, h = 0, raf = null, hover = null, picked = null;
  let lit = null;            // Set of ids to keep bright, or null for all
  let scatter = 0;           // 0 = settled graph, 1 = scattered (beat 0)
  let reveal = 1;            // 0..1 how much of the graph has assembled

  const COL = {
    ink:   '11,11,11',
    volt:  '77,91,255',
    coral: '255,92,77',
    mint:  '78,230,168',
    orchid:'215,141,255',
  };
  let inkRGB = COL.ink;

  function size() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const r = cv.getBoundingClientRect();
    w = r.width; h = r.height;
    if (!w || !h) return;
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // in dark mode the ink token flips to paper, so nodes must flip too
    const fg = getComputedStyle(document.body).color.match(/\d+/g);
    if (fg) inkRGB = fg.slice(0, 3).join(',');
  }

  let pending = null;     // graph data that arrived before the canvas had a size
  let retry = null;

  function load(g) {
    size();
    if (!w || !h) {
      // The canvas can measure 0x0 when data lands before layout settles.
      // A ResizeObserver alone is not enough: its one initial callback can
      // arrive while the element is still 0x0, and no later resize follows.
      // So hold the data and poll briefly as well. setTimeout is deliberate,
      // since rAF does not run in a background or non-compositing tab.
      pending = g;
      if (!retry) {
        let tries = 0;
        retry = setInterval(() => {
          if (++tries > 60) { clearInterval(retry); retry = null; return; }
          const r = cv.getBoundingClientRect();
          if (!r.width || !r.height) return;
          clearInterval(retry); retry = null;
          const data = pending; pending = null;
          if (data) load(data);
        }, 50);
      }
      return;
    }
    if (retry) { clearInterval(retry); retry = null; }
    pending = null;
    nodes = g.nodes.map((n, i) => ({
      ...n, i,
      x: w / 2, y: h / 2, vx: 0, vy: 0,
      // a stable scatter position per node so beat 0 does not reshuffle
      sx: (Math.sin(i * 12.9898) * 0.5 + 0.5) * w,
      sy: (Math.sin(i * 78.233) * 0.5 + 0.5) * h,
      r: n.kind === 'core' ? 6 : n.kind === 'job' ? 5 : n.kind === 'index' ? 4 : 3,
      a: 1,
    }));
    nodes.forEach((n) => { n.x = n.sx; n.y = n.sy; });
    const by = new Map(nodes.map((n) => [n.id, n]));
    edges = g.edges.map(([s, t]) => ({ s: by.get(s), t: by.get(t) })).filter((e) => e.s && e.t);
    adj = new Map(nodes.map((n) => [n.id, []]));
    edges.forEach((e) => { adj.get(e.s.id).push(e.t.id); adj.get(e.t.id).push(e.s.id); });
    for (let i = 0; i < 400; i++) step();
    draw();
    start();
  }

  function step() {
    const cx = w / 2, cy = h / 2;
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i];
      for (let j = i + 1; j < nodes.length; j++) {
        const b = nodes[j];
        let dx = b.x - a.x, dy = b.y - a.y, d2 = dx * dx + dy * dy;
        if (d2 < 1) { d2 = 1; dx = Math.random(); dy = Math.random(); }
        if (d2 > 60000) continue;
        const d = Math.sqrt(d2), f = 620 / d2;
        a.vx -= (dx / d) * f; a.vy -= (dy / d) * f;
        b.vx += (dx / d) * f; b.vy += (dy / d) * f;
      }
    }
    edges.forEach((e) => {
      const dx = e.t.x - e.s.x, dy = e.t.y - e.s.y;
      const d = Math.hypot(dx, dy) || 1, f = (d - 58) * 0.006;
      e.s.vx += (dx / d) * f; e.s.vy += (dy / d) * f;
      e.t.vx -= (dx / d) * f; e.t.vy -= (dy / d) * f;
    });
    nodes.forEach((n) => {
      n.vx += (cx - n.x) * 0.0022; n.vy += (cy - n.y) * 0.0022;
      n.vx *= 0.85; n.vy *= 0.85;
      n.x += n.vx; n.y += n.vy;
      const m = 24;
      n.x = Math.max(m, Math.min(w - m, n.x));
      n.y = Math.max(m, Math.min(h - m, n.y));
    });
  }

  // where a node renders right now, blending settled position with scatter
  const px = (n) => n.x + (n.sx - n.x) * scatter;
  const py = (n) => n.y + (n.sy - n.y) * scatter;
  const shown = (n) => n.i / Math.max(nodes.length - 1, 1) <= reveal;

  function draw() {
    if (!w || !h) return;
    ctx.clearRect(0, 0, w, h);
    if (!nodes.length) return;

    nodes.forEach((n) => {
      const on = shown(n);
      const target = !on ? 0 : (!lit ? 1 : (lit.has(n.id) ? 1 : 0.12));
      n.a += (target - n.a) * (REDUCED ? 1 : 0.16);
    });

    edges.forEach((e) => {
      const a = Math.min(e.s.a, e.t.a);
      if (a < 0.02) return;
      const both = lit && lit.has(e.s.id) && lit.has(e.t.id);
      const near = picked && (e.s.id === picked.id || e.t.id === picked.id);
      ctx.beginPath();
      ctx.moveTo(px(e.s), py(e.s)); ctx.lineTo(px(e.t), py(e.t));
      ctx.strokeStyle = both ? `rgba(${COL.volt},${0.95 * a})`
        : near ? `rgba(${COL.coral},${0.9 * a})`
        : `rgba(${inkRGB},${0.22 * a})`;
      ctx.lineWidth = (both || near) ? 2 : 1;
      ctx.stroke();
    });

    nodes.forEach((n) => {
      if (n.a < 0.02) return;
      const X = px(n), Y = py(n);
      const isLit = lit && lit.has(n.id);
      const isPick = picked && picked.id === n.id;
      const isHov = hover && hover.id === n.id;
      const rad = n.r + (isPick ? 3 : isHov ? 2 : 0);

      ctx.beginPath(); ctx.arc(X, Y, rad, 0, Math.PI * 2);
      ctx.fillStyle = isPick ? `rgba(${COL.coral},${n.a})`
        : isLit ? `rgba(${COL.volt},${n.a})`
        : n.kind === 'core' ? `rgba(${COL.orchid},${n.a})`
        : n.kind === 'job' ? `rgba(${COL.mint},${n.a})`
        : `rgba(${inkRGB},${n.a * 0.9})`;
      ctx.fill();
      // hard 2px ink ring: the brutalist border, on every node
      ctx.lineWidth = 2;
      ctx.strokeStyle = `rgba(${inkRGB},${n.a})`;
      ctx.stroke();

      if (isPick || isHov || isLit || n.deg >= 18) {
        ctx.font = '600 11px "IBM Plex Mono", ui-monospace, monospace';
        const label = n.id.length > 30 ? n.id.slice(0, 29) + '…' : n.id;
        const tw = ctx.measureText(label).width;
        ctx.fillStyle = `rgba(${inkRGB},${n.a})`;
        ctx.fillRect(X + rad + 4, Y - 8, tw + 8, 16);
        ctx.fillStyle = getComputedStyle(document.body).backgroundColor;
        ctx.fillText(label, X + rad + 8, Y + 3.5);
      }
    });
  }

  function frame() { draw(); raf = requestAnimationFrame(frame); }
  function start() { if (!raf && !REDUCED) raf = requestAnimationFrame(frame); }
  function stop() { if (raf) { cancelAnimationFrame(raf); raf = null; } }
  document.addEventListener('visibilitychange', () => { document.hidden ? stop() : start(); });

  function at(clientX, clientY) {
    const r = cv.getBoundingClientRect();
    const mx = clientX - r.left, my = clientY - r.top;
    let best = null, bd = 18 * 18;
    nodes.forEach((n) => {
      if (n.a < 0.25) return;
      const d = (px(n) - mx) ** 2 + (py(n) - my) ** 2;
      if (d < bd) { bd = d; best = n; }
    });
    return best;
  }

  cv.addEventListener('mousemove', (e) => {
    const n = at(e.clientX, e.clientY);
    hover = n;
    cv.style.cursor = n ? 'pointer' : 'default';
    const tip = $('tip');
    if (n) {
      tip.innerHTML = '';
      tip.appendChild(el('b', null, n.id));
      const links = adj.get(n.id) || [];
      tip.appendChild(el('span', null,
        `${n.kind} · ${links.length} link${links.length === 1 ? '' : 's'} · click to inspect`));
      tip.hidden = false;
      const tw = 300;
      tip.style.left = Math.min(e.clientX + 14, innerWidth - tw) + 'px';
      tip.style.top = Math.min(e.clientY + 16, innerHeight - 90) + 'px';
    } else tip.hidden = true;
    if (REDUCED) draw();
  });
  cv.addEventListener('mouseleave', () => { hover = null; $('tip').hidden = true; if (REDUCED) draw(); });
  cv.addEventListener('click', (e) => {
    const n = at(e.clientX, e.clientY);
    if (!n) return;
    picked = n;
    showNote(n, adj.get(n.id) || []);
    if (REDUCED) draw();
  });

  addEventListener('resize', () => { size(); draw(); });

  // Authoritative sizing: fires when the canvas actually has dimensions, which
  // removes the race between the fetch resolving and the layout settling.
  if (window.ResizeObserver) {
    new ResizeObserver(() => {
      const r = cv.getBoundingClientRect();
      if (!r.width || !r.height) return;
      if (pending) { load(pending); return; }
      if (Math.abs(r.width - w) > 1 || Math.abs(r.height - h) > 1) { size(); draw(); }
    }).observe(cv);
  }

  return {
    load,
    highlight(ids) { lit = ids && ids.size ? ids : null; if (REDUCED) draw(); },
    setScatter(v) { scatter = v; if (REDUCED) draw(); },
    setReveal(v) { reveal = v; if (REDUCED) draw(); },
    clearPick() { picked = null; if (REDUCED) draw(); },
    count: () => nodes.length,
    shownCount: () => nodes.filter(shown).length,
    litCount: () => (lit ? nodes.filter((n) => lit.has(n.id)).length : nodes.filter(shown).length),
    neighbours: (id) => adj.get(id) || [],
    draw,
  };
})();

/* ═══════════════════════ scroll story ═════════════════════════ */

const BEATS = [
  { caption: 'Context window full. The oldest things fall out first.', label: 'notes retained' },
  { caption: 'The vault, drawn from the real files on disk.',          label: 'notes in memory' },
  { caption: 'Wikilinks and folder indexes make it walkable.',         label: 'links resolved' },
  { caption: 'One job. Only the notes that job needs.',                label: 'notes loaded' },
  { caption: 'Every link checked. No dead ends.',                      label: 'checks passed' },
];

function setBeat(i) {
  if (i === beat) return;
  beat = i;
  const b = BEATS[i];
  $('stageCaption').textContent = b.caption;
  $('stageCountLabel').textContent = b.label;
  document.querySelectorAll('.beat').forEach((n, k) => {
    n.style.opacity = REDUCED ? 1 : (k === i ? 1 : 0.34);
  });
  if (i !== 3 && selectedJob) { selectedJob = null; Graph.highlight(null); paintChips(); }
  updateStageCount();
}

function updateStageCount() {
  const s = STATE ? STATE.stats : { notes: 0, links: 0 };
  const v = STATE ? STATE.validation : { checks: 0 };
  let n = 0;
  if (beat === 0) n = Math.round(Graph.shownCount());
  else if (beat === 1) n = Graph.shownCount();
  else if (beat === 2) n = s.links;
  else if (beat === 3) n = selectedJob ? selectedJob.chainNotes.length + 1 : Graph.count();
  else n = v.checks;
  $('stageCount').textContent = num(n);
}

function buildStory() {
  if (!window.gsap || !window.ScrollTrigger) return;

  if (REDUCED) {
    // No scrubbing. Show the assembled graph and reveal beats on entry only.
    Graph.setScatter(0); Graph.setReveal(1); setBeat(1);
    gsap.utils.toArray('.beat').forEach((b, i) => {
      ScrollTrigger.create({ trigger: b, start: 'top 70%', onEnter: () => setBeat(i) });
    });
    return;
  }

  // Beat 0 -> 1: the scattered field collapses into the real graph and the
  // notes stream back in. Scrubbed, so the reader controls the assembly.
  gsap.timeline({
    scrollTrigger: {
      trigger: '.beat[data-beat="0"]',
      start: 'top 80%', end: 'bottom 20%', scrub: 0.6,
    },
  })
    .fromTo({ v: 1 }, { v: 1 }, {
      v: 0, ease: 'none',
      onUpdate() { Graph.setScatter(this.targets()[0].v); },
    }, 0)
    .fromTo({ v: 0.18 }, { v: 0.18 }, {
      v: 1, ease: 'none',
      onUpdate() { Graph.setReveal(this.targets()[0].v); updateStageCount(); },
    }, 0);

  gsap.utils.toArray('.beat').forEach((b, i) => {
    ScrollTrigger.create({
      trigger: b, start: 'top 60%', end: 'bottom 40%',
      onEnter: () => setBeat(i),
      onEnterBack: () => setBeat(i),
    });
  });

  // Beat 2: pulse the hubs so "structure" is visible rather than asserted.
  ScrollTrigger.create({
    trigger: '.beat[data-beat="2"]', start: 'top 60%', end: 'bottom 40%',
    onEnter: () => {
      if (!STATE) return;
      const hubs = STATE.graph.nodes
        .slice().sort((a, b) => b.deg - a.deg).slice(0, 12).map((n) => n.id);
      Graph.highlight(new Set(hubs));
    },
    onEnterBack: () => {
      if (!STATE) return;
      const hubs = STATE.graph.nodes
        .slice().sort((a, b) => b.deg - a.deg).slice(0, 12).map((n) => n.id);
      Graph.highlight(new Set(hubs));
    },
    onLeave: () => Graph.highlight(null),
    onLeaveBack: () => Graph.highlight(null),
  });

  // Beat 3: the first job lights automatically so the point lands without a click.
  ScrollTrigger.create({
    trigger: '.beat[data-beat="3"]', start: 'top 60%',
    onEnter: () => { if (STATE && STATE.jobs.length && !selectedJob) pickJob(STATE.jobs[0]); },
  });

  // Hero: one orchestrated entrance, then the page gets out of the way.
  const intro = gsap.timeline({ defaults: { ease: 'power3.out' } });
  intro
    .from('.act-hero [data-anim="mega"]', { yPercent: 108, duration: 0.85, stagger: 0.08 })
    .from('.act-hero [data-anim="rise"]', { y: 20, opacity: 0, duration: 0.5, stagger: 0.09 }, '-=0.4');

  // from() writes opacity:0 the moment it is created. If the tween then never
  // runs - GSAP blocked, rAF throttled in a background tab - that content stays
  // invisible for good. setTimeout does not depend on rAF, so it can always
  // undo it. An animation must never be able to permanently hide content.
  const failsafe = setTimeout(() => {
    if (intro.progress() < 1) gsap.set('.act-hero [data-anim]', { clearProps: 'all' });
  }, 2500);
  intro.eventCallback('onComplete', () => clearTimeout(failsafe));

  gsap.utils.toArray('.beat h2').forEach((n) => {
    // immediateRender:false keeps the from-state off the element until the
    // trigger actually fires, so a heading that is never scrolled to stays
    // readable rather than sitting at opacity 0.
    gsap.fromTo(n, { y: 18, opacity: 0 }, {
      y: 0, opacity: 1, duration: 0.5, ease: 'power2.out',
      immediateRender: false,
      scrollTrigger: { trigger: n, start: 'top 85%', once: true },
    });
  });
}

function countUp(id, to) {
  const node = $(id);
  if (!node) return;
  if (REDUCED || !window.gsap) { node.textContent = num(to); return; }
  const o = { v: 0 };
  gsap.to(o, {
    v: to, duration: 1.1, ease: 'power2.out',
    onUpdate: () => { node.textContent = num(Math.round(o.v)); },
  });
}

/* ═══════════════════════ data + console ═══════════════════════ */

async function load(manual) {
  const btn = $('refresh');
  if (manual) btn.dataset.busy = '1';
  try {
    const res = await fetch('/api/state', { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const first = STATE === null;
    STATE = await res.json();
    render(first);
  } catch (err) {
    fatal(err.message);
  } finally {
    delete btn.dataset.busy;
    $('grid').setAttribute('aria-busy', 'false');
  }
}

function fatal(msg, title, hint) {
  document.body.dataset.state = 'fail';
  const g = $('grid');
  g.innerHTML = '';
  const box = el('div', 'fatal');
  box.appendChild(el('h2', null, title || 'Console disconnected'));
  const p = el('p');
  p.textContent = hint || ('The server stopped responding (' + msg + '). Restart it with ');
  if (!hint) p.appendChild(el('code', null, 'python scripts/hud.py'));
  box.appendChild(p);
  g.appendChild(box);
}

function render(first) {
  if (!STATE) return;
  if (STATE.ok === false) {
    fatal('', 'Vault not found',
      STATE.error || 'The configured vault path does not exist. Fix it under "Where your memory lives" in AGENTS.md.');
    return;
  }

  document.title = STATE.agent + ' Console';
  const v = STATE.validation;
  document.body.dataset.state = v.ok ? 'ok' : 'fail';
  $('verdict').textContent = v.ok ? 'NOMINAL' : 'FAULT';
  $('verdictSub').textContent = v.ok
    ? (v.warnings.length ? v.warnings.length + ' advisory, no faults' : 'all checks passed')
    : v.failures.length + ' fault' + (v.failures.length === 1 ? '' : 's') + ' blocking';

  $('f-notes').textContent = num(STATE.stats.notes);
  $('f-links').textContent = num(STATE.stats.links);
  $('f-words').textContent = (STATE.stats.words / 1000).toFixed(1) + 'k';
  $('f-checks').textContent = v.checks;

  if (first) {
    countUp('h-notes', STATE.stats.notes);
    countUp('h-links', STATE.stats.links);
    countUp('h-jobs', STATE.jobs.length);
  } else {
    $('h-notes').textContent = num(STATE.stats.notes);
    $('h-links').textContent = num(STATE.stats.links);
    $('h-jobs').textContent = num(STATE.jobs.length);
  }

  renderFaults(v);
  renderPriorities();
  renderJobs();
  renderDist();
  renderDaily();
  renderProjects();
  paintChips();

  if (first && STATE.graph) {
    Graph.load(STATE.graph);
    buildStory();
    setBeat(0);
    if (window.ScrollTrigger) ScrollTrigger.refresh();
  }
  updateStageCount();

  $('footLeft').textContent =
    'snapshot ' + new Date(STATE.generated).toLocaleTimeString('en-GB', { hour12: false }) +
    ' · refresh 30s · 127.0.0.1 local only';
  $('vaultPath').textContent = STATE.vault;
}

function renderFaults(v) {
  const box = $('faults');
  box.innerHTML = '';
  $('faultMeta').textContent = v.failures.length + ' / ' + v.warnings.length;
  if (!v.failures.length && !v.warnings.length) {
    const c = el('div', 'clear');
    c.appendChild(el('i'));
    c.append('No faults. Every link resolves.');
    box.appendChild(c);
    return;
  }
  v.failures.forEach((f) => {
    const r = el('div', 'fault-row');
    r.appendChild(el('span', 'fault-code f', 'FAULT'));
    r.appendChild(el('span', null, f));
    box.appendChild(r);
  });
  v.warnings.forEach((wn) => {
    const r = el('div', 'fault-row');
    r.appendChild(el('span', 'fault-code a', 'ADV'));
    r.appendChild(el('span', null, wn));
    box.appendChild(r);
  });
}

const match = (t) => !filter || t.toLowerCase().includes(filter);

// head entries are [label, cls, explain?, explainTitle?]. Column names in a
// dense table are the densest jargon on the page, so they carry the tooltips.
function table(head) {
  const t = el('table', 'tbl'), thead = el('thead'), tr = el('tr');
  head.forEach(([label, cls, explain, title]) => {
    const th = el('th', cls, label);
    if (explain) Explain.tag(th, explain, title || label);
    tr.appendChild(th);
  });
  thead.appendChild(tr); t.appendChild(thead);
  const tb = el('tbody'); t.appendChild(tb);
  return { table: t, body: tb };
}

function empty(title, hint) {
  const e = el('div', 'empty');
  e.appendChild(el('strong', null, title));
  e.append(hint);
  return e;
}

function renderPriorities() {
  const box = $('priorities'); box.innerHTML = '';
  const p = STATE.priorities;
  const rows = p.open.map((t) => ({ ...t, done: false }))
    .concat(p.done.map((t) => ({ ...t, done: true })))
    .filter((t) => match(t.text + ' ' + t.tag));
  $('prMeta').textContent = p.open.length + ' open';
  if (!rows.length) {
    box.appendChild(filter ? empty('No match', 'Nothing matches "' + filter + '".')
                           : empty('Queue clear', 'Add items to Active Priorities.md.'));
    return;
  }
  const { table: t, body } = table([['', ''], ['project', ''], ['item', '']]);
  rows.forEach((r) => {
    const tr = el('tr');
    const c = el('td');
    c.appendChild(el('span', 'pill ' + (r.done ? 'done' : 'open'), r.done ? 'done' : 'open'));
    tr.appendChild(c);
    const tg = el('td');
    if (r.tag) tg.appendChild(el('span', 'tag', r.tag));
    tr.appendChild(tg);
    tr.appendChild(el('td', r.done ? 'strike' : '', r.text));
    body.appendChild(tr);
  });
  box.appendChild(t);
}

function renderJobs() {
  const box = $('jobs'); box.innerHTML = '';
  const list = STATE.jobs.filter((j) => match(j.name + ' ' + j.job));
  $('jobMeta').textContent = STATE.jobs.length;
  if (!list.length) {
    box.appendChild(filter ? empty('No match', 'No job matches "' + filter + '".')
                           : empty('No jobs', 'Add one when you explain the same task twice.'));
    return;
  }
  const { table: t, body } = table([
    ['job', ''],
    ['chain', 'r', 'How many items the job tells the agent to read, in order, before starting. A tight chain is the point; one that has crept past six items is doing too much.', 'Boot chain'],
    ['notes', 'r', 'How many of those chain items are actual vault notes, so how many dots light up in the graph. The rest are files outside the vault, like a repo AGENTS.md.', 'Vault notes'],
    ['steps', 'r', 'Numbered steps in the job procedure. This is the recipe the agent follows once it has read the chain.', 'Steps'],
  ]);
  list.forEach((j) => {
    const tr = el('tr', 'click');
    tr.tabIndex = 0;
    tr.setAttribute('aria-selected', selectedJob && selectedJob.name === j.name ? 'true' : 'false');
    tr.appendChild(el('td', null, j.name));
    tr.appendChild(el('td', 'r', j.chain.length));
    tr.appendChild(el('td', 'r dim', j.chainNotes.length + 1));
    tr.appendChild(el('td', 'r dim', j.steps));
    tr.addEventListener('click', () => showJob(j));
    tr.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); showJob(j); }
    });
    body.appendChild(tr);
  });
  box.appendChild(t);
}

function renderDist() {
  const box = $('dist'); box.innerHTML = '';
  const rows = (STATE.folders || []).filter((f) => f.notes > 0)
    .slice().sort((a, b) => b.notes - a.notes);
  if (!rows.length) { box.appendChild(empty('No folders', 'Nothing to chart yet.')); return; }
  const max = rows[0].notes;
  rows.forEach((f) => {
    const wrap = el('div', 'bar-row');
    wrap.appendChild(el('span', 'bar-label', f.name));
    wrap.appendChild(el('span', 'bar-num', f.notes));
    const track = el('div', 'bar-track');
    const fill = el('div', 'bar-fill' + (f.folder ? '' : ' zk'));
    fill.style.width = Math.max(3, (f.notes / max) * 100) + '%';
    track.appendChild(fill); wrap.appendChild(track);
    box.appendChild(wrap);
  });
}

function renderDaily() {
  const box = $('daily'); box.innerHTML = '';
  const d = STATE.daily;
  $('dailyMeta').textContent = (d.total || 0) + ' days';
  if (!d.recent.length) { box.appendChild(empty('No entries', 'Say you are done and the agent logs the day.')); return; }
  d.recent.forEach((day) => {
    const w = el('div', 'log-day'), h = el('div');
    h.appendChild(el('span', 'log-date', day.date));
    h.appendChild(el('span', 'log-meta', day.sessions + ' session' + (day.sessions === 1 ? '' : 's') + ', ' + day.words + ' words'));
    w.appendChild(h);
    if (day.index.length) {
      const ul = el('ul');
      day.index.forEach((b) => ul.appendChild(el('li', null, b)));
      w.appendChild(ul);
    }
    box.appendChild(w);
  });
}

function renderProjects() {
  const box = $('projects'); box.innerHTML = '';
  const list = STATE.projects.filter((p) => match(p.name + ' ' + p.slug));
  $('projMeta').textContent = STATE.projects.length;
  if (!list.length) { box.appendChild(empty('No match', 'No project matches "' + filter + '".')); return; }
  const { table: t, body } = table([
    ['project', ''],
    ['slug', '', 'The short id written into each note\'s frontmatter to bind it to this project. It is how the agent knows a note belongs here even if the file moves.', 'Slug'],
    ['notes', 'r'],
    ['index', 'r', 'Whether the folder has its map note, the file that lists what is inside. Without one, a future session has no reason to look in the folder at all.', 'Folder index'],
  ]);
  list.forEach((p) => {
    const tr = el('tr', 'click');
    tr.tabIndex = 0;
    tr.appendChild(el('td', null, p.name));
    tr.appendChild(el('td', 'dim', p.slug || '—'));
    tr.appendChild(el('td', 'r', p.notes));
    const ix = el('td', 'r');
    ix.appendChild(el('span', 'pill ' + (p.hasIndex ? 'done' : 'miss'), p.hasIndex ? 'yes' : 'missing'));
    tr.appendChild(ix);
    tr.addEventListener('click', () => showProject(p));
    tr.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); showProject(p); }
    });
    body.appendChild(tr);
  });
  box.appendChild(t);
}

/* ═══════════════════════ job chips ════════════════════════════ */

function paintChips() {
  const box = $('jobPicker');
  if (!box || !STATE) return;
  box.innerHTML = '';
  STATE.jobs.forEach((j) => {
    const b = el('button', 'chip', j.name.replace(/^(Write|Ship|Log|Start|Triage) /, ''));
    b.type = 'button';
    b.setAttribute('aria-pressed', selectedJob && selectedJob.name === j.name ? 'true' : 'false');
    b.addEventListener('click', () => pickJob(j));
    box.appendChild(b);
  });
}

function pickJob(j) {
  selectedJob = (selectedJob && selectedJob.name === j.name) ? null : j;
  if (selectedJob) {
    const ids = new Set(selectedJob.chainNotes);
    ids.add(selectedJob.name);
    Graph.highlight(ids);
    $('stageCaption').textContent = selectedJob.name + ' loads ' + ids.size +
      ' of ' + Graph.count() + ' notes.';
  } else {
    Graph.highlight(null);
    $('stageCaption').textContent = BEATS[3].caption;
  }
  paintChips(); renderJobs(); updateStageCount();
}

/* ═══════════════════════ sheets ═══════════════════════════════ */

function openSheet(kicker, title, build) {
  $('detailKicker').textContent = kicker;
  $('detailTitle').textContent = title;
  const b = $('detailBody'); b.innerHTML = ''; build(b);
  $('detail').hidden = false;
  $('detailClose').focus();
}
const closeSheet = () => { $('detail').hidden = true; Graph.clearPick(); };

function kvBlock(pairs) {
  const kv = el('dl', 'kv');
  pairs.forEach(([k, v]) => {
    const d = el('div');
    d.appendChild(el('dt', null, k));
    d.appendChild(el('dd', null, String(v)));
    kv.appendChild(d);
  });
  return kv;
}

function showNote(n, links) {
  openSheet('Note', n.id, (body) => {
    body.appendChild(kvBlock([['kind', n.kind], ['links', links.length], ['folder', n.group]]));
    if (links.length) {
      body.appendChild(el('p', 'sub-head', 'Links to'));
      const ol = el('ol', 'chain');
      links.slice().sort().forEach((t) => ol.appendChild(el('li', null, t)));
      body.appendChild(ol);
    } else {
      body.appendChild(el('p', 'lead', 'This note has no outgoing or incoming wikilinks yet. It is reachable only through its folder index.'));
    }
  });
}

function showJob(j) {
  openSheet('Job', j.name, (body) => {
    if (j.job) body.appendChild(el('p', 'lead', j.job));
    body.appendChild(kvBlock([['boot chain', j.chain.length],
      ['vault notes', j.chainNotes.length + 1], ['steps', j.steps], ['lessons', j.lessons]]));
    body.appendChild(el('p', 'sub-head', 'Boot chain, in order'));
    const ol = el('ol', 'chain');
    j.chain.forEach((c) => ol.appendChild(el('li', null, c)));
    body.appendChild(ol);
  });
}

function showProject(p) {
  openSheet('Project folder', p.name, (body) => {
    if (p.summary) body.appendChild(el('p', 'lead', p.summary));
    body.appendChild(kvBlock([['notes', p.notes], ['slug', p.slug || '—'],
      ['index', p.hasIndex ? 'yes' : 'missing']]));
    const rel = STATE.priorities.open.filter(
      (t) => t.tag && p.slug && t.tag.toLowerCase().replace(/\s+/g, '-') === p.slug);
    if (rel.length) {
      body.appendChild(el('p', 'sub-head', 'Open items'));
      const ol = el('ol', 'chain');
      rel.forEach((t) => ol.appendChild(el('li', null, t.text)));
      body.appendChild(ol);
    }
  });
}

/* ═══════════════════════ explain system ═══════════════════════
   One delegated listener for every [data-explain] element, present or added
   later by a render. Opens on hover and on keyboard focus, so it is not a
   mouse-only affordance, and wires aria-describedby while open so a screen
   reader gets the same text. */

const Explain = (() => {
  const box = $('explain');
  let openOn = null;
  let seq = 0;

  function show(node) {
    const text = node.getAttribute('data-explain');
    if (!text) return;
    box.innerHTML = '';
    box.appendChild(el('b', null, node.getAttribute('data-explain-title') || 'What this is'));
    box.append(text);
    box.hidden = false;

    if (!box.id) box.id = 'explain';
    node.setAttribute('aria-describedby', box.id);
    openOn = node;

    const r = node.getBoundingClientRect();
    // Park at a known origin before measuring. Measuring while the box still
    // sits at the previous anchor's position can report a stale height, and the
    // clamp below then lets it hang off the bottom edge.
    box.style.left = '0px';
    box.style.top = '0px';
    const b = box.getBoundingClientRect();
    // prefer below, flip above when it would run off the bottom
    let top = r.bottom + 8;
    if (top + b.height > innerHeight - 8) top = r.top - b.height - 8;
    let left = r.left;
    // Clamp both axes to the viewport last, unconditionally. The flip alone is
    // not enough: an anchor that is itself off-screen would otherwise place the
    // popover off-screen too, which is reachable via keyboard focus.
    top = Math.min(Math.max(8, top), Math.max(8, innerHeight - b.height - 8));
    left = Math.min(Math.max(8, left), Math.max(8, innerWidth - b.width - 8));
    box.style.left = Math.floor(left) + 'px';
    box.style.top = Math.floor(top) + 'px';

    // Correct against the box as actually laid out. The pre-measure can report
    // a shorter height than the final render, which left the popover hanging
    // off the bottom edge; measuring once more after placement is cheap and
    // does not depend on knowing why the first measurement was short.
    const f = box.getBoundingClientRect();
    if (f.bottom > innerHeight - 8) {
      box.style.top = Math.floor(Math.max(8, innerHeight - f.height - 8)) + 'px';
    }
    if (f.right > innerWidth - 8) {
      box.style.left = Math.floor(Math.max(8, innerWidth - f.width - 8)) + 'px';
    }
  }

  function hide() {
    box.hidden = true;
    if (openOn) { openOn.removeAttribute('aria-describedby'); openOn = null; }
  }

  document.addEventListener('mouseover', (e) => {
    const n = e.target.closest('[data-explain]');
    if (n) show(n); else if (openOn) hide();
  });
  document.addEventListener('focusin', (e) => {
    const n = e.target.closest('[data-explain]');
    if (n) show(n); else if (openOn) hide();
  });
  document.addEventListener('focusout', hide);
  addEventListener('scroll', () => { if (openOn) hide(); }, { passive: true });

  return {
    hide,
    /* Make an element explainable and keyboard reachable. Used by the render
       functions, since those nodes do not exist in the HTML. */
    tag(node, text, title) {
      if (!node || !text) return node;
      node.setAttribute('data-explain', text);
      if (title) node.setAttribute('data-explain-title', title);
      if (!node.hasAttribute('tabindex') && !/^(A|BUTTON|INPUT|SELECT|TEXTAREA)$/.test(node.tagName)) {
        node.tabIndex = 0;
      }
      node.id = node.id || ('ex-' + (++seq));
      return node;
    },
  };
})();

setInterval(() => {
  $('clock').textContent = new Date().toLocaleTimeString('en-GB', { hour12: false });
}, 1000);

$('refresh').addEventListener('click', () => load(true));
$('detailClose').addEventListener('click', closeSheet);
$('detail').addEventListener('click', (e) => { if (e.target === $('detail')) closeSheet(); });

$('search').addEventListener('input', (e) => {
  filter = e.target.value.trim().toLowerCase();
  if (STATE && STATE.ok !== false) { renderPriorities(); renderJobs(); renderProjects(); }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (!$('detail').hidden) { closeSheet(); return; }
    if (selectedJob) { pickJob(selectedJob); return; }
    if (document.activeElement === $('search')) {
      $('search').value = ''; filter = '';
      renderPriorities(); renderJobs(); renderProjects(); $('search').blur();
    }
  }
  if (e.key === '/' && document.activeElement !== $('search')) {
    e.preventDefault(); $('search').focus();
  }
});

load(false);
setInterval(() => load(false), 30000);
