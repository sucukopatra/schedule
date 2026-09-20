# Deployment: schedule

This project is a weekly semester timetable: one self-contained HTML page plus a
tiny Python sync server. It is developed on my laptop and deployed to my home
server, `bmo`.

## Where it runs

- Host: `bmo` (reachable over SSH as `bmo`), Docker Compose setup in `/srv/docker`.
- Stack file: `/srv/docker/stacks/schedule.yml`, included by the main compose file.
- Container: `schedule`, image `python:3.12-alpine`, runs as `1000:1000`,
  command `python -u /app/server.py`, env `DATA_DIR=/data`, `PORT=8080`.
  Healthcheck hits `http://127.0.0.1:8080/healthz`.
- Network: the external Docker network `core`, shared with Caddy.
- Mounts:
  - `/srv/docker/config/caddy/webpages/schedule/app` → `/app` (read-only)
  - `/srv/docker/config/caddy/webpages/schedule/data` → `/data` (read-write)
- Reverse proxy: Caddy, site block
  ```
  schedule.domatesis.com {
      reverse_proxy schedule:8080
  }
  ```
  The Caddyfile Caddy actually mounts is **`/srv/docker/config/caddy/Caddyfile`**.
  There is a second copy at `/srv/docker/Caddyfile` with identical contents that
  is *not* mounted — editing that one changes nothing, and because the two read
  the same it is easy to convince yourself the config is fine when Caddy never
  saw it.
  Caddy does not watch the file. After editing it:
  ```bash
  ssh bmo 'docker exec caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile \
           && docker exec caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile'
  ```
  Reload is graceful and applies to every site in the file, so validate first.
  The symptom of a missed reload is specific and misleading: `/` keeps working
  while the newer files 404, because an older container still shares the `app/`
  mount and serves `index.html` fine but has no route for the rest.
- Access: LAN and Tailscale only. No public DNS record and no auth, by design.

Server layout today:

```
/srv/docker/config/caddy/webpages/schedule/
├── app/
│   ├── server.py
│   └── web/
│       ├── index.html
│       ├── style.css
│       ├── schedule.js
│       ├── app.js
│       ├── sw.js
│       ├── manifest.webmanifest
│       ├── icon.svg
│       ├── icon-192.png
│       ├── icon-512.png
│       ├── icon-maskable.png
│       └── apple-touch-icon.png
└── data/
    └── state.json      # live personal data, never touch
```

## What the server does

`app/server.py` uses only the Python standard library:

- `GET /` and any bare filename with a known extension serve that file from
  `app/web/`, read from disk on every request (so page changes go live without
  a restart). `/` maps to `index.html`. A request path has to be a single
  filename — no slashes, no leading dot — and its extension has to be in
  `TYPES` in `server.py`, so there is nothing to traverse with and no way to
  reach `server.py` itself. Everything else 404s.
  Dropping a new file into `app/web/` is therefore just a deploy, not a
  `server.py` change. A new *kind* of file still needs an entry in `TYPES`,
  and that is a `server.py` change, so the container has to be recreated.
- `GET /api/state` returns `data/state.json` (404 until the first save).
- `PUT /api/state` replaces it. Body must be a JSON object, max 64 KB. Writes are
  atomic (temp file + `os.replace`). If the incoming `savedAt` is older than the
  stored one, it responds 409 with the stored state instead of saving.
- `GET /healthz` returns `ok`.

## How the page works

Plain files in `app/web/`, no build step and no bundler. The icons are the one
generated thing, and they are committed, not built at deploy time:

- `index.html` — document shell: head, `<div id="root">`, tags for the other
  files, and the service worker registration. `schedule.js` must load before
  `app.js`. It carries no state: an empty default used to sit in a
  `<script type="application/json">` block, but nothing ever templated it, so
  it was always the same empty object and the comparison against it was always
  won by whatever localStorage held.
- `style.css` — all CSS, mobile-first, colour tokens on `:root` for light/dark.
- `schedule.js` — **the timetable, and the only file you edit to change it.**
  Pure data: one `SCHEDULE` object with term settings, week types and their
  targets, deep-session categories, and the block list. Times are `"HH:MM"`
  strings and `day` takes `'Mon'`, a list, or `'*'`. Its header comment
  documents every field. Nothing in `app.js` needs to change when it does.
