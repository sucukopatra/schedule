# todo

Working backlog for the weekly timetable. Newest thinking at the top of each
section; tick things off as they land.

## Bugs

### Round 2, found and fixed 2026-09-19 by audit

Not yet deployed to bmo.

- [x] **Offline edits are never pushed back.** *The serious one.* `pull()` only
      pushes when the server has **no** state at all (`s === null`). If the
      server holds an *older* state, `adopt()` returns false, nothing is
      pushed, and the status line says **"Synced"** — while the work sits on
      one device. Proven by driving `app.js` under a DOM shim: server at
      `savedAt: 1000`, local at `9000`, and the only request made is the GET.
      Worse, it diverges silently: open the page on another device, it loads
      the old server state, tick one thing, and that device now has the newest
      `savedAt` — the offline work is gone.
      Shipping the PWA is what made this reachable; before it, the page could
      not load offline at all, so there were no offline edits to lose.
      Fixed: `pull()` now pushes whenever `state.savedAt` is ahead of the
      server's, whatever the server holds, and only says "Synced" when it
      really is. Re-ran the shim across seven scenarios, including the two that
      must stay quiet — a fresh page with nothing ticked still writes no
      `state.json`.
- [x] **A long filename crashes the request.** `static_file` lets any bare name
      through, so `GET /aaaa…400 chars….js` reaches `open()` and raises
      `OSError: [Errno 36] File name too long`, which nothing catches: the
      connection closes with no HTTP response at all, not even a 500.
      Introduced by the `TYPES` change — the old fixed allowlist could never
      reach `open()` with an arbitrary name. Fixed by catching `OSError`, which
      covers missing, is-a-directory and too-long alike. Now a 404.
- [x] **A non-numeric Content-Length crashes the request.** `int(...)` in
      `do_PUT` raises `ValueError` and the client gets no reply. Pre-existing.
      Now a 400.
- [x] **A running block that is not `current` is listed under "Still to
      come".** `later` is `b.e > now && b !== current`, so with two overlapping
      blocks the one that did not win `currentBlock` shows as upcoming with a
      start time in the past. Latent: a check of every week type found zero
      overlaps in today's `schedule.js`, but trips are the designed overlap and
      one long block plus anything else brings it out. Fixed by partitioning
      the day into current / also-running / later / earlier, so every block
      lands in exactly one place; the running ones get an "Also on now"
      heading.
- [x] **`slots` accumulates orphans.** `normalize()` copies `slots` wholesale
      and `rollWeek()` keeps it, so a slot key whose block was moved or deleted
      in `schedule.js` stays in the state for good. Harmless but unbounded.
      Fixed: `normalize()` keeps only keys that still name a real block of the
      right kind, and only categories that exist. Did not need the `v: 3` bump
      after all — it validates the same shape more strictly rather than
      changing it.

### Round 1, fixed 2026-09-19

All three in `app.js`. Deployed to bmo.

- [x] **Stale Now card after unlocking the phone.** `visibilitychange` calls
      `pull()`, which only re-renders when the server has strictly newer state.
      Come back to the tab after an hour and the Now card still shows the block
      that was running when you locked it, with a wrong "left" and a wrong
      progress bar, until the next 60 s tick. Render on visible, then pull.
- [x] **Week grid loses its scroll every minute.** `render()` replaces
      everything under `#root` and the 60 s tick calls it, so a grid scrolled to
      Thursday snaps back to Monday, and keyboard focus drops to `<body>`.
      Save and restore `.gridwrap` scrollLeft and the focused control.
- [x] **The deep-session dialog saves even when nothing changed.** Its `close`
      handler calls `save()` unconditionally, so opening and closing bumps
      `savedAt`, pushes to the server, and creates `state.json` on a page where
      nothing was ticked — which the docs say never happens. Only save on a
      real change.

## Checks

`tools/check-schedule.js`, `tools/check-sync.js` and `tools/check-server.sh`,
added 2026-09-19. Outside `app/`, so never deployed. Run all three before a
deploy. Each was confirmed to fail on a deliberately introduced fault, which is
the only thing that makes a check worth having.

## Worth knowing (checked, not bugs)

- `isoWeek()` is correct, including the year-boundary cases: verified against
  16 known ISO-8601 dates and confirmed to roll only on Mondays across 400
  consecutive days.
- `schedule.js` is structurally clean: no reversed or zero-length blocks, none
  outside the grid, no duplicate ids, no overlaps, no track without a meter.
- **Normal weeks have exactly zero slack: 6 deep slots against 6 category
  targets.** Every single slot has to be assigned correctly or the week cannot
  add up. Exam weeks have 3 gym blocks for a target of 2, so those have one
  spare. This is what makes the "close the loop" item below worth more than it
  first looks.
- The two `review` blocks are tickable but feed no meter. That reads as
  deliberate — they are ticked, they just do not count.

## Next

- [x] **PWA: manifest + service worker.** Done 2026-09-19. `sw.js` precaches
      the page files and serves network-first, so edit-and-reload still works;
      `api/state` is left alone. Icons rendered from `icon.svg`. Verified
      offline in Zen on 2026-09-19: server stopped, page still renders.
      Deployed to bmo 2026-09-19; all files serve through Caddy over HTTPS,
      container healthy. Still to do: install it on the phone — *Add to Home
      Screen* in Safari, the install prompt in Android Chrome. Firefox on the
      desktop does not install PWAs, so that part cannot be checked here.
- [ ] **Keep history.** `rollWeek()` wipes `done` and nothing survives, so the
      app cannot answer "did I hit gym 3× this month?". Append
      `{week, type, counts}` to a `history` array capped at ~26 weeks before
      clearing; show a strip of past weeks under the meters. Needs `v: 3` and a
      migration in `normalize()`.
- [ ] **Close the loop on deep sessions.** The meters say "Coursework 1 of 3"
      but never connect that to the two unassigned slots sitting on Wednesday
      and Saturday. One line under the meters: "3 open sessions left · 2
      coursework, 1 software short." Maybe a "fill to targets" button.
- [ ] **Notifications** ("Gym in 15 minutes"), now that the PWA exists. Needs
      the page installed on the phone first, and a decision about scheduling:
      there is no server push here, so it is either a one-shot timer while the
      page is open or the Notification Triggers API where it exists.

## Smaller

- [ ] **Date-driven week types.** Pressing Trip/Exam by hand is the same kind of
      chore the no-"start-a-new-week"-button design already removed. Let
      `weeks.exam` carry `isoWeeks: [...]` and have `rollWeek` set the type,
      with the buttons as a manual override.
- [ ] **Tomorrow peek** at the bottom of Today. The Week grid is a desktop
      thing; at 22:30 you just want to know what the morning looks like.
- [x] **Generalise `STATIC` in `server.py`.** Done 2026-09-19, as the
      prerequisite for the PWA files. Now a `TYPES` extension map plus a bare-
      filename check; traversal attempts and `/server.py` all 404. Deploying
      this needs the container recreated, which `schedule-deploy` does by
      itself because `server.py` changed.
- [ ] **Validate `schedule.js` on load.** Nothing checks the hand-edited data:
      `at: '23:30-00:30'` gives `e < s` and a negative height, an unknown
      `track` silently never reaches a meter. A few `console.warn`s would catch
      typos at the moment they are made.
- [ ] **Drop the vestigial embedded state.** Nothing templates
      `<script id="state">`, so it is always the empty default and
      `stored.savedAt > embedded.savedAt` is always true. Either use `blank()`
      or say in the docs that it is only a default.
