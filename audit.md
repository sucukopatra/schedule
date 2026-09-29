# audit

Simplification audit, 2026-09-29. Nothing was changed; this is a list of
candidates, highest value first. Line numbers are as of `45b4b97`.

The code is already small (about 1,900 lines of code plus about 1,000 of docs)
and mostly tidy. The wins fall into three groups: the same logic written in
several files, docs that no longer match the code, and a few dead bits. None
of the suggestions below changes behaviour unless it says so.

## Tasks

Each task is small enough to land and check by itself. After every task, all
four checks in `tools/` must still pass. References like (§3) point to the
findings below.

### Mechanical cleanups, no behaviour change

- [x] **T1** Stop tracking `tools/__pycache__/` and add `__pycache__/` to `.gitignore` (§3)
- [x] **T2** Delete the unused `SCHEDULE.tagline` (§3)
- [x] **T3** Remove the dead `getElementById('state')` branch from `harness.js` (§3)
- [x] **T4** CSS: merge the dark tokens into one block, drop the reduced-motion rule, drop the no-op `.hcell.miss` rule (§3)
- [x] **T5** `make-ics.js`: escape `;` properly (§5; the output stays identical today)
- [x] **T6** `push-dav.py`: use `urljoin`, drop the unused `quiet` argument and `put()` return values (§3)
- [x] **T7** `push-dav.py`: take the collection title from the feed's `X-WR-CALNAME` and remove `--title` (§3)
- [x] **T8** `check-sync.js`: pinned to a fixed date in place of both `isoWeek` copies, a real flag in place of the `startsWith('E')` test, no hard-coded `+ 5`, fix the stale comment (§4, §2). See *Found while working* for the bug this fixed.
- [x] **T9** `check-plan.js`: derive `ALL` from `full` (§4)

### Sharing code between the tools

- [x] **T10** Add `tools/lib.js` (`loadSchedule`, `expand`, `isoWeek`, `typeForWeek`, `mins`, `hhmm`, `DAYS`, `TICKABLE`) and use it in `check-schedule.js`, `make-ics.js`, `check-plan.js` and `check-sync.js` (§1.1–1.3)
- [x] **T11** `make-ics.js` exports `build()`, so `check-schedule.js` calls it directly instead of spawning a process (§1.3)
- [x] **T12** A check that the block ids `app.js` generates match `lib.expand()` (§1.1)

### `app.js`

- [x] **T13** One `METERS` list used by `counts`, `snapshot`, `metersHTML` and `historyHTML` (§1.4)
- [x] **T14** Small helpers: `inWeek(type)`, `clock()`, `shortWeek()`, `toggleDone()`, and a `refresh()` that does the `dialogOpen` guard (§1.5)
- [x] **T15** One row renderer shared by Today and Tomorrow, one Today section loop (§1.5)

### Docs

- [x] **T16** `DEPLOYMENT.md`: replace the old `schedule-deploy` block, fix "three scripts", move the view line to *Views*, update the server layout, drop the embedded-state paragraph and the event counts (§2)
- [x] **T17** Fix "both lists ship empty" in `DEPLOYMENT.md`, `todo.md` and `check-sync.js`; fix the fold comment in `push-dav.py`; fix the stale "Worth knowing" entries in `todo.md`; update the example ids (§2)

### Found while working

- **`check-sync.js` would have failed in every exam week.** The roll cases
  followed the real clock and expected the new week to be `normal`, but
  W44, W45 and W50–52 are exam weeks. Fixed in T8 by pinning the whole file to
  2026-W39.
- **A save conflict (409) could wipe the deep-session dialog.** It re-rendered
  without the `dialogOpen` guard the other paths have. Fixed in T14:
  everything that re-renders on its own now goes through `refresh()`.
- **New task T18:** rows get a `past` class that `style.css` never styles.
  Either style it or stop emitting it.

- [ ] **T18** Style `.row.past` or drop the class from `rowHTML`

### How T13–T15 were verified

