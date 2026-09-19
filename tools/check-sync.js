#!/usr/bin/env node
/* Sync behaviour, checked by running the real app/web/app.js against a fake
   server through tools/harness.js.

     node tools/check-sync.js             # exits 1 if any case is wrong
     node tools/check-sync.js other/web   # check a copy of web/ instead

   The case that matters is B. pull() used to push only when the server had no
   state at all, so edits made offline were stranded while the status line said
   "Synced", until another device saved and quietly won. E and F are the other
   half of the contract: a page where nothing was ticked must never write a
   state.json. */
'use strict';
const drive = require('./harness.js');
const webDir = process.argv[2] || undefined;

function isoWeekNow() {
  const d = new Date();
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  const jan1 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return t.getUTCFullYear() + '-W' + String(Math.ceil(((t - jan1) / 86400000 + 1) / 7)).padStart(2, '0');
}

const W = isoWeekNow();
/* The ISO week before this one, for the roll cases. */
function isoWeekBack(n) {
  const d = new Date();
  d.setDate(d.getDate() - 7 * n);
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  const jan1 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return t.getUTCFullYear() + '-W' + String(Math.ceil(((t - jan1) / 86400000 + 1) / 7)).padStart(2, '0');
}
const LAST = isoWeekBack(1);
const base = { v: 2, week: W, type: 'normal', slots: {}, done: {} };
const OLD = { ...base, savedAt: 1000 };
const MINE = { ...base, done: { 'gym-Thu-18:15': true }, savedAt: 9000 };
const AHEAD = { ...MINE, savedAt: 99000 };

const CASES = [
  { name: 'A. server empty, this device has work', state: { serverState: null, localState: MINE },
    put: true, why: 'nothing on the server yet, so send it' },
  { name: 'B. offline edits, server holds an OLDER state', state: { serverState: OLD, localState: MINE },
    put: true, why: 'the regression: this used to stay silent and strand the work' },
  { name: 'C. server is ahead', state: { serverState: AHEAD, localState: OLD },
    put: false, savedAt: 99000, why: 'adopt the server copy, send nothing' },
  { name: 'D. in step with the server', state: { serverState: MINE, localState: MINE },
    put: false, why: 'nothing to say' },
  { name: 'E. fresh page, nothing ticked, server empty', state: { serverState: null, localState: null },
    put: false, why: 'must not create a state.json for an untouched week' },
  { name: 'F. fresh page, nothing ticked, server has state', state: { serverState: MINE, localState: null },
    put: false, savedAt: 9000, why: 'take the server copy, write nothing back' },
  { name: 'G. state naming blocks that no longer exist',
    state: { serverState: { ...base, savedAt: 50000,
                            slots: { 'deep-Thu-16:00': 'chess', 'deep-Mon-03:00': 'chess', 'gym-Thu-18:15': 'chess' },
                            done: { 'gym-Thu-18:15': true, 'class-Mon-09:00': true, 'nope-Xxx-00:00': true } },
             localState: null },
    put: false, slots: { 'deep-Thu-16:00': 'chess' }, done: { 'gym-Thu-18:15': true },
    why: 'keep only keys that still name a real block of the right kind' },
];

/* A finished week, as v2 wrote it: no history field at all. gym-Thu-18:15 and
   gym-Tue-19:30 ticked is 2 of a target of 3; German ticked once of the 6 on
   the timetable. */
const FINISHED_V2 = {
  v: 2, week: LAST, type: 'normal',
  slots: { 'deep-Thu-16:00': 'coursework' },
  done: { 'gym-Thu-18:15': true, 'gym-Tue-19:30': true, 'deep-Thu-16:00': true, 'habit-Mon-07:45': true },
  savedAt: 7000,
};

CASES.push(
  { name: 'H. v2 state from a finished week rolls into history',
    state: { serverState: FINISHED_V2, localState: null },
    put: true, week: W, done: {}, type: 'normal',
    history: [{ week: LAST, gym: [2, 3], coursework: [1, 3], german: [1, 7] }],
    why: 'the week is recorded before its ticks are cleared, and the roll is saved' },
  { name: 'I. same week as stored, nothing rolls',
    state: { serverState: { ...FINISHED_V2, week: W }, localState: null },
    put: false, week: W, history: [],
    why: 'no roll, so no history entry and nothing to send' },
  { name: 'J. a v2 state with no history migrates to an empty one',
    state: { serverState: { ...FINISHED_V2, week: W }, localState: null },
    put: false, history: [], v: 3,
    why: 'v2 never recorded history, so migrating is just defaulting it' },
  { name: 'K. junk history entries are dropped',
    state: { serverState: { ...FINISHED_V2, week: W, history: [
      { week: '2026-W30', type: 'normal', meters: { gym: [2, 3] } },
      { nope: true }, 'garbage', null,
      { week: '2026-W31', type: 'normal', meters: { gym: 'not a pair', chess: [1, 1] } },
    ] }, localState: null },
    put: false, historyWeeks: ['2026-W30', '2026-W31'],
    why: 'unrecognised entries degrade away rather than breaking the page' },
);

(async () => {
  let bad = 0;
  for (const c of CASES) {
    const got = await drive({ ...c.state, webDir });
    const fails = [];
    if (got.put !== c.put) fails.push(`PUT ${got.put ? 'was' : 'was not'} issued, expected ${c.put ? 'it' : 'none'}`);
    if ('savedAt' in c && (!got.stored || got.stored.savedAt !== c.savedAt)) {
      fails.push(`savedAt ${got.stored && got.stored.savedAt}, expected ${c.savedAt}`);
    }
    if (c.put === false && c.name.startsWith('E') && got.stored) fails.push('wrote to localStorage, expected nothing');
    for (const key of ['slots', 'done']) {
      if (!c[key]) continue;
      const got_ = JSON.stringify((got.stored || {})[key]);
      const want = JSON.stringify(c[key]);
      if (got_ !== want) fails.push(`${key} ${got_}, expected ${want}`);
    }
    for (const key of ['week', 'type', 'v']) {
      if (!(key in c)) continue;
      if (!got.stored || got.stored[key] !== c[key]) fails.push(`${key} ${got.stored && got.stored[key]}, expected ${c[key]}`);
    }
    if (c.historyWeeks) {
      const got_ = JSON.stringify((got.stored.history || []).map((e) => e.week));
      if (got_ !== JSON.stringify(c.historyWeeks)) fails.push(`history weeks ${got_}, expected ${JSON.stringify(c.historyWeeks)}`);
    }
    if (c.history) {
      const h = (got.stored || {}).history || [];
      if (h.length !== c.history.length) fails.push(`${h.length} history entries, expected ${c.history.length}`);
      else c.history.forEach((want, i) => {
        if (h[i].week !== want.week) fails.push(`history[${i}].week ${h[i].week}, expected ${want.week}`);
        Object.keys(want).forEach((k) => {
          if (k === 'week') return;
          const got_ = JSON.stringify(h[i].meters[k]);
          if (got_ !== JSON.stringify(want[k])) fails.push(`history[${i}].meters.${k} ${got_}, expected ${JSON.stringify(want[k])}`);
        });
      });
    }
    if (fails.length) { bad++; console.log(`  FAIL ${c.name}\n       ${fails.join('\n       ')}`); }
    else console.log(`  ok   ${c.name}  -- ${c.why}`);
  }
  console.log(bad ? `\n${bad} sync case(s) failed` : `\nall ${CASES.length} sync cases correct`);
  process.exit(bad ? 1 : 0);
})();
