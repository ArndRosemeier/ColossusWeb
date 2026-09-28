#!/usr/bin/env python3
"""S9's browser-level check: GIVE UP (outside a battle) and DELETE a game.

Why this exists. Both features are UI flows, and the one that matters most cannot
be seen from a DOM-free suite at all: the owner's live keys carry `read,write` and
NO `delete` (ServerStore makes `delete` opt-in), so the EXPECTED outcome today is a
store refusal — and "the app must never claim a game was deleted when it was not"
is a statement about what is ON SCREEN. So this check drives the REAL built app in
headless Chrome against a fake ServerStore on the same origin, and reads the DOM.

What it proves, mode by mode:

  delete-denied (the owner's TODAY case: the store refuses DELETE with 403)
   1. a game the caller JOINED is offered a delete; a game they never joined is NOT;
   2. the confirmation NAMES the game and counts what would go (snapshots, players,
      the record) before anything is removed;
   3. pressing Delete shows the store's OWN code and message, says NOT deleted, says
      what remains, and adds the actionable sentence about granting the permission;
   4. NOTHING was removed — the game is still listed, and so is the other one.

  delete-granted (the same store, DELETE allowed)
   5. the whole game goes: every snapshot, every player object and the record;
   6. the OTHER game — one the caller never joined — is untouched, byte for byte.

  resign (a started two-human game, the caller to move)
   7. "Give up the game" is offered, ENABLED, outside a battle;
   8. the first press asks for confirmation and names the player and the legions;
   9. the second press ENDS the game for two players: the resigner is eliminated,
      every one of their legions has left the board, the opponent has won, and the
      winner is announced on the client — and the reason in the log never claims a
      Titan was slain;
  10. the ending is FINAL: a further resign command changes nothing.

  in-battle (the same game with a battle running)
  11. the give-up control is DISABLED, with the engine's own reason ON SCREEN —
      "Cannot give up during a battle — concede the battle instead" — never a
      silently absent button, and the engine refuses the command as a backstop.

No key material is used (the keys are made-up strings containing `testonly`) and no
request leaves this box. The Chrome tree is killed in `finally`, success and
failure alike.

Run it after a non-production build:

  (cd web && npx vitest run --config scripts/browser-check/vitest.config.s9.ts)
  (cd web && VITE_SERVERSTORE_URL=/storeapi npx vite build --mode test \\
      --outDir ../scripts/browser-check/s9-dist --emptyOutDir)
  python3 scripts/browser-check/s9-game-hygiene.py delete-denied
  python3 scripts/browser-check/s9-game-hygiene.py delete-granted
  python3 scripts/browser-check/s9-game-hygiene.py resign
  python3 scripts/browser-check/s9-game-hygiene.py in-battle
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
DIST = os.environ.get("S9_SITE", os.path.join(HERE, "s9-dist"))
PROFILE = os.path.join(HERE, "s9-profile")
FIXTURE = os.environ.get("S9_FIXTURE", os.path.join(HERE, "s9-fixture.json"))
KEY_KEY = "colossusweb.key.v1"
ACTIVE_KEY = "colossusweb.multiplayer.v1"
SAVE_KEY = "colossusweb.save.v1"
# Made-up keys whose `_testonly` marker keeps the fake store's identity split.
CALLER_KEY = "ssk_FPYGNDslev_p_testonlysecret"  # the caller -> FPYGNDslev_p
OTHER_KEY = "ssk_i9PGQ7wIj971_testonlysecret"  # the other player -> i9PGQ7wIj971
# Server-side switches for the ONE thing this check is about.
DENY_DELETE = os.environ.get("S9_DENY_DELETE", "1") == "1"
PERMS = os.environ.get("S9_PERMS", "read,write")

with open(FIXTURE, "r", encoding="utf8") as fh:
    FX = json.load(fh)

MINE = FX["mine"]
THEIRS = FX["theirs"]
RESIGN = FX["resign"]


class Store:
    """The fake ServerStore: name -> body, plus every PUT and DELETE the app made."""

    def __init__(self, bodies):
        self.objects = dict(bodies)
        self.puts = []
        self.deletes = []
        self.denied = []

    def put(self, name, body):
        self.objects[name] = body
        self.puts.append(name)

    def delete(self, name):
        if DENY_DELETE:
            self.denied.append(name)
            return False
        self.objects.pop(name, None)
        self.deletes.append(name)
        return True

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
                    "createdAt": "2026-09-29T10:00:00.000Z",
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
        ctype = {
            ".html": "text/html",
            ".js": "application/javascript",
            ".css": "text/css",
            ".json": "application/json",
        }.get(os.path.splitext(target)[1], "application/octet-stream")
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
        identity = (
            key.split("_testonly")[0].replace("ssk_", "") if "_testonly" in key else "FPYGNDslev_p"
        )
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
                        # THE MEASURED BLOCKER: these are the owner's live perms.
                        "perms": [p for p in PERMS.split(",") if p],
                    }
                ),
            )
        if path.startswith("/stores/colossus/objects"):
            rest = path[len("/stores/colossus/objects") :].lstrip("/")
            if not rest:
                return self._send(
                    200, json.dumps({"objects": STORE.listing(query.get("prefix", ""))})
                )
            name = urllib.parse.unquote(rest)
            if method == "GET":
                if name not in STORE.objects:
                    return self._send(
                        404, json.dumps({"error": {"code": "not_found", "message": name}})
                    )
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
                            "createdAt": "2026-09-29T10:00:00.000Z",
                        }
                    ),
                )
            if method == "DELETE":
                if STORE.delete(name):
                    return self._send(204, b"", "application/json")
                # `delete` is OPT-IN in ServerStore; a key without it gets a 403
                # with the service's own envelope.
                return self._send(
                    403,
                    json.dumps(
                        {
                            "error": {
                                "code": "forbidden",
                                "message": "key is not allowed to delete objects",
                            }
                        }
                    ),
                )
        return self._send(404, json.dumps({"error": {"code": "not_found", "message": path}}))


class WS:
    """A minimal DevTools-Protocol client (its own WebSocket; no library)."""

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
                "Connection: Upgrade\r\nSec-WebSocket-Key: %s\r\nSec-WebSocket-Version: 13\r\n\r\n"
                % (path, hostport, key)
            ).encode()
        )
        data = b""
        while b"\r\n\r\n" not in data:
            data = data + self.sock.recv(4096)
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
        r = self.ws.call(
            "Runtime.evaluate", {"expression": expr, "returnByValue": True, "awaitPromise": True}
        )
        res = r.get("result", {})
        if "exceptionDetails" in res:
            return {"__error__": str(res["exceptionDetails"])[:300]}
        return res.get("result", {}).get("value")

    def click_text(self, label, selector="button"):
        """Press the button whose trimmed text is exactly `label`."""
        return self.ev(
            "(() => { const b=[...document.querySelectorAll(%s)]"
            ".find(b => (b.textContent||'').trim() === %s);"
            " if (!b || b.disabled) return false; b.click(); return true; })()"
            % (json.dumps(selector), json.dumps(label))
        )

    def delete_buttons(self):
        return json.loads(
            self.ev(
                "JSON.stringify([...document.querySelectorAll('button.lobby-delete-btn')]"
                ".map(b => b.getAttribute('data-game')))"
            )
            or "[]"
        )

    def delete_card_text(self):
        return self.ev(
            "(document.querySelector('.lobby-delete-card')||{}).textContent || ''"
        )

    def give_up_buttons(self):
        return json.loads(
            self.ev(
                "JSON.stringify([...document.querySelectorAll('button.give-up-btn')]"
                ".map(b => ({player: b.getAttribute('data-player'), label: (b.textContent||'').trim(), disabled: !!b.disabled})))"
            )
            or "[]"
        )

    def give_up_text(self):
        return self.ev("(document.querySelector('.give-up')||{}).textContent || ''")

    def message(self):
        return self.ev("(document.querySelector('.message')||{}).textContent || ''")

    def topbar(self):
        return self.ev("(document.querySelector('.topbar')||{}).textContent || ''")

    def saved_state(self):
        raw = self.ev("localStorage.getItem(%s)" % json.dumps(SAVE_KEY))
        if not raw:
            return None
        try:
            blob = json.loads(raw)
        except Exception:
            return None
        return blob.get("state")

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


def seed_bodies(mode):
    """Every object the fake store starts with, per mode."""
    bodies = {
        "game.%s" % MINE["gameId"]: MINE["record"],
        "game.%s" % THEIRS["gameId"]: THEIRS["record"],
    }
    # `players` are bodies in fixture order: mine[0] = caller, mine[1] = other.
    bodies["player.%s.%s" % (MINE["gameId"], FX["caller"]["tag"])] = MINE["players"][0]
    bodies["player.%s.%s" % (MINE["gameId"], FX["other"]["tag"])] = MINE["players"][1]
    bodies["player.%s.%s" % (THEIRS["gameId"], FX["other"]["tag"])] = THEIRS["players"][0]
    for name, body in zip(MINE["snapshotNames"], MINE["snapshots"]):
        bodies[name] = body
    for name, body in zip(THEIRS["snapshotNames"], THEIRS["snapshots"]):
        bodies[name] = body
    if mode in ("resign", "in-battle"):
        bodies["game.%s" % RESIGN["gameId"]] = RESIGN["record"]
        bodies["player.%s.%s" % (RESIGN["gameId"], FX["caller"]["tag"])] = RESIGN["players"][0]
        bodies["player.%s.%s" % (RESIGN["gameId"], FX["other"]["tag"])] = RESIGN["players"][1]
        if mode == "in-battle":
            # ONLY the battle snapshot: the app adopts the newest, so the game
            # resumes with the battle running.
            bodies[RESIGN["inBattleSnapshotName"]] = RESIGN["inBattleSnapshot"]
        else:
            bodies[RESIGN["snapshotName"]] = RESIGN["snapshot"]
    return bodies


def run(check, mode):
    global STORE
    STORE = Store(seed_bodies(mode))

    site_port = free_port()
    httpd = http.server.ThreadingHTTPServer(("127.0.0.1", site_port), Handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    cdp_port = free_port()
    shutil.rmtree(PROFILE, ignore_errors=True)
    log = open(os.path.join(HERE, "s9-chrome.log"), "w")
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
                with urllib.request.urlopen(
                    "http://127.0.0.1:%d/json/list" % cdp_port, timeout=1
                ) as r:
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
        # The RESIGN mode resumes a game; the delete modes must stay in the LOBBY,
        # so no active-game pointer is written for them.
        active = (
            "localStorage.setItem('%s', JSON.stringify({version:1, gameId:'%s'}));"
            % (ACTIVE_KEY, RESIGN["gameId"])
            if mode in ("resign", "in-battle")
            else "localStorage.removeItem('%s');" % ACTIVE_KEY
        )
        ws.call(
            "Page.addScriptToEvaluateOnNewDocument",
            {
                "source": (
                    "try { localStorage.clear();"
                    " localStorage.setItem('%s', '%s');"
                    " %s } catch (e) {}"
                )
                % (KEY_KEY, CALLER_KEY, active),
            },
        )
        app = App(ws)
        ws.call("Page.navigate", {"url": "http://127.0.0.1:%d/index.html" % site_port})
        app.wait_for("!!document.querySelector('.lobby-panel')", 25, "lobby")
        if mode in ("resign", "in-battle"):
            # The Enter-game button is disabled while the lobby refreshes, and a
            # click on a disabled button is a silent no-op — retry until the board
            # renders (S7/S8 both record this trap).
            # A battle renders the BATTLE board, not the master board (the
            # `in-battle` mode resumes straight into one), so either counts.
            board = (
                "!!document.querySelector('svg.master-board')"
                " || !!document.querySelector('.battle-board')"
                " || !!document.querySelector('svg.battle-board')"
            )
            deadline = time.time() + 45
            while time.time() < deadline and not app.ev(board):
                app.ev(
                    "(() => { const b=[...document.querySelectorAll('button')]"
                    ".find(b=>b.textContent.includes('Enter game'));"
                    " if (b && !b.disabled) { b.click(); return true; } return false; })()"
                )
                time.sleep(1.0)
            if not app.ev(board):
                print("DEBUG after Enter game: %r" % (app.ev("document.body.innerText") or "")[:800])
                print("DEBUG requests: %r" % REQUEST_LOG[-15:])
                raise AssertionError("could not enter the game (board never rendered)")
            time.sleep(1.5)
            if mode == "resign":
                resign_statements(check, app)
            else:
                in_battle_statements(check, app)
        else:
            app.wait_for(
                "document.querySelectorAll('button.lobby-delete-btn').length > 0", 30, "the list"
            )
            time.sleep(0.5)
            if mode == "delete-denied":
                denied_statements(check, app)
            else:
                granted_statements(check, app)
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


def denied_statements(check, app):
    offered = app.delete_buttons()
    check.ok(
        "the caller's OWN game is offered a delete",
        MINE["gameId"] in offered,
        "offered=%r" % offered,
    )
    check.ok(
        "a game the caller NEVER JOINED is NOT offered a delete",
        THEIRS["gameId"] not in offered,
        "offered=%r" % offered,
    )

    # The confirmation must NAME what goes, before anything is removed.
    pressed = app.click_text("Delete…")
    check.ok("the Delete affordance is pressable", pressed is True)
    app.wait_for("!!document.querySelector('.lobby-delete-card')", 15, "the delete card")
    time.sleep(0.5)
    card = app.delete_card_text()
    check.ok(
        "the confirmation names the game and counts what would go",
        "Test's old game" in card
        and "4 snapshots" in card
        and "2 player objects" in card
        and "7 objects in all" in card,
        "card=%r" % card[:400],
    )
    check.ok(
        "the confirmation says the record goes LAST, so a half-done delete stays visible",
        "record goes last" in card,
        "card=%r" % card[:400],
    )
    check.ok("nothing was deleted before the confirmation", STORE.deletes == [] and STORE.denied == [])

    # THE MEASURED BLOCKER: press it, and the store says 403.
    confirmed = app.click_text("Delete permanently")
    check.ok("the confirmation is pressable", confirmed is True)
    deadline = time.time() + 30
    while time.time() < deadline and "Not deleted" not in app.delete_card_text():
        time.sleep(0.5)
    time.sleep(0.5)
    card = app.delete_card_text()
    check.ok(
        "the refusal is LOUD: the store's own code AND message are on screen",
        "forbidden" in card and "key is not allowed to delete objects" in card,
        "card=%r" % card[:500],
    )
    check.ok(
        "the app does NOT claim the game was deleted",
        "Not deleted" in card and "Deleted 0 of 7 objects" in card,
        "card=%r" % card[:500],
    )
    check.ok(
        "it says exactly what remains — including the record — and that the game is still deletable",
        "The remaining 7 objects" in card
        and "still listed and still deletable" in card,
        "card=%r" % card[:500],
    )
    check.ok(
        "and it gives the ACTIONABLE sentence about granting the permission",
        "ask the operator to grant the delete permission" in card,
        "card=%r" % card[:500],
    )
    # The truth about the store: every DELETE was refused, so every object remains.
    check.ok(
        "NOTHING was removed from the store",
        STORE.deletes == [] and len(STORE.denied) > 0,
        "deleted=%r denied=%d" % (STORE.deletes, len(STORE.denied)),
    )
    remaining = set(STORE.objects)
    expected = set(seed_bodies("delete-denied"))
    check.ok(
        "every object of the game is still there, and the other game is untouched",
        remaining == expected,
        "missing=%r extra=%r" % (sorted(expected - remaining), sorted(remaining - expected)),
    )
    check.ok(
        "the game is still listed in the lobby",
        MINE["gameId"] in app.delete_buttons(),
        "offered=%r" % app.delete_buttons(),
    )


def granted_statements(check, app):
    before = dict(STORE.objects)
    theirs = {name: body for name, body in before.items() if THEIRS["gameId"] in name}
    check.ok("the other game's objects are seeded", len(theirs) > 0, "theirs=%r" % sorted(theirs))

    app.click_text("Delete…")
    app.wait_for("!!document.querySelector('.lobby-delete-card')", 15, "the delete card")
    time.sleep(0.4)
    app.click_text("Delete permanently")
    deadline = time.time() + 45
    while time.time() < deadline and "game.%s" % MINE["gameId"] in STORE.objects:
        time.sleep(0.5)
    time.sleep(1.0)

    check.ok(
        "the whole game went: every snapshot, every player object and the record",
        "game.%s" % MINE["gameId"] not in STORE.objects
        and not any(name.startswith("snap.%s." % MINE["gameId"]) for name in STORE.objects)
        and not any(name.startswith("player.%s." % MINE["gameId"]) for name in STORE.objects),
        "left=%r" % sorted(
            name for name in STORE.objects if MINE["gameId"] in name
        ),
    )
    # The RECORD went LAST: the app's own request order is the proof.
    order = STORE.deletes
    record_at = order.index("game.%s" % MINE["gameId"]) if "game.%s" % MINE["gameId"] in order else -1
    check.ok(
        "the game RECORD was deleted LAST, after every snapshot and player object",
        record_at == len(order) - 1,
        "order=%r" % order,
    )
    check.ok(
        "the OTHER game is byte-for-byte untouched",
        all(STORE.objects.get(name) == body for name, body in theirs.items()),
        "theirs=%r" % sorted(theirs),
    )
    check.ok(
        "the deleted game is gone from the lobby list",
        MINE["gameId"] not in app.delete_buttons(),
        "offered=%r" % app.delete_buttons(),
    )
    # The delete SUCCEEDED here, so the app may say so — and the card is gone.
    check.ok(
        "the confirmation is cleared once the game is gone",
        not app.ev("!!document.querySelector('.lobby-delete-card')"),
    )


def resign_statements(check, app):
    buttons = app.give_up_buttons()
    mine = [b for b in buttons if b.get("player") == RESIGN["playerIds"][0]]
    check.ok(
        "the caller's OWN give-up control is offered",
        len(mine) == 1,
        "buttons=%r" % buttons,
    )
    check.ok(
        "outside a battle it is ENABLED (the owner's scope: outside battles is enough)",
        bool(mine) and mine[0]["disabled"] is False,
        "mine=%r" % mine,
    )
    check.ok(
        "no control is offered for the opponent in this client",
        all(b.get("player") != RESIGN["playerIds"][1] for b in buttons),
        "buttons=%r" % buttons,
    )
    check.ok(
        "the button names the game action, not a battle one",
        "Give up the game" in (mine[0]["label"] if mine else ""),
        "mine=%r" % mine,
    )

    # THE CONFIRMATION: first press asks and names what leaves the board.
    pressed = app.click_text("Give up the game")
    check.ok("the give-up control is pressable", pressed is True)
    time.sleep(0.4)
    confirming = app.give_up_buttons()
    label = next((b["label"] for b in confirming if b.get("player") == RESIGN["playerIds"][0]), "")
    check.ok(
        "the first press ASKS for confirmation instead of resigning",
        "confirm" in label.lower(),
        "label=%r" % label,
    )
    warning = app.give_up_text()
    check.ok(
        "the confirmation names the player, the legions and that it is irreversible",
        "Irreversible" in warning and "Test" in warning and "legion" in warning,
        "warning=%r" % warning[:400],
    )
    check.ok(
        "nothing has been published yet: the state is unchanged",
        (app.saved_state() or {}).get("winnerId") is None,
        "state=%r" % ((app.saved_state() or {}).get("winnerId"),),
    )

    # THE ACTION: the second press resigns, and the game ends for two players.
    pressed = app.click_text(label)
    check.ok("the confirmation is pressable", pressed is True)
    deadline = time.time() + 30
    while time.time() < deadline and (app.saved_state() or {}).get("winnerId") is None:
        time.sleep(0.5)
    time.sleep(1.0)
    state = app.saved_state() or {}
    resigner = state["players"][0]
    opponent = state["players"][1]
    check.ok(
        "the resigner is ELIMINATED",
        resigner.get("dead") is True,
        "players=%r" % [(p.get("name"), p.get("dead")) for p in state.get("players", [])],
    )
    check.ok(
        "EVERY legion of the resigner's has left the board",
        not [l for l in state.get("legions", []) if l.get("playerId") == resigner.get("id")],
        "legions=%r" % [l.get("markerId") for l in state.get("legions", [])],
    )
    check.ok(
        "the opponent WINS (two players: one remains)",
        state.get("winnerId") == opponent.get("id") and state.get("draw") is False,
        "winnerId=%r opponent=%r" % (state.get("winnerId"), opponent.get("id")),
    )
    check.ok(
        "the board shows the win, so the OTHER player is told whose game ended",
        "wins!" in app.topbar(),
        "topbar=%r" % app.topbar()[:300],
    )
    check.ok(
        "the reason is in the game log, and it does NOT claim a Titan was slain",
        any("gives up the game" in line for line in state.get("log", []))
        and not any("Titan slain" in line for line in state.get("log", [])),
        "log=%r" % state.get("log", [])[-6:],
    )

    # The ending is FINAL: a further command changes nothing at all.
    state_after = app.saved_state() or {}
    check.ok(
        "the ending is FINAL — the state after the win is a finished game",
        state_after.get("winnerId") == opponent.get("id")
        and state_after.get("draw") is False
        and (state_after.get("battle") is None),
        "winnerId=%r" % state_after.get("winnerId"),
    )


def in_battle_statements(check, app):
    """The owner's scope: INSIDE a battle, giving up is not available."""
    state = app.saved_state() or {}
    check.ok(
        "the app resumed the game IN a battle",
        state.get("battle") is not None and state.get("phase") == "Battle",
        "phase=%r battle=%r" % (state.get("phase"), bool(state.get("battle"))),
    )
    buttons = app.give_up_buttons()
    mine = [b for b in buttons if b.get("player") == RESIGN["playerIds"][0]]
    check.ok(
        "the give-up control is still SHOWN (not silently absent), so the rule is visible",
        len(mine) == 1,
        "buttons=%r" % buttons,
    )
    check.ok(
        "and it is DISABLED inside a battle",
        bool(mine) and mine[0]["disabled"] is True,
        "mine=%r" % mine,
    )
    text = app.give_up_text()
    check.ok(
        "the engine's own reason is ON SCREEN beside it",
        "Cannot give up during a battle" in text and "concede the battle instead" in text,
        "give-up=%r" % text[:400],
    )
    check.ok(
        "and no give-up was published for anyone",
        (app.saved_state() or {}).get("winnerId") is None
        and not any("gives up the game" in line for line in (app.saved_state() or {}).get("log", [])),
        "log=%r" % ((app.saved_state() or {}).get("log", [])[-4:]),
    )

    # THE BACKSTOP: even force-dispatched through the app's own commit path, the
    # engine refuses it — the UI is not the only guard.
    refusal = app.ev(
        "(() => { if (typeof window.__colossusDispatch !== 'function') return 'no-handle';"
        " window.__colossusDispatch({type:'resign', playerId: %s}); return 'dispatched'; })()"
        % json.dumps(RESIGN["playerIds"][0])
    )
    if refusal == "no-handle":
        check.ok(
            "the app exposes its ONE commit path for the check (S9 test handle)",
            False,
            "window.__colossusDispatch missing",
        )
    else:
        time.sleep(0.8)
        after = app.saved_state() or {}
        check.ok(
            "a force-dispatched resign inside a battle is REFUSED, loudly, on the message surface",
            "during a battle" in app.message().lower(),
            "message=%r" % app.message(),
        )
        check.ok(
            "and nothing changed: no winner, no dead player, no legion removed",
            after.get("winnerId") is None
            and not any(p.get("dead") for p in after.get("players", []))
            and len(after.get("legions", [])) == len(state.get("legions", [])),
            "players=%r" % [(p.get("name"), p.get("dead")) for p in after.get("players", [])],
        )


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "mode", choices=["delete-denied", "delete-granted", "resign", "in-battle"]
    )
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
