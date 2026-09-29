#!/bin/sh
# Deploy the timetable to bmo.
#
#     tools/deploy.sh
#
# Two things go up: app/, which the container serves, and tools/push-dav.py,
# which the push at the end runs. Neither rsync can reach data/, where the
# ticks live. The push runs on bmo, inside the schedule container, with the
# credentials it already carries, so this laptop holds nothing the server needs.
set -eu

host=${SCHEDULE_HOST:-bmo}
root=${SCHEDULE_ROOT:-/srv/docker/config/caddy/webpages/schedule}
src=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)

# Refuse to ship anything the checks reject. check-schedule.js matters most:
# nothing validates schedule.js at runtime, and it fails when schedule.ics no
# longer matches it, which would reach the phone as alarms at the wrong time.
# Quiet unless one fails: the notes they print on a clean run are not deploy news.
for check in "node tools/check-schedule.js" "node tools/check-sync.js" \
             "node tools/check-plan.js" "tools/check-server.sh"; do
  if ! out=$(cd "$src" && $check 2>&1); then
    printf '%s\n' "$out"
    echo "Refusing to deploy: $check failed. A stale .ics is: node tools/make-ics.js"
    exit 1
  fi
done

# --delete is safe here only because the target is app/, never the parent.
app_out=$(rsync -az --delete --itemize-changes "$src/app/" "$host:$root/app/")

# push-dav.py alone, not all of tools/: the checks have no business on the
# server. tools/ sits outside WEB_DIR (app/web), so none of it is reachable
# over HTTP.
ssh "$host" "mkdir -p '$root/tools'"
tools_out=$(rsync -az --itemize-changes "$src/tools/push-dav.py" "$host:$root/tools/")

# Deliberately not an early exit: the push below has to run even when nothing
# moved, so that deploying again retries a push that failed.
if [ -z "$app_out$tools_out" ]; then
  echo "Nothing changed."
fi
if [ -n "$app_out" ]; then echo "$app_out"; fi
if [ -n "$tools_out" ]; then echo "$tools_out"; fi

# Page changes need no restart; server.py does. --force-recreate is not
# optional: compose compares the service definition, not the code, and
# server.py arrives through a bind mount -- without it compose prints
# "Container schedule Running", leaves the old process up, and the newer files
# 404 while index.html asks for them.
case $app_out in
  *server.py*)
    ssh "$host" 'cd /srv/docker && docker compose up -d --force-recreate schedule'
    echo "Recreated schedule (server.py changed)."
    ;;
esac

# From inside the container because the host cannot reach radicale:5232 (the
# stack uses `expose`, not `publish`), but anything on the `core` network can.
# docker exec inherits the container's environment, which holds the
# credentials from /srv/docker/.env. The feed is at /app/schedule.ics, where
# push-dav.py looks by default.
#
# A failed push is not a failed deploy: the page is already live.
if ! ssh "$host" "docker exec schedule \
      python /tools/push-dav.py --url http://radicale:5232/ender/schedule/"; then
  echo "Calendar push failed. The page is live; phone reminders are stale."
fi
