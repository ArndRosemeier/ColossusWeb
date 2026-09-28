#!/usr/bin/env python3
"""S6's browser-level check: the BOARD after a roll CHANGES under an adoption.

Why this exists. The S6 defect was a DERIVED field (`legalHexes`) copied across
an adoption like a UI preference: a client adopting a snapshot kept the PREVIOUS
roll's reachable set. The brief requires the symptom to be observed on the BOARD,
not merely asserted in a DOM-free suite.

What this drives. The REAL built app in headless Chrome, against a fake store
answered entirely by this process over the DevTools Protocol's Fetch domain
(exactly the S5 method): the app's own transport, poll loop and React render are
the code under test. The fixture is a real engine state written by
`gen-fixture.test.ts` and shaped like the owner's LIVE snapshot
(`snap.number-1-8e21f4f8.0002.001`): `phase: Move`, `movementRoll: 3`, nothing
selected, `legalHexes: []`.

The statements it proves, in order:

  1. the app resumes the game and renders the board with the host's turn;
  2. the host selects its stack on the LOCAL roll (6) — the board highlights
     exactly the engine's own destinations for roll 6;
  3. the store then serves the roll-3 snapshot; the app adopts it and the board
     highlights exactly the engine's destinations for roll 3 — the roll-6-only
     hex is NO LONGER highlighted (the old copy kept it);
  4. the app's own persisted state (`colossusweb.save.v1`, autosaved from the
     adopted state) carries the adopted roll and the ENGINE's recomputed set —
     under the defect it carried the local roll's set;
  5. clicking the roll-6-only hex is IGNORED, and clicking a roll-3 destination
     MOVES the stack and PUBLISHES the new position — i.e. the owner can move.

No key material is used (the key is a made-up string and the network is answered
here) and nothing talks to the live service. The Chrome tree is killed in
`finally`, success and failure alike.
"""

import base64
import functools
import hashlib
import http.server
import json
import os
import shutil
import socket
import subprocess
import threading
import time
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
FIXTURE = os.path.join(HERE, "fixture.json")
# The built app: `web/dist`, which the gate's cheap tier builds.
SITE = os.environ.get("S6_SITE", os.path.abspath(os.path.join(HERE, "..", "..", "web", "dist")))
PROFILE = os.path.join(HERE, "s6-profile")
STORE_ORIGIN = "https://store.futuremagic.de"
TEST_KEY = "ssk_testonly_s6browsercheck_0123456789"
STORE = "colossus"

with open(FIXTURE, "r", encoding="utf8") as handle:
    FIX = json.load(handle)

WHOAMI = json.dumps(
    {
        "id": FIX["host"]["id"],
        "label": "s6-browsercheck",
        "stores": [STORE],
        "perms": ["read", "write"],
    }
)

# ---------------------------------------------------------------------------
# The fake store: objects mutated between reads, exactly as a peer client would
# publish. The app is never told anything; it polls and reacts.
# ---------------------------------------------------------------------------

OBJECTS = {}


def sha256(text):
    return hashlib.sha256(text.encode()).hexdigest()


def seed_store():
    OBJECTS.clear()
    OBJECTS["game." + FIX["gameId"]] = FIX["records"]["game"]
    names = [
        f"player.{FIX['gameId']}.{FIX['host']['tag']}",
        f"player.{FIX['gameId']}.{FIX['guest']['tag']}",
    ]
    for name, body in zip(names, FIX["records"]["players"]):
        OBJECTS[name] = body
    # ONLY the first snapshot, so the app resumes onto the roll-6 state.
    OBJECTS[FIX["firstSnapshotName"]] = FIX["firstSnapshot"]


def publish_adopted():
    OBJECTS[FIX["adoptedSnapshotName"]] = FIX["adoptedSnapshot"]


