# todo

Open items only. Finished work lives in git history.

## Deploy

- [ ] Schedule B was marked "not deployed yet" on 2026-09-28, and the audit
      cleanup (see `audit.md`) is not deployed either. Look at the page in a
      real browser, both views and the deep-session dialog, then run
      `tools/deploy.sh`. `server.py` changed, so the deploy recreates the
      container, and the old `app/web/schedule.ics` on bmo is removed by the
      rsync.

## Waiting: PHYS 101 lab and CHEM 110 lab

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
      Touches `app.js` (`forWeek` and the grid filter), `tools/lib.js`
      (`expand`), `check-schedule.js` (validate the list) and `make-ics.js`,
      which writes one weekly `RRULE` per block and would need `INTERVAL=2` or
      one event per date.

## Schedule B, still settling

- [ ] W40 is the first week on schedule B. After it, check whether Friday at
      08:15 actually happens. If B doesn't hold, alternatives A and C are in
      git history as `schedules.md`.

## Dates

- [ ] Trip weeks: add each one to `weeks.trip.isoWeeks` once it's planned.

## After every edit

- [ ] Look at the page, both views.
- [ ] Regenerate the calendar feed with `node tools/make-ics.js`, then deploy
      with `tools/deploy.sh`. The deploy runs all four checks and refuses a
      stale `schedule.ics`, so the phone calendar can't fall behind the page.
