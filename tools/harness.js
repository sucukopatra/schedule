/* Runs the real app/web/app.js against a fake server and a DOM small enough to
   be honest about what it is.

   app.js renders by writing a string to root.innerHTML and then asking for
   elements to bind, so the stub parses that string back into tags and hands
   out fakes that record their listeners. That is enough to render, read what
   was rendered, and click something. It is not a browser: there is no layout,
   no CSS and no event bubbling, so it can tell you a button's handler did the
   right thing to the state, never that the button was reachable or legible. */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const WEB = path.join(__dirname, '..', 'app', 'web');

/* Handles both `name="value"` and a bare `name`, which is how app.js writes
   data-fill and data-status. */
function parseAttrs(str) {
  const attrs = {};
  const attr = /([a-zA-Z][a-zA-Z0-9-]*)(?:\s*=\s*"([^"]*)")?/g;
  let a;
  while ((a = attr.exec(str))) {
    if (!a[0]) { attr.lastIndex++; continue; }
    attrs[a[1]] = a[2] === undefined ? '' : a[2];
  }
  return attrs;
}

function parseTags(html) {
  const tags = [];
  const tag = /<(button|div|section|nav|span|p)\b([^>]*)>/g;
  let m;
  while ((m = tag.exec(html))) tags.push(parseAttrs(m[2]));
  return tags;
}

/* Only the shapes app.js actually uses: [attr] and [attr="value"]. */
function matches(attrs, selector) {
  const m = /^\[([a-zA-Z][a-zA-Z0-9-]*)(?:="([^"]*)")?\]$/.exec(selector);
  if (!m) return false;
  if (!(m[1] in attrs)) return false;
  return m[2] === undefined || attrs[m[1]] === m[2];
}

module.exports = function drive(opts) {
  const { serverState = null, localState = null, now = null, webDir = WEB } = opts || {};
  const clicks = [].concat(opts && opts.click ? opts.click : []);
  const calls = [];
  const store = {};
  if (localState) store['ender-schedule'] = JSON.stringify(localState);

  let html = '';
  let listeners = [];

  const fake = (attrs) => ({
    attrs,
    getAttribute: (k) => (k in attrs ? attrs[k] : null),
    setAttribute() {}, focus() {}, addEventListener: (ev, fn) => listeners.push({ attrs, ev, fn }),
    set textContent(v) {}, get textContent() { return ''; },
    querySelector: () => null, querySelectorAll: () => [],
  });
  const find = (sel) => parseTags(html).filter((a) => matches(a, sel)).map(fake);

  const root = {
    set innerHTML(v) { html = v; listeners = []; },
    get innerHTML() { return html; },
    querySelector: (sel) => find(sel)[0] || null,
    querySelectorAll: (sel) => find(sel),
    addEventListener() {},
  };

  const FixedDate = now === null ? Date : class extends Date {
    constructor(...args) { if (args.length) super(...args); else super(now); }
    static now() { return now; }
  };

  const ctx = {
    console, JSON, Math, Object, Number, String, Array, Promise, Error, URL,
    Date: FixedDate,
    /* app.js debounces its push by 1.5 s. Fast-forward every timer it sets so
       a debounced save still lands inside the settle window below; otherwise a
       case that saves through save() rather than push() looks like a case that
       never sends anything. */
    setTimeout: (fn, ms) => setTimeout(fn, Math.min(ms || 0, 5)),
    clearTimeout,
    setInterval: () => 0,
    localStorage: {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
    },
    document: {
      getElementById: (id) => (id === 'state'
        ? { textContent: '{"v":3,"type":"normal","slots":{},"done":{}}' } : root),
      addEventListener() {},
      visibilityState: 'visible',
    },
    fetch: (url, o) => {
      const method = (o && o.method) || 'GET';
      calls.push({ url, method, body: o && o.body ? JSON.parse(o.body) : null });
      if (method === 'PUT') return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(null) });
      if (serverState === null) return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve(null) });
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(serverState) });
    },
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(webDir, 'schedule.js'), 'utf8'), ctx);
  vm.runInContext(fs.readFileSync(path.join(webDir, 'app.js'), 'utf8'), ctx);

  const settle = () => new Promise((r) => setTimeout(r, 40));

  return settle().then(() => {
    const missing = [];
    clicks.forEach((sel) => {
      const hit = listeners.filter((l) => l.ev === 'click' && matches(l.attrs, sel));
      if (!hit.length) missing.push(sel);
      else hit[0].fn();
    });
    return settle().then(() => ({
      put: calls.some((c) => c.method === 'PUT'),
      puts: calls.filter((c) => c.method === 'PUT').map((c) => c.body),
      stored: store['ender-schedule'] ? JSON.parse(store['ender-schedule']) : null,
      html,
      text: html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim(),
      missing,
    }));
  });
};