def listing(prefix):
    objects = []
    for name, body in OBJECTS.items():
        if prefix is not None and not name.startswith(prefix):
            continue
        objects.append(
            {
                "store": STORE,
                "name": name,
                "sha256": sha256(body),
                "size": len(body),
                "createdAt": "2026-09-29T09:15:19.000Z",
            }
        )
    return json.dumps({"objects": objects})


# ---------------------------------------------------------------------------
# A minimal DevTools-Protocol client (its own WebSocket; no library).
# ---------------------------------------------------------------------------


class WS:
    def __init__(self, url):
        self.url = url
        self.buf = b""
        self.next_id = 1
        self.sock = None

    def connect(self):
        rest = self.url.split("://", 1)[1]
        hostport, path = rest.split("/", 1)
        host, port = hostport.split(":")
        self.sock = socket.create_connection((host, int(port)), timeout=5)
        key = base64.b64encode(os.urandom(16)).decode()
        req = (
            f"GET /{path} HTTP/1.1\r\nHost: {hostport}\r\nUpgrade: websocket\r\n"
            f"Connection: Upgrade\r\nSec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n"
        )
        self.sock.sendall(req.encode())
        data = b""
        while b"\r\n\r\n" not in data:
            data += self.sock.recv(4096)
        assert b"101" in data.split(b"\r\n")[0], data[:200]

    def send(self, text):
        payload = text.encode()
        mask = os.urandom(4)
        n = len(payload)
        if n < 126:
            header = bytes([0x81, 0x80 | n])
        elif n < 65536:
            header = bytes([0x81, 0x80 | 126]) + n.to_bytes(2, "big")
        else:
            header = bytes([0x81, 0x80 | 127]) + n.to_bytes(8, "big")
        masked = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
        self.sock.sendall(header + mask + masked)

    def _read_exact(self, n):
        while len(self.buf) < n:
            chunk = self.sock.recv(65536)
            if not chunk:
                raise ConnectionError("closed")
            self.buf += chunk
        out, self.buf = self.buf[:n], self.buf[n:]
        return out

    def recv(self, timeout=0.2):
        self.sock.settimeout(timeout)
        while True:
            b0, b1 = self._read_exact(2)
            opcode = b0 & 0x0F
            length = b1 & 0x7F
            if length == 126:
                length = int.from_bytes(self._read_exact(2), "big")
            elif length == 127:
                length = int.from_bytes(self._read_exact(8), "big")
            payload = self._read_exact(length)
            if opcode == 0x8:
                raise ConnectionError("closed by peer")
            if opcode == 0x1:
                return payload.decode()


def free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


class Check:
    def __init__(self):
        self.failures = []
        self.notes = []
        self.published = []
        self.put_count = 0
        self.put_log = []
        self.store_requests = []

    def fail(self, sentence):
        self.failures.append(sentence)
        print("  FAIL:", sentence)

    def note(self, sentence):
        self.notes.append(sentence)
        print("  ok:", sentence)


# --- CDP plumbing ----------------------------------------------------------


def send(ws, method, params=None):
    call_id = ws.next_id
    ws.send(json.dumps({"id": call_id, "method": method, "params": params or {}}))
    ws.next_id += 1
    return call_id


def call(ws, check, method, params=None, timeout=90.0, quiet=False):
    """One CDP call, serving any store requests that arrive while it runs.

    `quiet` is for a PROBE whose silence is expected (the renderer-not-ready
    wait): it must not be recorded as a failed statement.
    """
    call_id = send(ws, method, params)
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            msg = json.loads(ws.recv(0.2))
        except (TimeoutError, socket.timeout, ConnectionError):
            continue
        if msg.get("method") == "Fetch.requestPaused":
            handle_paused(ws, check, msg["params"])
            continue
        if msg.get("id") == call_id:
            return msg
    if not quiet:
        check.fail(f"CDP call {method} never answered")
    return None


