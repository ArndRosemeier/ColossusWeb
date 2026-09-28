#!/usr/bin/env python3
"""One in-turn browser render of the REAL built app against a seeded fake store.

The chrome tree is killed in `finally`, so it dies on the failure path too.
"""
import os, re, shutil, socket, subprocess, sys, threading, time, http.server, functools

HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.path.join(HERE, "site")
PROFILE = os.path.join(HERE, "profile")

def free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port

def main():
    shutil.rmtree(PROFILE, ignore_errors=True)
    port = free_port()
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=SITE)
    httpd = http.server.ThreadingHTTPServer(("127.0.0.1", port), handler)
    t = threading.Thread(target=httpd.serve_forever, daemon=True)
    t.start()

    dump = os.path.join(HERE, "dom.html")
    shot = os.path.join(HERE, "lobby.png")
    log = open(os.path.join(HERE, "chrome.log"), "w")
    chrome = None
    try:
        # REAL time, not --virtual-time-budget: with the flag, a fetch against the
        # seeded store never settles before the dump (measured: the DOM came back
        # at phase "starting"), so the render must be given wall-clock seconds.
        cmd = [
            "google-chrome", "--headless=new", "--disable-gpu", "--no-sandbox",
            "--hide-scrollbars", f"--user-data-dir={PROFILE}", "--window-size=1400,1200",
            f"--screenshot={shot}",
            "--dump-dom", f"http://127.0.0.1:{port}/index.html",
        ]
        out = open(dump, "w")
        chrome = subprocess.Popen(cmd, stdout=out, stderr=log)
        try:
            rc = chrome.wait(timeout=float(os.environ.get("RENDER_SECONDS", "22")))
            print("chrome_exit=%s" % rc)
        except subprocess.TimeoutExpired:
            # Not a failure: the dump is written as the page runs, so killing the
            # renderer IS how this snapshot is taken.
            print("chrome_still_running=1 (killed after the render window)")
        out.close()
    finally:
        if chrome is not None and chrome.poll() is None:
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
