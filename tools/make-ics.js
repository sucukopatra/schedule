#!/usr/bin/env node
/* Generates app/schedule.ics from schedule.js, so the phone's own calendar can
   do the reminding: a page cannot wake itself while it is closed.
   tools/push-dav.py pushes the result into Radicale at deploy time.

     node tools/make-ics.js            # write app/schedule.ics
     node tools/make-ics.js --check    # exit 1 if the file is out of date

   Like the icons, the .ics is generated and committed rather than built on the
   way out -- but unlike the icons it goes stale every time the timetable
   changes, so check-schedule.js runs check() and the deploy refuses a stale one.

   Times are floating: no TZID, no VTIMEZONE, no UTC offsets. "09:00" means
   nine o'clock wherever the phone is, which is exactly what a class timetable
   means and leaves no DST arithmetic to get wrong. */
'use strict';
const fs = require('fs');
const path = require('path');
const { WEB, pad, loadSchedule, expand, isoWeek, typeForWeek } = require('./lib.js');

const OUT = path.join(WEB, '..', 'schedule.ics');
const BYDAY = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];
const SCHEDULE = loadSchedule();

const ymd = (d) => d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate());
const parseDate = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };

/* RFC 5545: backslash, semicolon, comma and newline are special in text. */
const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');

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
    /* push-dav.py names the collection after this if it has to create it. */
    'X-WR-CALNAME:' + esc(SCHEDULE.term),
  ];

  expand(SCHEDULE).forEach((b) => {
    const { d: di, from, to } = b;

    /* Every date in the term falling on this weekday, split into the ones
       this block applies to and the ones it does not. A block that applies
       to every week type can never be excluded. */
    const on = [];
    const off = [];
    const d = new Date(start);
    while (d.getDay() !== ((di + 1) % 7)) d.setDate(d.getDate() + 1);
    for (; d <= end; d.setDate(d.getDate() + 7)) {
      (b.weeks.indexOf(typeForWeek(SCHEDULE, isoWeek(d))) >= 0 ? on : off).push(new Date(d));
    }
    if (!on.length) return;

    const first = on[0];
    const last = on[on.length - 1];
    const skipped = off.filter((x) => x > first && x < last);

    lines.push('BEGIN:VEVENT');
    lines.push('UID:' + b.id + '@schedule.domatesis.com');
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
    const warn = b.alarm || (SCHEDULE.alarms || {})[b.kind];
    if (warn) {
      lines.push('BEGIN:VALARM');
      lines.push('ACTION:DISPLAY');
      lines.push('DESCRIPTION:' + esc(b.title));
      lines.push('TRIGGER:-PT' + warn + 'M');
      lines.push('END:VALARM');
    }
    lines.push('END:VEVENT');
  });

  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}

/* -> [ok, message]. check-schedule.js runs this, so a stale feed blocks the deploy. */
function check() {
  const current = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : null;
  if (current === build()) return [true, '  ok   schedule.ics is up to date'];
  return [false, current === null
    ? '  ERROR: app/schedule.ics does not exist -- run: node tools/make-ics.js'
    : '  ERROR: app/schedule.ics is out of date -- run: node tools/make-ics.js'];
}

module.exports = { build, check };

if (require.main === module) {
  if (process.argv.indexOf('--check') >= 0) {
    const [ok, msg] = check();
    console.log(msg);
    process.exit(ok ? 0 : 1);
  }
  const ics = build();
  fs.writeFileSync(OUT, ics);
  const events = (ics.match(/BEGIN:VEVENT/g) || []).length;
  const alarms = (ics.match(/BEGIN:VALARM/g) || []).length;
  console.log(`wrote app/schedule.ics: ${events} events, ${alarms} alarms, ${ics.length} bytes`);
}
