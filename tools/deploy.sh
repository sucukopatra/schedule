#!/bin/sh
# Deploy the timetable to bmo.
#
#     tools/deploy.sh
#
# This lives in the repo rather than in ~/.zshrc so that a reinstalled laptop
# needs nothing but a clone of this repo to deploy again. Two things go up:
# app/, which the container serves, and tools/push-dav.py, which the calendar
# sidecar runs. Neither rsync can reach data/, where the ticks live.
#
# The calendar push runs on bmo, not here, through the schedule container that
# already exists -- it is already on the `core` network and already mounts the
# feed. The credentials live on bmo too, so this laptop holds nothing the
# server needs.
set -eu

host=${SCHEDULE_HOST:-bmo}
root=${SCHEDULE_ROOT:-/srv/docker/config/caddy/webpages/schedule}
src=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)

# --delete is safe here only because the target is app/, never the parent.
app_out=$(rsync -az --delete --itemize-changes "$src/app/" "$host:$root/app/")

# push-dav.py alone, not all of tools/: the checks have no business on the
# server. tools/ sits outside WEB_DIR (app/web), so none of it is reachable
# over HTTP.
ssh "$host" "mkdir -p '$root/tools'"
tools_out=$(rsync -az --itemize-changes "$src/tools/push-dav.py" "$host:$root/tools/")

# Deliberately not an early exit. The push below has to run even when the
# rsync moved nothing, or a push that failed once could never be retried by
# running the deploy again -- "Nothing changed" would swallow it every time.
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

# Push the timetable into Radicale, from inside the schedule container: the
# host cannot reach radicale:5232 (the stack uses `expose`, not `publish`), but
# anything on the `core` network can, which skips TLS, public DNS and Caddy.
#
# Unconditional, because it is cheap and idempotent, and a deploy is exactly
# when you are paying attention if it has anything to say.
#
# The credentials come from /srv/docker/.env by way of the service definition,
# the same as every other secret on that host; docker exec inherits the
# container's environment, so nothing is passed or sourced here.
#
# A failed push is not a failed deploy: the page is already live.
if ! ssh "$host" "docker exec schedule \
      python /tools/push-dav.py \
        --ics /app/web/schedule.ics \
        --url http://radicale:5232/ender/schedule/"; then
  echo "Calendar push failed. The page is live; phone reminders are stale."
fi
