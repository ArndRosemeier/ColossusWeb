#!/usr/bin/env python3
"""S7's browser-level check: the board with an OPPONENT's legion selected.

Why this exists. The owner's "I cannot move at all" was invisible to a DOM-free
suite: it was found by a browser, and the symptom is what the BOARD SHOWS. The
diagnosed chain (docs/DECISION-LEDGER.md row 13) is that `MasterBoardView` painted
`listEnemyMovePreview` (the union over rolls 1–6, 45 fields on the owner's real
state) while the click gate silently dispatched `deselectLegion` when
`getMovesForSelected` came back empty — the fields vanished ("the flash") and
NOTHING was published.

What this drives. The REAL built app in headless Chrome against a fake store on
the same origin (`VITE_SERVERSTORE_URL=/storeapi`, answered entirely by this
process), seeded from the READ-ONLY probe's fixture of the OWNER'S OWN snapshot
chain. No key material is used (the keys are made-up strings containing
`testonly`) and no request leaves this box. The Chrome tree is killed in
`finally`, success and failure alike.

The statements it proves, and they are read off the DOM, not inferred:

  host (seat 0, his own Move phase, roll 3)
   1. the board renders his game;
   2. selecting his own stack paints exactly the engine's roll-3 destinations
      (measured by the probe: leg-1@100 with roll 3 reaches 1, 5 and 141);
   3. selecting the OPPONENT's stack paints NO legal field and DOES paint the
      preview (kept as a feature, clearly distinct);
   4. a click on a previewed field is REFUSED — the selection survives, the
      fields do not vanish, a sentence appears on the message surface, and
      NOTHING is published;
   5. a click on a plain hex is still the DESELECT gesture and publishes nothing;
   6. a legitimate move by the active player still MOVES and PUBLISHES exactly
      one snapshot.

  guest (seat 1, the opponent's Move phase)
   7. the board paints NO actionable field at all (no legal rings, no preview);
   8. a click surfaces a reason on the message surface instead of doing nothing.

Run it after a subpath-free build:
  (cd web && VITE_SERVERSTORE_URL=/storeapi npx vite build \
      --outDir ../scripts/browser-check/s7-dist --emptyOutDir)
  python3 scripts/browser-check/s7-move-gate.py host
  python3 scripts/browser-check/s7-move-gate.py guest

The fixture (`scripts/browser-check/s7-fixture.json`) is COPYED from the
read-only probe at
`/home/administrator/projects/ColossusWeb/.gate-logs/probe-stuck/fixture.json`
(21 objects read from the live store, sha256-verified there); it is gitignored
scratch, so copy it before running. Exit 0 = every statement held.
"""

import argparse
import base64
import hashlib
import http.server
import json
import os
import shutil
import socket
import subprocess
import sys
import threading
import time
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
DIST = os.path.join(HERE, "s7-dist")
PROFILE = os.path.join(HERE, "s7-profile")
FIXTURE = os.environ.get("S7_FIXTURE", os.path.join(HERE, "s7-fixture.json"))
GAME = "number-1-8e21f4f8"
SEAT0_KEY = "ssk_FPYGNDslev_p_testonlysecret"  # made up; id is between ssk_ and _testonly
SEAT1_KEY = "ssk_i9PGQ7wIj971_testonlysecret"
ACTIVE_KEY = "colossusweb.multiplayer.v1"
KEY_KEY = "colossusweb.key.v1"

with open(FIXTURE, "r", encoding="utf8") as fh:
    FX = json.load(fh)
SNAP_PREFIX = "snap.%s." % GAME


class Store:
    """The fake ServerStore: name -> body, plus every PUT the app made."""

    def __init__(self, names):
        self.objects = {}
        self.puts = []
        for name in names:
            self.objects[name] = FX[name]["body"]

    def put(self, name, body):
        self.objects[name] = body
        parsed = json.loads(body)
        self.puts.append({"name": name, "body": parsed})

    def listing(self, prefix):
        out = []
        for name, body in sorted(self.objects.items()):
            if prefix and not name.startswith(prefix):
                continue
            data = body.encode()
            out.append(
                {
                    "store": "colossus",
                    "name": name,
                    "sha256": hashlib.sha256(data).hexdigest(),
                    "size": len(data),
                    "createdAt": "2026-09-28T09:00:00.000Z",
                }
            )
        return out


STORE = None
REQUEST_LOG = []