The harness can't open the dialog, and it isn't a browser. So on top of the
four checks, the committed and the new `app.js` were each rendered 72 ways
(6 moments × 3 week types × 2 views × 2 states) and diffed. The output
matched apart from whitespace between flex items in the Tomorrow rows, which
doesn't render. Clicks on ticks, week types, views and *Fill to targets*
behaved the same. Still worth looking at once in a real browser.

### Needs your decision first

- [ ] **D1** Auth: does `server.py`'s "put auth in front" or `DEPLOYMENT.md`'s "no auth, by design" win?
- [ ] **D2** Cut `todo.md` down to its open items?
- [ ] **D3** Delete `schedules.md`?
- [ ] **D4** Drop the subscribe-by-URL route (§6)?
- [ ] **D5** Drop the interactive credential prompt in `push-dav.py`?
- [ ] **D6** Have `deploy.sh` run all four checks, not just `check-schedule.js`?
- [ ] **D7** Trim the comments that tell the story of past bugs?

## 1. Duplicated logic

### 1.1 Block expansion is written three times

Turning `SCHEDULE.blocks` into one block per day, with the id
`kind-Day-HH:MM`, is done separately in:

- `app/web/app.js:41-62`
- `tools/check-schedule.js:42-57` (its comment says "Expand exactly the way app.js does")
- `tools/make-ics.js:92-116`

The id recipe matters more than anything else in the project. It is the tick
key in `state.json`, the `UID` in `schedule.ics`, and the CalDAV resource name
on the phone. If one copy drifts, ticks get lost or duplicate events show up,
and none of the checks compares the three copies.

**Suggestion:** a `tools/lib.js` shared by the Node tools, holding
`loadSchedule()`, `expand()`, `isoWeek()`, `typeForWeek()`, `mins()`, `hhmm()`,
`DAYS` and `TICKABLE`. `app.js` has to stay standalone because there is no
build step, so add one check that runs `app.js` through the harness and
confirms its ids match `lib.expand()`. That brings it down to two copies, one
of which is checked against the other.

### 1.2 `isoWeek()`: five copies

- `app/web/app.js:31`
- `tools/make-ics.js:37`
- `tools/check-plan.js:13` (`isoWeekOf`)
- `tools/check-sync.js:33` (`isoWeekNow`) and `tools/check-sync.js:43`
  (`isoWeekBack`). These two sit in the same file, and `isoWeekBack(0)`
  already is `isoWeekNow()`.

It is the fiddliest function in the repo. `todo.md` records it being checked
against 16 dates and 400 days, and only one of the five copies got that check.
It belongs in `lib.js` (1.1).

### 1.3 Other small duplicates across files

- `typeForWeek()`: `app.js:75` and `make-ics.js:45`.
- Loading `schedule.js` through `vm`: `check-schedule.js:20-24`,
  `make-ics.js:27-30` and `harness.js`.
- `mins`/`hhmm`/`DAYS`/`TICKABLE`: `app.js:6-23` and `check-schedule.js:26-31`.
  `KINDS` exists only in `check-schedule.js`.
- `check-schedule.js:148-153` runs `make-ics.js --check` as a child process,
  and re-requires `path` even though it is already imported. If `make-ics.js`
  exported `build()`, this would be a function call.

### 1.4 The meter list is built four times inside `app.js`

"Every category, then gym, then each habit meter" is spelled out in:

- `counts()`: `app.js:247-249`
- `snapshot()`: `app.js:270-274`
- `metersHTML()`: `app.js:309-311`
- `historyHTML()`: `app.js:379-381`

Each copy hard-codes gym's label and colour (`'Gym'`, `'var(--gym)'`).
**Suggestion:** build one `METERS` array at startup, with
`{ key, label, color, target(type, counts) }` per meter. All four functions
then loop over it, and adding a meter becomes a single edit. This is the
biggest simplification available inside `app.js`.

### 1.5 Smaller repeats inside `app.js`

- `BLOCKS.filter((b) => b.weeks.indexOf(type) >= 0)` appears three times:
  `forWeek` at 67, `counts` at 251 and `tomorrowHTML` at 466. It could be an
  `inWeek(type)` helper.
