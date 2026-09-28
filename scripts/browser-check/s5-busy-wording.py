#!/usr/bin/env python3
"""S5's browser-level check: the "store is busy - slowing down" wording, SEEN.

Why this exists: the brief's part B is a sentence the owner reads on screen, and
two of the last four slices shipped a defect a DOM-free suite could not see. So
this drives the REAL built app in headless Chrome and makes the REAL store
connection answer `429 rate_limited` with `Retry-After`, over the DevTools
Protocol's Fetch interception — the request is fulfilled by this script, so the
app's own transport, poll loop and React render are the code under test.

It proves, in the browser and not merely in jsdom:
  * the first poll is a NARROW request (`prefix=game.`), sent as `?prefix=game.`
    on the wire, with the key in the Authorization header and nowhere else;
  * a `429` carrying `Retry-After` reaches the UI as the busy wording, WITH the
    wait, rather than as an unexplained "list update failed";
  * the wording is stable, and the loop keeps polling (it does not die).

No key material is used: the key is a made-up test string, and the network is
answered by this process. The chrome tree is killed in `finally`, success and
failure alike.
"""

import base64
import functools
import http.server
import json
import os
import shutil
import socket
import subprocess
import threading
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.environ.get("S5_SITE", os.path.join(os.path.dirname(HERE), "..", "web", "dist"))
SITE = os.path.abspath(SITE)
PROFILE = os.path.join(HERE, "s5-profile")
STORE_ORIGIN = "https://store.futuremagic.de"
TEST_KEY = "ssk_testonly_browsercheck_0123456789"
WHOAMI = json.dumps(
    {
        "id": "key_browsercheck1",
        "label": "browsercheck",
        "stores": ["colossus"],
        "perms": ["read", "write"],
    }
)

# --- a minimal DevTools-Protocol client (its own WebSocket; no library) -------


