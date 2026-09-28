#!/usr/bin/env python3
"""Drive the built app in headless Chrome over CDP and snapshot the lobby.

Real DevTools Protocol, so the page is given wall-clock time: the previous
attempts used `--dump-dom`, which writes its dump when the FIRST paint settles,
before the app's first fetch returns (measured: 4 KB of background markup, no
lobby). The chrome tree is killed in `finally` — success and failure alike.
"""
import base64, json, os, shutil, socket, struct, subprocess, threading, time, functools, http.server, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.path.join(HERE, "site")
PROFILE = os.path.join(HERE, "profile")

class WS:
    def __init__(self, url):
        self.url = url
        self.buf = b""
        self.next_id = 1
    def connect(self):
        rest = self.url.split("://", 1)[1]
        hostport, path = rest.split("/", 1)
        host, port = hostport.split(":")
        self.sock = socket.create_connection((host, int(port)), timeout=3)
        key = base64.b64encode(os.urandom(16)).decode()
        req = (f"GET /{path} HTTP/1.1\r\nHost: {hostport}\r\nUpgrade: websocket\r\n"
               f"Connection: Upgrade\r\nSec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n")
        self.sock.sendall(req.encode())
        data = b""
        while b"\r\n\r\n" not in data:
            data += self.sock.recv(4096)
        assert b"101" in data.split(b"\r\n")[0], data[:200]
    def send(self, text):
        payload = text.encode()
        mask = os.urandom(4)
        header = bytes([0x81])
        n = len(payload)
        if n < 126:
            header += bytes([0x80 | n])
        elif n < 65536:
            header += bytes([0x80 | 126]) + struct.pack(">H", n)
        else:
            header += bytes([0x80 | 127]) + struct.pack(">Q", n)
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
                length = struct.unpack(">H", self._read_exact(2))[0]
            elif length == 127:
                length = struct.unpack(">Q", self._read_exact(8))[0]
            payload = self._read_exact(length)
            if opcode == 0x8:
                raise ConnectionError("closed by peer")
            if opcode == 0x1:
                return payload.decode()
            if opcode == 0x9:  # ping
                self.sock.sendall(bytes([0x8A, 0x80]) + os.urandom(4))
    def call(self, method, params=None, _id=None):
        mid = _id or self.next_id
        self.next_id = max(self.next_id, mid) + 1
        self.send(json.dumps({"id": mid, "method": method, "params": params or {}}))
        while True:
            msg = json.loads(self.recv())
            if msg.get("id") == mid:
                return msg

def free_port():
    s = socket.socket(); s.bind(("127.0.0.1", 0)); p = s.getsockname()[1]; s.close(); return p

