/* Weekly timetable. Phone-first: Today is the default view, Week is the wall
   chart. State syncs through api/state, falling back to localStorage. */
(function () {
  'use strict';

  const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const LONG = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const TICKABLE = ['deep', 'gym', 'habit', 'review'];
  const WEEK_TYPES = Object.keys(SCHEDULE.weeks);
  const CATS = SCHEDULE.categories;
  const KEY = 'ender-schedule';
  const HOUR_PX = 46;
  const HISTORY_WEEKS = 26;   // kept in the state
  const HISTORY_SHOWN = 8;    // drawn on the page

  /* ---------- time helpers: everything is minutes since midnight ---------- */

  const mins = (hhmm) => {
    const [h, m] = hhmm.split(':').map(Number);
    return h * 60 + m;
  };
  const hhmm = (m) => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
  const dur = (m) => (m >= 60 ? Math.floor(m / 60) + ' h' + (m % 60 ? ' ' + (m % 60) + ' min' : '') : m + ' min');

  const GRID_START = mins(SCHEDULE.gridStart);
  const GRID_END = mins(SCHEDULE.gridEnd);

  /* Monday-based day index, and the ISO week the ticks belong to. */
  const dayIndex = (d) => (d.getDay() + 6) % 7;
  function isoWeek(d) {
    const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
    const jan1 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
    const wk = Math.ceil(((t - jan1) / 86400000 + 1) / 7);
    return t.getUTCFullYear() + '-W' + String(wk).padStart(2, '0');
  }

  /* ---------- expand SCHEDULE.blocks into concrete per-day blocks ---------- */

  const BLOCKS = [];
  SCHEDULE.blocks.forEach((b) => {
    const days = b.day === '*' ? DAYS : [].concat(b.day);
    const [from, to] = b.at.split('-');
    days.forEach((name) => {
      const d = DAYS.indexOf(name);
      if (d < 0) return;
      BLOCKS.push({
        d,
        s: mins(from),
        e: mins(to),
        kind: b.kind,
        title: b.title,
        note: b.note || '',
        track: b.track || '',
        weeks: b.weeks || WEEK_TYPES,
        tickable: TICKABLE.indexOf(b.kind) >= 0,
        id: b.kind + '-' + name + '-' + from
      });
    });
  });
  BLOCKS.sort((a, b) => a.d - b.d || a.s - b.s || a.e - b.e);

  const BY_ID = {};
  BLOCKS.forEach((b) => { BY_ID[b.id] = b; });

  const forWeek = () => BLOCKS.filter((b) => b.weeks.indexOf(state.type) >= 0);
  const forDay = (d) => forWeek().filter((b) => b.d === d);

  /* ---------- state ---------- */

  const blank = () => ({ v: 3, week: isoWeek(new Date()), type: 'normal',
                         slots: {}, done: {}, history: [], savedAt: 0 });

  /* v2 had no history, so migrating is just defaulting it to empty. Entries
     are validated the same way everything else is: anything unrecognised is
     dropped rather than trusted. */
  function normHistory(h) {
    if (!Array.isArray(h)) return [];
    const out = [];
    h.forEach((e) => {
      if (!e || typeof e !== 'object' || typeof e.week !== 'string') return;
      const meters = {};
      if (e.meters && typeof e.meters === 'object') {
        Object.keys(e.meters).forEach((k) => {
          const v = e.meters[k];
          if (Array.isArray(v) && v.length === 2) meters[k] = [Number(v[0]) || 0, Number(v[1]) || 0];
        });
      }
      out.push({ week: e.week, type: typeof e.type === 'string' ? e.type : '', meters });
    });
    return out.slice(-HISTORY_WEEKS);
  }

  function normalize(s) {
    if (!s || typeof s !== 'object') return blank();
    const out = blank();
    if (WEEK_TYPES.indexOf(s.type) >= 0) out.type = s.type;
    if (typeof s.week === 'string') out.week = s.week;
    /* Keep only what still refers to a real block. Moving a block in
       schedule.js changes its id, and without this the orphaned key stays in
       the state for good. */
    if (s.slots && typeof s.slots === 'object') {
      Object.keys(s.slots).forEach((k) => {
        if (BY_ID[k] && BY_ID[k].kind === 'deep' && CATS[s.slots[k]]) out.slots[k] = s.slots[k];
      });
    }
    if (s.done && typeof s.done === 'object') {
      Object.keys(s.done).forEach((k) => {
        if (BY_ID[k] && BY_ID[k].tickable && s.done[k]) out.done[k] = true;
      });
    }
    out.history = normHistory(s.history);
    out.savedAt = Number(s.savedAt) || 0;
    return out;
  }

  /* A new ISO week clears the ticks but keeps the plan, so there is no
     "start a new week" button to remember to press. */
  function rollWeek(s) {
    const now = isoWeek(new Date());
    if (s.week === now) return false;
    /* Keep what the week that just ended came to. Guarded on savedAt so a
       state that was never saved cannot file a week of zeroes. */
    if (s.savedAt > 0) {
      s.history = normHistory((s.history || []).concat([snapshot(s)]));
    }
    s.week = now;
    s.done = {};
    s.type = 'normal';
    return true;
  }

  let embedded = {};
  try { embedded = JSON.parse(document.getElementById('state').textContent); } catch (e) { /* default below */ }
  let stored = null;
  try { stored = JSON.parse(localStorage.getItem(KEY)); } catch (e) { /* no localStorage */ }

  let state = normalize((stored && (stored.savedAt || 0) > (embedded.savedAt || 0)) ? stored : embedded);
  let needsRollSave = rollWeek(state);

  let view = 'today';
  try { view = localStorage.getItem(KEY + ':view') === 'week' ? 'week' : 'today'; } catch (e) { /* default */ }

  let status = '';
  let dialogOpen = false;
  let serverOk = false;
  let serverTimer = null;
  const root = document.getElementById('root');

  /* ---------- sync ---------- */

  function adopt(incoming) {
    const s = normalize(incoming);
    if (s.savedAt <= state.savedAt) return false;
    state = s;
    /* Adopting a state from an earlier week rolls it here, which is a real
       change: the ticks are cleared and the finished week is filed into
       history. Nothing else would ever send that, so every device would roll
       the same week over and over and keep its own private history. */
    if (rollWeek(state)) needsRollSave = true;
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* ignore */ }
    return true;
  }

  function pull() {
    fetch('api/state', { cache: 'no-store' })
      .then((r) => {
        if (r.status === 404) { serverOk = true; return null; }
        if (!r.ok) throw new Error('status ' + r.status);
        serverOk = true;
        return r.json();
      })
      .then((s) => {
        if (adopt(s) && !dialogOpen) render();
        if (needsRollSave) { needsRollSave = false; save(); return; }
        /* Anything ticked while the server was unreachable is still only on
           this device: save() skips the push when serverOk is false, and
           adopt() has just turned down the server's older copy. Nothing else
           ever retries, so without this the work sits here under a status line
           claiming "Synced" until another device saves and quietly wins. */
        if (state.savedAt > (s ? Number(s.savedAt) || 0 : 0)) { push(); return; }
        setStatus('Synced');
      })
      .catch(() => { serverOk = false; setStatus('Offline, saving on this device'); });
  }

  function push() {
    if (dialogOpen) { clearTimeout(serverTimer); serverTimer = setTimeout(push, 1500); return; }
    setStatus('Saving…');
    fetch('api/state', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(state)
    })
      .then((r) => {
        if (r.status === 409) return r.json().then((s) => { if (adopt(s)) render(); setStatus('Updated from another device'); });
        if (!r.ok) throw new Error('status ' + r.status);
        setStatus('Synced');
      })
      .catch(() => setStatus('Save failed, kept on this device'));
  }

  function save() {
    state.savedAt = Date.now();
    let localOk = true;
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { localOk = false; }
    if (serverOk) {
      clearTimeout(serverTimer);
      setStatus('Unsaved changes');
      serverTimer = setTimeout(push, 1500);
      return;
    }
    setStatus(localOk ? 'Saved on this device' : 'Changes last until you close this page');
  }

  function setStatus(s) {
    status = s;
    const el = root.querySelector('[data-status]');
    if (el) el.textContent = s;
  }

  /* ---------- counts ---------- */

  /* Defaults to the live state, but takes one explicitly so a week can still
     be counted at the moment it rolls, before its ticks are cleared. */
  function counts(s) {
    s = s || state;
    const c = {};
    const bump = (k, done) => {
      if (!c[k]) c[k] = { planned: 0, done: 0 };
      c[k].planned++;
      if (done) c[k].done++;
    };
    Object.keys(CATS).forEach((k) => { c[k] = { planned: 0, done: 0 }; });
    c.gym = { planned: 0, done: 0 };
    SCHEDULE.habitMeters.forEach((m) => { c[m.track] = { planned: 0, done: 0 }; });

    BLOCKS.filter((b) => b.weeks.indexOf(s.type) >= 0).forEach((b) => {
      if (b.kind === 'deep') {
        const cat = s.slots[b.id];
        if (cat && c[cat]) bump(cat, s.done[b.id]);
      } else if (b.track) {
        bump(b.track, s.done[b.id]);
      }
    });
    return c;
  }

  /* What a finished week came to, as [done, target] per meter. Targets are
     stored alongside, not looked up later: schedule.js changes between
     semesters and a past week should keep the target it was actually judged
     against. */
  function snapshot(s) {
    const c = counts(s);
    const t = (SCHEDULE.weeks[s.type] || { targets: {} }).targets;
    const meters = {};
    Object.keys(CATS).forEach((k) => { meters[k] = [c[k].done, t[k] || 0]; });
    meters.gym = [c.gym.done, t.gym || 0];
    /* Habit meters have no target of their own: doing all the ones on the
       timetable is the target. */
    SCHEDULE.habitMeters.forEach((m) => { meters[m.track] = [c[m.track].done, c[m.track].planned]; });
    return { week: s.week, type: s.type, meters };
  }

  /* ---------- rendering helpers ---------- */

  const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

  /* What a block shows once a category has been picked for it. */
  function face(b) {
    if (b.kind !== 'deep') return { title: b.title, note: b.note, color: '' };
    const cat = state.slots[b.id];
    if (cat && CATS[cat]) return { title: CATS[cat].label, note: 'Deep session', color: CATS[cat].color };
    return { title: 'Open deep session', note: 'Tap to choose', color: 'var(--signal)' };
  }

  function meterHTML(label, color, target, c, hatch) {
    if (target === 0) {
      return `<div class="meter" style="--c:${color}"><div class="mname">${esc(label)}</div>
        <div class="mnone">Paused${c.planned ? ', slots go to coursework' : ''}</div></div>`;
    }
    const n = Math.max(target, c.planned);
    let cells = '';
    for (let i = 0; i < n; i++) {
      cells += `<span class="cell ${i < c.done ? 'done' : hatch && i < c.planned ? 'planned' : ''}"></span>`;
    }
    return `<div class="meter" style="--c:${color}"><div class="mname">${esc(label)}</div>
      <div class="cells" aria-hidden="true">${cells}</div>
      <div class="mcount">${c.done} of ${target}</div></div>`;
  }

  function metersHTML() {
    const c = counts();
    const t = SCHEDULE.weeks[state.type].targets;
    let h = '<section class="meters" aria-label="This week’s counts">';
    Object.keys(CATS).forEach((k) => { h += meterHTML(CATS[k].label, CATS[k].color, t[k], c[k], true); });
    h += meterHTML('Gym', 'var(--gym)', t.gym, c.gym, false);
    SCHEDULE.habitMeters.forEach((m) => { h += meterHTML(m.label, 'var(--ink)', c[m.track].planned, c[m.track], false); });
    return h + '</section>';
  }

  /* Past weeks, one row per meter, so the question it answers is the one you
     actually ask: not "what did week 37 look like" but "have I been going to
     the gym". */
  function historyHTML() {
    const weeks = state.history.slice(-HISTORY_SHOWN);
    if (!weeks.length) return '';

    const rows = [];
    Object.keys(CATS).forEach((k) => rows.push([k, CATS[k].label, CATS[k].color]));
    rows.push(['gym', 'Gym', 'var(--gym)']);
    SCHEDULE.habitMeters.forEach((m) => rows.push([m.track, m.label, 'var(--ink)']));

    let h = `<section class="history" aria-label="Recent weeks"><h2>Recent weeks</h2>`;
    rows.forEach(([key, label, color]) => {
      let cells = '';
      weeks.forEach((w) => {
        const m = w.meters[key];
        const done = m ? m[0] : 0;
        const target = m ? m[1] : 0;
        const cls = !m || !target ? 'none' : done >= target ? 'met' : done ? 'part' : 'miss';
        const week = w.week.replace(/^\d+-/, '');
        cells += `<span class="hcell ${cls}" title="${esc(week + ' · ' + done + ' of ' + target)}"></span>`;
      });
      const last = weeks[weeks.length - 1].meters[key];
      h += `<div class="hrow" style="--c:${color}"><span class="hname">${esc(label)}</span>
        <span class="hcells" role="img" aria-label="${esc(label + ', last ' + weeks.length + ' weeks')}">${cells}</span>
        <span class="hlast">${last ? last[0] + '/' + last[1] : '–'}</span></div>`;
    });
    const span = weeks.length === 1 ? weeks[0].week.replace(/^\d+-/, '')
      : weeks[0].week.replace(/^\d+-/, '') + '–' + weeks[weeks.length - 1].week.replace(/^\d+-/, '');
    return h + `<p class="hfoot">${esc(span)}, oldest first. Last column is the most recent week.</p></section>`;
  }

  /* ---------- Today view ---------- */

  function rowHTML(b, now) {
    const f = face(b);
    const done = !!state.done[b.id];
    const past = b.e <= now;
    const cls = ['row', 'k-' + b.kind, done ? 'is-done' : '', past && !done ? 'past' : ''].join(' ');
    const style = f.color ? `--c:${f.color}` : '';
    const inner = `<span class="rtime">${hhmm(b.s)}</span>
      <span class="rbody"><span class="rtitle">${esc(f.title)}</span>${f.note ? `<span class="rnote">${esc(f.note)}</span>` : ''}</span>
      ${b.tickable ? `<span class="rtick" aria-hidden="true"></span>` : ''}`;
    if (!b.tickable) return `<div class="${cls}" style="${style}">${inner}</div>`;
    const label = `${f.title}, ${hhmm(b.s)} to ${hhmm(b.e)}${done ? ', done' : ''}`;
    return `<button type="button" class="${cls}" style="${style}" data-id="${b.id}" data-kind="${b.kind}"
      aria-pressed="${done}" aria-label="${esc(label)}">${inner}</button>`;
  }

  /* The one block the Now card speaks for: the latest-starting thing in
     progress. Trips count -- on a trip weekend, the trip is what's happening. */
  const currentBlock = (today, now) => {
    const running = today.filter((b) => b.s <= now && now < b.e);
    return running.length ? running[running.length - 1] : null;
  };

  function nowCardHTML(today, now, current) {
    const upcoming = today.filter((b) => b.s > now);

    let h = '<section class="nowcard">';
    if (current) {
      const b = current;
      const f = face(b);
      const pct = Math.round(((now - b.s) / (b.e - b.s)) * 100);
      h += `<div class="nlabel">Now</div>
        <div class="ntitle" style="${f.color ? `--c:${f.color}` : ''}">${esc(f.title)}</div>
        <div class="nmeta">${hhmm(b.s)}–${hhmm(b.e)} · ${dur(b.e - now)} left</div>
        <div class="nbar"><span style="width:${pct}%"></span></div>`;
    } else if (upcoming.length) {
      h += `<div class="nlabel">Nothing on right now</div>
        <div class="ntitle quiet">Free for ${dur(upcoming[0].s - now)}</div>`;
    } else {
      h += `<div class="nlabel">Nothing on right now</div>
        <div class="ntitle quiet">That’s the day</div>`;
    }

    if (upcoming.length) {
      const n = upcoming[0];
      const f = face(n);
      h += `<div class="nnext"><span class="nlabel">Next in ${dur(n.s - now)}</span>
        <span class="nnexttitle">${esc(f.title)}</span>
        <span class="nnexttime">${hhmm(n.s)}–${hhmm(n.e)}</span></div>`;
    }
    return h + '</section>';
  }

  function todayHTML() {
    const d = new Date();
    const di = dayIndex(d);
    const now = d.getHours() * 60 + d.getMinutes();
    const today = forDay(di);
    const current = currentBlock(today, now);
    /* Every block lands in exactly one of these. A block that has started but
       did not win the Now card -- a trip running under everything else -- is
       still running, and listing it as upcoming showed a start time that had
       already passed. */
    const running = today.filter((b) => b.s <= now && b.e > now && b !== current);
    const later = today.filter((b) => b.s > now);
    const earlier = today.filter((b) => b.e <= now);

    let h = nowCardHTML(today, now, current);
    if (running.length) {
      h += '<section class="rows"><h2>Also on now</h2>' + running.map((b) => rowHTML(b, now)).join('') + '</section>';
    }
    if (later.length) {
      h += '<section class="rows"><h2>Still to come</h2>' + later.map((b) => rowHTML(b, now)).join('') + '</section>';
    }
    if (earlier.length) {
      h += '<section class="rows earlier"><h2>Earlier today</h2>' + earlier.map((b) => rowHTML(b, now)).join('') + '</section>';
    }
    if (!today.length) h += '<section class="rows"><p class="empty">Nothing scheduled today.</p></section>';
    return h + metersHTML() + historyHTML();
  }

  /* ---------- Week view ---------- */

  function gridBlockHTML(b) {
    const f = face(b);
    const top = ((b.s - GRID_START) / 60) * HOUR_PX + 1;
    const height = ((b.e - b.s) / 60) * HOUR_PX - 3;
    const done = !!state.done[b.id];
    const short = b.e - b.s < 60;
    const cls = ['blk', 'k-' + b.kind, short ? 'short' : '', done ? 'is-done' : ''].join(' ');
    const style = `top:${top}px;height:${height}px;${f.color ? `--c:${f.color};` : ''}`;
    const inner = `<span class="t">${esc(f.title)}</span>${f.note && !short ? `<span class="s">${esc(f.note)}</span>` : ''}`;
    if (!b.tickable) return `<div class="${cls}" style="${style}" title="${esc(b.title + (b.note ? ': ' + b.note : ''))}">${inner}</div>`;
    const label = `${f.title}, ${DAYS[b.d]} ${hhmm(b.s)} to ${hhmm(b.e)}${done ? ', done' : ''}`;
    return `<button type="button" class="${cls}" style="${style}" data-id="${b.id}" data-kind="${b.kind}"
      aria-pressed="${done}" aria-label="${esc(label)}">${inner}</button>`;
  }

  function weekHTML() {
    const d = new Date();
    const today = dayIndex(d);
    const now = d.getHours() * 60 + d.getMinutes();
    const span = GRID_END - GRID_START;
    const px = (m) => ((m - GRID_START) / 60) * HOUR_PX;
    const height = (span / 60) * HOUR_PX;

    let h = metersHTML() + `<div class="gridwrap"><div class="grid" style="--h:${HOUR_PX}px">`;
    h += '<div class="corner"></div>';
    DAYS.forEach((name, i) => {
      h += `<div class="dayhead${i === today ? ' today' : ''}"><div class="dn">${name}</div>
        <div class="dd">${i === today ? 'Today' : i < 5 ? 'Campus' : 'Weekend'}</div></div>`;
    });
    h += `<div class="times" style="height:${height}px">`;
    for (let m = GRID_START + 60; m < GRID_END; m += 60) {
      h += `<span style="top:${px(m)}px">${hhmm(m)}</span>`;
    }
    h += '</div>';

    const lightsOut = mins(SCHEDULE.lightsOut);
    for (let d2 = 0; d2 < 7; d2++) {
      const wake = mins(d2 < 5 ? SCHEDULE.wake.weekday : SCHEDULE.wake.weekend);
      h += `<div class="col" style="height:${height}px">`;
      h += `<div class="sleep" style="top:0;height:${px(wake)}px" title="Sleep until ${hhmm(wake)}"></div>`;
      h += `<div class="sleep" style="top:${px(lightsOut)}px;height:${height - px(lightsOut)}px" title="Lights out ${hhmm(lightsOut)}"></div>`;
      const day = forDay(d2);
      day.filter((b) => b.kind === 'trip').forEach((b) => { h += gridBlockHTML(b); });
      day.filter((b) => b.kind !== 'trip').forEach((b) => { h += gridBlockHTML(b); });
      if (d2 === today && now >= GRID_START && now < GRID_END) {
        h += `<div class="nowline" style="top:${px(now)}px"></div>`;
      }
      h += '</div>';
    }
    return h + '</div></div>' + historyHTML();
  }

  /* ---------- shell ---------- */

  function render() {
    const d = new Date();
    const di = dayIndex(d);
    let h = '<div class="wrap"><header class="top">';
    h += `<div class="ident"><div class="date">${LONG[di]} ${d.getDate()} ${MONTHS[d.getMonth()]}</div>
      <div class="term">${esc(SCHEDULE.term)}</div></div>`;
    h += '<div class="types" role="group" aria-label="Week type">';
    WEEK_TYPES.forEach((t) => {
      h += `<button type="button" data-type="${t}" aria-pressed="${state.type === t}">${esc(SCHEDULE.weeks[t].label)}</button>`;
    });
    h += '</div></header>';
    h += `<nav class="views" role="group" aria-label="View">
      <button type="button" data-view="today" aria-pressed="${view === 'today'}">Today</button>
      <button type="button" data-view="week" aria-pressed="${view === 'week'}">Week</button></nav>`;
    h += view === 'today' ? todayHTML() : weekHTML();
    h += `<p class="status" data-status role="status">${esc(status)}</p>`;
    h += '<dialog id="dlg"></dialog></div>';
    const place = takePlace();
    root.innerHTML = h;
    bind();
    putPlace(place);
  }

  /* A render replaces everything under #root, so whatever the browser was
     holding on to goes with it: the week grid's horizontal scroll, and
     keyboard focus. Without this the 60 s tick snaps the grid back to Monday
     and drops focus to <body> mid-tab. */
  const PLACE_ATTRS = ['data-id', 'data-view', 'data-type'];

  function takePlace() {
    const grid = root.querySelector('.gridwrap');
    const active = document.activeElement;
    let focus = '';
    if (active && active !== document.body && root.contains(active)) {
      PLACE_ATTRS.some((a) => {
        const v = active.getAttribute(a);
        if (v === null) return false;
        focus = `[${a}="${v}"]`;
        return true;
      });
    }
    return { left: grid ? grid.scrollLeft : 0, focus };
  }

  function putPlace(place) {
    const grid = root.querySelector('.gridwrap');
    if (grid && place.left) grid.scrollLeft = place.left;
    if (!place.focus) return;
    const el = root.querySelector(place.focus);
    if (el) el.focus({ preventScroll: true });
  }

  function openDeep(id) {
    const b = BY_ID[id];
    const picked = state.slots[id] || '';
    const done = !!state.done[id];
    const dlg = document.getElementById('dlg');
    let h = `<h3>Deep session</h3><p class="when">${LONG[b.d]} ${hhmm(b.s)}–${hhmm(b.e)}</p><div class="opts">`;
    Object.keys(CATS).forEach((k) => {
      h += `<button type="button" data-cat="${k}" style="--c:${CATS[k].color}" aria-pressed="${picked === k}">
        <b>${esc(CATS[k].label)}</b><small>${esc(CATS[k].hint)}</small></button>`;
    });
    h += `<button type="button" data-cat="" style="--c:var(--signal)" aria-pressed="${!picked}">
      <b>Leave open</b><small>Decide on the day</small></button></div>`;
    h += `<div class="dlg-actions"><button type="button" id="dlg-done"${picked ? '' : ' disabled'}>${done ? 'Mark not done' : 'Mark done'}</button>
      <button type="button" class="primary" id="dlg-close">Close</button></div>`;
    dlg.innerHTML = h;
    dialogOpen = true;
    /* Opening and closing without picking anything is not a change, and must
       not bump savedAt or write a state.json for an untouched week. */
    let changed = false;
    dlg.addEventListener('close', () => { dialogOpen = false; render(); if (changed) save(); }, { once: true });
    dlg.querySelectorAll('[data-cat]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const cat = btn.getAttribute('data-cat');
        if (cat !== picked) {
          if (cat) state.slots[id] = cat;
          else { delete state.slots[id]; delete state.done[id]; }
          changed = true;
        }
        dlg.close();
      });
    });
    dlg.querySelector('#dlg-done').addEventListener('click', () => {
      if (!state.slots[id]) return;
      if (state.done[id]) delete state.done[id];
      else state.done[id] = true;
      changed = true;
      dlg.close();
    });
    dlg.querySelector('#dlg-close').addEventListener('click', () => dlg.close());
    if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', '');
  }

  function bind() {
    root.querySelectorAll('[data-type]').forEach((btn) => {
      btn.addEventListener('click', () => { state.type = btn.getAttribute('data-type'); render(); save(); });
    });
    root.querySelectorAll('[data-view]').forEach((btn) => {
      btn.addEventListener('click', () => {
        view = btn.getAttribute('data-view');
        try { localStorage.setItem(KEY + ':view', view); } catch (e) { /* ignore */ }
        render();
      });
    });
    root.querySelectorAll('[data-id]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-id');
        if (btn.getAttribute('data-kind') === 'deep') { openDeep(id); return; }
        if (state.done[id]) delete state.done[id];
        else state.done[id] = true;
        render();
        save();
      });
    });
  }

  /* Render first: the clock has moved on while the tab was hidden, and pull()
     only re-renders when the server happens to have newer state, so without
     this the Now card keeps showing whatever was running at lock time. */
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    if (!dialogOpen) render();
    pull();
  });

  status = 'Tap a deep session to choose what goes in it.';
  render();
  pull();
  setInterval(() => { if (!dialogOpen) render(); }, 60000);
})();
