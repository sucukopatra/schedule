# todo

Working backlog for the weekly timetable. Newest thinking at the top of each
section; tick things off as they land.

## Bugs

Fixed 2026-09-19, all three in `app.js`. Not yet deployed to bmo.

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

## Next

- [ ] **PWA: manifest + service worker.** Home-screen icon, instant cold start,
      and a page that still renders when bmo is unreachable — the localStorage
      fallback exists but can never be reached, because without the network the
      HTML does not load at all. Precache the page files, network-first on
      `api/state`. Needs the `STATIC` change below first.
- [ ] **Keep history.** `rollWeek()` wipes `done` and nothing survives, so the
      app cannot answer "did I hit gym 3× this month?". Append
      `{week, type, counts}` to a `history` array capped at ~26 weeks before
      clearing; show a strip of past weeks under the meters. Needs `v: 3` and a
      migration in `normalize()`.
- [ ] **Close the loop on deep sessions.** The meters say "Coursework 1 of 3"
      but never connect that to the two unassigned slots sitting on Wednesday
      and Saturday. One line under the meters: "3 open sessions left · 2
      coursework, 1 software short." Maybe a "fill to targets" button.
- [ ] **Notifications** ("Gym in 15 minutes"), once the PWA is installed — on
      iOS it only works from an installed PWA, so it has to come second.

## Smaller

- [ ] **Date-driven week types.** Pressing Trip/Exam by hand is the same kind of
      chore the no-"start-a-new-week"-button design already removed. Let
      `weeks.exam` carry `isoWeeks: [...]` and have `rollWeek` set the type,
      with the buttons as a manual override.
- [ ] **Tomorrow peek** at the bottom of Today. The Week grid is a desktop
      thing; at 22:30 you just want to know what the morning looks like.
- [ ] **Generalise `STATIC` in `server.py`.** The allowlist buys nothing over
      `basename` plus an extension check against a fixed directory, and costs a
      container recreate and a confusing 404 every time a file is added —
      a trap `DEPLOYMENT.md` spends a paragraph on. Removing it beats
      documenting it.
- [ ] **Validate `schedule.js` on load.** Nothing checks the hand-edited data:
      `at: '23:30-00:30'` gives `e < s` and a negative height, an unknown
      `track` silently never reaches a meter. A few `console.warn`s would catch
      typos at the moment they are made.
- [ ] **Drop the vestigial embedded state.** Nothing templates
      `<script id="state">`, so it is always the empty default and
      `stored.savedAt > embedded.savedAt` is always true. Either use `blank()`
      or say in the docs that it is only a default.
