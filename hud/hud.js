/* J.K. Console — client
 *
 * Vanilla, no dependencies.
 *
 * Colour rule enforced throughout: green / amber / red mean nominal, advisory
 * and fault. Nothing decorative is allowed to use them, so a red pixel on this
 * panel always means something is wrong.
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

let STATE = null, filter = '', selectedJob = null;

/* ========================= link graph module ========================= */

const Graph = (() => {
  const cv = $('constellation');
  const ctx = cv.getContext('2d');
  let nodes = [], edges = [], w = 0, h = 0, raf = null, ticks = 0, lit = null;

  function size() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    w = cv.clientWidth; h = cv.clientHeight;
    if (!w || !h) return;
    cv.width = w * dpr; cv.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function load(g) {
    size();
    if (!w || !h) return;
    nodes = g.nodes.map((n) => ({
      ...n,
      x: w / 2 + (Math.random() - 0.5) * w * 0.7,
      y: h / 2 + (Math.random() - 0.5) * h * 0.7,
      vx: 0, vy: 0,
      r: n.kind === 'core' ? 3.4 : n.kind === 'job' ? 3 : 1.9,
      a: 1,
    }));
    const by = new Map(nodes.map((n) => [n.id, n]));
    edges = g.edges.map(([s, t]) => ({ s: by.get(s), t: by.get(t) }))
                   .filter((e) => e.s && e.t);
    ticks = 0;
    for (let i = 0; i < 320; i++) step();   // settle before first paint
    draw();
    if (!REDUCED) start();
  }

  function step() {
    const cx = w / 2, cy = h / 2;
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i];
      for (let j = i + 1; j < nodes.length; j++) {
        const b = nodes[j];
        let dx = b.x - a.x, dy = b.y - a.y, d2 = dx * dx + dy * dy;
        if (d2 < 1) { d2 = 1; dx = Math.random(); dy = Math.random(); }
        if (d2 > 40000) continue;
        const d = Math.sqrt(d2), f = 320 / d2;
        a.vx -= (dx / d) * f; a.vy -= (dy / d) * f;
        b.vx += (dx / d) * f; b.vy += (dy / d) * f;
      }
    }
    edges.forEach((e) => {
      const dx = e.t.x - e.s.x, dy = e.t.y - e.s.y;
      const d = Math.hypot(dx, dy) || 1, f = (d - 34) * 0.006;
      e.s.vx += (dx / d) * f; e.s.vy += (dy / d) * f;
      e.t.vx -= (dx / d) * f; e.t.vy -= (dy / d) * f;
    });
    nodes.forEach((n) => {
      n.vx += (cx - n.x) * 0.004; n.vy += (cy - n.y) * 0.004;
      n.vx *= 0.84; n.vy *= 0.84;
      n.x += n.vx; n.y += n.vy;
      n.x = Math.max(6, Math.min(w - 6, n.x));
      n.y = Math.max(6, Math.min(h - 6, n.y));
    });
    ticks++;
  }

  function draw() {
    if (!w || !h) return;
    ctx.clearRect(0, 0, w, h);
    nodes.forEach((n) => {
      const target = !lit ? 1 : (lit.has(n.id) ? 1 : 0.14);
      n.a += (target - n.a) * (REDUCED ? 1 : 0.16);
    });
    edges.forEach((e) => {
      const both = lit && lit.has(e.s.id) && lit.has(e.t.id);
      const a = Math.min(e.s.a, e.t.a);
      ctx.beginPath(); ctx.moveTo(e.s.x, e.s.y); ctx.lineTo(e.t.x, e.t.y);
      ctx.strokeStyle = both ? `rgba(18,80,127,${0.85 * a})` : `rgba(58,65,71,${0.20 * a})`;
      ctx.lineWidth = both ? 1.4 : 0.6;
      ctx.stroke();
    });
    nodes.forEach((n) => {
      ctx.beginPath();
      ctx.arc(n.x, n.y, lit && lit.has(n.id) ? n.r + 1.4 : n.r, 0, Math.PI * 2);
      ctx.fillStyle = (lit && lit.has(n.id))
        ? `rgba(18,80,127,${n.a})`
        : `rgba(20,24,26,${n.a * 0.72})`;
      ctx.fill();
    });
  }

  function frame() { if (ticks < 460) step(); draw(); raf = requestAnimationFrame(frame); }
  function start() { if (!raf) raf = requestAnimationFrame(frame); }
  function stop() { if (raf) { cancelAnimationFrame(raf); raf = null; } }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stop(); else if (!REDUCED) start();
  });
  addEventListener('resize', () => { size(); draw(); });

  return {
    load,
    highlight(ids) { lit = ids && ids.size ? ids : null; draw(); },
    settle(n) { for (let i = 0; i < n; i++) step(); draw(); },
    count: () => nodes.length,
  };
})();

