#!/usr/bin/env node
/* Sync behaviour, checked by running the real app/web/app.js against a fake
   server. app.js needs a DOM, but only barely: render() writes innerHTML and
   then asks for elements, so stubs that answer "nothing" are enough to drive
   the whole load -> pull -> push path.

     node tools/check-sync.js             # exits 1 if any case is wrong
     node tools/check-sync.js other/web   # check a copy of web/ instead

   The case that matters is B. pull() used to push only when the server had no
   state at all, so edits made offline were stranded while the status line said
   "Synced", until another device saved and quietly won. E and F are the other
   half of the contract: a page where nothing was ticked must never write a
   state.json. */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const WEB = process.argv[2] || path.join(__dirname, '..', 'app', 'web');

function isoWeekNow() {
  const d = new Date();
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  const jan1 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return t.getUTCFullYear() + '-W' + String(Math.ceil(((t - jan1) / 86400000 + 1) / 7)).padStart(2, '0');
}

function drive({ serverState, localState }) {
  const calls = [];
  const store = {};
  if (localState) store['ender-schedule'] = JSON.stringify(localState);

  const stub = { set innerHTML(v) {}, get innerHTML() { return ''; },
                 querySelector: () => null, querySelectorAll: () => [],
                 textContent: '', addEventListener() {} };
  const ctx = {
    console, Date, JSON, Math, Object, Number, String, Array, Promise, Error, URL,
    setTimeout, clearTimeout, setInterval: () => 0,
    localStorage: {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
    },
    document: {
      getElementById: (id) => (id === 'state'
        ? { textContent: '{"v":2,"type":"normal","slots":{},"done":{}}' } : stub),
      addEventListener() {},
      visibilityState: 'visible',
    },
    fetch: (url, opts) => {
      const method = (opts && opts.method) || 'GET';
      calls.push({ url, method });
      if (method === 'PUT') return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(null) });
      if (serverState === null) return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve(null) });
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(serverState) });
    },
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(WEB, 'schedule.js'), 'utf8'), ctx);
  vm.runInContext(fs.readFileSync(path.join(WEB, 'app.js'), 'utf8'), ctx);

  // Let the fetch promise chain settle.
  return new Promise((res) => setTimeout(() => res({
    put: calls.some((c) => c.method === 'PUT'),
    stored: store['ender-schedule'] ? JSON.parse(store['ender-schedule']) : null,
  }), 60));
}

const W = isoWeekNow();
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

(async () => {
  let bad = 0;
  for (const c of CASES) {
    const got = await drive(c.state);
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
    if (fails.length) { bad++; console.log(`  FAIL ${c.name}\n       ${fails.join('\n       ')}`); }
    else console.log(`  ok   ${c.name}  -- ${c.why}`);
  }
  console.log(bad ? `\n${bad} sync case(s) failed` : `\nall ${CASES.length} sync cases correct`);
  process.exit(bad ? 1 : 0);
})();
