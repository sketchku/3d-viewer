"""3D File Viewer - Portable launcher (local HTTP server + browser app window)."""
from __future__ import annotations

import os
import socket
import socketserver
import subprocess
import sys
import threading
import time
import webbrowser

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
APP_DIR = os.path.join(BASE_DIR, 'app')
LOG_FILE = os.path.join(BASE_DIR, 'data', 'launcher.log')
HOST = '127.0.0.1'
DEFAULT_PORT = 8765
WINDOW_TITLE = '3D File Viewer'

if BASE_DIR not in sys.path:
    sys.path.insert(0, BASE_DIR)

from viewer_server import make_handler


def log(message: str) -> None:
    os.makedirs(os.path.dirname(LOG_FILE), exist_ok=True)
    stamp = time.strftime('%Y-%m-%d %H:%M:%S')
    with open(LOG_FILE, 'a', encoding='utf-8') as handle:
        handle.write(f'[{stamp}] {message}\n')


def find_free_port(start=DEFAULT_PORT):
    for port in range(start, start + 50):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            if sock.connect_ex((HOST, port)) != 0:
                return port
    return start


def start_server(port):
    handler = make_handler(APP_DIR)
    with socketserver.TCPServer((HOST, port), handler) as httpd:
        httpd.allow_reuse_address = True
        httpd.serve_forever()


def find_browser():
    candidates = [
        os.path.expandvars(r'%ProgramFiles%\Microsoft\Edge\Application\msedge.exe'),
        os.path.expandvars(r'%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe'),
        os.path.expandvars(r'%ProgramFiles%\Google\Chrome\Application\chrome.exe'),
        os.path.expandvars(r'%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe'),
        os.path.expandvars(r'%LocalAppData%\Google\Chrome\Application\chrome.exe'),
    ]
    for browser in candidates:
        if os.path.isfile(browser):
            return browser
    return None


def open_with_browser_app(url):
    profile = os.path.join(BASE_DIR, 'data', 'browser-profile')
    os.makedirs(profile, exist_ok=True)

    browser = find_browser()
    if browser:
        args = [
            browser,
            f'--app={url}',
            f'--user-data-dir={profile}',
            '--new-window',
            '--disable-features=TranslateUI',
            '--disable-http-cache',
            '--disk-cache-size=1',
            f'--window-name={WINDOW_TITLE}',
        ]
        return subprocess.Popen(
            args,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )

    webbrowser.open(url)
    return None


def running_without_console() -> bool:
    return not sys.stdin or not sys.stdin.isatty()


def wait_for_exit(browser_proc):
    if browser_proc is not None:
        browser_proc.wait()
        return

    if running_without_console():
        while True:
            time.sleep(1)
        return

    print('3D File Viewer is running.')
    print('Close the viewer window, then press Enter here to stop the server.')
    try:
        input()
    except (EOFError, KeyboardInterrupt):
        pass


def fail(message: str, code: int = 1) -> None:
    log(message)
    if running_without_console():
        sys.exit(code)
    print(message)
    input('Press Enter to exit...')
    sys.exit(code)


def main():
    if not os.path.isdir(APP_DIR):
        fail(f'App folder not found: {APP_DIR}')

    port = find_free_port()
    server_thread = threading.Thread(target=start_server, args=(port,), daemon=True)
    server_thread.start()
    time.sleep(0.35)

    url = f'http://{HOST}:{port}/index.html?v=2.4.1'
    log(f'Starting viewer at {url}')

    browser_proc = open_with_browser_app(url)
    if browser_proc is None and find_browser() is None:
        log('No Edge/Chrome found; opened with default browser.')

    wait_for_exit(browser_proc)
    log('Viewer closed.')


if __name__ == '__main__':
    main()