def fulfill(ws, check, request_id, code, body):
    call(
        ws,
        check,
        "Fetch.fulfillRequest",
        {
            "requestId": request_id,
            "responseCode": code,
            "responseHeaders": [
                {"name": "content-type", "value": "application/json"},
                {"name": "access-control-allow-origin", "value": "*"},
                {
                    "name": "access-control-expose-headers",
                    "value": "retry-after, x-serverstore-sha256",
                },
                {"name": "x-serverstore-sha256", "value": sha256(body)},
            ],
            "body": base64.b64encode(body.encode()).decode(),
        },
    )


def handle_paused(ws, check, params):
    request_id = params["requestId"]
    request = params["request"]
    method = request["method"]
    url = request["url"]
    path = url.split(STORE_ORIGIN, 1)[1].split("?")[0]
    query = url.split("?", 1)[1] if "?" in url else ""

    if method == "OPTIONS":
        call(
            ws,
            check,
            "Fetch.fulfillRequest",
            {
                "requestId": request_id,
                "responseCode": 204,
                "responseHeaders": [
                    {"name": "access-control-allow-origin", "value": "*"},
                    {
                        "name": "access-control-allow-methods",
                        "value": "GET, PUT, DELETE, OPTIONS",
                    },
                    {
                        "name": "access-control-allow-headers",
                        "value": "authorization, content-type",
                    },
                    {
                        "name": "access-control-expose-headers",
                        "value": "retry-after, x-serverstore-sha256",
                    },
                ],
            },
        )
        return

    check.store_requests.append({"method": method, "url": url})
    if path == "/whoami":
        fulfill(ws, check, request_id, 200, WHOAMI)
        return
    if path.endswith("/objects") and method == "GET":
        prefix = None
        for part in query.split("&"):
            if part.startswith("prefix="):
                prefix = urllib.parse.unquote(part[len("prefix=") :])
        fulfill(ws, check, request_id, 200, listing(prefix))
        return
    if "/objects/" in path and method == "GET":
        name = urllib.parse.unquote(path.split("/objects/", 1)[1])
        body = OBJECTS.get(name)
        if body is None:
            fulfill(
                ws,
                check,
                request_id,
                404,
                json.dumps({"error": {"code": "not_found", "message": f"{name} is gone"}}),
            )
            return
        fulfill(ws, check, request_id, 200, body)
        return
    if "/objects/" in path and method == "PUT":
        name = urllib.parse.unquote(path.split("/objects/", 1)[1])
        # `postData` arrives as the decoded request body (NOT base64), and it
        # carries non-ASCII (the engine's "→" in the move log), so it is taken
        # verbatim.
        body = request.get("postData", "") or ""
        OBJECTS[name] = body
        check.put_count += 1
        check.published.append({"name": name, "body": body})
        check.put_log.append(name)
        try:
            blob = json.loads(body)
            # The snapshot body carries the ONE serialiser's blob: header plus
            # `{version, savedAt, variantName, state: <game state>}`.
            state = (blob.get("state") or {}).get("state") or {}
            legion = next(
                (l for l in state.get("legions", []) if l.get("id") == FIX["legionId"]), None
            )
            print(
                f"  -- PUT {name} [roll={state.get('movementRoll')} round="
                f"{state.get('turnNumber')} legionHex="
                f"{legion.get('hexLabel') if legion else None} "
                f"selected={state.get('selectedLegionId')}]"
            )
        except Exception as error:  # a body we cannot read is a fact worth printing
            print(f"  -- PUT {name} (unreadable: {error}) body[:160]={body[:160]!r}")
        fulfill(
            ws,
            check,
            request_id,
            200,
            json.dumps(
                {
                    "store": STORE,
                    "name": name,
                    "sha256": sha256(body),
                    "size": len(body),
                    "createdAt": "2026-09-29T09:20:00.000Z",
                }
            ),
        )
        return
    fulfill(
        ws,
        check,
        request_id,
        400,
        json.dumps({"error": {"code": "bad_request", "message": f"unhandled {method} {path}"}}),
    )