def main():
    shutil.rmtree(PROFILE, ignore_errors=True)
    site_port, cdp_port = free_port(), free_port()
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=SITE)
    httpd = http.server.ThreadingHTTPServer(("127.0.0.1", site_port), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()

    log = open(os.path.join(HERE, "chrome.log"), "w")
    chrome = subprocess.Popen([
        "google-chrome", "--headless=new", "--disable-gpu", "--no-sandbox", "--hide-scrollbars",
        f"--user-data-dir={PROFILE}", "--window-size=1400,1200",
        f"--remote-debugging-port={cdp_port}", "about:blank",
    ], stdout=log, stderr=log)
    dom = ""
    try:
        ws_url = None
        for _ in range(100):
            try:
                with urllib.request.urlopen(f"http://127.0.0.1:{cdp_port}/json/list", timeout=1) as r:
                    targets = json.load(r)
                page = next((t for t in targets if t.get("type") == "page"), None)
                if page:
                    ws_url = page["webSocketDebuggerUrl"]
                    break
            except Exception:
                time.sleep(0.2)
        assert ws_url, "chrome never exposed a page target"
        ws = WS(ws_url); ws.connect()
        ws.call("Runtime.enable"); ws.call("Log.enable"); ws.call("Network.enable")
        ws.call("Page.enable")
        console, requests = [], {}
        ws.call("Page.navigate", {"url": f"http://127.0.0.1:{site_port}/index.html"})

        deadline = time.time() + float(os.environ.get("RENDER_SECONDS", "20"))
        dom = ""
        while time.time() < deadline:
            try:
                msg = json.loads(ws.recv())
            except ConnectionError:
                break
            except TimeoutError:
                continue  # the page is just quiet; the deadline governs
            except Exception as exc:
                print("WS_ERR", type(exc).__name__, exc)
                break
            method, params = msg.get("method"), msg.get("params", {})
            if method == "Network.requestWillBeSent":
                requests[params["requestId"]] = {"method": params["request"]["method"], "url": params["request"]["url"]}
            elif method == "Runtime.consoleAPICalled":
                console.append("%s: %s" % (params.get("type"), " ".join(str(a.get("value", a.get("description", ""))) for a in params.get("args", []))))
            elif method == "Log.entryAdded":
                console.append("%s: %s" % (params["entry"].get("level"), params["entry"].get("text")))
        urlinfo = ws.call("Runtime.evaluate", {"expression": "JSON.stringify({url: location.href, hasLog: 'x' in window || Array.isArray(window.__POLL_LOG), scripts: [...document.scripts].map(s=>s.src)})", "returnByValue": True})
        print("PAGE", urlinfo.get("result", {}).get("result", {}).get("value"))
        for expr in [
            "JSON.stringify({trace: window.__TRACE||null, ctorErr: window.__CTOR_ERR||null, stopper: window.__STOPPER||0})",
            "JSON.stringify(window.__POLL_LOG||null)",
        ]:
            r = ws.call("Runtime.evaluate", {"expression": expr, "returnByValue": True})
            print("EV", expr, "=>", r.get("result", {}).get("result", {}).get("value"))
        vis = ws.call("Runtime.evaluate", {"expression": "JSON.stringify({vs: document.visibilityState, hidden: document.hidden, hasFocus: document.hasFocus(), t: typeof setTimeout})", "returnByValue": True})
        print("VIS", vis.get("result", {}).get("result", {}).get("value"))
        evalres = ws.call("Runtime.evaluate", {"expression": "(() => { try { const s = document.createElement('div'); s.textContent = 'x'; return 'dom-ok:' + s.textContent } catch (e) { return 'dom-err:' + e.message } })()", "returnByValue": True})
        print("DOMOK", evalres.get("result", {}).get("result", {}).get("value"))
        res = ws.call("Runtime.evaluate", {"expression": "document.documentElement.outerHTML", "returnByValue": True})
        dom = res.get("result", {}).get("result", {}).get("value", "")
        probe = ws.call("Runtime.evaluate", {"expression": "JSON.stringify(window.__LOBBY_PROBE ? {lists: window.__LOBBY_PROBE.lists(), reads: window.__LOBBY_PROBE.reads()} : null)", "returnByValue": True})
        print("PROBE", probe.get("result", {}).get("result", {}).get("value"))
        manual = ws.call("Runtime.evaluate", {"expression": "(() => { try { window.__H.start(); return 'called:' + JSON.stringify(window.__TRACE||null) } catch (e) { return 'threw:' + e.message } })()", "returnByValue": True})
        print("MANUAL_START", manual.get("result", {}).get("result", {}).get("value"))
        time.sleep(6)
        after = ws.call("Runtime.evaluate", {"expression": "JSON.stringify({trace: window.__TRACE||null, log: window.__POLL_LOG||null, f: document.querySelector('.lobby-freshness') && document.querySelector('.lobby-freshness').textContent, n: document.querySelectorAll('.lobby-games li').length, p: document.querySelectorAll('.lobby-players li').length, start: !!document.querySelector('.lobby-active button.primary')})", "returnByValue": True})
        print("MANUAL_AFTER", after.get("result", {}).get("result", {}).get("value"))
        seq = ws.call("Runtime.evaluate", {"expression": "document.querySelector('.lobby-freshness') && document.querySelector('.lobby-freshness').textContent", "returnByValue": True})
        print("FRESHNESS_AT_END", seq.get("result", {}).get("result", {}).get("value"))
        time.sleep(6)
        seq2 = ws.call("Runtime.evaluate", {"expression": "JSON.stringify({f: document.querySelector('.lobby-freshness') && document.querySelector('.lobby-freshness').textContent, n: document.querySelectorAll('.lobby-games li').length, p: document.querySelectorAll('.lobby-players li').length})", "returnByValue": True})
        print("AFTER_6S", seq2.get("result", {}).get("result", {}).get("value"))
        probe2 = ws.call("Runtime.evaluate", {"expression": "JSON.stringify({lists: window.__LOBBY_PROBE.lists(), reads: window.__LOBBY_PROBE.reads()})", "returnByValue": True})
        print("PROBE_AFTER_6S", probe2.get("result", {}).get("result", {}).get("value"))
        counters = ws.call("Runtime.evaluate", {"expression": "JSON.stringify({starters: window.__STARTER||0, watchers: window.__WATCHERS||0, logType: Object.prototype.toString.call(window.__POLL_LOG), keys: Object.keys(window).filter(k=>k.startsWith('__'))})", "returnByValue": True})
        print("COUNTERS", counters.get("result", {}).get("result", {}).get("value"))
        plog = ws.call("Runtime.evaluate", {"expression": "JSON.stringify(window.__POLL_LOG || [])", "returnByValue": True})
        print("POLL_LOG", plog.get("result", {}).get("result", {}).get("value"))
        shot = ws.call("Page.captureScreenshot", {"format": "png"})
        data = shot.get("result", {}).get("data")
        if data:
            open(os.path.join(HERE, "lobby.png"), "wb").write(base64.b64decode(data))
        open(os.path.join(HERE, "dom.html"), "w", encoding="utf-8").write(dom)
        store_calls = [c for c in requests.values() if "/stores/" in c["url"]]
        with open(os.path.join(HERE, "network.log"), "w") as f:
            for c in requests.values():
                f.write("%s %s\n" % (c["method"], c["url"]))
        print("store_requests", len(store_calls), "console_lines", len(console))
        for line in console[:10]:
            print("CONSOLE", line[:200])
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
    main()
