#!/usr/bin/env python3
"""Push schedule.ics into a CalDAV collection, one resource per event.

This is how reminders reach the phone: schedule.js -> make-ics.js ->
schedule.ics -> here -> Radicale -> DAVx5 -> Fossify, where the alarms are
local and fire with the phone off the network. The whole chain has been walked
once, ending at a gym block reading 19:30 on the phone, which is what says the
floating times survived the trip.

Run --dry-run when pointing this anywhere new. Aimed at the wrong collection it
deletes nothing, but it does add 46 events you would then clear out by hand.

    python3 tools/push-dav.py                 # push, using $SCHEDULE_DAV_* or ~/.netrc
    python3 tools/push-dav.py --dry-run       # say what would change, touch nothing
    python3 tools/push-dav.py --url URL       # a collection other than the default

On bmo this is run by tools/deploy.sh through `docker exec` on the schedule
container, which is already on the `core` network and already mounts the feed.
The .ics only changes when the timetable is deployed, so a push at deploy time
is all there is to do -- nothing polls, and there is no service to maintain.

Radicale's `webcal` collection type does NOT mirror a feed -- it stores the
source URL as CS:source and expects the *client* to fetch it, which is why such
a collection shows zero items and why DAVx5 hands it off to ICSx5 instead of
syncing it. So the events are pushed here instead, and the collection on the
other end is an ordinary calendar.

Deletion is the part worth reading twice. Every event this repo generates has a
UID ending `@schedule.domatesis.com`. Anything in the collection that is no
longer in the feed is removed, but ONLY after fetching it and confirming it
carries that suffix -- so a stray event someone added by hand survives, and
pointing this at the wrong collection cannot quietly empty it.

Stdlib only: no pip, matching the rest of tools/.
"""

import argparse
import base64
import getpass
import netrc
import os
import re
import sys
import time
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path
from urllib.parse import unquote, urlparse

DEFAULT_URL = 'https://dav.domatesis.com/ender/schedule/'
UID_SUFFIX = '@schedule.domatesis.com'
ICS = Path(__file__).resolve().parent.parent / 'app' / 'web' / 'schedule.ics'
DAV = '{DAV:}'


class DavError(Exception):
    """Raised rather than exiting, so a failure returns a status the deploy can
    report instead of killing the shell it runs in."""


def die(msg):
    raise DavError(msg)


def say(msg):
    """Timestamped, because these lines land in a deploy log and an undated one
    tells you nothing six weeks later."""
    print(f'[{time.strftime("%Y-%m-%d %H:%M:%S")}] {msg}', flush=True)


# --- the feed ---------------------------------------------------------------

def split_events(text):
    """-> {resource name: single-event VCALENDAR}, keeping every line verbatim.

    The generator never folds a line, so events can be sliced out as-is rather
    than parsed and rebuilt. Input newlines are normalised because reading the
    file in text mode turns CRLF into LF; output is always CRLF, which RFC 5545
    requires and some servers enforce."""
    lines = text.replace('\r\n', '\n').split('\n')
    try:
        head = lines[:lines.index('BEGIN:VEVENT')]
    except ValueError:
        die(f'{ICS.name} holds no events -- run: node tools/make-ics.js')

    # Calendar-level properties belong to the collection, not to 46 copies of
    # one event; the collection's displayname is what clients show.
    head = [l for l in head if not l.startswith(('X-WR-CALNAME', 'REFRESH-INTERVAL',
                                                 'X-PUBLISHED-TTL'))]

    out, cur = {}, None
    for line in lines:
        if line == 'BEGIN:VEVENT':
            cur = [line]
        elif cur is not None:
            cur.append(line)
            if line == 'END:VEVENT':
                uid = next((l[4:] for l in cur if l.startswith('UID:')), None)
                if not uid:
                    die('an event in the feed has no UID')
                body = head + cur + ['END:VCALENDAR', '']
                out[resource_name(uid)] = '\r\n'.join(body)
                cur = None
    return out


def resource_name(uid):
    """`gym-Mon-19:30@schedule...` -> `gym-Mon-19-30-schedule....ics`.

    Stable, so a re-run updates in place instead of duplicating."""
    return re.sub(r'[^A-Za-z0-9._-]', '-', uid) + '.ics'


# --- HTTP -------------------------------------------------------------------

