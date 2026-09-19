#!/usr/bin/env node
/* Invariants for the hand-edited timetable in app/web/schedule.js.
   Nothing validates that file at runtime, so a typo shows up as a block with a
   negative height or a habit that silently never reaches a meter. This is the
   thing that catches it.

     node tools/check-schedule.js             # exits 1 if anything is wrong
     node tools/check-schedule.js other.js    # check a copy instead

   Errors are real mistakes. Notes are things worth knowing that are allowed:
   trips are meant to overlap, and a tickable block with no track is meant to
   be tickable without counting. */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

/* schedule.js is a bare `var SCHEDULE = {...}` meant for a <script> tag, so
   run it in a throwaway context and take the global back out. */
const FILE = process.argv[2] || path.join(__dirname, '..', 'app', 'web', 'schedule.js');
const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(FILE, 'utf8'), sandbox);
const SCHEDULE = sandbox.SCHEDULE;

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const TICKABLE = ['deep', 'gym', 'habit', 'review'];
const KINDS = TICKABLE.concat(['class', 'anchor', 'trip', 'light']);
const WEEK_TYPES = Object.keys(SCHEDULE.weeks);
const mins = (s) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
const hhmm = (m) => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
const at = (b) => `${hhmm(b.s)}-${hhmm(b.e)}`;
const GRID_START = mins(SCHEDULE.gridStart);
const GRID_END = mins(SCHEDULE.gridEnd);

const errors = [];
const notes = [];
const err = (...a) => errors.push(a.join(' '));
const note = (...a) => notes.push(a.join(' '));

/* Expand exactly the way app.js does. */
const B = [];
SCHEDULE.blocks.forEach((b) => {
  if (!/^\d\d:\d\d-\d\d:\d\d$/.test(b.at || '')) return err('bad "at":', JSON.stringify(b.at), '-', b.title);
  if (KINDS.indexOf(b.kind) < 0) err('unknown kind:', b.kind, '-', b.title);
  (b.weeks || []).forEach((w) => { if (!SCHEDULE.weeks[w]) err('unknown week type:', w, '-', b.title); });
  const days = b.day === '*' ? DAYS : [].concat(b.day);
  const [from, to] = b.at.split('-');
  days.forEach((name) => {
    if (DAYS.indexOf(name) < 0) return err('unknown day:', name, '-', b.title);
    B.push({
      d: DAYS.indexOf(name), s: mins(from), e: mins(to), kind: b.kind, title: b.title,
      track: b.track || '', weeks: b.weeks || WEEK_TYPES,
      tickable: TICKABLE.indexOf(b.kind) >= 0, id: b.kind + '-' + name + '-' + from,
    });
  });
});

B.forEach((b) => {
  if (b.e <= b.s) err('ends before it starts:', b.id, b.title, at(b));
  if (b.s < GRID_START || b.e > GRID_END) err('outside the grid:', b.id, b.title, at(b));
});

WEEK_TYPES.forEach((t) => {
  const seen = {};
  B.filter((b) => b.weeks.indexOf(t) >= 0).forEach((b) => {
    if (seen[b.id]) err(`duplicate id in ${t} weeks:`, b.id, '-', seen[b.id], '&', b.title);
    seen[b.id] = b.title;
  });
});

/* isoWeeks has to look like an ISO week, and no two types may claim one. */
const claimed = {};
WEEK_TYPES.forEach((t) => {
  const weeks = SCHEDULE.weeks[t].isoWeeks;
  if (weeks === undefined) return;
  if (!Array.isArray(weeks)) return err(`${t}.isoWeeks is not a list`);
  weeks.forEach((w) => {
    if (typeof w !== 'string' || !/^\d{4}-W\d{2}$/.test(w)) return err(`${t}.isoWeeks: ${JSON.stringify(w)} is not an ISO week like 2026-W46`);
    if (claimed[w]) err(`${w} is claimed by both ${claimed[w]} and ${t}`);
    claimed[w] = t;
  });
});
if (SCHEDULE.weeks.normal && SCHEDULE.weeks.normal.isoWeeks) {
  note('normal.isoWeeks is redundant: a week no type claims is already normal');
}