def pump(ws, check, seconds):
    """Serve store requests (and drain other events) for `seconds`."""
    deadline = time.time() + seconds
    while time.time() < deadline:
        try:
            msg = json.loads(ws.recv(min(0.2, max(0.01, deadline - time.time()))))
        except (TimeoutError, socket.timeout, ConnectionError):
            continue
        if msg.get("method") == "Fetch.requestPaused":
            handle_paused(ws, check, msg["params"])


def js_raw(ws, check, expression, timeout=30.0):
    """Evaluate JS and return the value, or None when the call did not answer."""
    result = call(
        ws,
        check,
        "Runtime.evaluate",
        {"expression": expression, "returnByValue": True},
        timeout=timeout,
        quiet=True,
    )
    if result is None:
        return None
    body = result.get("result", {})
    if "exceptionDetails" in body:
        check.fail(
            "page evaluation threw: "
            + str(body["exceptionDetails"].get("exception", {}).get("description"))
        )
        return None
    return body.get("result", {}).get("value")


def js(ws, check, expression, await_promise=False, attempts=2):
    """Evaluate JS in the page. A transiently unanswered eval is retried ONCE —
    the app's poll loop bombards the socket, and a lost answer must not be read
    as a failed statement."""
    payload = {
        "expression": expression,
        "returnByValue": True,
        "awaitPromise": await_promise,
        "userGesture": True,
    }
    for attempt in range(attempts):
        result = call(
            ws, check, "Runtime.evaluate", payload, timeout=30.0, quiet=True
        )
        if result is not None:
            body = result.get("result", {})
            if "exceptionDetails" in body:
                check.fail(
                    "page evaluation threw: "
                    + str(body["exceptionDetails"].get("exception", {}).get("description"))
                )
                return None
            return body.get("result", {}).get("value")
        if attempt + 1 < attempts:
            # A retried eval is not a failed statement: only silence after every
            # attempt is. (The app's poll loop bombards the same socket.)
            print("  -- re-issuing an unanswered Runtime.evaluate")
    check.fail(f"a page evaluation never answered: {expression[:60]!r}")
    return None


def wait_for(ws, check, expression, seconds):
    deadline = time.time() + seconds
    while time.time() < deadline:
        if js(ws, check, expression) is True:
            return True
        pump(ws, check, 0.25)
    return False


def rings(ws, check):
    value = js(
        ws,
        check,
        "[...document.querySelectorAll('.legal-hex-ring')].map((ring) => ring.closest('g[data-hex]')?.getAttribute('data-hex'))",
    )
    return [label for label in (value or []) if label is not None]


def read_save(ws, check):
    return js(
        ws,
        check,
        "(() => { const raw = localStorage.getItem('colossusweb.save.v1');"
        " return raw ? JSON.parse(raw).state : null; })()",
    )


def click_hex(label, settle_ms=700):
    return f"""
    (async () => {{
      const group = document.querySelector('g[data-hex="{label}"]');
      if (!group) return 'no-hex';
      group.dispatchEvent(new MouseEvent('click', {{bubbles: true, cancelable: true, view: window}}));
      await new Promise((r) => setTimeout(r, {settle_ms}));
      return 'clicked';
    }})()
    """


def click_legion(legion_id):
    return f"""
    (async () => {{
      const chit = document.querySelector('[data-legion="{legion_id}"]');
      const group = chit ? chit.closest('g') : null;
      if (!group) return 'no-legion';
      group.dispatchEvent(new MouseEvent('click', {{bubbles: true, cancelable: true, view: window}}));
      await new Promise((r) => setTimeout(r, 700));
      return 'clicked';
    }})()
    """


def published_legion_hex(check):
    for published in reversed(check.published):
        try:
            blob = json.loads(published["body"])
        except Exception:
            continue
        state = (blob.get("state") or {}).get("state") or {}
        for legion in state.get("legions", []):
            if legion.get("id") == FIX["legionId"]:
                return legion.get("hexLabel")
    return None


