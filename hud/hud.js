/* J.K. HUD - client
   Vanilla. No framework, no bundler, no dependency tax. */

'use strict';

const $  = (id) => document.getElementById(id);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};

let STATE = null;
let filter = '';
const REFRESH_MS = 30000;

/* ---------- reactor tick marks (drawn, not imported) ---------- */

(function ticks() {
  const g = $('ticks');
  if (!g) return;
  const NS = 'http://www.w3.org/2000/svg';
  for (let i = 0; i < 48; i++) {
    const a = (i / 48) * Math.PI * 2;
    const long = i % 4 === 0;
    const r1 = long ? 68 : 72, r2 = 78;
    const line = document.createElementNS(NS, 'line');
    line.setAttribute('x1', 120 + Math.cos(a) * r1);
    line.setAttribute('y1', 120 + Math.sin(a) * r1);
    line.setAttribute('x2', 120 + Math.cos(a) * r2);
    line.setAttribute('y2', 120 + Math.sin(a) * r2);
    if (long) line.setAttribute('opacity', '0.75');
    g.appendChild(line);
  }
})();

/* ---------- clock ---------- */

setInterval(() => {
  $('clock').textContent = new Date().toLocaleTimeString('en-GB', { hour12: false });
}, 1000);

/* ---------- fetch ---------- */

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
    $('grid').setAttribute('aria-busy', 'false');
  }
}

function fatal(msg) {
  document.body.dataset.state = 'fail';
  $('status').textContent = 'OFFLINE';
  $('statusSub').textContent = 'cannot reach hud server';
  const grid = $('grid');
  grid.innerHTML = '';
  const box = el('div', 'fatal');
  box.appendChild(el('h2', null, 'HUD disconnected'));
  const p = el('p');
  p.textContent = 'The HUD server stopped responding: ' + msg + '. Restart it with ';
  const c = el('code', null, 'python scripts/hud.py');
  p.appendChild(c);
  box.appendChild(p);
  grid.appendChild(box);
}

/* ---------- render ---------- */

function render() {
  if (!STATE) return;

  if (STATE.ok === false) {
    document.body.dataset.state = 'fail';
    $('status').textContent = 'NO VAULT';
    $('statusSub').textContent = 'memory unreachable';
    const grid = $('grid');
    grid.innerHTML = '';
    const box = el('div', 'fatal');
    box.appendChild(el('h2', null, 'Vault not found'));
    box.appendChild(el('p', null, STATE.error || 'The configured vault path does not exist.'));
    const p = el('p');
    p.textContent = 'Fix the path under "Where your memory lives" in AGENTS.md, or run ';
    p.appendChild(el('code', null, 'setup.ps1'));
    p.append(' to rewire it.');
    box.appendChild(p);
    grid.appendChild(box);
    return;
  }

  $('agentName').textContent = STATE.agent;
  document.title = STATE.agent + ' HUD';

  const v = STATE.validation;
  const state = v.ok ? (v.warnings.length ? 'warn' : 'ok') : 'fail';
  document.body.dataset.state = state;
  $('status').textContent = v.ok ? 'ONLINE' : 'DEGRADED';
  $('statusSub').textContent = v.ok
    ? (v.warnings.length ? v.warnings.length + ' advisory' : 'all systems nominal')
    : v.failures.length + ' fault' + (v.failures.length === 1 ? '' : 's');

  renderSystems(v);
  renderStats();
  renderPriorities();
  renderProjects();
  renderJobs();
  renderDaily();

  const when = new Date(STATE.generated).toLocaleTimeString('en-GB', { hour12: false });
  $('footer').textContent = '';
  $('footer').append(
    'SNAPSHOT ' + when,
    ' · ',
    'AUTO-REFRESH 30s',
    ' · ',
    'LOCAL ONLY — 127.0.0.1'
  );
}

function sysRow(label, cls, value) {
  const r = el('div', 'sys');
  r.appendChild(el('span', 'led ' + cls));
  r.appendChild(el('span', 'sys-label', label));
  r.appendChild(el('span', 'sys-val', value));
  return r;
}

