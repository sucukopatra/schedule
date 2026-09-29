#!/usr/bin/env node
/* Sync behaviour, checked by running the real app/web/app.js against a fake
   server through tools/harness.js.

     node tools/check-sync.js             # exits 1 if any case is wrong
     node tools/check-sync.js other/web   # check a copy of web/ instead

   The case that matters most is B: edits made offline must reach the server
   once it is back, even when the server holds an older state, rather than sit
   on one device under a status line saying "Synced". E and F are the other
   half of the contract: a page where nothing was ticked must never write a
   state.json. */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const drive = require('./harness.js');
const webDir = process.argv[2] || undefined;

/* Every case runs at a fixed moment, in a week the real schedule.js leaves
   normal, so the roll cases pass the same way in an exam week. */
const NOW = new Date(2026, 8, 23, 12, 0).getTime();   // Wed 23 Sep 2026
const W = '2026-W39';
const LAST = '2026-W38';

/* The real schedule.js claims only exam weeks, and W is not one of them. To
   see a roll pick up a claimed week, build a copy that claims W. Appending
   beats editing: it does not care how the file is formatted. */
function webClaiming(type, week) {
  const src = webDir || path.join(__dirname, '..', 'app', 'web');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'schedule-check-'));
  ['schedule.js', 'app.js'].forEach((f) => fs.copyFileSync(path.join(src, f), path.join(dir, f)));
  fs.appendFileSync(path.join(dir, 'schedule.js'),
    `\nSCHEDULE.weeks[${JSON.stringify(type)}].isoWeeks = [${JSON.stringify(week)}];\n`);
  return dir;
}

const base = { v: 2, week: W, type: 'normal', slots: {}, done: {} };
const OLD = { ...base, savedAt: 1000 };
const MINE = { ...base, done: { 'gym-Tue-18:30': true }, savedAt: 9000 };
const AHEAD = { ...MINE, savedAt: 99000 };

const CASES = [
  { name: 'A. server empty, this device has work', state: { serverState: null, localState: MINE },
    put: true, why: 'nothing on the server yet, so send it' },
  { name: 'B. offline edits, server holds an OLDER state', state: { serverState: OLD, localState: MINE },
    put: true, why: 'the offline work is pushed, not stranded' },
  { name: 'C. server is ahead', state: { serverState: AHEAD, localState: OLD },
    put: false, savedAt: 99000, why: 'adopt the server copy, send nothing' },
  { name: 'D. in step with the server', state: { serverState: MINE, localState: MINE },
    put: false, why: 'nothing to say' },
  { name: 'E. fresh page, nothing ticked, server empty', state: { serverState: null, localState: null },
    put: false, noLocalWrite: true, why: 'must not create a state.json for an untouched week' },
  { name: 'F. fresh page, nothing ticked, server has state', state: { serverState: MINE, localState: null },
    put: false, savedAt: 9000, why: 'take the server copy, write nothing back' },
  { name: 'G. state naming blocks that no longer exist',
    state: { serverState: { ...base, savedAt: 50000,
                            slots: { 'deep-Thu-16:00': 'chess', 'deep-Mon-03:00': 'chess', 'gym-Tue-18:30': 'chess' },
                            done: { 'gym-Tue-18:30': true, 'class-Mon-09:00': true, 'nope-Xxx-00:00': true } },
             localState: null },
    put: false, slots: { 'deep-Thu-16:00': 'chess' }, done: { 'gym-Tue-18:30': true },
    why: 'keep only keys that still name a real block of the right kind' },
];

/* A finished week, as v2 wrote it: no history field at all. gym-Tue-18:30 and
   gym-Thu-18:30 ticked is 2 of a target of 3; German ticked once of the 7 on
   the timetable. */
const FINISHED_V2 = {
  v: 2, week: LAST, type: 'normal',
  slots: { 'deep-Thu-16:00': 'coursework' },
  done: { 'gym-Tue-18:30': true, 'gym-Thu-18:30': true, 'deep-Thu-16:00': true, 'habit-Mon-07:45': true },
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
    const got = await drive({ ...c.state, now: NOW, webDir });
    const fails = [];
    if (got.put !== c.put) fails.push(`PUT ${got.put ? 'was' : 'was not'} issued, expected ${c.put ? 'it' : 'none'}`);
    if ('savedAt' in c && (!got.stored || got.stored.savedAt !== c.savedAt)) {
      fails.push(`savedAt ${got.stored && got.stored.savedAt}, expected ${c.savedAt}`);
    }
    if (c.noLocalWrite && got.stored) fails.push('wrote to localStorage, expected nothing');
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
  /* The real schedule.js names the midterm and finals weeks, so check those
     dates are actually picked up rather than only the mechanism. */
  const DATES = [
    ['N. a midterm week, from the real schedule.js', new Date(2026, 10, 3), '2026-W45', 'exam'],
    ['O. a finals week, from the real schedule.js', new Date(2026, 11, 15), '2026-W51', 'exam'],
    ['P. an ordinary teaching week', new Date(2026, 10, 10), '2026-W46', 'normal'],
  ];
  for (const [label, when, week, want] of DATES) {
    const r = await drive({
      serverState: { ...FINISHED_V2, week: '2026-W40', type: 'trip' },
      now: when.getTime(), webDir,
    });
    const got = r.stored || {};
    if (got.week === week && got.type === want) console.log(`  ok   ${label} -- ${week} is ${want}`);
    else { bad++; console.log(`  FAIL ${label}\n       ${got.week} / ${got.type}, expected ${week} / ${want}`); }
  }

  /* Rolling into a week the calendar claims picks that type up; rolling into
     one nothing claims goes back to normal. */
  const ROLLS = [
    ['L. rolls into a week the calendar claims', webClaiming('exam', W), 'exam'],
    ['M. rolls into a week nothing claims', undefined, 'normal'],
  ];
  for (const [label, dir, want] of ROLLS) {
    const r = await drive({ serverState: { ...FINISHED_V2, type: 'trip' }, now: NOW, webDir: dir || webDir });
    if (r.stored && r.stored.type === want) console.log(`  ok   ${label} -- type is ${want}`);
    else { bad++; console.log(`  FAIL ${label}\n       type ${r.stored && r.stored.type}, expected ${want}`); }
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }

  console.log(bad ? `\n${bad} sync case(s) failed` : `\nall ${CASES.length + DATES.length + ROLLS.length} sync cases correct`);
  process.exit(bad ? 1 : 0);
})();