class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def _send(self, code, body, ctype="application/json", extra=None):
        REQUEST_LOG.append("%s %s -> %s" % (self.command, self.path, code))
        data = body.encode() if isinstance(body, str) else body
        self.send_response(code)
        self.send_header("content-type", ctype)
        self.send_header("content-length", str(len(data)))
        for key, value in (extra or {}).items():
            self.send_header(key, value)
        self.end_headers()
        self.wfile.write(data)

    def do_OPTIONS(self):
        self._send(
            204,
            "",
            extra={
                "access-control-allow-origin": "*",
                "access-control-allow-methods": "GET, PUT, DELETE, OPTIONS",
                "access-control-allow-headers": "authorization, content-type",
            },
        )

    def do_GET(self):
        if self.path.startswith("/storeapi"):
            return self.api("GET")
        path = self.path.split("?")[0]
        if path == "/":
            path = "/index.html"
        target = os.path.normpath(os.path.join(DIST, path.lstrip("/")))
        if not target.startswith(DIST) or not os.path.isfile(target):
            return self._send(404, "not found", "text/plain")
        if target.endswith(".html"):
            ctype = "text/html"
        elif target.endswith(".js"):
            ctype = "application/javascript"
        elif target.endswith(".css"):
            ctype = "text/css"
        elif target.endswith(".json"):
            ctype = "application/json"
        else:
            ctype = "application/octet-stream"
        with open(target, "rb") as fh:
            return self._send(200, fh.read(), ctype)

    def do_PUT(self):
        return self.api("PUT")

    def do_DELETE(self):
        return self.api("DELETE")

    def do_POST(self):
        return self.api("POST")

    def api(self, method):
        auth = self.headers.get("authorization") or ""
        key = auth.replace("Bearer ", "")
        identity = key.split("_testonly")[0].replace("ssk_", "") if "_testonly" in key else "FPYGNDslev_p"
        path = self.path.split("?")[0][len("/storeapi") :]
        query = {}
        if "?" in self.path:
            for pair in self.path.split("?", 1)[1].split("&"):
                if "=" in pair:
                    k, v = pair.split("=", 1)
                    query[k] = urllib.parse.unquote(v)
        if path == "/whoami":
            return self._send(
                200,
                json.dumps(
                    {
                        "id": identity,
                        "label": "Test" if identity.startswith("FPY") else "Test2",
                        "stores": ["colossus"],
                        "perms": ["read", "write"],
                    }
                ),
            )
        if path.startswith("/stores/colossus/objects"):
            rest = path[len("/stores/colossus/objects") :].lstrip("/")
            if not rest:
                return self._send(200, json.dumps({"objects": STORE.listing(query.get("prefix", ""))}))
            name = urllib.parse.unquote(rest)
            if method == "GET":
                if name not in STORE.objects:
                    return self._send(404, json.dumps({"error": {"code": "not_found", "message": name}}))
                body = STORE.objects[name]
                sha = hashlib.sha256(body.encode()).hexdigest()
                return self._send(200, body, extra={"x-serverstore-sha256": sha})
            if method == "PUT":
                length = int(self.headers.get("content-length") or 0)
                body = self.rfile.read(length).decode()
                STORE.put(name, body)
                data = body.encode()
                return self._send(
                    200,
                    json.dumps(
                        {
                            "store": "colossus",
                            "name": name,
                            "sha256": hashlib.sha256(data).hexdigest(),
                            "size": len(data),
                            "createdAt": "2026-09-28T09:00:00.000Z",
                        }
                    ),
                )
        return self._send(404, json.dumps({"error": {"code": "not_found", "message": path}}))


