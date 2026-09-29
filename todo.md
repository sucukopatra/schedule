# todo

Working backlog for the weekly timetable. Newest thinking at the top of each
section; tick things off as they land.

## Timetable changes, asked for 2026-09-28

All in `app/web/schedule.js` unless noted. Everything below landed
2026-09-28 except the two labs, which are **Waiting**.

Moving or deleting a tickable block changes its id and drops its ticks for the
current week, so land these early in a week — today is a Monday.

### Straight removals

Done 2026-09-28. All four checks pass and `schedule.ics` is regenerated, down
to 43 events. Not deployed yet. None of these blocks were tickable, so no
ticks were lost.

- [x] **Drop CHEM 110, E3-ZZZ5.** The Tue 18:00–19:00 lecture. The CHEM 110
      lab on Tue 14:00 stays.
- [x] **Drop the GAME 203 and GAME 211 online classes.** Fri 17:00–18:00 and
      18:00–19:00. Their labs (GAME 203 Fri 10:00, GAME 211 Thu 14:00) stay.
      The trip block's note, "After online classes", was wrong after this,
      so it's gone. The trip still leaves at 19:30, but Friday is free from
      16:00 now, so it could leave earlier.
- [x] **Drop the Spare morning's note.** Wed 09:00, "Laser, errands or
      catch-up". The block itself stays. The laser line in the Wednesday
      section comment went too.

Together these freed **Tue 18:00–19:45** and **Fri 16:00–19:30**. Schedule B
below uses Friday's for a deep session and Tuesday's for the gym.

### On hold: PHYS 101 lab and CHEM 110 lab

**Don't touch either for now.** Both will probably run less than weekly, in a
"bit weird" pattern, and neither pattern is decided yet. They stay exactly as
they are, weekly, until it is: PHYS 101 lab Mon 11:00–13:00, CHEM 110 lab
Tue 14:00–16:00.

- [ ] **Waiting:** the actual pattern for each lab, whether that's odd or even
      weeks, a start date, or an irregular list of dates.
- [ ] Then build it once for both. Right now a block can only be limited by
      week *type* (`weeks`), not by calendar week, so this needs a new field.
      Recommendation: an `isoWeeks` list on the block itself, the same shape
      the week types already use. That covers a strict alternation and an
      irregular pattern alike, so a weird pattern needs no extra code.
      Touches `app.js` (`forWeek` and the grid filter), `check-schedule.js`
      (validate the list) and `make-ics.js`, which currently writes one weekly
      `RRULE` per block and would need `INTERVAL=2` or one event per date.

### Gym, meal prep, deep sessions, German and Reading: schedule B

Done 2026-09-28. The user picked alternative B from `schedules.md`, which
still holds all three alternatives and the reasons behind B. All four checks
pass and `schedule.ics` is regenerated, now 47 events. Not deployed yet.

- [x] **Gym, 5x5**, Tue and Thu 18:30–19:45 and Sat 10:00–11:15 (normal and
      exam weeks only). Never two days in a row. The gym targets didn't need
      to change: normal 3, trip 2 (Tue, Thu), exam 2 with one spare. The old
      Mon/Wed/Fri 19:30 blocks and the men's-block comment are gone.
- [x] **Meal prep** at Baki's on Wed 19:30–22:00 (cooks for Thu–Sat) and Sun
      16:00–18:30 (cooks for Mon–Wed). In trip weeks, Wednesday is the big
      batch and there is no Sunday prep. Baki confirmed the days can move.
- [x] **Deep sessions, none at weekends:** Tue 16:00, Wed 14:00, Thu 16:00,
      Fri 08:15, Fri 12:30, Fri 16:00. Still 6 for 6 in normal and exam weeks,
      with no slack. Trip weeks now have 6 for 4. `check-plan.js` has the new
      slots.
