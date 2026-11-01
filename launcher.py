#!/usr/bin/env python3
"""Start the local game and open it in the default browser."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import os
from urllib.error import URLError
from urllib.request import urlopen
import webbrowser

ROOT = Path(__file__).resolve().parent
os.chdir(ROOT)
handler = partial(SimpleHTTPRequestHandler, directory=str(ROOT))
server = None
for port in range(8765, 8785):
    try:
        server = ThreadingHTTPServer(("127.0.0.1", port), handler)
        break
    except OSError:
        # Reuse a running copy so the browser keeps the same saved course.
        try:
            with urlopen(f"http://127.0.0.1:{port}/", timeout=0.5) as response:
                if b'little-railway-v1' in response.read(4096):
                    url = f"http://127.0.0.1:{port}/"
                    print(f"起動中のちいさな鉄道を開きます: {url}", flush=True)
                    webbrowser.open(url)
                    raise SystemExit(0)
        except (OSError, URLError):
            pass
        continue
if server is None:
    raise SystemExit("サーバーを起動できませんでした。8765〜8784番ポートを確認してください。")
url = f"http://127.0.0.1:{server.server_port}/"
print(f"ちいさな鉄道を起動しました: {url}", flush=True)
print("終了するには、このウィンドウで Control + C を押してください。", flush=True)
webbrowser.open(url)
try:
    server.serve_forever()
except KeyboardInterrupt:
    print("\n終了しました。")
finally:
    server.server_close()