function renderSystems(v) {
  const box = $('systems');
  box.innerHTML = '';
  $('sysMeta').textContent = v.checks + ' checks';

  box.appendChild(sysRow('Vault reachable', 'ok', 'yes'));
  box.appendChild(sysRow('Wikilinks resolved', v.ok ? 'ok' : 'fail', String(v.links)));
  box.appendChild(sysRow('Structure', v.ok ? 'ok' : 'fail', v.ok ? 'valid' : v.failures.length + ' fail'));
  box.appendChild(sysRow('Zettelkasten', 'ok', String(STATE.stats.zettel) + ' notes'));

  v.failures.forEach((f) => {
    const r = el('div', 'sys');
    r.appendChild(el('span', 'led fail'));
    r.appendChild(el('span', 'sys-label', f));
    box.appendChild(r);
  });
  v.warnings.forEach((w) => {
    const r = el('div', 'sys');
    r.appendChild(el('span', 'led warn'));
    r.appendChild(el('span', 'sys-label', w));
    box.appendChild(r);
  });
}

function renderStats() {
  const s = STATE.stats;
  $('s-notes').textContent = s.notes.toLocaleString();
  $('s-words').textContent = s.words.toLocaleString();
  $('s-links').textContent = s.links.toLocaleString();
  $('s-folders').textContent = s.systemFolders;
  $('vaultPath').textContent = STATE.vault;
}

function match(txt) {
  return !filter || txt.toLowerCase().includes(filter);
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
  const open = p.open.filter((t) => match(t.text + ' ' + t.tag));
  const done = p.done.filter((t) => match(t.text + ' ' + t.tag));
  $('prMeta').textContent = p.open.length + ' open';

  if (!open.length && !done.length) {
    box.appendChild(filter
      ? empty('No match', 'Nothing in Active Priorities matches "' + filter + '".')
      : empty('Queue is clear', 'Nothing open. Add items to Active Priorities.md as they come up.'));
    return;
  }

  open.concat(done).forEach((t) => {
    const isDone = done.includes(t);
    const row = el('div', 'task' + (isDone ? ' done' : ''));
    row.appendChild(el('span', 'box'));
    const body = el('div');
    if (t.tag) {
      const tg = el('span', 'tag task-tag', t.tag);
      body.appendChild(tg);
    }
    body.appendChild(el('span', 'task-text', t.text));
    row.appendChild(body);
    box.appendChild(row);
  });
}

function renderProjects() {
  const box = $('projects');
  box.innerHTML = '';
  const list = STATE.projects.filter((p) => match(p.name + ' ' + p.slug + ' ' + p.summary));
  $('projMeta').textContent = STATE.projects.length + '';

  if (!list.length) {
    box.appendChild(empty('No match', 'No project folder matches "' + filter + '".'));
    return;
  }

  list.forEach((p) => {
    const row = el('button', 'row');
    row.type = 'button';
    const head = el('div', 'row-head');
    head.appendChild(el('span', 'row-name', p.name));
    head.appendChild(el('span', 'row-num', p.notes + (p.notes === 1 ? ' note' : ' notes')));
    row.appendChild(head);
    if (p.slug) {
      const sub = el('div', 'row-sub', p.slug);
      row.appendChild(sub);
    }
    row.addEventListener('click', () => showProject(p));
    box.appendChild(row);
  });
}

function renderJobs() {
  const box = $('jobs');
  box.innerHTML = '';
  const list = STATE.jobs.filter((j) => match(j.name + ' ' + j.job));
  $('jobMeta').textContent = STATE.jobs.length + '';

  if (!list.length) {
    box.appendChild(filter
      ? empty('No match', 'No Job matches "' + filter + '".')
      : empty('No Jobs yet', 'Add one the first time you explain the same task twice.'));
    return;
  }

  list.forEach((j) => {
    const row = el('button', 'row');
    row.type = 'button';
    const head = el('div', 'row-head');
    head.appendChild(el('span', 'row-name', j.name));
    head.appendChild(el('span', 'row-num', j.chain.length + ' in chain'));
    row.appendChild(head);
    if (j.job) row.appendChild(el('div', 'row-sub', j.job));
    row.addEventListener('click', () => showJob(j));
    box.appendChild(row);
  });
}

