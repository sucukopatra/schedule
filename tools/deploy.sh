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
# Nothing here talks to Radicale. The calendar push runs on bmo now, watching
# the deployed schedule.ics, so it keeps working whether or not this laptop
# still exists. That is the whole point of the split.
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

if [ -z "$app_out$tools_out" ]; then
  echo "Nothing changed."
  exit 0
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

# The sidecar holds push-dav.py in memory for as long as it runs, so a new
# copy on disk means nothing until it is restarted.
case $tools_out in
  *push-dav.py*)
    ssh "$host" 'cd /srv/docker && docker compose up -d --force-recreate schedule-calendar'
    echo "Recreated schedule-calendar (push-dav.py changed)."
    ;;
esac

# The .ics is picked up by the sidecar on its own, within --poll seconds.