class WS:
    def __init__(self, url):
        self.url, self.buf, self.next_id = url, b"", 1

    def connect(self):
        rest = self.url.split("://", 1)[1]
        hostport, path = rest.split("/", 1)
        host, port = hostport.split(":")
        self.sock = socket.create_connection((host, int(port)), timeout=10)
        key = base64.b64encode(os.urandom(16)).decode()
        self.sock.sendall(
            (
                "GET /%s HTTP/1.1\r\nHost: %s\r\nUpgrade: websocket\r\n"
                "Connection: Upgrade\r\nSec-WebSocket-Key: %s\r\n"
                "Sec-WebSocket-Version: 13\r\n\r\n" % (path, hostport, key)
            ).encode()
        )
        data = b""
        while b"\r\n\r\n" not in data:
            data += self.sock.recv(4096)
        assert b"101" in data.split(b"\r\n")[0], data[:200]

    def send(self, text):
        payload, mask = text.encode(), os.urandom(4)
        n = len(payload)
        if n < 126:
            header = bytes([0x81, 0x80 | n])
        elif n < 65536:
            header = bytes([0x81, 0x80 | 126]) + n.to_bytes(2, "big")
        else:
            header = bytes([0x81, 0x80 | 127]) + n.to_bytes(8, "big")
        self.sock.sendall(header + mask + bytes(b ^ mask[i % 4] for i, b in enumerate(payload)))

    def _read(self, n):
        while len(self.buf) < n:
            chunk = self.sock.recv(65536)
            if not chunk:
                raise ConnectionError("closed")
            self.buf += chunk
        out, self.buf = self.buf[:n], self.buf[n:]
        return out

    def recv(self):
        while True:
            b0, b1 = self._read(2)
            op, ln = b0 & 0x0F, b1 & 0x7F
            if ln == 126:
                ln = int.from_bytes(self._read(2), "big")
            elif ln == 127:
                ln = int.from_bytes(self._read(8), "big")
            payload = self._read(ln)
            if op == 0x8:
                raise ConnectionError("closed")
            if op == 0x1:
                return payload.decode()

    def call(self, method, params=None):
        mid = self.next_id
        self.next_id += 1
        self.send(json.dumps({"id": mid, "method": method, "params": params or {}}))
        while True:
            msg = json.loads(self.recv())
            if msg.get("id") == mid:
                return msg


def free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


class App:
    """The DOM reads the check is built on — every statement is one of these."""

    def __init__(self, ws):
        self.ws = ws

    def ev(self, expr):
        r = self.ws.call("Runtime.evaluate", {"expression": expr, "returnByValue": True, "awaitPromise": True})
        res = r.get("result", {})
        if "exceptionDetails" in res:
            return {"__error__": str(res["exceptionDetails"])[:300]}
        return res.get("result", {}).get("value")

    def center(self, selector_js):
        return self.ev(
            "(() => { const el = %s; if (!el) return null;"
            " const r = el.getBoundingClientRect();"
            " return JSON.stringify({x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2)}); })()"
            % selector_js
        )

    def real_click(self, selector_js):
        c = self.center(selector_js)
        if c is None:
            return False
        pt = json.loads(c)
        for t in ("mousePressed", "mouseReleased"):
            self.ws.call(
                "Input.dispatchMouseEvent",
                {"type": t, "x": pt["x"], "y": pt["y"], "button": "left", "clickCount": 1},
            )
            time.sleep(0.08)
        return True

    def rings(self):
        return json.loads(
            self.ev(
                """JSON.stringify([...document.querySelectorAll('g[data-hex]')]
                    .filter(g => g.querySelector('.legal-hex-stroke'))
                    .map(g => g.getAttribute('data-hex')))"""
            )
            or "[]"
        )

    def previews(self):
        return json.loads(
            self.ev(
                """JSON.stringify([...document.querySelectorAll('g[data-hex]')]
                    .filter(g => g.querySelector('.preview-hex-stroke'))
                    .map(g => g.getAttribute('data-hex')))"""
            )
            or "[]"
        )

    def all_hexes(self):
        return json.loads(
            self.ev("JSON.stringify([...document.querySelectorAll('g[data-hex]')].map(g => g.getAttribute('data-hex')))")
            or "[]"
        )

    def selected(self):
        return json.loads(
            self.ev(
                """JSON.stringify([...document.querySelectorAll('[data-legion]')]
                    .filter(g => [...g.querySelectorAll('rect')].some(r => r.getAttribute('stroke') === '#e08a45'))
                    .map(g => g.getAttribute('data-legion')))"""
            )
            or "[]"
        )

    def message(self):
        return self.ev("(document.querySelector('.message')||{}).textContent || ''")

    def tray(self):
        return self.ev("(document.querySelector('.dice-tray-meta')||{}).textContent || ''")

    def wait_for(self, expr, timeout=30, what=""):
        deadline = time.time() + timeout
        while time.time() < deadline:
            if self.ev(expr):
                return True
            time.sleep(0.25)
        raise AssertionError("timed out waiting for %s" % (what or expr))


class Check:
    def __init__(self, label):
        self.label = label
        self.failures = []
        self.count = 0

    def ok(self, name, cond, detail=""):
        self.count += 1
        tag = "PASS" if cond else "FAIL"
        line = "%s %s" % (tag, name)
        if not cond and detail:
            line += " — %s" % detail
        print(line)
        sys.stdout.flush()
        if not cond:
            self.failures.append((name, detail))


def snapshots(state):
    return [p for p in STORE.puts if p["name"].startswith(SNAP_PREFIX)]