- `app.js` — one IIFE: expands `SCHEDULE.blocks` into per-day blocks, renders
  the two views, handles ticks and sync.
- `sw.js`, `manifest.webmanifest` and the icons — see *Installing it* below.

Edit them directly and reload.

### Installing it

The page is installable and works offline: *Add to home screen* on the phone,
or the install button in a desktop browser. It then opens without browser
chrome, from the icon, and starts even when bmo is unreachable — which the
localStorage fallback always supported in principle but could never actually
reach, because without the network the HTML never loaded at all.

- `manifest.webmanifest` — name, colours and icons. The name is deliberately
  generic (*Weekly timetable* / *Week*) so it does not go stale every semester
  the way the `<title>` does.
- `sw.js` — the service worker. It precaches the page files on install, and
  then serves **network-first**: a fetch that succeeds is used and re-cached,
  and the cache is only what you get when the fetch fails. Editing a file on
  bmo and reloading therefore still works exactly as it did before, which is
  the whole reason it is not cache-first.
  - `api/state` is never intercepted. A stale week would be worse than no week,
    and `app.js` already handles the server being unreachable.
  - Google Fonts are cached separately and served stale-while-revalidate.
    Missing them just falls back to the local font stack.
  - `VERSION` at the top names the caches. Bump it to throw a bad cache away;
    ordinary page edits do not need it.
- Icons are rendered from `icon.svg`. To change the mark, edit the SVG and
  re-render: `rsvg-convert -w 192 -h 192 icon.svg -o icon-192.png`, and so on
  for 512. `icon-maskable.png` keeps its content inside the middle ~72% so
  launchers can crop it to any shape, and `apple-touch-icon.png` is opaque and
  square because iOS rounds it itself.

A service worker needs a secure context. `https://schedule.domatesis.com` and
`http://localhost` both qualify; opening `index.html` off disk does not, so
registration just fails there and the page carries on with localStorage.

### Reminders: the calendar feed

The page cannot tell you "gym in 15 minutes". A web page cannot wake itself,
a backgrounded PWA is suspended, and the API that would have fixed that never
shipped past an origin trial. Real push would mean VAPID signing and payload
encryption, neither of which is in the standard library, plus something on bmo
deciding when to fire.

So the phone's own calendar does the reminding instead. `schedule.ics` is a
subscribable calendar generated from `schedule.js`:

```bash
node tools/make-ics.js           # regenerate after editing the timetable
node tools/make-ics.js --check   # exit 1 if it is out of date
```

Like the icons it is generated and committed rather than built on the way out —
but unlike the icons it goes stale every time the timetable changes, so
`check-schedule.js` runs `--check` and the pre-deploy checks catch it.

- Lead times come from `SCHEDULE.alarms`, keyed by kind. A kind that is not
  listed gets no alarm, which is why `habit` is absent.
- Times are **floating**: no `TZID`, no `VTIMEZONE`, no offsets. "09:00" means
  nine o'clock wherever the phone is, which is what a class timetable means and
  leaves no DST arithmetic to get wrong.
- The range comes from `termStart` and `termEnd`. Each block becomes one
  weekly `VEVENT`; weeks where a block does not apply become `EXDATE`s, so once
  `isoWeeks` names your trip weeks the calendar follows. A block that applies
  to no week in the term is left out entirely — with no trip weeks declared,
  the five trip-only blocks produce no events.
- `UID`s are the same stable ids the page uses, so re-subscribing updates
  events rather than duplicating them.

**Subscribing depends on who does the fetching**, and this is where it gets
counter-intuitive. The site has no public DNS and is reachable only over the
LAN or Tailscale:

- **iOS** fetches subscribed calendars *from the phone*, so it works: Settings
  → Calendar → Accounts → Add Account → Other → Add Subscribed Calendar, then
  `https://schedule.domatesis.com/schedule.ics`. The phone has to be on
  Tailscale or the LAN when it refreshes.
- **Google Calendar cannot do this.** "From URL" makes *Google's servers*
  fetch, and they cannot reach a private host. It will fail, and the failure
  looks like nothing happening.
- **Android** has no subscribe-from-the-device support of its own. Either an
  app that fetches locally, such as ICSx⁵, or the CalDAV route below.