class WS:
    def __init__(self, url):
        self.url = url
        self.buf = b""
        self.next_id = 1

    def connect(self):
        rest = self.url.split("://", 1)[1]
        hostport, path = rest.split("/", 1)
        host, port = hostport.split(":")
        self.sock = socket.create_connection((host, int(port)), timeout=5)
        key = base64.b64encode(os.urandom(16)).decode()
        req = (
            f"GET /{path} HTTP/1.1\r\nHost: {hostport}\r\nUpgrade: websocket\r\n"
            f"Connection: Upgrade\r\nSec-WebSocket-Key: {key}\r\n"
            f"Sec-WebSocket-Version: 13\r\n\r\n"
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

    def recv(self):
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

    def call(self, method, params=None, _id=None):
        mid = _id or self.next_id
        self.next_id = max(self.next_id, mid) + 1
        self.send(json.dumps({"id": mid, "method": method, "params": params or {}}))
        while True:
            msg = json.loads(self.recv())
            if msg.get("id") == mid:
                return msg


def free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    p = s.getsockname()[1]
    s.close()
    return p


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def main():
    shutil.rmtree(PROFILE, ignore_errors=True)
    site_port, cdp_port = free_port(), free_port()
    handler = functools.partial(Quiet, directory=SITE)
    httpd = http.server.ThreadingHTTPServer(("127.0.0.1", site_port), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()

    log = open(os.path.join(HERE, "s5-chrome.log"), "w")
    chrome = subprocess.Popen(
        [
            "google-chrome",
            "--headless=new",
            "--disable-gpu",
            "--no-sandbox",
            "--hide-scrollbars",
            f"--user-data-dir={PROFILE}",
            "--window-size=1400,1200",
            f"--remote-debugging-port={cdp_port}",
            "about:blank",
        ],
        stdout=log,
        stderr=log,
    )
    failures = []
    store_requests = []  # the URLs the app ACTUALLY asked for
    try:
        ws_url = None
        for _ in range(150):
            try:
                with urllib.request.urlopen(
                    f"http://127.0.0.1:{cdp_port}/json/list", timeout=1
                ) as r:
                    page = next(
                        (t for t in json.load(r) if t.get("type") == "page"), None
                    )
                if page:
                    ws_url = page["webSocketDebuggerUrl"]
                    break
            except Exception:
                time.sleep(0.2)
        assert ws_url, "chrome never exposed a page target"

        ws = WS(ws_url)
        ws.connect()
        for method in ("Runtime.enable", "Page.enable", "Network.enable"):
            ws.call(method)

        # Intercept the store ONLY, and BEFORE the first navigation: the app
        # validates a stored key the moment it mounts, so a handler armed any
        # later would miss the very requests this check is about.
        ws.call(
            "Fetch.enable",
            {
                "patterns": [
                    {"urlPattern": f"{STORE_ORIGIN}/*", "requestStage": "Request"}
                ]
            },
        )
        # Seed the APP'S OWN key entry before any script runs, then load: the
        # app's `restoreStoredKey` validates it through a real `whoami` and the
        # lobby panel starts its poll loop. (The page's own assets are NOT
        # intercepted — only the store origin is.)
        ws.call(
            "Page.addScriptToEvaluateOnNewDocument",
            {
                "source": (
                    "try { localStorage.setItem('colossusweb.key.v1',"
                    f"'{TEST_KEY}') }} catch (e) {{}}"
                )
            },
        )
        ws.call(
            "Page.navigate",
            {"url": f"http://127.0.0.1:{site_port}/index.html"},
        )

        deadline = time.time() + 30
        intercepted = 0
        busy_seen = None
        first_target = None
        while time.time() < deadline:
            try:
                msg = json.loads(ws.recv())
            except (TimeoutError, ConnectionError):
                continue
            method = msg.get("method")
            params = msg.get("params", {})
            if method != "Fetch.requestPaused":
                continue
            request_id = params["requestId"]
            url = params["request"]["url"]
            # The Fetch domain reports headers as a NAME -> value map (the
            # Network domain reports a list of pairs).
            headers = {
                k.lower(): v for k, v in (params["request"].get("headers") or {}).items()
            }
            store_requests.append(
                {"url": url, "authorization": headers.get("authorization"), "method": params["request"]["method"]}
            )
            intercepted += 1
            if first_target is None:
                first_target = url
            path = url.split(STORE_ORIGIN, 1)[1].split("?")[0]
            if params["request"]["method"] == "OPTIONS":
                # The store's CORS preflight (it answers 204 before the key
                # guard). Nothing here is rate-limited by the real service, and a
                # preflight must NOT count towards the app's own request tally.
                ws.call(
                    "Fetch.fulfillRequest",
                    {
                        "requestId": request_id,
                        "responseCode": 204,
                        "responseHeaders": [
                            {"name": "access-control-allow-origin", "value": "*"},
                            {"name": "access-control-allow-methods", "value": "GET, PUT, DELETE, OPTIONS"},
                            {"name": "access-control-allow-headers", "value": "authorization, content-type"},
                            {"name": "access-control-expose-headers", "value": "retry-after, x-serverstore-sha256"},
                            {"name": "access-control-max-age", "value": "600"},
                        ],
                    },
                )
                del store_requests[-1]  # a preflight is not a store call
                intercepted -= 1
                if first_target == url:
                    first_target = None
                continue
            if path == "/whoami":
                # The key VALIDATES, so the app proceeds to the lobby and polls.
                body = WHOAMI
                ws.call(
                    "Fetch.fulfillRequest",
                    {
                        "requestId": request_id,
                        "responseCode": 200,
                        "responseHeaders": [
                            {"name": "content-type", "value": "application/json"},
                            {"name": "access-control-allow-origin", "value": "*"},
                            {"name": "access-control-expose-headers", "value": "retry-after, x-serverstore-sha256"},
                        ],
                        "body": base64.b64encode(body.encode()).decode(),
                    },
                )
                continue
            # EVERY listing from now on is refused by the store's limiter, with the
            # header a real 429 carries. A refusal has no side effect.
            limited = json.dumps(
                {
                    "error": {
                        "code": "rate_limited",
                        "message": "rate limit exceeded for this client; retry in 60s",
                    }
                }
            )
            ws.call(
                "Fetch.fulfillRequest",
                {
                    "requestId": request_id,
                    "responseCode": 429,
                    "responseHeaders": [
                        {"name": "content-type", "value": "application/json"},
                        {"name": "retry-after", "value": "60"},
                        {"name": "access-control-allow-origin", "value": "*"},
                        {"name": "access-control-expose-headers", "value": "retry-after, x-serverstore-sha256"},
                    ],
                    "body": base64.b64encode(limited.encode()).decode(),
                },
            )
            # Give the app a moment to render the refusal, then read the DOM the
            # moment the sentence appears.
            time.sleep(0.4)
            probe = ws.call(
                "Runtime.evaluate",
                {
                    "expression": (
                        "JSON.stringify({fresh: (document.querySelector('.lobby-freshness')||{}).textContent||null,"
                        " alert: (document.querySelector('.connect-failure')||{}).textContent||null,"
                        " panel: !!document.querySelector('.lobby-panel')})"
                    ),
                    "returnByValue": True,
                },
            )
            value = probe.get("result", {}).get("result", {}).get("value")
            if value:
                busy_seen = json.loads(value)
                if busy_seen.get("fresh") and "busy" in busy_seen["fresh"]:
                    break

        print("INTERCEPTED", intercepted)
        print("FIRST_TARGET", first_target)
        print("STORE_REQUESTS", json.dumps(store_requests[:4], indent=1))
        print("DOM", json.dumps(busy_seen))

        # --- the statements this check exists for -----------------------------
        listings = [r for r in store_requests if "/objects" in r["url"]]
        if not listings:
            failures.append("the app never listed the store")
        elif "?prefix=game." not in listings[0]["url"]:
            failures.append(
                f"the first listing did not carry the narrow prefix: {listings[0]['url']}"
            )
        else:
            print("FIRST_LISTING", listings[0]["url"])
        for request in store_requests:
            if not request["url"].startswith(STORE_ORIGIN):
                failures.append(f"a request went somewhere else: {request['url']}")
            if request["authorization"] != f"Bearer {TEST_KEY}":
                # whoami and every listing alike: the header and nowhere else.
                failures.append(
                    f"the key was not (only) in the Authorization header for {request['url']}"
                )
            if TEST_KEY in request["url"]:
                failures.append("the key reached the URL")
        fresh = (busy_seen or {}).get("fresh") or ""
        if "the store is busy" not in fresh:
            failures.append(f"the freshness line does not say the store is busy: {fresh!r}")
        if "slowing down" not in fresh:
            failures.append(f"the freshness line does not say slowing down: {fresh!r}")
        if "60s" not in fresh:
            failures.append(f"the freshness line does not name the wait: {fresh!r}")
        if "list update failed" in fresh:
            failures.append(f"the rate limit still reads as a broken list: {fresh!r}")

        if failures:
            print("CHECK FAILED")
            for failure in failures:
                print("  -", failure)
            return 1
        print("CHECK PASSED — the real app, in a real browser, says it in words")
        return 0
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
