# todo

Open items only. Finished work lives in git history.

## Deploy

- [ ] Schedule B was marked "not deployed yet" on 2026-09-28, and the audit
      cleanup (see `audit.md`) is not deployed either. Look at the page in a
      real browser, both views and the deep-session dialog, then run
      `tools/deploy.sh`. `server.py` changed, so the deploy recreates the
      container, and the old `app/web/schedule.ics` on bmo is removed by the
      rsync.

## Labs

- [ ] CHEM 110 lab includes Tue 8 Dec (W50), the "Recitation" week on the lab
      schedule. Drop `2026-W50` from its `isoWeeks` if that turns out not to
      be in the lab slot.

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