Once events have synced, the alarms are local: they fire with the phone off the
network entirely. Only picking up *changes* needs Tailscale.

### The CalDAV route: pushing into Radicale (experimental)

**Experimental, and nothing depends on it.** It is not part of `schedule-deploy`,
and the page and the `.ics` feed work whether or not it is ever run. The push
half is tested -- against a throwaway Radicale 3.8.0, not against the real
server -- and the phone half is not tested at all. Read the caveats at the end
of this section before relying on it for a morning alarm.

The phone here is GrapheneOS running Fossify Calendar, synced by DAVx⁵ against
Radicale at `dav.domatesis.com`. That sync path already works, so the timetable
rides it instead of adding a second one -- and the phone then only ever needs to
reach `dav.domatesis.com`, never `schedule.domatesis.com`.

**Radicale's `webcal` collection type is not the way to do this**, which is not
obvious and costs an hour if you assume otherwise. It does not mirror the feed:
it stores the URL as `CS:source` with `tag: VSUBSCRIBED` in `.Radicale.props`
and leaves the fetching to the client. So the collection sits at zero items, and
DAVx⁵ refuses it with *no compatible calendar app* because it wants to hand the
URL off to ICSx⁵. Make the collection an ordinary **Calendar** and push to it:

```bash
python3 tools/push-dav.py             # after make-ics.js, after the rsync
python3 tools/push-dav.py --dry-run   # report, change nothing
```

Once set up this is not run by hand: `schedule-deploy` calls it, so editing
`schedule.js` and deploying is the whole workflow and the phone follows. The
one-time setup is a `Calendar` collection at `/ender/schedule/`, a `~/.netrc`
entry for `dav.domatesis.com`, and enabling the calendar in DAVx⁵ and Fossify.

- One resource per event, named from the UID (`gym-Mon-19-30-schedule....ics`),
  so a re-run updates in place rather than duplicating.
- **Deletion is scoped.** Anything in the collection missing from the feed is
  removed, but only after fetching it and confirming its UID ends
  `@schedule.domatesis.com`. An event added by hand survives, and pointing the
  script at the wrong collection cannot quietly empty it. This is what a webcal
  subscription would have given for free, and the reason moving a block does
  not leave a ghost alarm behind.
- Credentials come from `SCHEDULE_DAV_USER`/`SCHEDULE_DAV_PASS`, else `~/.netrc`
  for the host, else a prompt. Never from the command line, which `ps` shows to
  every process on the machine. `--url` or `SCHEDULE_DAV_URL` overrides the
  collection.
- The collection is created with `MKCALENDAR` if it is not there yet.

On the phone, **Fossify hides CalDAV calendars until you turn them on**: Settings
→ CalDAV sync, then tick the calendar. Reminders also need the *Alarms &
reminders* permission and an exemption from battery optimisation, or they fire
late or not at all.

**What is actually proven.** Against a throwaway Radicale 3.8.0: the collection
is created, 46 events land one file each, a re-run reports `0 new, 46 updated`
with no duplicates, a planted stale `gym-Thu-18:15` is deleted, a hand-added
event is left alone, and `DTSTART`, `RRULE` and `VALARM` all round-trip with no
`TZID` injected. Aimed at a collection holding three unrelated events it deleted
none of them -- but it did add its own 46, taking that collection to 49 items.
It cannot destroy anything; it can still make a mess. Hence `--dry-run`.

**What is not proven.** The real server behind Caddy and TLS, where a `[rights]`
section may refuse `MKCALENDAR` -- if it does, create the collection by hand as
type *Calendar* and re-run, since the script only creates one when `PROPFIND`
returns 404. And everything downstream of Radicale: whether DAVx⁵ maps the
feed's floating times onto the device timezone as intended is the one that
matters, because getting it wrong puts every event an hour out rather than
failing loudly. Check a single event on the phone against the page before
trusting an alarm to it.

### Views

- **Today** is the default, and the reason to open the page at all: a card for
  what is running now with time remaining, what is next and in how long,
  anything else still running, the rest of today as a tap-to-tick list, a
  read-only peek at tomorrow, then the week's counts, the plan line and recent
  weeks.
