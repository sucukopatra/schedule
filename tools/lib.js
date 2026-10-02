/* What the Node tools share about schedule.js. app.js keeps its own copy of
   the expansion, because the page has no build step; check-schedule.js
   confirms the two still agree on block ids. */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const TICKABLE = ['deep', 'gym', 'habit', 'review'];
const WEB = path.join(__dirname, '..', 'app', 'web');

const pad = (n) => String(n).padStart(2, '0');
const mins = (s) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
const hhmm = (m) => pad(Math.floor(m / 60)) + ':' + pad(m % 60);

/* schedule.js is a bare `var SCHEDULE = {...}` meant for a <script> tag, so
   run it in a throwaway context and take the global back out. */
function loadSchedule(file) {
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(file || path.join(WEB, 'schedule.js'), 'utf8'), sandbox);
  return sandbox.SCHEDULE;
}

const daysOf = (b) => (b.day === '*' ? DAYS : [].concat(b.day));

/* One entry per block per day, in schedule.js order, carrying the id app.js
   ticks and make-ics.js uses as a UID. A day not in DAYS is skipped here and
   reported by check-schedule.js. */
function expand(SCHEDULE) {
  const types = Object.keys(SCHEDULE.weeks);
  const out = [];
  SCHEDULE.blocks.forEach((b) => {
    const [from, to] = b.at.split('-');
    daysOf(b).forEach((day) => {
      const d = DAYS.indexOf(day);
      if (d < 0) return;
      out.push({
        d, day, from, to, s: mins(from), e: mins(to),
        kind: b.kind, title: b.title, note: b.note || '', track: b.track || '',
        weeks: b.weeks || types, isoWeeks: b.isoWeeks || null, tickable: TICKABLE.indexOf(b.kind) >= 0, alarm: b.alarm,
        id: b.kind + '-' + day + '-' + from,
      });
    });
  });
  return out;
}

function isoWeek(d) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  const jan1 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return t.getUTCFullYear() + '-W' + pad(Math.ceil(((t - jan1) / 86400000 + 1) / 7));
}

/* The same rule the page uses: the week's type has to include the block, and
   a block that names its own isoWeeks only happens in those. */
const runs = (b, type, week) => b.weeks.indexOf(type) >= 0 && (!b.isoWeeks || b.isoWeeks.indexOf(week) >= 0);

/* The same rule the page uses: a week no type claims is normal. */
function typeForWeek(SCHEDULE, week) {
  let picked = 'normal';
  Object.keys(SCHEDULE.weeks).forEach((t) => {
    const weeks = SCHEDULE.weeks[t].isoWeeks;
    if (Array.isArray(weeks) && weeks.indexOf(week) >= 0) picked = t;
  });
  return picked;
}

module.exports = { DAYS, TICKABLE, WEB, pad, mins, hhmm, loadSchedule, daysOf, expand, runs, isoWeek, typeForWeek };
