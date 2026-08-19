/* J.K. HUD — client
 *
 * Vanilla. No framework, no bundler.
 *
 * The constellation is the vault's real link graph. It is decoration ON TOP of
 * the panels, never the only route to a fact: every node, count and boot chain
 * it draws is also readable as text in the flanking panels, because a
 * force-directed graph on a canvas is not accessible on its own.
 */

'use strict';

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;

let STATE = null;
let filter = '';
let selectedJob = null;

/* ============================ constellation ============================ */

const Graph = (() => {
  const cv = $('constellation');
  const ctx = cv.getContext('2d');
  let nodes = [], edges = [], adj = new Map();
  let w = 0, h = 0, dpr = 1, raf = null, ticks = 0, hover = null;
  let lit = null;              // Set of node ids to highlight, or null for all

  const RADIUS = { core: 6.5, job: 5.5, index: 4.5, note: 3 };

  function size() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = cv.clientWidth; h = cv.clientHeight;
    cv.width = w * dpr; cv.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function load(graph) {
    const prev = new Map(nodes.map((n) => [n.id, n]));
    nodes = graph.nodes.map((n) => {
      const p = prev.get(n.id);
      return {
        ...n,
        x: p ? p.x : w / 2 + (Math.random() - 0.5) * 320,
        y: p ? p.y : h / 2 + (Math.random() - 0.5) * 320,
        vx: 0, vy: 0,
        r: RADIUS[n.kind] + Math.min(n.deg * 0.22, 4),
        a: 1,          // current alpha, eased toward target
      };
    });
    const byId = new Map(nodes.map((n) => [n.id, n]));
    edges = graph.edges
      .map(([s, t]) => ({ s: byId.get(s), t: byId.get(t) }))
      .filter((e) => e.s && e.t);
    adj = new Map(nodes.map((n) => [n.id, new Set()]));
    edges.forEach((e) => { adj.get(e.s.id).add(e.t.id); adj.get(e.t.id).add(e.s.id); });
    ticks = 0;
    if (REDUCED) { for (let i = 0; i < 260; i++) step(); }   // settle instantly
    draw();   // paint once synchronously: first paint must not wait on rAF,
              // which never fires in a background or non-compositing tab
    start();
  }

  /* force-directed: repulsion, spring, centre pull. 108 nodes needs no
     quadtree, and adding one would be complexity with nothing to show for it. */
  function step() {
    const cx = w / 2, cy = h / 2;
    const k = ticks < 260 ? 1 : 0.12;   // settle, then drift gently

    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i];
      for (let j = i + 1; j < nodes.length; j++) {
        const b = nodes[j];
        let dx = b.x - a.x, dy = b.y - a.y;
        let d2 = dx * dx + dy * dy;
        if (d2 < 1) { d2 = 1; dx = Math.random(); dy = Math.random(); }
        if (d2 > 90000) continue;
        const f = 900 / d2;
        const d = Math.sqrt(d2);
        const fx = (dx / d) * f, fy = (dy / d) * f;
        a.vx -= fx; a.vy -= fy; b.vx += fx; b.vy += fy;
      }
    }
    edges.forEach((e) => {
      const dx = e.t.x - e.s.x, dy = e.t.y - e.s.y;
      const d = Math.hypot(dx, dy) || 1;
      const f = (d - 78) * 0.0055;
      const fx = (dx / d) * f, fy = (dy / d) * f;
      e.s.vx += fx; e.s.vy += fy; e.t.vx -= fx; e.t.vy -= fy;
    });
    nodes.forEach((n) => {
      n.vx += (cx - n.x) * 0.0016;
      n.vy += (cy - n.y) * 0.0016;
      n.vx *= 0.86; n.vy *= 0.86;
      n.x += n.vx * k; n.y += n.vy * k;
      const m = 40;
      n.x = Math.max(m, Math.min(w - m, n.x));
      n.y = Math.max(m, Math.min(h - m, n.y));
    });
    ticks++;
  }

  function draw() {
    ctx.clearRect(0, 0, w, h);

    nodes.forEach((n) => {
      const target = !lit ? 1 : (lit.has(n.id) ? 1 : 0.09);
      n.a += (target - n.a) * (REDUCED ? 1 : 0.12);
    });

    // edges first, dim; a lit pair burns amber
    edges.forEach((e) => {
      const both = lit && lit.has(e.s.id) && lit.has(e.t.id);
      const a = Math.min(e.s.a, e.t.a);
      ctx.beginPath();
      ctx.moveTo(e.s.x, e.s.y);
      ctx.lineTo(e.t.x, e.t.y);
      ctx.strokeStyle = both
        ? `rgba(232,163,61,${0.55 * a})`
        : `rgba(232,163,61,${0.11 * a})`;
      ctx.lineWidth = both ? 1.4 : 0.7;
      ctx.stroke();
    });

    nodes.forEach((n) => {
      const isLit = lit && lit.has(n.id);
      const isHover = hover === n;
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.r + (isHover ? 2 : 0), 0, Math.PI * 2);
      if (n.kind === 'core') ctx.fillStyle = `rgba(63,199,212,${n.a})`;
      else if (n.kind === 'job') ctx.fillStyle = `rgba(255,201,120,${n.a})`;
      else ctx.fillStyle = `rgba(232,163,61,${n.a * 0.82})`;
      ctx.fill();

      if (isLit || isHover) {
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.r + 6, 0, Math.PI * 2);
        ctx.strokeStyle = n.kind === 'core'
          ? `rgba(63,199,212,${0.5 * n.a})`
          : `rgba(232,163,61,${0.45 * n.a})`;
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      // label only the few that matter, so it stays a constellation not a list
      if (isLit || isHover || n.deg >= 16) {
        ctx.font = '10px "Cascadia Mono", ui-monospace, monospace';
        ctx.fillStyle = `rgba(244,236,222,${(isLit || isHover ? 0.9 : 0.34) * Math.max(n.a, 0.09)})`;
        ctx.fillText(n.id, n.x + n.r + 6, n.y + 3.5);
      }
    });
  }

  function frame() {
    if (ticks < 400 || !REDUCED) step();
    draw();
    raf = requestAnimationFrame(frame);
  }
  function start() { if (!raf) raf = requestAnimationFrame(frame); }
  function stop() { if (raf) { cancelAnimationFrame(raf); raf = null; } }

  // A hidden tab should not burn CPU on a simulation nobody is looking at.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stop(); else start();
  });

  cv.addEventListener('mousemove', (e) => {
    const r = cv.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    let best = null, bd = 14 * 14;
    nodes.forEach((n) => {
      const d = (n.x - mx) ** 2 + (n.y - my) ** 2;
      if (d < bd) { bd = d; best = n; }
    });
    hover = best;
    const tip = $('tip');
    if (best) {
      tip.innerHTML = '';
      tip.appendChild(el('b', null, best.id));
      tip.append(' · ' + best.deg + (best.deg === 1 ? ' link' : ' links'));
      tip.hidden = false;
      tip.style.left = Math.min(e.clientX + 14, window.innerWidth - 220) + 'px';
      tip.style.top = (e.clientY + 16) + 'px';
      cv.style.cursor = 'crosshair';
    } else {
      tip.hidden = true;
      cv.style.cursor = 'default';
    }
  });
  cv.addEventListener('mouseleave', () => { hover = null; $('tip').hidden = true; });

  window.addEventListener('resize', () => { size(); draw(); });

  return {
    init() { size(); },
    load,
    highlight(ids) { lit = ids && ids.size ? ids : null; draw(); },
    // exposed so the settled layout can be verified without a compositor
    settle(n) { for (let i = 0; i < n; i++) step(); draw(); },
    neighbours(id) { return adj.get(id) || new Set(); },
    count() { return nodes.length; },
  };
})();