- `dayIndex(d)` plus `d.getHours() * 60 + d.getMinutes()` is recomputed in
  `plan` (323-325), `todayHTML` (483-485), `weekHTML` (528-530) and `render`.
  One `clock()` returning `{ di, now }` would cover all four.
- The row markup is written twice: `rowHTML` (406-419) and `tomorrowHTML`
  (474-477). Also, `rowHTML` and `gridBlockHTML` (512-525) repeat the same
  "button if tickable, otherwise div, plus aria-label" logic.
- `todayHTML` (497-505) has three identical "section with heading and rows"
  appends. They could be one loop over `[heading, blocks, class]`.
- `w.week.replace(/^\d+-/, '')` appears four times in `historyHTML`
  (391, 399-400).
- The "toggle done" code appears twice (651-652 and 689-690).
- `if (!dialogOpen) render()` is guarded at three call sites (187, 702, 709).
  Putting the guard inside a `refresh()` would cover all of them.

## 2. Docs that no longer match the code

These are the most urgent items. A wrong doc costs more than a long one.

- **`DEPLOYMENT.md:447-478` describes the old deploy.** It shows a
  `schedule-deploy` zsh function using `~/dev/server/schedule` that runs
  `push-dav.py` on the laptop with `~/.netrc`. Two follow-on lines are also
  wrong: "needs a `~/.netrc` entry … or it will stop and prompt on every
  deploy" (474-475), and "which the calendar sidecar runs" (443-444). The real
  `tools/deploy.sh` runs `check-schedule.js` first, rsyncs `push-dav.py`, and
  pushes from inside the container on bmo with the credentials from `.env`.
  The block could be replaced with "read `tools/deploy.sh`", since the script
  is already heavily commented.
- **"Both lists ship empty"**: `DEPLOYMENT.md:365`, `todo.md:253`, and the
  comment at `check-sync.js:20-23` ("the real one deliberately names none").
  `weeks.exam.isoWeeks` has held five weeks since 2026-09-20, and sync cases
  N and O depend on that.
- **Auth.** `server.py:8` says "Put auth in front of it (Caddy basic_auth)".
  `DEPLOYMENT.md:38` says "no auth, by design", and the Caddy block has none.
  One of them should win.
- **`DEPLOYMENT.md:544`** says "Three scripts in `tools/`" and then lists four.
- **`DEPLOYMENT.md:334`** ("The choice is remembered per device…") is about the
  Today/Week view, but it sits under *The plan line*. It belongs under *Views*.
- **`DEPLOYMENT.md:40-60`**: the server layout leaves out `schedule.ics` and the
  `tools/` directory on bmo.
- **`DEPLOYMENT.md:86-91`** explains an embedded-state `<script>` block that
  was removed. That is history, not documentation.
- **Hard-coded event counts go stale.** `push-dav.py:11` and
  `DEPLOYMENT.md:281-285` say 46 events; the feed has 47. Drop the numbers.
- **`push-dav.py:77`** says "The generator never folds a line". That is wrong:
  `make-ics.js:58-73` folds at 75 octets. It is harmless today, because no
  current line is long enough to be folded and continuation lines are kept
  verbatim anyway, but the reasoning in the comment is false.
- **`todo.md:189-202` ("Worth knowing") is out of date:** "4 against 4 on a
  trip" (trip weeks are now 6 slots for 4 targets), and "no overlaps" (Anki now
  sits inside the trip blocks on purpose).
- Example ids use the old gym times (`gym-Mon-19:30`) in `DEPLOYMENT.md:339`,
  `:348` and the `push-dav.py` docstring. This is cosmetic.

### Doc volume

- `todo.md` is 275 lines, and about 230 of them are finished items written up
  as narratives. Those duplicate git history and `DEPLOYMENT.md`; for example,
  `todo.md:163-174` is almost word for word `DEPLOYMENT.md:573-580`. Only
  about five items are open: the lab patterns, habit alarms, the W40 Friday
  08:15 check, the `termStart` guess, and the after-every-edit reminder.
  Cutting it to the open items would make it a working list again.
- `schedules.md`: B was picked and built. A and C are kept "in case B doesn't
  hold up", but git keeps them anyway. Whether to delete it is your call.