- **Week** is the full seven-day grid, mainly useful on a desktop.

Both views end with the counts, the plan line and the recent-weeks strip.

The tomorrow peek is deliberately not tickable: tomorrow's ticks are
tomorrow's business, and a deep session that has not been assigned reads
"Not chosen yet" there rather than inviting a tap. On a Sunday it shows next
week's Monday, under next week's type rather than this one's.

### The plan line

Every week type has exactly as many deep slots as it has category targets —
six against six in a normal week — so there is no slack anywhere: one slot
assigned to the wrong thing makes the week impossible, and nothing else on the
page would tell you. The line under the meters is what closes that gap:

- *5 open sessions left · still needs 2 Coursework, 2 Software project, 1 Chess
  study.* — with a **Fill to targets** button, which assigns the open slots
  that have not passed yet, earliest slot to the first meter on the page. It
  works around whatever is already chosen and every slot stays tappable
  afterwards, so it is a starting point rather than a decision.
- *Every deep session is spoken for, and the targets add up.*
- *Every session is assigned, but the week is still short 1 Chess study —
  something else has one too many.*
- *Nothing left to assign · still short …, and 4 sessions went by unassigned.*
  A slot whose time has passed while still open cannot be filled, and with no
  slack that means the week has already stopped adding up. Better said on
  Tuesday than discovered on Sunday.

The choice is remembered per device in localStorage, not synced.

### Block ids and ticks

Tickable kinds are `deep`, `gym`, `habit` and `review`. Each gets a stable id
from its kind, day and start time (`gym-Mon-19:30`), so ids are never written by
hand and can never collide. Moving a block in `schedule.js` changes its id and
so drops that week's tick for it, which is normally what you want.

### State

```json
{ "v": 3, "week": "2026-W38", "type": "normal",
  "slots": { "deep-Thu-16:00": "coursework" },
  "done":  { "gym-Mon-19:30": true },
  "history": [
    { "week": "2026-W37", "type": "normal",
      "meters": { "coursework": [3, 3], "gym": [2, 3], "german": [6, 7] } }
  ],
  "savedAt": 1758200000000 }
```

`week` is the ISO week the ticks belong to. On the first load of a new week the
page files the finished week into `history`, clears `done`, keeps `slots` so
the plan carries over, and sets `type` from the calendar — so there is no
"start a new week" button to remember to press.

A week type can claim ISO weeks in `schedule.js` (`weeks.exam.isoWeeks`), and a
week nothing claims is normal. The type is set when the week rolls over, so
adding a week to that list mid-week does nothing until the next Monday; the
buttons in the header still override it for the rest of the week. Both lists
ship empty — the trip and exam dates are yours to fill in, and
`tools/check-schedule.js` will complain if two types claim the same week. Unknown and missing fields are dropped
on load, so a malformed or outdated `state.json` degrades to an empty week
rather than breaking the page.

Each `history` entry is one finished week, `[done, target]` per meter, capped
at the last 26 and drawn eight at a time under the meters. The target is stored
rather than looked up later, because `schedule.js` changes between semesters
and a past week should keep the target it was actually judged against. Habit
meters have no target of their own, so theirs is however many were on the
timetable that week.

`slots` and `done` are pruned on load to keys that still name a real block of
the right kind: moving a block in `schedule.js` changes its id, and the orphan
would otherwise stay for good.

A roll that happens while adopting another device's state is saved, not just
applied — otherwise each device would roll the same week separately and keep
its own private history.

The page only writes to the server once you have actually changed something; a
fresh page with nothing ticked will not create a `state.json`.

### Modes

1. **Self-hosted on bmo** (the normal case): loads and saves through the
   relative path `api/state`, saves 1.5 s after the last change, re-fetches when
   the tab becomes visible, and adopts the server's state on a 409.
2. **Fallback**: if `api/state` is unreachable, localStorage only. This is also
   what happens if you open `index.html` straight off disk — the relative
   `style.css`, `schedule.js` and `app.js` still resolve over `file://`.

## Deploying

### Prerequisite: passwordless SSH to bmo

Every command here assumes `ssh bmo` works with no prompt. `~/.ssh/config`
pins the account and key:

```
Host bmo
    User ender
    IdentityFile ~/.ssh/id_ed25519
    IdentitiesOnly yes
    ServerAliveInterval 30
```

