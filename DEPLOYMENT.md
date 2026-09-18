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
│       └── app.js
└── data/
    └── state.json      # live personal data, never touch
```

## What the server does

`app/server.py` uses only the Python standard library:

- `GET /`, `/index.html`, `/style.css`, `/schedule.js` and `/app.js` serve those files from
  `app/web/`, read from disk on every request (so page changes go live without
  a restart). Anything else 404s; there is no directory traversal because the
  served paths are a fixed allowlist (`STATIC` in `server.py`).
  Adding a file to `app/web/` therefore means adding it to `STATIC` too, and
  that is a `server.py` change: the container must be recreated or the new file
  404s while `index.html` happily asks for it.
- `GET /api/state` returns `data/state.json` (404 until the first save).
- `PUT /api/state` replaces it. Body must be a JSON object, max 64 KB. Writes are
  atomic (temp file + `os.replace`). If the incoming `savedAt` is older than the
  stored one, it responds 409 with the stored state instead of saving.
- `GET /healthz` returns `ok`.

## How the page works

Four plain files in `app/web/`, no build step and no generated output:

- `index.html` — document shell: head, `<div id="root">`, a
  `<script id="state" type="application/json">` block holding the empty default
  state, and tags for the other files. `schedule.js` must load before `app.js`.
- `style.css` — all CSS, mobile-first, colour tokens on `:root` for light/dark.
- `schedule.js` — **the timetable, and the only file you edit to change it.**
  Pure data: one `SCHEDULE` object with term settings, week types and their
  targets, deep-session categories, and the block list. Times are `"HH:MM"`
  strings and `day` takes `'Mon'`, a list, or `'*'`. Its header comment
  documents every field. Nothing in `app.js` needs to change when it does.
- `app.js` — one IIFE: expands `SCHEDULE.blocks` into per-day blocks, renders
  the two views, handles ticks and sync.

Edit them directly and reload.

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

Page edits are picked up on reload. Editing `server.py` — including adding a
file to `STATIC` — needs the process restarted, exactly like the container on
bmo; a page asking for a file the running process does not serve gets a 404 and
the app will not start. Hard-reload the browser after changing `app.js` or
`schedule.js`, since a normal reload may keep the cached copy.

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