- Many code comments tell the story of past bugs ("used to…", "has always
  existed but could never be reached…"): `sw.js:1-8`, `index.html`, much of
  `deploy.sh`, `server.py` `static_file`, and `app.js` 189-193 and 488-491.
  Some of these are guardrails worth keeping, such as the `--force-recreate`
  note in `deploy.sh`. Others are really changelog entries and would sit
  better in commit messages. Low priority, since this is a style choice.

## 3. Dead or no-op code

- **`tools/__pycache__/push-dav.cpython-314.pyc` is committed**, and
  `.gitignore` has no `__pycache__/` entry. This is the easiest fix on the list.
- **`SCHEDULE.tagline`** (`schedule.js:28`) is not read anywhere.
- **`harness.js:93`** has a special case for `getElementById('state')`, left
  over from the embedded-state block that was removed.
- **`style.css:20-27`**: nothing ever sets `data-theme`, so the
  `:root[data-theme="dark"]` block (a verbatim copy of the dark tokens) and the
  `:not([data-theme="light"])` guard at line 11 never take effect. A plain
  `@media (prefers-color-scheme: dark) { :root { … } }` does the same job with
  half the lines. Keep them only if a theme toggle is planned.
- **`style.css:221`** turns transitions off for reduced motion, but the
  stylesheet has no transitions.
- **`style.css:154`**: `.hcell.miss{border-color:var(--line)}` repeats the
  default `.hcell` border.
- `style.css:120` and `:153` use the same hatch gradient, and `.types button`
  and `.views button` (50-61) are near-duplicate segmented controls. These are
  minor.
- **`push-dav.py`:**
  - `sync_once(..., quiet=False)` (line 227): no caller passes `quiet`.
  - `urljoin_host()` (line 192) re-implements `urllib.parse.urljoin`.
  - `put()` returns strings that nothing reads.
  - `die()` (line 62) only wraps `raise DavError`.
  - `--title` defaults to a hard-coded `'Fall 2026'` (line 272), while the feed
    already carries `X-WR-CALNAME`. The script reads that value and throws it
    away (line 89). Using it would remove the flag and one thing to update
    each semester.

## 4. Tests

- `check-sync.js:122` changes what it checks based on
  `c.name.startsWith('E')`. A field such as `noLocalWrite: true` would say
  what it means.
- `check-sync.js:180` hard-codes `CASES.length + 5` for the cases that sit
  outside `CASES`, so it goes wrong as soon as one is added.
- `check-plan.js:26` (`ALL`) is `Object.keys(full)` typed out a second time.
- There is no single command that runs every check. The docs say "run all four
  before a deploy", but `deploy.sh` only runs `check-schedule.js`. Having the
  deploy run all four would remove a step that relies on memory. Whether that
  is worth the extra seconds on each deploy is your call.

## 5. Latent bug found along the way

This is not a simplification, but it turned up while reading.
`make-ics.js:55` escapes semicolons with `'\;'`. In a JS string literal that is
just `';'`, so semicolons in titles and notes are never escaped, which RFC 5545
requires for TEXT values. No current title or note contains a `;`, so the
generated feed is correct today. It needs `'\\;'`.

## 6. Bigger cuts (features, your call)

These remove behaviour, so they are only worth doing if the feature is unused.

- **The subscribe-by-URL route.** If the phone only ever gets events through
  the CalDAV push, then several things exist only for subscription:
  `REFRESH-INTERVAL`/`X-PUBLISHED-TTL` in `make-ics.js` (which `push-dav.py`
  then strips out), serving `schedule.ics` from `app/web/`, the `.ics` entry in
  `server.py` `TYPES`, and the iOS/Google/ICSx⁵ section of `DEPLOYMENT.md`
  (169-184). All of that could go.
- **Interactive credential prompt in `push-dav.py`.** On bmo, only the
  environment variables are used. By hand, `~/.netrc` covers it.

## Not worth touching

- `server.py`: small, correct, and every branch is covered by
  `check-server.sh`.
- `sw.js`: already minimal for network-first with a fonts cache.
- `check-server.sh` and `harness.js`, apart from the dead branch noted above.