- [x] **Anki**, 15 min at breakfast every day: weekdays 07:45, weekends
      09:00. It is on in trip weeks too and sits inside the trip blocks, which
      is allowed. It keeps the `german` track and history, now labelled
      "Anki". The weekday and Saturday ids are unchanged, so no ticks were
      lost.
- [x] **Nicos Weg**, 30 min, on its own `nicosweg` meter: Mon 20:00, Thu
      20:30, Sat 11:45. The Saturday lesson is off in trip weeks, so those
      weeks get 2. The Sunday "Long German session" is gone.
- [x] **Long read**, Sun 11:00–12:30, normal and exam weeks, on its own
      `longread` meter. The meter shows "Paused" in trip weeks. Reading
      before bed stays as it was.
- [x] Rewrote the `alarms` comment's joke about breakfast with your German.
- [x] `check-sync.js` used the old gym ids in its fixtures. They now use
      Tue and Thu 18:30.
- [ ] Habits still get no calendar alarm. If Anki or Nicos Weg keep getting
      forgotten, add `habit` to `alarms`, or give these a kind of their own.
- [ ] This week (W40) is the first on the new timetable. After it, check
      whether Friday at 08:15 actually happens.

### After every edit

- [ ] Run all four checks in `tools/` and look at the page, both views.
- [ ] Regenerate the calendar feed with `node tools/make-ics.js`, then deploy
      with `tools/deploy.sh`. The deploy refuses a stale `schedule.ics`, so
      the phone calendar can't fall behind the page.

## Bugs

### Round 2, found and fixed 2026-09-19 by audit

Deployed to bmo 2026-09-19.

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

`check-schedule.js`, `check-sync.js`, `check-plan.js` and `check-server.sh` in
`tools/`, with `harness.js` shared by the middle two. Outside `app/`, so never
deployed. Run all four before a deploy. Each was confirmed to fail on a
deliberately introduced fault, which is the only thing that makes a check worth
having.

The harness is not a browser — no layout, no CSS, no event bubbling. It can say
a handler did the right thing to the state, never that a button was reachable
or legible. For that, render a state through it, drop the HTML next to the real
`style.css`, and look at it.

## Term dates

Set 2026-09-20 from what the user gave: midterms 1–8 Nov, finals 12–22 Dec, so
`termEnd` is 2026-12-22. **`termStart` (2026-09-14) is still a guess** — it was
never confirmed, and it only affects dates already in the past, so the cost of
being wrong is a few phantom events in mid-September.

Both exam periods straddle a week boundary. Every ISO week either one touches
is marked exam — W44, W45, W50, W51, W52 — even though W44 holds only Sunday
1 Nov and W50 only the weekend of 12–13 Dec. The reasoning: those are the
run-ups, which is when the exam targets earn their keep. Dropping either is a
one-line edit.

## Worth knowing (checked, not bugs)

- `isoWeek()` is correct, including the year-boundary cases: verified against
  16 known ISO-8601 dates and confirmed to roll only on Mondays across 400
  consecutive days.
- `schedule.js` is structurally clean: no reversed or zero-length blocks, none
  outside the grid, no duplicate ids, no track without a meter. The only
  overlaps are Anki inside the trip blocks, which is intended.
- **Normal and exam weeks have exactly zero slack**: 6 deep slots against 6
  category targets. Every single slot has to be assigned correctly or the week
  cannot add up. Trip weeks, since schedule B, have 6 slots for 4 targets. Exam weeks have 3 gym blocks
  for a target of 2, so those have one spare. This is what the plan line exists
  for.
- The two `review` blocks are tickable but feed no meter. That reads as
  deliberate — they are ticked, they just do not count.

## Next

- [x] **PWA: manifest + service worker.** Done 2026-09-19. `sw.js` precaches
      the page files and serves network-first, so edit-and-reload still works;
      `api/state` is left alone. Icons rendered from `icon.svg`. Verified
      offline in Zen on 2026-09-19: server stopped, page still renders.
      Deployed to bmo 2026-09-19; all files serve through Caddy over HTTPS,
      container healthy. Installed on the phone 2026-09-20 — the PWA work is
      finished. (Firefox on the desktop does not install PWAs, so that part
      was never checkable here.)