/* ============================== clock =============================== */

setInterval(() => {
  $('clock').textContent = new Date().toLocaleTimeString('en-GB', { hour12: false });
}, 1000);

/* ============================== fetch =============================== */

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
    $('console').setAttribute('aria-busy', 'false');
  }
}

function fatal(msg, title, hint) {
  document.body.dataset.state = 'fail';
  const c = $('console');
  c.innerHTML = '';
  const box = el('div', 'fatal');
  box.appendChild(el('h2', null, title || 'Console disconnected'));
  const p = el('p');
  p.textContent = (hint || 'The server stopped responding (' + msg + '). Restart it with ');
  if (!hint) p.appendChild(el('code', null, 'python scripts/hud.py'));
  box.appendChild(p);
  c.appendChild(box);
}

/* ============================== render ============================== */

function render() {
  if (!STATE) return;
  if (STATE.ok === false) {
    fatal('', 'Vault not found',
          STATE.error || 'The configured vault path does not exist. Fix it under "Where your memory lives" in AGENTS.md.');
    return;
  }

  $('agentName').textContent = STATE.agent;
  document.title = STATE.agent + ' Console';

  const v = STATE.validation;
  const faults = v.failures.length, advisories = v.warnings.length;
  document.body.dataset.state = v.ok ? 'ok' : 'fail';

  $('verdict').textContent = v.ok ? 'NOMINAL' : 'FAULT';
  $('verdictSub').textContent = v.ok
    ? (advisories ? advisories + ' advisory, no faults' : 'all checks passed')
    : faults + ' fault' + (faults === 1 ? '' : 's') + ' blocking';

  $('f-notes').textContent = num(STATE.stats.notes);
  $('f-links').textContent = num(STATE.stats.links);
  $('f-words').textContent = (STATE.stats.words / 1000).toFixed(1) + 'k';
  $('f-checks').textContent = v.checks;

  renderLamps(v);
  renderFaults(v);
  renderStrip();
  renderPriorities();
  renderJobs();
  renderDist();
  renderDaily();
  renderProjects();

  if (STATE.graph) {
    Graph.load(STATE.graph);
    $('graphMeta').textContent = STATE.graph.nodes.length + ' nodes / ' + STATE.graph.edges.length + ' edges';
    $('graphNote').textContent = selectedJob
      ? selectedJob.name + ': ' + (selectedJob.chainNotes.length + 1) + ' lit'
      : 'select a job to light its chain';
  }

  $('footLeft').textContent =
    'snapshot ' + new Date(STATE.generated).toLocaleTimeString('en-GB', { hour12: false }) +
    '   refresh 30s   127.0.0.1 local only';
  $('vaultPath').textContent = STATE.vault;
}

function renderLamps(v) {
  const box = $('lamps');
  box.innerHTML = '';
  const add = (label, cls) => {
    const li = el('li', 'lamp ' + cls);
    li.appendChild(el('i'));
    li.append(label);
    li.title = label + ': ' + (cls === 'on' ? 'nominal' : cls === 'adv' ? 'advisory' : 'fault');
    box.appendChild(li);
  };
  add('vault', 'on');
  add('links', v.ok ? 'on' : 'err');
  add('index', v.ok ? 'on' : 'err');
  add('jobs', STATE.jobs.length ? 'on' : 'adv');
  add('advisory', v.warnings.length ? 'adv' : 'on');
}

function renderFaults(v) {
  const box = $('faults');
  box.innerHTML = '';
  $('faultMeta').textContent = v.failures.length + ' / ' + v.warnings.length;
  if (!v.failures.length && !v.warnings.length) {
    const c = el('div', 'clear');
    c.appendChild(el('i'));
    c.append('no faults');
    box.appendChild(c);
    return;
  }
  v.failures.forEach((f) => {
    const r = el('div', 'fault-row');
    r.appendChild(el('span', 'fault-code f', 'FAULT'));
    r.appendChild(el('span', 'fault-text', f));
    box.appendChild(r);
  });
  v.warnings.forEach((wn) => {
    const r = el('div', 'fault-row');
    r.appendChild(el('span', 'fault-code a', 'ADV'));
    r.appendChild(el('span', 'fault-text', wn));
    box.appendChild(r);
  });
}