def run(check, mode):
    global STORE

    all_snaps = sorted(n for n in FX if n.startswith(SNAP_PREFIX))
    tail = ["game.%s" % GAME, "player.%s.fpygndsl" % GAME, "player.%s.i9pgq7wi" % GAME]
    if mode == "host":
        seed = list(all_snaps) + tail
    else:
        seed = [n for n in all_snaps if n <= "%s0001.015.i9pgq7wi" % SNAP_PREFIX] + tail
    STORE = Store(seed)

    site_port = free_port()
    httpd = http.server.ThreadingHTTPServer(("127.0.0.1", site_port), Handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    cdp_port = free_port()
    shutil.rmtree(PROFILE, ignore_errors=True)
    log = open(os.path.join(HERE, "s7-chrome.log"), "w")
    chrome = subprocess.Popen(
        [
            "google-chrome",
            "--headless=new",
            "--disable-gpu",
            "--no-sandbox",
            "--hide-scrollbars",
            "--disable-dev-shm-usage",
            "--force-prefers-reduced-motion",
            "--user-data-dir=%s" % PROFILE,
            "--window-size=1600,1200",
            "--remote-debugging-port=%d" % cdp_port,
            "about:blank",
        ],
        stdout=log,
        stderr=log,
        start_new_session=True,
    )
    try:
        ws_url = None
        for _ in range(150):
            try:
                with urllib.request.urlopen("http://127.0.0.1:%d/json/list" % cdp_port, timeout=1) as r:
                    page = next((t for t in json.load(r) if t.get("type") == "page"), None)
                if page:
                    ws_url = page["webSocketDebuggerUrl"]
                    break
            except Exception:
                time.sleep(0.2)
        assert ws_url, "no page target"
        ws = WS(ws_url)
        ws.connect()
        for m in ("Runtime.enable", "Page.enable", "Network.enable"):
            ws.call(m)
        seat_key = SEAT1_KEY if mode == "guest" else SEAT0_KEY
        ws.call(
            "Page.addScriptToEvaluateOnNewDocument",
            {
                "source": "try { localStorage.setItem('%s', '%s'); localStorage.setItem('%s', JSON.stringify({version:1, gameId:'%s'})); } catch (e) {}"
                % (KEY_KEY, seat_key, ACTIVE_KEY, GAME)
            },
        )
        app = App(ws)
        ws.call("Page.navigate", {"url": "http://127.0.0.1:%d/index.html" % site_port})
        app.wait_for("!!document.querySelector('.lobby-panel')", 25, "lobby")
        # The Enter-game button is disabled while the lobby is refreshing, and a
        # click on a disabled button is a no-op — retry until the board renders.
        deadline = time.time() + 45
        while time.time() < deadline and not app.ev("!!document.querySelector('svg.master-board')"):
            app.ev(
                "(() => { const b=[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Enter game'));"
                " if (b && !b.disabled) { b.click(); return true; } return false; })()"
            )
            time.sleep(1.0)
        if not app.ev("!!document.querySelector('svg.master-board')"):
            print("DEBUG after Enter game: %r" % (app.ev("document.body.innerText") or "")[:600])
            print("DEBUG requests: %r" % REQUEST_LOG[-15:])
            raise AssertionError("could not enter the game (board never rendered)")
        time.sleep(1.5)

        if mode == "guest":
            # Adopt p0's turn while seat 1 is the watcher, carrying its own selection.
            for name in ("%s0002.000.i9pgq7wi" % SNAP_PREFIX, "%s0002.001.fpygndsl" % SNAP_PREFIX):
                STORE.put(name, FX[name]["body"])
                time.sleep(3.4)
            guest_statements(check, app)
        else:
            host_statements(check, app)
    finally:
        try:
            os.killpg(os.getpgid(chrome.pid), 15)
        except Exception:
            pass
        try:
            chrome.wait(timeout=8)
        except Exception:
            try:
                os.killpg(os.getpgid(chrome.pid), 9)
            except Exception:
                pass
        httpd.shutdown()
        log.close()
        shutil.rmtree(PROFILE, ignore_errors=True)


def host_statements(check, app):
    check.ok("board renders his game", "movement" in app.tray(), "tray=%r" % app.tray())

    # 2 · his OWN stack: the paint is the engine's roll-3 set (probe: 1, 5, 141)
    app.real_click("document.querySelector('[data-legion=\"leg-1\"]')")
    time.sleep(0.7)
    own = app.rings()
    check.ok(
        "selecting his own stack paints exactly the engine's roll-3 destinations",
        set(own) == {"1", "5", "141"},
        "rings=%r" % own,
    )

    # 3 · the OPPONENT's stack: preview painted, nothing painted as a destination
    app.real_click("document.querySelector('[data-legion=\"leg-2\"]')")
    time.sleep(0.7)
    previews = app.previews()
    check.ok("opponent selected: NO field is painted as a legal destination", app.rings() == [], "rings=%r" % app.rings())
    check.ok("opponent selected: the move PREVIEW is painted (the feature survives)", len(previews) > 0, "previews=%d" % len(previews))
    check.ok("opponent selected: the opponent is the selected legion", app.selected() == ["leg-2"], "selected=%r" % app.selected())

    # 4 · the owner's trap: a click on a previewed field must be REFUSED, loudly
    before = len(snapshots(STORE))
    app.real_click("document.querySelector('g[data-hex=\"%s\"]')" % previews[0])
    time.sleep(1.5)
    after = len(snapshots(STORE))
    message = app.message()
    check.ok("CLICKING A PREVIEWED FIELD DOES NOT DESELECT (the owner's trap)", app.selected() == ["leg-2"], "selected=%r" % app.selected())
    check.ok("the previewed fields do NOT vanish", app.previews() == previews, "previews=%d" % len(app.previews()))
    check.ok("nothing is published", after == before, "PUTs %d -> %d" % (before, after))
    check.ok(
        "a sentence explains the refusal on the message surface",
        ("preview" in message.lower()) and ("not a destination" in message.lower() or "own legions" in message.lower()),
        "message=%r" % message,
    )

    # 5 · a plain hex is still the deselect gesture and publishes nothing
    before = len(snapshots(STORE))
    plain = [h for h in app.all_hexes() if h not in previews and h not in own]
    check.ok("a plain hex exists to click", len(plain) > 0, "hexes=%d" % len(plain))
    app.real_click("document.querySelector('g[data-hex=\"%s\"]')" % plain[0])
    time.sleep(1.0)
    check.ok("a plain hex still DESELECTS", app.selected() == [], "selected=%r" % app.selected())
    check.ok("a deselect publishes nothing", len(snapshots(STORE)) == before, "PUTs %d -> %d" % (before, len(snapshots(STORE))))

    # 6 · a legitimate move by the active player still moves and publishes ONCE
    app.real_click("document.querySelector('[data-legion=\"leg-1\"]')")
    time.sleep(0.7)
    targets = app.rings()
    check.ok("re-selecting his own stack restores the roll-3 destinations", set(targets) == {"1", "5", "141"}, "rings=%r" % targets)
    before = len(snapshots(STORE))
    target = targets[0]
    app.real_click("document.querySelector('g[data-hex=\"%s\"]')" % target)
    time.sleep(2.5)
    published = snapshots(STORE)
    check.ok("a legal move still publishes exactly ONE snapshot", len(published) == before + 1, "PUTs %d -> %d" % (before, len(published)))
    if len(published) > before:
        legions = published[-1]["body"]["state"]["state"]["legions"]
        moved = next((l for l in legions if l["id"] == "leg-1"), None)
        check.ok("the moved legion is on the clicked destination", moved is not None and moved["hexLabel"] == target, "leg-1=%r target=%r" % (moved and moved.get("hexLabel"), target))


def guest_statements(check, app):
    check.ok("the guest client is on the opponent's turn", "movement" in app.tray(), "tray=%r" % app.tray())
    check.ok("a guest paints NO legal destination", app.rings() == [], "rings=%r" % app.rings())
    check.ok("a guest paints NO preview either", app.previews() == [], "previews=%r" % app.previews())

    before = len(snapshots(STORE))
    app.real_click("document.querySelector('g[data-hex=\"1\"]')")
    time.sleep(1.0)
    message = app.message()
    check.ok(
        "a guest's click surfaces a reason instead of doing nothing",
        ("turn" in message.lower()) or ("watching" in message.lower()),
        "message=%r" % message,
    )
    check.ok("a guest's click publishes nothing", len(snapshots(STORE)) == before, "PUTs %d -> %d" % (before, len(snapshots(STORE))))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("mode", choices=["host", "guest"])
    args = ap.parse_args()
    check = Check(args.mode)
    run(check, args.mode)
    print("\n%s: %d statements, %d failed" % (args.mode, check.count, len(check.failures)))
    if check.failures:
        for name, detail in check.failures:
            print("  FAILED: %s — %s" % (name, detail))
        sys.exit(1)
    print("%s: ALL STATEMENTS HELD" % args.mode)
    sys.exit(0)


if __name__ == "__main__":
    main()
