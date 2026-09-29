#!/usr/bin/env bash
# The server's HTTP contract, checked against a real instance on a throwaway
# DATA_DIR: every request gets a reply, nothing outside web/ is reachable, and
# a stale write is refused.
#
#   tools/check-server.sh        # exits 1 on the first wrong answer
set -uo pipefail
cd "$(dirname "$0")/.."

PORT=$(python3 -c 'import socket;s=socket.socket();s.bind(("127.0.0.1",0));print(s.getsockname()[1]);s.close()')
DATA=$(mktemp -d); LOG=$(mktemp)
DATA_DIR="$DATA" PORT="$PORT" python3 app/server.py >"$LOG" 2>&1 &
SRV=$!
trap 'kill $SRV 2>/dev/null; rm -rf "$DATA" "$LOG"' EXIT

for _ in $(seq 40); do curl -sf "http://127.0.0.1:$PORT/healthz" >/dev/null && break; sleep 0.1; done

fails=0
check() { # check <what> <want> <got>
  if [ "$2" = "$3" ]; then printf '  ok   %-46s %s\n' "$1" "$3"
  else printf '  FAIL %-46s got %s, want %s\n' "$1" "$3" "$2"; fails=$((fails+1)); fi
}
code() { curl -s -o /dev/null -w '%{http_code}' --path-as-is --max-time 10 "http://127.0.0.1:$PORT$1"; }
put()  { curl -s -o /dev/null -w '%{http_code}' -X PUT -H 'Content-Type: application/json' \
           --max-time 10 -d "$1" "http://127.0.0.1:$PORT/api/state"; }

echo "serving"
for f in / /index.html /style.css /schedule.js /app.js /sw.js /manifest.webmanifest /icon.svg /icon-192.png /apple-touch-icon.png /healthz; do
  check "GET $f" 200 "$(code $f)"
done
ctype() { curl -s -o /dev/null -w '%{content_type}' --max-time 10 "http://127.0.0.1:$PORT$1"; }
check "GET /icon-192.png claims no charset" "image/png" "$(ctype /icon-192.png)"

echo "refusing"
check "GET /api/state before any save"    404 "$(code /api/state)"
check "GET /missing.css"                  404 "$(code /missing.css)"
check "GET /server.py"                    404 "$(code /server.py)"
check "GET /schedule.ics (pushed, not served)" 404 "$(code /schedule.ics)"
check "GET /../server.py"                 404 "$(code /../server.py)"
check "GET /%2e%2e%2fserver.py"           404 "$(code /%2e%2e%2fserver.py)"
check "GET /sub/dir/app.js"               404 "$(code /sub/dir/app.js)"
check "GET /.hidden.js"                   404 "$(code /.hidden.js)"
# A name too long for the filesystem gets a 404, not a dropped connection.
check "GET /<400 chars>.js"               404 "$(code "/$(python3 -c 'print("a"*400)').js")"

echo "state"
check "PUT valid"                         200 "$(put '{"v":2,"savedAt":5000}')"
check "GET after save"                    200 "$(code /api/state)"
check "PUT stale (savedAt behind)"        409 "$(put '{"v":2,"savedAt":1}')"
check "PUT not JSON"                      400 "$(put 'nonsense')"
check "PUT a JSON array, not an object"   400 "$(put '[1,2,3]')"
check "PUT empty body"                    413 "$(put '')"
check "PUT over 64 KB"                    413 "$(put "$(python3 -c 'print("{\"a\":\"" + "x"*70000 + "\"}")')")"
# A non-numeric Content-Length gets a 400, not a dropped connection.
reply=$(printf 'PUT /api/state HTTP/1.1\r\nHost: x\r\nContent-Length: abc\r\n\r\n' \
  | timeout 5 python3 -c "
import socket,sys
s=socket.create_connection(('127.0.0.1',$PORT)); s.sendall(sys.stdin.buffer.read()); s.settimeout(3)
try: print(s.recv(200).decode(errors='replace').split()[1])
except Exception: print('no-reply')")
check "PUT non-numeric Content-Length"    400 "$reply"

echo "server log"
check "tracebacks in the log"             0 "$(grep -c Traceback "$LOG")"

echo
if [ $fails -eq 0 ]; then echo "server contract holds"; else echo "$fails server check(s) failed"; fi
exit $((fails > 0))