/* A meter exists for every category, for gym, and for each habit meter. */
const meters = new Set([...Object.keys(SCHEDULE.categories), 'gym',
                        ...SCHEDULE.habitMeters.map((m) => m.track)]);
B.forEach((b) => { if (b.track && !meters.has(b.track)) err('track with no meter:', b.id, b.track); });
WEEK_TYPES.forEach((t) => Object.keys(SCHEDULE.weeks[t].targets).forEach((k) => {
  if (!meters.has(k)) err(`${t} targets an unknown meter:`, k);
}));

/* A week you cannot possibly finish is a data mistake, not a hard week. */
WEEK_TYPES.forEach((t) => {
  const deep = B.filter((b) => b.kind === 'deep' && b.weeks.indexOf(t) >= 0).length;
  const need = Object.entries(SCHEDULE.weeks[t].targets)
    .filter(([k]) => SCHEDULE.categories[k]).reduce((a, [, v]) => a + v, 0);
  if (deep < need) err(`${t} weeks are impossible:`, deep, 'deep slots for', need, 'category targets');
  else note(`${t}: ${deep} deep slots for ${need} category targets` + (deep === need ? '  (no slack)' : ''));
  const have = B.filter((b) => b.kind === 'gym' && b.weeks.indexOf(t) >= 0).length;
  const want = SCHEDULE.weeks[t].targets.gym || 0;
  if (have < want) err(`${t} weeks are impossible:`, have, 'gym blocks for a target of', want);
});

WEEK_TYPES.forEach((t) => {
  for (let d = 0; d < 7; d++) {
    const day = B.filter((b) => b.d === d && b.weeks.indexOf(t) >= 0).sort((a, b) => a.s - b.s);
    for (let i = 0; i < day.length; i++) {
      for (let j = i + 1; j < day.length; j++) {
        if (day[j].s < day[i].e) {
          note(`overlap in ${t} ${DAYS[d]}: ${day[i].title} ${at(day[i])} / ${day[j].title} ${at(day[j])}`);
        }
      }
    }
  }
});

B.forEach((b) => {
  if (b.tickable && !b.track && b.kind !== 'deep') note(`tickable but counts toward nothing: ${b.id} (${b.title})`);
});

/* The term dates only feed schedule.ics, but a wrong one there is a calendar
   full of wrong reminders. */
const start = SCHEDULE.termStart;
const end = SCHEDULE.termEnd;
const isDate = (d) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && !isNaN(Date.parse(d));
if (!isDate(start)) err('termStart is not a YYYY-MM-DD date:', JSON.stringify(start));
if (!isDate(end)) err('termEnd is not a YYYY-MM-DD date:', JSON.stringify(end));
if (isDate(start) && isDate(end)) {
  if (Date.parse(start) >= Date.parse(end)) err('termStart is not before termEnd');
  else if (Date.parse(end) < Date.now()) note(`the term ended on ${end}; schedule.ics has nothing left in it`);
}
Object.keys(SCHEDULE.alarms || {}).forEach((k) => {
  if (KINDS.indexOf(k) < 0) err('alarms names an unknown kind:', k);
  else if (!(SCHEDULE.alarms[k] > 0)) err(`alarms.${k} is not a positive number of minutes`);
});

notes.forEach((m) => console.log('  note:', m));
errors.forEach((m) => console.log('  ERROR:', m));
console.log(errors.length ? `\n${errors.length} error(s) in schedule.js` : `\nschedule.js is clean (${B.length} blocks)`);
if (errors.length) process.exit(1);

/* schedule.ics is generated from this file and goes stale the moment it
   changes, so the deploy checks are where that gets caught. */
if (!process.argv[2]) {
  const r = require('child_process').spawnSync(process.execPath,
    [require('path').join(__dirname, 'make-ics.js'), '--check'], { encoding: 'utf8' });
  process.stdout.write(r.stdout || '');
  if (r.status !== 0) process.exit(1);
}
process.exit(0);