`HostName` is deliberately left out so `bmo` keeps resolving however it does at
the time — Tailscale MagicDNS (`bmo.border-truck.ts.net`, `100.120.110.106`) or
the LAN. `User` and `IdentityFile` are pinned because neither is discoverable:
without them `ssh bmo` works only by coincidence, because the local username
happens to match the account on the server. Check with:

```bash
ssh -o BatchMode=yes bmo 'echo ok'
```

If that asks for a password or fails, the key is not in bmo's
`authorized_keys`. Fix it once, from a real terminal — it needs a TTY for the
password prompt, so it cannot be done through a tool or a non-interactive shell:

```bash
ssh-copy-id -i ~/.ssh/id_ed25519.pub bmo
```

The key is unencrypted, so no ssh-agent is needed; `SSH_AUTH_SOCK` being unset
is not the problem. A failure that mentions `ssh_askpass` only means ssh had no
terminal to prompt on, which hides the real cause — run it in a terminal to see
what is actually wrong.

### The deploy itself

Only `app/` is deployed. Nothing is built, locally or on the server — deploy is
just an rsync of `app/` to bmo, with a shell function on the laptop:

```bash
schedule-deploy() {
  local src=~/dev/server/schedule
  local dest=bmo:/srv/docker/config/caddy/webpages/schedule/app/
  local out
  out=$(rsync -az --delete --itemize-changes "$src/app/" "$dest") || return 1
  if [[ -z "$out" ]]; then
    echo "Nothing changed."
  else
    echo "$out"
    if grep -q 'server\.py' <<<"$out"; then
      ssh bmo 'cd /srv/docker && docker compose up -d --force-recreate schedule' \
        && echo "Recreated schedule (server.py changed)."
    fi
  fi
  # Keep the phone's calendar in step with what was just deployed.
  python3 "$src/tools/push-dav.py" \
    || echo "Calendar push failed. The page is live; phone reminders are stale."
}
```

- The rsync target is `app/` only, so `--delete` can never reach `data/`.
- The calendar push runs **unconditionally**, including on a deploy that
  changed nothing. It is idempotent, so that costs a few seconds and heals a
  collection that drifted -- which is the whole point of it being here rather
  than in your head. It deliberately never sets `$?`: a push failure is not a
  deploy failure, because the page is already live and only the reminders are
  stale. It needs a `~/.netrc` entry for `dav.domatesis.com` or it will stop
  and prompt on every deploy.
- The trailing slash on `"$src/app/"` matters; without it rsync creates `app/app/`.
- Page changes need no restart. Changes to `server.py` need the container
  recreated, which the function does automatically.
- Use `docker compose up -d --force-recreate schedule`. Both halves matter:
  - Not `docker restart schedule`. The service is defined in
    `stacks/schedule.yml` and included by `compose.yml`; `restart` fails
    outright if the container does not exist, which is the state you are in
    after a `compose down`, a prune, or a first deploy.
  - `--force-recreate`, because without it Compose compares the *service
    definition*, not the code. `server.py` arrives through a bind mount, so
    nothing Compose looks at has changed: it prints `Container schedule
    Running`, leaves the old process up, and the deploy silently does nothing.
    This bit on 2026-09-19 and it looks exactly like the missed-Caddy-reload
    symptom — `/` keeps working while the newer files 404, because the running
    process still has the old routes.
- Changes to the compose file or Caddyfile are made on bmo by hand, not by
  this deploy.

## Pulling the current version

To start from what is running on bmo, pull `app/` only:

```bash
rsync -az bmo:/srv/docker/config/caddy/webpages/schedule/app/ ./app/
```

This needs key-based SSH to `bmo` (no password prompt). It brings down
`server.py` and everything in `web/` exactly as deployed.

Never pull `data/` into `app/` or anywhere that gets deployed. Real data for
testing goes into `./dev-data/` only (see below).

## Local development

Run the same server locally against throwaway data:

```bash
DATA_DIR=./dev-data PORT=8080 python3 app/server.py
# open http://localhost:8080
```

Page edits are picked up on reload, including new files in `app/web/`. Editing
`server.py` needs the process restarted, exactly like the container on bmo.
Hard-reload the browser after changing `app.js` or `schedule.js`, since a
normal reload may keep the cached copy.