- [x] **Keep history.** Done 2026-09-20. `rollWeek()` files the finished week
      into `history` before clearing the ticks, `[done, target]` per meter,
      capped at 26 and drawn eight at a time under the meters as one row per
      meter — so the strip answers "have I been going to the gym", not "what
      did week 37 look like". `v: 3`; migrating from v2 is just defaulting
      `history` to empty, since v2 never recorded any.
      Building it turned up a bug of its own: a roll that happens inside
      `adopt()` was applied but never saved, so each device would have rolled
      the same week over and over and kept its own private history. Caught by
      the new sync cases, not by eye.
      Checked at phone and desktop width, light and dark, both views.
- [x] **Close the loop on deep sessions.** Done 2026-09-20. A line under the
      meters, in four states, plus a **Fill to targets** button that assigns
      the open slots that have not passed yet — earliest slot to the first
      meter on the page, working around whatever is already chosen, every slot
      still tappable after.
      The state worth having is the fourth: a slot whose time has passed while
      still open cannot be filled, and with no slack anywhere that means the
      week has already stopped adding up. The page now says so on Tuesday
      instead of letting it be discovered on Sunday.
      `tools/check-plan.js` pins every branch and both fill cases, including
      that whatever the fill produces actually adds up.
- [x] **Notifications**, done 2026-09-20 — as a calendar feed, not as push.
      A page cannot wake itself, a backgrounded PWA is suspended, and the
      Notification Triggers API never shipped past an origin trial. Push would
      have meant VAPID and payload encryption, neither in the standard library,
      plus a scheduler on bmo. So `schedule.ics` is generated from
      `schedule.js` and the phone's own calendar does the reminding: native,
      and the alarms fire with the phone off the network entirely.
      The catch worth remembering: Google Calendar's "from URL" makes *Google's
      servers* fetch, and they cannot reach a host with no public DNS. iOS
      fetches from the phone, so it works over Tailscale. On Android it needs a
      client that fetches locally, like ICSx⁵.

## Smaller

- [x] **Date-driven week types.** Done 2026-09-20. `weeks.trip` and
      `weeks.exam` carry an `isoWeeks` list; `rollWeek` sets the type from it
      on the Monday roll and the header buttons still override for that week.
      Both lists shipped empty; the exam weeks have since been filled in (see
      *Term dates*), and trip weeks get added as trips are planned.
      `check-schedule.js` rejects a malformed week string and a week claimed by
      two types; `check-sync.js` covers the roll both ways against a temporary
      copy of `schedule.js` that claims a week.
- [x] **Tomorrow peek.** Done 2026-09-20. Sits after "Earlier today", before
      the week-level summaries, so the day-level things stay together. Dashed
      and read-only — tomorrow's ticks are tomorrow's business — and an
      unassigned deep session reads "Not chosen yet" rather than inviting a
      tap. On a Sunday it shows next week's Monday under next week's type.
- [x] **Generalise `STATIC` in `server.py`.** Done 2026-09-19, as the
      prerequisite for the PWA files. Now a `TYPES` extension map plus a bare-
      filename check; traversal attempts and `/server.py` all 404. Deploying
      this needs the container recreated, which `schedule-deploy` does by
      itself because `server.py` changed.
- [~] **Validate `schedule.js` on load.** Skipped on purpose, 2026-09-20.
      `tools/check-schedule.js` already does this properly and in more depth.
      Duplicating the rules inside `app.js` would mean two places to keep in
      step, and the copy in the page would be the one that quietly rots.
- [x] **Drop the vestigial embedded state.** Done 2026-09-20. The
      `<script id="state">` block and the comparison against it are gone;
      startup is `normalize(stored)`, and `normalize(null)` was already
      `blank()`.