function renderDaily() {
  const box = $('daily');
  box.innerHTML = '';
  const d = STATE.daily;
  $('dailyMeta').textContent = (d.total || 0) + ' days';

  if (!d.recent.length) {
    box.appendChild(empty('No daily notes yet',
      'Tell the agent you are done and it will offer to log the day.'));
    return;
  }

  d.recent.forEach((day) => {
    const wrap = el('div', 'day');
    const h = el('div');
    h.appendChild(el('span', 'day-date', day.date));
    h.appendChild(el('span', 'day-meta',
      day.sessions + (day.sessions === 1 ? ' session' : ' sessions') + ' · ' + day.words + 'w'));
    wrap.appendChild(h);
    if (day.index.length) {
      const ul = el('ul');
      day.index.forEach((b) => ul.appendChild(el('li', null, b)));
      wrap.appendChild(ul);
    }
    box.appendChild(wrap);
  });
}

/* ---------- detail ---------- */

function openDetail(kicker, title, build) {
  $('detailKicker').textContent = kicker;
  $('detailTitle').textContent = title;
  const body = $('detailBody');
  body.innerHTML = '';
  build(body);
  $('detail').hidden = false;
  $('detailClose').focus();
}

function closeDetail() {
  $('detail').hidden = true;
}

function showJob(j) {
  openDetail('Job', j.name, (body) => {
    if (j.job) body.appendChild(el('p', 'detail-lead', j.job));

    const kv = el('dl', 'kv');
    [['Boot chain', j.chain.length], ['Steps', j.steps], ['Lessons', j.lessons]]
      .forEach(([k, val]) => {
        const d = el('div');
        d.appendChild(el('dt', null, k));
        d.appendChild(el('dd', null, String(val)));
        kv.appendChild(d);
      });
    body.appendChild(kv);

    body.appendChild(el('p', 'sub-head', 'What this loads, in order'));
    const ol = el('ol', 'chain');
    j.chain.forEach((c) => ol.appendChild(el('li', null, c)));
    body.appendChild(ol);

    body.appendChild(el('p', 'detail-lead',
      'The agent reads this one note plus these ' + j.chain.length +
      ' items, and nothing else in the vault. That is what keeps it fast as the vault grows.'));
  });
}

function showProject(p) {
  openDetail('Project folder', p.name, (body) => {
    if (p.summary) body.appendChild(el('p', 'detail-lead', p.summary));

    const kv = el('dl', 'kv');
    [['Notes', p.notes], ['Slug', p.slug || '-'], ['Index', p.hasIndex ? 'yes' : 'missing']]
      .forEach(([k, val]) => {
        const d = el('div');
        d.appendChild(el('dt', null, k));
        d.appendChild(el('dd', null, String(val)));
        kv.appendChild(d);
      });
    body.appendChild(kv);

    body.appendChild(el('p', 'sub-head', 'Folder'));
    body.appendChild(el('p', 'detail-lead', STATE.vault + '\\' + p.folder));

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

/* ---------- events ---------- */

$('refresh').addEventListener('click', () => load(true));
$('detailClose').addEventListener('click', closeDetail);
$('detail').addEventListener('click', (e) => {
  if (e.target === $('detail')) closeDetail();
});

$('search').addEventListener('input', (e) => {
  filter = e.target.value.trim().toLowerCase();
  if (STATE && STATE.ok !== false) {
    renderPriorities(); renderProjects(); renderJobs();
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (!$('detail').hidden) { closeDetail(); return; }
    if (document.activeElement === $('search')) { $('search').value = ''; filter = ''; render(); $('search').blur(); }
  }
  if (e.key === '/' && document.activeElement !== $('search')) {
    e.preventDefault();
    $('search').focus();
  }
});

load(false);
setInterval(() => load(false), REFRESH_MS);