def report(check):
    print()
    print(f"STORE REQUESTS (first 6): {json.dumps(check.store_requests[:6])}")
    print(f"PUBLISHED: {check.put_log}")
    print(f"EVENTS: {len(check.notes)}")
    if check.failures:
        print(f"S6 BROWSER CHECK FAILED ({len(check.failures)}):")
        for failure in check.failures:
            print("  -", failure)
        return 1
    print("S6 BROWSER CHECK PASSED — the board follows the ADOPTED roll and the move is accepted")
    return 0


# ---------------------------------------------------------------------------
# The check
# ---------------------------------------------------------------------------


def main():
    if not os.path.isdir(SITE):
        print(f"S6 SITE MISSING: {SITE} — build the app first (npx vite build)")
        return 1

    shutil.rmtree(PROFILE, ignore_errors=True)
    seed_store()
    site_port, cdp_port = free_port(), free_port()
    handler = functools.partial(Quiet, directory=SITE)
    httpd = http.server.ThreadingHTTPServer(("127.0.0.1", site_port), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()

    check = Check()
    log = open(os.path.join(HERE, "s6-chrome.log"), "w")
    chrome = subprocess.Popen(
        [
            "google-chrome",
            "--headless=new",
            "--disable-gpu",
            "--no-sandbox",
            "--hide-scrollbars",
            # Apply a move on the click, not after the tween: the check is about
            # which hexes are LEGAL, not about the animation's clock.
            "--force-prefers-reduced-motion",
            f"--user-data-dir={PROFILE}",
            "--window-size=1400,1200",
            f"--remote-debugging-port={cdp_port}",
            "about:blank",
        ],
        stdout=log,
        stderr=log,
    )
    try:
        ws_url = None
        for _ in range(150):
            try:
                with urllib.request.urlopen(
                    f"http://127.0.0.1:{cdp_port}/json/list", timeout=1
                ) as response:
                    page = next(
                        (t for t in json.load(response) if t.get("type") == "page"), None
                    )
                if page:
                    ws_url = page["webSocketDebuggerUrl"]
                    break
            except Exception:
                time.sleep(0.2)
        if ws_url is None:
            check.fail("chrome never exposed a page target")
            return report(check)

        ws = WS(ws_url)
        ws.connect()
        for method in ("Runtime.enable", "Page.enable", "Network.enable"):
            call(ws, check, method)

        # The renderer may still be starting when the target appears, and an eval
        # that hangs against a not-yet-live execution context is a STARTUP race,
        # not a failed statement. Wait for a trivial evaluation to answer before
        # any statement is judged.
        ready = False
        for _ in range(30):
            if js_raw(ws, check, "1 + 1", timeout=5.0) == 2:
                ready = True
                break
            time.sleep(0.5)
        if not ready:
            check.fail("the page never answered a trivial evaluation (renderer not ready)")
            return report(check)

        # Intercept the store BEFORE the first navigation: the app validates the
        # stored key the moment it mounts.
        call(
            ws,
            check,
            "Fetch.enable",
            {"patterns": [{"urlPattern": f"{STORE_ORIGIN}/*", "requestStage": "Request"}]},
        )
        inject = (
            "try { localStorage.clear();"
            f" localStorage.setItem('colossusweb.key.v1','{TEST_KEY}');"
            " localStorage.setItem('colossusweb.multiplayer.v1',"
            f" JSON.stringify({{version:1, gameId:'{FIX['gameId']}'}}));"
            " } catch (e) {}"
        )
        call(ws, check, "Page.addScriptToEvaluateOnNewDocument", {"source": inject})
        call(
            ws,
            check,
            "Page.navigate",
            {"url": f"http://127.0.0.1:{site_port}/index.html"},
        )

        if not wait_for(
            ws,
            check,
            "!!document.querySelector('.lobby-panel') || !!document.querySelector('.connect-failure')"
            " || !!document.querySelector('.master-board')",
            40.0,
        ):
            check.fail("the app never rendered a lobby or a board")
            return report(check)
        if js(ws, check, "!!document.querySelector('.connect-failure')"):
            check.fail("the app showed a connection failure instead of the lobby")
            return report(check)

        if not js(ws, check, "!!document.querySelector('.master-board')"):
            # Resume the offered game: "Enter game" is the control the owner
            # would press after a reload.
            ok = js(
                ws,
                check,
                """
                (async () => {
                  for (let i = 0; i < 120; i++) {
                    const button = [...document.querySelectorAll('button')]
                      .find((b) => (b.textContent || '').trim() === 'Enter game' && !b.disabled);
                    if (button) { button.click(); return 'clicked'; }
                    await new Promise((r) => setTimeout(r, 250));
                  }
                  return 'no-enter-button';
                })()
                """,
                await_promise=True,
            )
            if ok != "clicked":
                check.fail(f"the lobby never offered 'Enter game' (got {ok!r})")
                return report(check)

        if not wait_for(ws, check, "!!document.querySelector('.master-board')", 40.0):
            check.fail("the board never rendered after Enter game")
            return report(check)
        if not wait_for(
            ws,
            check,
            f"!!document.querySelector('g[data-hex=\"{FIX['legionHex']}\"]')",
            15.0,
        ):
            check.fail(f"hex {FIX['legionHex']} is not on the rendered board")
            return report(check)
        check.note("the app resumed the game and rendered the board")

        # --- 2. the local roll (6): select the stack and read the BOARD --------
        if js(ws, check, click_legion(FIX["legionId"]), await_promise=True) != "clicked":
            check.fail(f"could not find the stack marked {FIX['marker']} in the DOM")
            return report(check)
        if not wait_for(
            ws, check, "document.querySelectorAll('.legal-hex-ring').length > 0", 15.0
        ):
            check.fail("selecting the stack on roll 6 highlighted NOTHING")
            return report(check)

        local_save = read_save(ws, check)
        if local_save is None:
            check.fail("the app did not autosave the local (roll 6) state")
            return report(check)
        local_rings = rings(ws, check)
        check.note(
            f"roll {local_save.get('movementRoll')}: board highlights {len(local_rings)} hexes, "
            f"persisted legalHexes {len(local_save.get('legalHexes', []))}"
        )
        if sorted(local_rings) != sorted(FIX["destinationsOnMyRoll"]):
            check.fail(
                "on roll 6 the board did not highlight the engine's own destination set: "
                f"board {len(local_rings)} vs engine {len(FIX['destinationsOnMyRoll'])}, "
                f"extra {sorted(set(local_rings) - set(FIX['destinationsOnMyRoll']))[:5]}, "
                f"missing {sorted(set(FIX['destinationsOnMyRoll']) - set(local_rings))[:5]}"
            )
        if FIX["roll6OnlyDestination"] not in local_rings:
            check.fail(
                f"roll-6-only hex {FIX['roll6OnlyDestination']} is not highlighted on roll 6"
            )
        if local_save.get("selectedLegionId") != FIX["legionId"]:
            check.fail(
                f"the persisted state does not carry the selected legion: {local_save.get('selectedLegionId')!r}"
            )

        # --- 3. the store serves the roll-3 snapshot; the app must adopt it ----
        publish_adopted()
        print("  -- published", FIX["adoptedSnapshotName"], "(roll 3) into the fake store")

        adopted = None
        deadline = time.time() + 30
        while time.time() < deadline:
            pump(ws, check, 1.0)
            save = read_save(ws, check)
            if save is not None and save.get("movementRoll") == FIX["adoptedRoll"]:
                adopted = save
                break
        if adopted is None:
            check.fail("the app never adopted the roll-3 snapshot (persisted state kept roll 6)")
            return report(check)
        check.note(f"adopted the remote snapshot: movementRoll is now {adopted['movementRoll']}")

        # The persisted state is the app's OWN copy of the adopted state, so this
        # is the field under test, read out of the real browser.
        if FIX["sentinel"] in json.dumps(adopted):
            check.fail("the local sentinel survived adoption")
        if sorted(adopted.get("legalHexes", [])) != sorted(FIX["destinationsOnAdoptedRoll"]):
            check.fail(
                "the adopted state's legalHexes is not the engine's set for the adopted roll: "
                f"{sorted(adopted.get('legalHexes', []))} vs {sorted(FIX['destinationsOnAdoptedRoll'])}"
            )
        else:
            check.note(
                "the adopted state's derived legalHexes is the roll-3 set "
                f"{sorted(adopted['legalHexes'])} (the local roll-6 set had "
                f"{len(FIX['destinationsOnMyRoll'])} hexes)"
            )
        if adopted.get("selectedLegionId") != FIX["legionId"]:
            check.fail(
                f"the inspected legion did not survive adoption: {adopted.get('selectedLegionId')!r}"
            )
        else:
            check.note("the inspected legion survived the adoption")

        # --- 4. the BOARD after adoption --------------------------------------
        adopted_rings = rings(ws, check)
        if sorted(adopted_rings) != sorted(FIX["destinationsOnAdoptedRoll"]):
            check.fail(
                "after adoption the board highlights the wrong hexes: "
                f"{sorted(adopted_rings)} vs engine {sorted(FIX['destinationsOnAdoptedRoll'])}"
            )
        else:
            check.note(
                f"roll changed 6 -> 3: the board now highlights exactly {sorted(adopted_rings)}"
            )
        if FIX["roll6OnlyDestination"] in adopted_rings:
            check.fail(
                f"the roll-6-only hex {FIX['roll6OnlyDestination']} is STILL highlighted after the roll changed to 3"
            )
        else:
            check.note(
                f"the roll-6-only hex {FIX['roll6OnlyDestination']} is no longer highlighted"
            )

        # --- 5. a move is actually accepted ------------------------------------
        # Click the LEGAL destination FIRST: a click on a non-legal hex is the
        # board's DESELECT gesture, so it must not precede the move.
        put_before = check.put_count
        destination = FIX["destinationsOnAdoptedRoll"][0]
        js(ws, check, click_hex(destination), await_promise=True)
        deadline = time.time() + 20
        while time.time() < deadline and check.put_count == put_before:
            pump(ws, check, 1.0)
        if check.put_count == put_before:
            check.fail(
                f"clicking legal destination {destination} on roll 3 did NOT move the stack"
            )
            return report(check)
        moved_hex = published_legion_hex(check)
        if moved_hex == FIX["legionHex"]:
            check.fail(f"a move was published but the stack is still on {moved_hex}")
        else:
            check.note(
                f"the move was ACCEPTED: the stack left {FIX['legionHex']} and is now on "
                f"{moved_hex} (published {check.put_count} snapshot(s))"
            )

        # ...and the roll-6-only hex is not one the board will move to. (Clicking
        # it is the board's deselect gesture, so the check is that NO MOVE is
        # published — the selection simply clears.)
        put_before = check.put_count
        js(ws, check, click_hex(FIX["roll6OnlyDestination"]), await_promise=True)
        pump(ws, check, 2.0)
        if check.put_count != put_before:
            check.fail(
                f"clicking the roll-6-only hex {FIX['roll6OnlyDestination']} was treated as a move"
            )
        else:
            check.note(
                f"clicking the roll-6-only hex {FIX['roll6OnlyDestination']} moved nothing"
            )

        return report(check)
    finally:
        chrome.terminate()
        try:
            chrome.wait(timeout=10)
        except subprocess.TimeoutExpired:
            chrome.kill()
        httpd.shutdown()
        log.close()
        shutil.rmtree(PROFILE, ignore_errors=True)


if __name__ == "__main__":
    raise SystemExit(main())
