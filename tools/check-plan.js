#!/usr/bin/env node
/* The deep-session plan line and its "Fill to targets" button.

     node tools/check-plan.js        # exits 1 if any case is wrong

   Every week type has exactly as many deep slots as category targets, so the
   plan line is the only thing that tells you a week has already stopped adding
   up -- and the only thing standing between a misassigned slot and finding out
   on Sunday. Its branches are worth pinning down. */
'use strict';
const drive = require('./harness.js');
const { isoWeek } = require('./lib.js');

/* Normal weeks hold six deep slots: Tue 16:00, Wed 14:00, Thu 16:00, and
   Fri 08:15, 12:30 and 16:00, against targets of 3 coursework, 2 software
   and 1 chess. Monday 08:00 is before all of them, Sunday 23:00 after. */
const MON = new Date(2026, 8, 21, 8, 0);   // Mon 21 Sep 2026
const SUN = new Date(2026, 8, 27, 23, 0);  // Sun 27 Sep 2026
const WEEK = isoWeek(MON);

const st = (slots, when) => ({
  serverState: { v: 3, week: WEEK, type: 'normal', slots, done: {}, history: [], savedAt: 5000 },
  now: (when || MON).getTime(),
});
const full = { 'deep-Tue-16:00': 'coursework', 'deep-Wed-14:00': 'coursework', 'deep-Thu-16:00': 'coursework',
               'deep-Fri-08:15': 'software', 'deep-Fri-12:30': 'software', 'deep-Fri-16:00': 'chess' };
const ALL = Object.keys(full);

const CASES = [
  { name: 'nothing assigned yet',
    run: () => drive(st({})),
    says: '6 open sessions left · still needs 3 Coursework, 2 Software project, 1 Chess study.',
    button: true },
  { name: 'partly assigned',
    run: () => drive(st({ 'deep-Tue-16:00': 'coursework', 'deep-Wed-14:00': 'chess' })),
    says: '4 open sessions left · still needs 2 Coursework, 2 Software project.',
    button: true },
  { name: 'one left, one needed (singular)',
    run: () => drive(st({ ...full, 'deep-Fri-16:00': undefined })),
    says: '1 open session left · still needs 1 Chess study.',
    button: true },
  { name: 'fully assigned and adding up',
    run: () => drive(st(full)),
    says: 'Every deep session is spoken for, and the targets add up.',
    button: false },
  { name: 'assigned, but one category over at another\'s expense',
    run: () => drive(st({ ...full, 'deep-Fri-16:00': 'coursework' })),
    says: 'Every session is assigned, but the week is still short 1 Chess study — something else has one too many.',
    button: false },
  { name: 'slots went by unassigned (Sunday night)',
    run: () => drive(st({ 'deep-Tue-16:00': 'coursework' }, SUN)),
    says: 'Nothing left to assign · still short 2 Coursework, 2 Software project, 1 Chess study, and 5 sessions went by unassigned.',
    button: false },
  { name: 'exam week: paused categories are not asked for',
    run: () => drive({ serverState: { v: 3, week: WEEK, type: 'exam', slots: {}, done: {}, history: [], savedAt: 5000 },
                       now: MON.getTime() }),
    says: '6 open sessions left · still needs 6 Coursework.',
    button: true },
];

/* Clicking Fill to targets has to leave the week adding up, and has to be
   deterministic: the earliest free slot goes to the first meter on the page. */
const FILL = [
  { name: 'fill from empty', slots: {},
    want: { 'deep-Tue-16:00': 'coursework', 'deep-Wed-14:00': 'coursework', 'deep-Thu-16:00': 'coursework',
            'deep-Fri-08:15': 'software', 'deep-Fri-12:30': 'software', 'deep-Fri-16:00': 'chess' } },
  { name: 'fill around what is already chosen', slots: { 'deep-Tue-16:00': 'chess', 'deep-Thu-16:00': 'software' },
    want: { 'deep-Tue-16:00': 'chess', 'deep-Thu-16:00': 'software', 'deep-Wed-14:00': 'coursework',
            'deep-Fri-08:15': 'coursework', 'deep-Fri-12:30': 'coursework', 'deep-Fri-16:00': 'software' } },
];

(async () => {
  let bad = 0;
  for (const c of CASES) {
    const r = await c.run();
    const fails = [];
    if (r.text.indexOf(c.says) < 0) {
      const line = (/(\d+ open session[^<]*|Every [^<]*|Nothing left[^<]*)/.exec(r.text) || [])[0];
      fails.push(`said "${line || '(no plan line)'}"\n              want "${c.says}"`);
    }
    const hasButton = r.html.indexOf('data-fill') >= 0;
    if (hasButton !== c.button) fails.push(`button ${hasButton ? 'shown' : 'absent'}, expected ${c.button ? 'shown' : 'absent'}`);
    if (fails.length) { bad++; console.log(`  FAIL ${c.name}\n       ${fails.join('\n       ')}`); }
    else console.log(`  ok   ${c.name}`);
  }

  for (const f of FILL) {
    const r = await drive({ ...st(f.slots), click: '[data-fill]' });
    const fails = [];
    if (r.missing.length) fails.push('no Fill button to click');
    const got = (r.stored || {}).slots || {};
    ALL.forEach((id) => {
      if (got[id] !== f.want[id]) fails.push(`${id} -> ${got[id]}, expected ${f.want[id]}`);
    });
    if (!r.put) fails.push('the fill was not saved');
    /* Whatever it produced must leave a week that adds up. */
    const after = await drive(st(got));
    if (after.text.indexOf('the targets add up') < 0) fails.push('the filled week still does not add up');
    if (fails.length) { bad++; console.log(`  FAIL ${f.name}\n       ${fails.join('\n       ')}`); }
    else console.log(`  ok   ${f.name} -- and the result adds up`);
  }

  console.log(bad ? `\n${bad} plan case(s) failed` : `\nall ${CASES.length + FILL.length} plan cases correct`);
  process.exit(bad ? 1 : 0);
})();