/* ============================== clock ============================== */

setInterval(() => {
  $('clock').textContent = new Date().toLocaleTimeString('en-GB', { hour12: false });
}, 1000);

/* ============================== data =============================== */

async function load(manual) {
  const btn = $('refresh');
  if (manual) btn.dataset.busy = '1';
  try {
    const res = await fetch('/api/state', { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    STATE = await res.json();
    render();
  } catch (err) {
    fatal(err.message);
  } finally {
    delete btn.dataset.busy;
    $('stage').setAttribute('aria-busy', 'false');
  }
}

function fatal(msg) {
  document.body.dataset.state = 'fail';
  $('statusText').textContent = 'offline';
  $('statusSub').textContent = 'server unreachable';
  const stage = $('stage');
  stage.innerHTML = '';
  const box = el('div', 'fatal');
  box.appendChild(el('h2', null, 'HUD disconnected'));
  const p = el('p');
  p.textContent = 'The server stopped responding (' + msg + '). Restart it with ';
  p.appendChild(el('code', null, 'python scripts/hud.py'));
  box.appendChild(p);
  stage.appendChild(box);
}

/* ============================= render ============================== */

function render() {
  if (!STATE) return;

  if (STATE.ok === false) {
    document.body.dataset.state = 'fail';
    $('statusText').textContent = 'no vault';
    $('statusSub').textContent = 'memory unreachable';
    const stage = $('stage');
    stage.innerHTML = '';
    const box = el('div', 'fatal');
    box.appendChild(el('h2', null, 'Vault not found'));
    box.appendChild(el('p', null, STATE.error || 'The configured path does not exist.'));
    const p = el('p');
    p.textContent = 'Fix the path under "Where your memory lives" in AGENTS.md, or run ';
    p.appendChild(el('code', null, 'setup.ps1'));
    p.append(' to rewire it.');
    box.appendChild(p);
    stage.appendChild(box);
    return;
  }

  $('agentName').textContent = STATE.agent;
  document.title = STATE.agent + ' HUD';

  const v = STATE.validation;
  document.body.dataset.state = v.ok ? 'ok' : 'fail';
  $('statusText').textContent = v.ok ? 'nominal' : 'degraded';
  $('statusSub').textContent = v.ok
    ? STATE.stats.notes + ' notes, ' + STATE.stats.links + ' links'
    : v.failures.length + ' fault' + (v.failures.length === 1 ? '' : 's');

  if (STATE.graph) Graph.load(STATE.graph);
  paintCore();

  renderSystems(v);
  renderGauges();
  renderPriorities();
  renderProjects();
  renderJobs();
  renderDaily();

  const when = new Date(STATE.generated).toLocaleTimeString('en-GB', { hour12: false });
  $('footer').textContent = 'snapshot ' + when +
    '   ·   auto-refresh 30s   ·   127.0.0.1, local only';
}

function paintCore() {
  const count = $('coreCount'), label = $('coreLabel'), reset = $('coreReset');
  if (selectedJob) {
    const n = selectedJob.chainNotes.length + 1;
    count.textContent = n + ' / ' + STATE.stats.notes;
    count.classList.remove('idle');
    // Say what the number counts. A boot chain also names files outside the
    // vault (a repo's AGENTS.md, docs/STATE.md); those are not vault notes and
    // are not lit, so calling this "notes loaded" would overstate it.
    label.textContent = 'vault notes this job lights';
    reset.hidden = false;
  } else {
    count.textContent = STATE.stats.notes;
    count.classList.add('idle');
    label.textContent = 'notes in memory';
    reset.hidden = true;
  }
}

function sysRow(label, cls, value) {
  const r = el('div', 'sys');
  const lamp = el('span', 'lamp ' + cls);
  lamp.setAttribute('role', 'img');
  lamp.setAttribute('aria-label', cls);
  r.appendChild(lamp);
  r.appendChild(el('span', 'sys-label', label));
  if (value !== undefined) r.appendChild(el('span', 'sys-val', value));
  return r;
}

function renderSystems(v) {
  const box = $('systems');
  box.innerHTML = '';
  $('sysMeta').textContent = v.checks + ' checks';
  box.appendChild(sysRow('structure', v.ok ? 'ok' : 'fail', v.ok ? 'valid' : 'broken'));
  box.appendChild(sysRow('wikilinks', v.ok ? 'ok' : 'fail', String(v.links)));
  box.appendChild(sysRow('zettelkasten', 'ok', String(STATE.stats.zettel)));
  v.failures.forEach((f) => box.appendChild(sysRow(f, 'fail')));
  v.warnings.forEach((wn) => box.appendChild(sysRow(wn, 'warn')));
}

function renderGauges() {
  const s = STATE.stats;
  $('g-notes').textContent = s.notes.toLocaleString();
  $('g-links').textContent = s.links.toLocaleString();
  $('g-words').textContent = (s.words / 1000).toFixed(1) + 'k';
  $('vaultPath').textContent = STATE.vault;
}

const match = (t) => !filter || t.toLowerCase().includes(filter);

function empty(title, hint) {
  const e = el('div', 'empty');
  e.appendChild(el('strong', null, title));
  e.append(hint);
  return e;
}

function renderPriorities() {
  const box = $('priorities');
  box.innerHTML = '';
  const p = STATE.priorities;
  const open = p.open.filter((t) => match(t.text + ' ' + t.tag));
  const done = p.done.filter((t) => match(t.text + ' ' + t.tag));
  $('prMeta').textContent = p.open.length;

  if (!open.length && !done.length) {
    box.appendChild(filter
      ? empty('no match', 'Nothing open matches "' + filter + '".')
      : empty('queue clear', 'Add items to Active Priorities.md as they come up.'));
    return;
  }
  open.concat(done).forEach((t) => {
    const row = el('div', 'task' + (done.includes(t) ? ' done' : ''));
    row.appendChild(el('span', 'mark'));
    const body = el('div');
    if (t.tag) body.appendChild(el('span', 'tag', t.tag));
    body.appendChild(el('div', 'task-text', t.text));
    row.appendChild(body);
    box.appendChild(row);
  });
}

function renderProjects() {
  const box = $('projects');
  box.innerHTML = '';
  const list = STATE.projects.filter((p) => match(p.name + ' ' + p.slug));
  $('projMeta').textContent = STATE.projects.length;
  if (!list.length) { box.appendChild(empty('no match', 'No project matches "' + filter + '".')); return; }

  list.forEach((p) => {
    const row = el('button', 'row');
    row.type = 'button';
    const head = el('div', 'row-head');
    head.appendChild(el('span', 'row-name', p.name));
    head.appendChild(el('span', 'row-num', p.notes));
    row.appendChild(head);
    row.addEventListener('click', () => showProject(p));
    box.appendChild(row);
  });
}

function renderJobs() {
  const box = $('jobs');
  box.innerHTML = '';
  const list = STATE.jobs.filter((j) => match(j.name + ' ' + j.job));
  $('jobMeta').textContent = STATE.jobs.length;
  if (!list.length) {
    box.appendChild(filter
      ? empty('no match', 'No job matches "' + filter + '".')
      : empty('no jobs yet', 'Add one the first time you explain the same task twice.'));
    return;
  }
  list.forEach((j) => {
    const row = el('button', 'row');
    row.type = 'button';
    row.setAttribute('aria-pressed', selectedJob && selectedJob.name === j.name ? 'true' : 'false');
    const head = el('div', 'row-head');
    head.appendChild(el('span', 'row-name', j.name));
    head.appendChild(el('span', 'row-num', j.chain.length + ' step chain'));
    row.appendChild(head);
    if (j.job) row.appendChild(el('div', 'row-sub', j.job));
    row.addEventListener('click', () => selectJob(j));
    row.addEventListener('dblclick', () => showJob(j));
    box.appendChild(row);
  });
}

function renderDaily() {
  const box = $('daily');
  box.innerHTML = '';
  const d = STATE.daily;
  $('dailyMeta').textContent = (d.total || 0) + ' days';
  if (!d.recent.length) {
    box.appendChild(empty('no daily notes', 'Say you are done and the agent offers to log the day.'));
    return;
  }
  d.recent.forEach((day) => {
    const wrap = el('div', 'day');
    const h = el('div');
    h.appendChild(el('span', 'day-date', day.date));
    h.appendChild(el('span', 'day-meta', day.sessions + 'ses · ' + day.words + 'w'));
    wrap.appendChild(h);
    if (day.index.length) {
      const ul = el('ul');
      day.index.forEach((b) => ul.appendChild(el('li', null, b)));
      wrap.appendChild(ul);
    }
    box.appendChild(wrap);
  });
}

/* =========================== interaction =========================== */

function selectJob(j) {
  const same = selectedJob && selectedJob.name === j.name;
  selectedJob = same ? null : j;
  if (selectedJob) {
    const ids = new Set(selectedJob.chainNotes);
    ids.add(selectedJob.name);
    Graph.highlight(ids);
  } else {
    Graph.highlight(null);
  }
  paintCore();
  renderJobs();
}

function clearSelection() {
  selectedJob = null;
  Graph.highlight(null);
  paintCore();
  renderJobs();
}

function openSheet(kicker, title, build) {
  $('detailKicker').textContent = kicker;
  $('detailTitle').textContent = title;
  const body = $('detailBody');
  body.innerHTML = '';
  build(body);
  $('detail').hidden = false;
  $('detailClose').focus();
}
const closeSheet = () => { $('detail').hidden = true; };

function showJob(j) {
  openSheet('Job', j.name, (body) => {
    if (j.job) body.appendChild(el('p', 'lead', j.job));
    const kv = el('dl', 'kv');
    [['boot chain', j.chain.length], ['vault notes', j.chainNotes.length + 1],
     ['steps', j.steps], ['lessons', j.lessons]]
      .forEach(([k, val]) => {
        const d = el('div');
        d.appendChild(el('dt', null, k));
        d.appendChild(el('dd', null, String(val)));
        kv.appendChild(d);
      });
    body.appendChild(kv);
    body.appendChild(el('p', 'sub-head', 'Boot chain, in order'));
    const ol = el('ol', 'chain');
    j.chain.forEach((c) => ol.appendChild(el('li', null, c)));
    body.appendChild(ol);
  });
}

function showProject(p) {
  openSheet('Project folder', p.name, (body) => {
    if (p.summary) body.appendChild(el('p', 'lead', p.summary));
    const kv = el('dl', 'kv');
    [['notes', p.notes], ['slug', p.slug || '-'], ['index', p.hasIndex ? 'yes' : 'missing']]
      .forEach(([k, val]) => {
        const d = el('div');
        d.appendChild(el('dt', null, k));
        d.appendChild(el('dd', null, String(val)));
        kv.appendChild(d);
      });
    body.appendChild(kv);
    const related = STATE.priorities.open.filter(
      (t) => t.tag && p.slug && t.tag.toLowerCase().replace(/\s+/g, '-') === p.slug);
    if (related.length) {
      body.appendChild(el('p', 'sub-head', 'Open items'));
      const ol = el('ol', 'chain');
      related.forEach((t) => ol.appendChild(el('li', null, t.text)));
      body.appendChild(ol);
    }
  });
}

/* ============================== events ============================= */

$('refresh').addEventListener('click', () => load(true));
$('detailClose').addEventListener('click', closeSheet);
$('coreReset').addEventListener('click', clearSelection);
$('detail').addEventListener('click', (e) => { if (e.target === $('detail')) closeSheet(); });

$('search').addEventListener('input', (e) => {
  filter = e.target.value.trim().toLowerCase();
  if (STATE && STATE.ok !== false) { renderPriorities(); renderProjects(); renderJobs(); }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (!$('detail').hidden) { closeSheet(); return; }
    if (selectedJob) { clearSelection(); return; }
    if (document.activeElement === $('search')) {
      $('search').value = ''; filter = ''; render(); $('search').blur();
    }
  }
  if (e.key === '/' && document.activeElement !== $('search')) {
    e.preventDefault(); $('search').focus();
  }
});

Graph.init();
load(false);
setInterval(() => load(false), 30000);