With the service worker registered, a hard reload is not always enough — it
only bypasses the HTTP cache, not the worker. If a change refuses to show up,
open `about:debugging#/runtime/this-firefox`, find the registration under
*Service Workers*, and **Unregister** it. (The same thing lives in devtools
under *Application*, behind the `»` overflow at the end of the panel row; the
caches themselves are in *Storage → Cache Storage*, as `shell-v1` and
`fonts-v1`.) `localhost` is a separate registration from bmo, so nothing you do
locally affects the installed copy on your phone.

To test offline, stop the server rather than looking for a devtools offline
toggle — Firefox has no equivalent of Chrome's checkbox, and killing the server
is the condition you actually care about. The page should still render and the
status line should read *Offline, saving on this device*.

Note that Firefox on the desktop does not install PWAs, so the manifest does
nothing visible in Zen; desktop is only good for checking that the worker
registers and that offline works. Installing is a phone thing: Safari via
*Share → Add to Home Screen*, Android Chrome via the install prompt. Service
workers are also disabled in private windows.

### Checks

Three scripts in `tools/`, no dependencies beyond `node`, `python3` and `curl`.
They live outside `app/`, so they are never deployed. Run them before a deploy;
each exits non-zero on a failure.

```bash
node tools/check-schedule.js   # invariants, and that schedule.ics is current
node tools/check-sync.js       # load -> pull -> push, against a fake server
node tools/check-plan.js       # the plan line and Fill to targets
tools/check-server.sh          # the HTTP contract, on a throwaway DATA_DIR
```

- **check-schedule.js** catches what nothing validates at runtime: a block that
  ends before it starts, one outside the grid, a duplicate id, a `track` with
  no meter, a week whose targets cannot be met by the slots on offer. Overlaps
  and tickable-but-uncounted blocks are printed as notes, not errors, because
  trips are meant to overlap and the reviews are meant to be tickable without
  counting.
- **check-sync.js** runs the real `app.js` against a fake server under a small
  DOM stub. It pins both halves of the contract: work done offline gets pushed
  once the server is back, and a page where nothing was ticked never writes a
  `state.json`.
- **check-plan.js** pins each branch of the plan line and the fill: that the
  result adds up, that it works around slots already chosen, and that it is the
  same every time.
- **check-server.sh** starts a real server on a free port and walks the HTTP
  contract, including the two requests that once got no reply at all — a
  filename too long for the filesystem, and a non-numeric `Content-Length` —
  and asserts the log holds no tracebacks.

`check-sync.js` and `check-plan.js` share `tools/harness.js`, which runs the
real `app.js` against a fake server and a DOM small enough to be honest about
what it is: it parses the rendered HTML back into tags and hands out fakes that
record their listeners, which is enough to render, read what was rendered, and
click something. It is not a browser — no layout, no CSS, no bubbling — so it
can tell you a handler did the right thing to the state, never that a button
was reachable or legible. For that, render a state through the harness, drop
the HTML next to the real `style.css`, and look at it.

Both `.js` scripts take an optional path, so you can point them at a copy and
confirm they still fail on a fault you introduce deliberately. That is worth
doing when you add a case: a check that cannot fail is not a check.

To test against a copy of the real data (one direction only, safe):

```bash
rsync bmo:/srv/docker/config/caddy/webpages/schedule/data/state.json ./dev-data/
```

## Rules

- Never write to, delete, or overwrite anything under the server's `data/`.
  Never sync local data up to bmo.
- Keep `server.py` standard-library only; the container installs nothing.
- Keep the page dependency-free: no framework, no bundler, no build step.
  External resources are limited to Google Fonts.
- A change to the state shape needs either a bump of `v` with a migration in
  `normalize()`, or the knowledge that unrecognised state degrades to an empty
  week. Never edit `data/state.json` on bmo to force a shape.
  The window to watch after a bump is a device still running the old page from
  the service worker cache: it drops the field it does not know about and saves
  the state without it. Loading the page once while online on each device you
  use closes that window.
- The timetable belongs in `schedule.js`. If a change needs `app.js` to know
  about a specific class or habit, that is a sign the data model is missing
  something — add a field, not a special case.