function renderStrip() {
  const box = $('strip');
  box.innerHTML = '';
  const s = STATE.stats;
  const jobsChain = STATE.jobs.length
    ? Math.round(STATE.jobs.reduce((a, j) => a + j.chain.length, 0) / STATE.jobs.length * 10) / 10
    : 0;
  const density = s.notes ? Math.round(s.links / s.notes * 10) / 10 : 0;
  const chans = [
    ['notes',     s.notes,   200,  num(s.notes),            false],
    ['links',     s.links,   500,  num(s.links),            false],
    ['density',   density,   6,    density + ' / note',     true],
    ['words',     s.words,   60000, (s.words / 1000).toFixed(1) + 'k', false],
    ['folders',   s.systemFolders, 20, s.systemFolders,     false],
    ['jobs',      STATE.jobs.length, 12, STATE.jobs.length, false],
    ['chain avg', jobsChain, 8,    jobsChain + ' steps',    true],
  ];
  chans.forEach(([name, val, max, label, accent]) => {
    const c = el('div', 'chan');
    const top = el('div', 'chan-top');
    top.appendChild(el('span', 'chan-name', name));
    top.appendChild(el('span', 'chan-val', String(label)));
    c.appendChild(top);
    const bar = el('div', 'chan-bar');
    const fill = el('div', 'chan-fill' + (accent ? ' acc' : ''));
    fill.style.width = Math.max(2, Math.min(100, (val / max) * 100)) + '%';
    bar.appendChild(fill);
    c.appendChild(bar);
    const sc = el('div', 'chan-scale');
    sc.appendChild(el('span', null, '0'));
    sc.appendChild(el('span', null, String(max)));
    c.appendChild(sc);
    box.appendChild(c);
  });
}

const match = (t) => !filter || t.toLowerCase().includes(filter);

function table(head) {
  const t = el('table', 'tbl');
  const thead = el('thead'), tr = el('tr');
  head.forEach(([label, cls]) => {
    const th = el('th', cls, label);
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
  const box = $('priorities');
  box.innerHTML = '';
  const p = STATE.priorities;
  const rows = p.open.map((t) => ({ ...t, done: false }))
    .concat(p.done.map((t) => ({ ...t, done: true })))
    .filter((t) => match(t.text + ' ' + t.tag));
  $('prMeta').textContent = p.open.length + ' open';
  if (!rows.length) {
    box.appendChild(filter ? empty('no match', 'Nothing matches "' + filter + '".')
                           : empty('queue clear', 'Add items to Active Priorities.md.'));
    return;
  }
  const { table: t, body } = table([['', ''], ['project', ''], ['item', '']]);
  rows.forEach((r) => {
    const tr = el('tr');
    const f = el('td');
    f.appendChild(el('span', 'flag ' + (r.done ? 'done' : 'open'), r.done ? 'OK' : '·'));
    tr.appendChild(f);
    const tg = el('td');
    if (r.tag) tg.appendChild(el('span', 'tag', r.tag));
    tr.appendChild(tg);
    tr.appendChild(el('td', r.done ? 'strike' : '', r.text));
    body.appendChild(tr);
  });
  box.appendChild(t);
}

function renderJobs() {
  const box = $('jobs');
  box.innerHTML = '';
  const list = STATE.jobs.filter((j) => match(j.name + ' ' + j.job));
  $('jobMeta').textContent = STATE.jobs.length;
  if (!list.length) {
    box.appendChild(filter ? empty('no match', 'No job matches "' + filter + '".')
                           : empty('no jobs', 'Add one when you explain the same task twice.'));
    return;
  }
  const { table: t, body } = table([['job', ''], ['chain', 'r'], ['lit', 'r'], ['steps', 'r']]);
  list.forEach((j) => {
    const tr = el('tr', 'click');
    tr.tabIndex = 0;
    tr.setAttribute('aria-selected', selectedJob && selectedJob.name === j.name ? 'true' : 'false');
    tr.appendChild(el('td', null, j.name));
    tr.appendChild(el('td', 'r', j.chain.length));
    tr.appendChild(el('td', 'r dim', j.chainNotes.length + 1));
    tr.appendChild(el('td', 'r dim', j.steps));
    const go = () => selectJob(j);
    tr.addEventListener('click', go);
    tr.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); }
      if (e.key === 'i') showJob(j);
    });
    tr.addEventListener('dblclick', () => showJob(j));
    body.appendChild(tr);
  });
  box.appendChild(t);
}

