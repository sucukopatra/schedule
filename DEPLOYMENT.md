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

- `index.html` — document shell: head, `<div id="root">`, a
  `<script id="state" type="application/json">` block holding the empty default
  state, tags for the other files, and the service worker registration.
  `schedule.js` must load before `app.js`.
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

### Views

- **Today** is the default, and the reason to open the page at all: a card for
  what is running now with time remaining, what is next and in how long, then
  the rest of today as a tap-to-tick list, then the week's counts.
- **Week** is the full seven-day grid, mainly useful on a desktop.

The choice is remembered per device in localStorage, not synced.

### Block ids and ticks

Tickable kinds are `deep`, `gym`, `habit` and `review`. Each gets a stable id
from its kind, day and start time (`gym-Thu-18:15`), so ids are never written by
hand and can never collide. Moving a block in `schedule.js` changes its id and
so drops that week's tick for it, which is normally what you want.

### State

```json
{ "v": 2, "week": "2026-W38", "type": "normal",
  "slots": { "deep-Thu-16:00": "coursework" },
  "done":  { "gym-Thu-18:15": true },
  "savedAt": 1758200000000 }
```

`week` is the ISO week the ticks belong to. On the first load of a new week the
page clears `done`, keeps `slots` so the plan carries over, and resets `type` to
`normal` — so there is no "start a new week" button to remember to press.
Unknown and missing fields are dropped on load, so a malformed or outdated
`state.json` degrades to an empty week rather than breaking the page.

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
  [[ -z "$out" ]] && { echo "Nothing changed."; return 0; }
  echo "$out"
  if grep -q 'server\.py' <<<"$out"; then
    ssh bmo 'cd /srv/docker && docker compose up -d schedule' \
      && echo "Recreated schedule (server.py changed)."
  fi
}
```

- The rsync target is `app/` only, so `--delete` can never reach `data/`.
- The trailing slash on `"$src/app/"` matters; without it rsync creates `app/app/`.
- Page changes need no restart. Changes to `server.py` need the container
  recreated, which the function does automatically.
- Use `docker compose up -d schedule`, not `docker restart schedule`. The
  service is defined in `stacks/schedule.yml` and included by `compose.yml`;
  `restart` fails outright if the container does not exist, which is the state
  you are in after a `compose down`, a prune, or a first deploy.
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
use *Application → Service workers → Update on reload* in devtools, or
unregister the worker there. `localhost` is a separate registration from bmo,
so nothing you do locally affects the installed copy on your phone.

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
- The timetable belongs in `schedule.js`. If a change needs `app.js` to know
  about a specific class or habit, that is a sign the data model is missing
  something — add a field, not a special case.
