#!/usr/bin/env node
/* Generates app/web/schedule.ics from schedule.js, so the phone's own calendar
   can do the reminding. A subscribed calendar is the one way to be told "gym
   in 15 minutes" while the app is closed without running push infrastructure:
   a page cannot wake itself, and the API that would have let it never shipped.

     node tools/make-ics.js            # write app/web/schedule.ics
     node tools/make-ics.js --check    # exit 1 if the file is out of date

   Like the icons, the .ics is generated and committed rather than built on the
   way out -- but unlike the icons it goes stale every time the timetable
   changes, so check-schedule.js runs --check and the pre-deploy checks catch it.

   Times are floating: no TZID, no VTIMEZONE, no UTC offsets. "09:00" means
   nine o'clock wherever the phone is, which is exactly what a class timetable
   means and leaves no DST arithmetic to get wrong. */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'app', 'web', 'schedule.ics');
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const BYDAY = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];

const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'app', 'web', 'schedule.js'), 'utf8'), sandbox);
const SCHEDULE = sandbox.SCHEDULE;
const WEEK_TYPES = Object.keys(SCHEDULE.weeks);

const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate());
const parseDate = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };

function isoWeek(d) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  const jan1 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return t.getUTCFullYear() + '-W' + pad(Math.ceil(((t - jan1) / 86400000 + 1) / 7));
}

/* The same rule the page uses: a week no type claims is normal. */
function typeForWeek(week) {
  let picked = 'normal';
  WEEK_TYPES.forEach((t) => {
    const weeks = SCHEDULE.weeks[t].isoWeeks;
    if (Array.isArray(weeks) && weeks.indexOf(week) >= 0) picked = t;
  });
  return picked;
}

/* RFC 5545: backslash, semicolon, comma and newline are special in text. */
const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');

/* Content lines are folded at 75 octets, continuations starting with a space. */
function fold(line) {
  const bytes = Buffer.from(line, 'utf8');
  if (bytes.length <= 75) return line;
  const out = [];
  let start = 0;
  let limit = 75;
  while (start < bytes.length) {
    let end = Math.min(start + limit, bytes.length);
    /* Never split a UTF-8 sequence. */
    while (end > start && end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--;
    out.push((start ? ' ' : '') + bytes.slice(start, end).toString('utf8'));
    start = end;
    limit = 74;
  }
  return out.join('\r\n');
}

function build() {
  const start = parseDate(SCHEDULE.termStart);
  const end = parseDate(SCHEDULE.termEnd);
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//schedule//' + esc(SCHEDULE.term) + '//EN',
    'CALSCALE:GREGORIAN',
    /* No METHOD: it belongs on an invitation, and some clients treat a
       subscription carrying one as exactly that. No X-WR-TIMEZONE either,
       because these times are floating and any value there would be a lie. */
    'X-WR-CALNAME:' + esc(SCHEDULE.term),
    /* Ask subscribers to re-poll daily; both spellings, since clients differ. */
    'REFRESH-INTERVAL;VALUE=DURATION:PT12H',
    'X-PUBLISHED-TTL:PT12H',
  ];

  SCHEDULE.blocks.forEach((b) => {
    const days = b.day === '*' ? DAYS : [].concat(b.day);
    const [from, to] = b.at.split('-');
    const applies = b.weeks || WEEK_TYPES;

    days.forEach((name) => {
      const di = DAYS.indexOf(name);
      if (di < 0) return;

      /* Every date in the term falling on this weekday, split into the ones
         this block applies to and the ones it does not. A block that applies
         to every week type can never be excluded. */
      const on = [];
      const off = [];
      const d = new Date(start);
      while (d.getDay() !== ((di + 1) % 7)) d.setDate(d.getDate() + 1);
      for (; d <= end; d.setDate(d.getDate() + 7)) {
        (applies.indexOf(typeForWeek(isoWeek(d))) >= 0 ? on : off).push(new Date(d));
      }
      if (!on.length) return;

      const first = on[0];
      const last = on[on.length - 1];
      const skipped = off.filter((x) => x > first && x < last);
      const id = b.kind + '-' + name + '-' + from;

      lines.push('BEGIN:VEVENT');
      lines.push('UID:' + id + '@schedule.domatesis.com');
      /* Fixed, so regenerating an unchanged timetable produces an identical
         file and --check stays meaningful. */
      lines.push('DTSTAMP:' + ymd(start) + 'T000000Z');
      lines.push('SUMMARY:' + esc(b.title));
      if (b.note) lines.push('DESCRIPTION:' + esc(b.note));
      lines.push('DTSTART:' + ymd(first) + 'T' + from.replace(':', '') + '00');
      lines.push('DTEND:' + ymd(first) + 'T' + to.replace(':', '') + '00');
      lines.push('RRULE:FREQ=WEEKLY;BYDAY=' + BYDAY[di] + ';UNTIL=' + ymd(last) + 'T235959');
      skipped.forEach((x) => {
        lines.push('EXDATE:' + ymd(x) + 'T' + from.replace(':', '') + '00');
      });
      const warn = (SCHEDULE.alarms || {})[b.kind];
      if (warn) {
        lines.push('BEGIN:VALARM');
        lines.push('ACTION:DISPLAY');
        lines.push('DESCRIPTION:' + esc(b.title));
        lines.push('TRIGGER:-PT' + warn + 'M');
        lines.push('END:VALARM');
      }
      lines.push('END:VEVENT');
    });
  });

  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}

const ics = build();
const check = process.argv.indexOf('--check') >= 0;
const current = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : null;

if (check) {
  if (current === ics) { console.log('  ok   schedule.ics is up to date'); process.exit(0); }
  console.log(current === null
    ? '  ERROR: app/web/schedule.ics does not exist -- run: node tools/make-ics.js'
    : '  ERROR: app/web/schedule.ics is out of date -- run: node tools/make-ics.js');
  process.exit(1);
}

fs.writeFileSync(OUT, ics);
const events = (ics.match(/BEGIN:VEVENT/g) || []).length;
const alarms = (ics.match(/BEGIN:VALARM/g) || []).length;
console.log(`wrote app/web/schedule.ics: ${events} events, ${alarms} alarms, ${ics.length} bytes`);