function renderDist() {
  const box = $('dist');
  box.innerHTML = '';
  const rows = (STATE.folders || []).filter((f) => f.notes > 0)
    .slice().sort((a, b) => b.notes - a.notes);
  if (!rows.length) { box.appendChild(empty('no folders', 'Nothing to chart yet.')); return; }
  const max = rows[0].notes;
  rows.forEach((f) => {
    const wrap = el('div', 'bar-row');
    wrap.appendChild(el('span', 'bar-label', f.name));
    wrap.appendChild(el('span', 'bar-num', f.notes));
    const track = el('div', 'bar-track');
    const fill = el('div', 'bar-fill' + (f.folder ? '' : ' zk'));
    fill.style.width = Math.max(2, (f.notes / max) * 100) + '%';
    track.appendChild(fill);
    wrap.appendChild(track);
    box.appendChild(wrap);
  });
}

function renderDaily() {
  const box = $('daily');
  box.innerHTML = '';
  const d = STATE.daily;
  $('dailyMeta').textContent = (d.total || 0) + ' days';
  if (!d.recent.length) {
    box.appendChild(empty('no entries', 'Say you are done and the agent logs the day.'));
    return;
  }
  d.recent.forEach((day) => {
    const w = el('div', 'log-day');
    const h = el('div');
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
  const box = $('projects');
  box.innerHTML = '';
  const list = STATE.projects.filter((p) => match(p.name + ' ' + p.slug));
  $('projMeta').textContent = STATE.projects.length;
  if (!list.length) { box.appendChild(empty('no match', 'No project matches "' + filter + '".')); return; }
  const { table: t, body } = table([['project', ''], ['slug', ''], ['notes', 'r'], ['index', 'r']]);
  list.forEach((p) => {
    const tr = el('tr', 'click');
    tr.tabIndex = 0;
    tr.appendChild(el('td', null, p.name));
    tr.appendChild(el('td', 'dim', p.slug || '—'));
    tr.appendChild(el('td', 'r', p.notes));
    const ix = el('td', 'r');
    ix.appendChild(el('span', 'flag ' + (p.hasIndex ? 'done' : 'open'), p.hasIndex ? 'OK' : '—'));
    tr.appendChild(ix);
    tr.addEventListener('click', () => showProject(p));
    tr.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); showProject(p); }
    });
    body.appendChild(tr);
  });
  box.appendChild(t);
}

/* =========================== interaction =========================== */

function selectJob(j) {
  selectedJob = (selectedJob && selectedJob.name === j.name) ? null : j;
  if (selectedJob) {
    const ids = new Set(selectedJob.chainNotes);
    ids.add(selectedJob.name);
    Graph.highlight(ids);
    $('graphNote').textContent = selectedJob.name + ': ' + ids.size + ' lit of ' + Graph.count();
  } else {
    Graph.highlight(null);
    $('graphNote').textContent = 'select a job to light its chain';
  }
  renderJobs();
}

function openSheet(kicker, title, build) {
  $('detailKicker').textContent = kicker;
  $('detailTitle').textContent = title;
  const b = $('detailBody');
  b.innerHTML = '';
  build(b);
  $('detail').hidden = false;
  $('detailClose').focus();
}
const closeSheet = () => { $('detail').hidden = true; };

function showJob(j) {
  openSheet('Job', j.name, (body) => {
    if (j.job) body.appendChild(el('p', 'lead', j.job));
    const kv = el('dl', 'kv');
    [['boot chain', j.chain.length], ['vault notes', j.chainNotes.length + 1],
     ['steps', j.steps], ['lessons', j.lessons]].forEach(([k, val]) => {
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
    [['notes', p.notes], ['slug', p.slug || '—'], ['index', p.hasIndex ? 'yes' : 'missing']]
      .forEach(([k, val]) => {
        const d = el('div');
        d.appendChild(el('dt', null, k));
        d.appendChild(el('dd', null, String(val)));
        kv.appendChild(d);
      });
    body.appendChild(kv);
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

/* ============================== events ============================= */

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
    if (selectedJob) { selectJob(selectedJob); return; }
    if (document.activeElement === $('search')) {
      $('search').value = ''; filter = '';
      renderPriorities(); renderJobs(); renderProjects();
      $('search').blur();
    }
  }
  if (e.key === '/' && document.activeElement !== $('search')) {
    e.preventDefault(); $('search').focus();
  }
});

load(false);
setInterval(() => load(false), 30000);