class Dav:
    def __init__(self, url, auth, dry_run):
        self.url = url if url.endswith('/') else url + '/'
        self.auth = auth
        self.dry_run = dry_run

    def request(self, method, url, body=None, headers=None, ok=(200, 201, 204, 207)):
        data = body.encode('utf-8') if body else None
        req = urllib.request.Request(url, data=data, method=method)
        req.add_header('Authorization', 'Basic ' + self.auth)
        for k, v in (headers or {}).items():
            req.add_header(k, v)
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return r.status, r.read().decode('utf-8', 'replace')
        except urllib.error.HTTPError as e:
            return e.code, e.read().decode('utf-8', 'replace')
        except urllib.error.URLError as e:
            die(f'{method} {url}: {e.reason}')

    def listing(self):
        """-> {resource name: href} for everything already in the collection."""
        body = ('<?xml version="1.0" encoding="utf-8"?>'
                '<d:propfind xmlns:d="DAV:"><d:prop><d:getetag/></d:prop></d:propfind>')
        status, text = self.request('PROPFIND', self.url, body,
                                    {'Depth': '1', 'Content-Type': 'application/xml'})
        if status == 404:
            return None
        if status != 207:
            die(f'PROPFIND returned {status}, expected 207:\n{text.strip()[:400]}')
        found = {}
        for resp in ET.fromstring(text).findall(DAV + 'response'):
            href = (resp.findtext(DAV + 'href') or '').strip()
            name = unquote(href.rstrip('/').rsplit('/', 1)[-1])
            if name.endswith('.ics'):
                found[name] = href
        return found

    def is_ours(self, href):
        """Only events this repo generated may be deleted."""
        status, text = self.request('GET', urljoin_host(self.url, href))
        if status != 200:
            return False
        return UID_SUFFIX in text

    def put(self, name, body):
        if self.dry_run:
            return 'would put'
        status, text = self.request('PUT', self.url + name, body,
                                    {'Content-Type': 'text/calendar; charset=utf-8'})
        if status not in (200, 201, 204):
            die(f'PUT {name} returned {status}:\n{text.strip()[:400]}')
        return 'put'

    def delete(self, href):
        if self.dry_run:
            return 'would delete'
        status, text = self.request('DELETE', urljoin_host(self.url, href))
        if status not in (200, 204, 404):
            die(f'DELETE {href} returned {status}:\n{text.strip()[:400]}')
        return 'deleted'

    def mkcalendar(self, title):
        if self.dry_run:
            return
        body = ('<?xml version="1.0" encoding="utf-8"?>'
                '<c:mkcalendar xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">'
                '<d:set><d:prop><d:displayname>' + title + '</d:displayname></d:prop></d:set>'
                '</c:mkcalendar>')
        status, text = self.request('MKCALENDAR', self.url, body,
                                    {'Content-Type': 'application/xml'})
        if status not in (201, 204):
            die(f'MKCALENDAR returned {status}:\n{text.strip()[:400]}')


def urljoin_host(base, href):
    """hrefs come back absolute-path; keep the scheme and host from the URL."""
    if href.startswith('http'):
        return href
    p = urlparse(base)
    return f'{p.scheme}://{p.netloc}{href}'


# --- credentials ------------------------------------------------------------

def credentials(url):
    """Env first, then ~/.netrc, then prompt. Never from argv -- that is
    visible in `ps` to every process on the machine."""
    user = os.environ.get('SCHEDULE_DAV_USER')
    password = os.environ.get('SCHEDULE_DAV_PASS')
    if user and password:
        return user, password, 'environment'

    host = urlparse(url).hostname
    try:
        auth = netrc.netrc().authenticators(host)
        if auth and auth[0] and auth[2]:
            return auth[0], auth[2], '~/.netrc'
    except (FileNotFoundError, netrc.NetrcParseError):
        pass

    if not sys.stdin.isatty():
        die('no credentials: set SCHEDULE_DAV_USER and SCHEDULE_DAV_PASS, '
            f'or add a ~/.netrc entry for {host}')
    user = user or input(f'{host} username: ')
    return user, getpass.getpass(f'{host} password: '), 'prompt'


# --- main -------------------------------------------------------------------

def sync_once(dav, ics, title, quiet=False):
    """One full pass. Returns the summary line."""
    if not ics.exists():
        die(f'{ics} is missing -- run: node tools/make-ics.js')
    want = split_events(ics.read_bytes().decode('utf-8'))

    have = dav.listing()
    if have is None:
        say(f'collection does not exist -- creating it as "{title}"')
        dav.mkcalendar(title)
        have = {}

    added = updated = 0
    for name, body in sorted(want.items()):
        if name in have:
            updated += 1
        else:
            added += 1
        dav.put(name, body)

    removed = kept = 0
    for name, href in sorted(have.items()):
        if name in want:
            continue
        if dav.is_ours(href):
            note = dav.delete(href)
            removed += 1
        else:
            note = 'left alone (not ours)'
            kept += 1
        if not quiet:
            say(f'  {note}: {name}')

    verb = 'would be' if dav.dry_run else 'were'
    return (f'{added} new, {updated} updated, {removed} removed'
            + (f', {kept} left alone' if kept else '')
            + f' -- {len(want)} events {verb} in the collection')


def main():
    ap = argparse.ArgumentParser(description='Push schedule.ics into a CalDAV collection.')
    ap.add_argument('--url', default=os.environ.get('SCHEDULE_DAV_URL', DEFAULT_URL))
    ap.add_argument('--ics', default=os.environ.get('SCHEDULE_ICS'), metavar='PATH',
                    help='the feed to push (default: app/web/schedule.ics beside this script)')
    ap.add_argument('--dry-run', action='store_true', help='report, change nothing')
    ap.add_argument('--title', default='Fall 2026', help='display name if the collection must be created')
    args = ap.parse_args()

    ics = Path(args.ics).resolve() if args.ics else ICS
    try:
        user, password, source = credentials(args.url)
    except DavError as e:
        print(f'  ERROR: {e}', file=sys.stderr)
        return 1
    auth = base64.b64encode(f'{user}:{password}'.encode('utf-8')).decode('ascii')
    dav = Dav(args.url, auth, args.dry_run)
    say(f'{dav.url}  (as {user}, credentials from {source})')
    if args.dry_run:
        say('dry run: nothing will be written')

    try:
        say(sync_once(dav, ics, args.title))
    except DavError as e:
        print(f'  ERROR: {e}', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
