"""Chrome / Edge Native Messaging host for automatic background launch of Phrasebound Companion.
Reads length-prefixed JSON from stdin, ensures companion/server.py is alive on :8787
(spawning pythonw.exe completely detached with zero terminal window), and replies with status.
"""
import json
import os
import struct
import subprocess
import sys
import tempfile
import time
import urllib.request

COMPANION_DIR = os.path.dirname(os.path.abspath(__file__))
SERVER_PY = os.path.join(COMPANION_DIR, 'server.py')
PORT = int(os.environ.get('YT_STUDY_PORT', '8787'))
HEALTH_URL = f'http://127.0.0.1:{PORT}/health'


def read_msg():
    raw_len = sys.stdin.buffer.read(4)
    if not raw_len or len(raw_len) < 4:
        return None
    msg_len = struct.unpack('<I', raw_len)[0]
    if msg_len <= 0 or msg_len > 1_048_576:
        return None
    payload = sys.stdin.buffer.read(msg_len)
    return json.loads(payload.decode('utf-8'))


def send_msg(obj):
    data = json.dumps(obj, ensure_ascii=False).encode('utf-8')
    sys.stdout.buffer.write(struct.pack('<I', len(data)))
    sys.stdout.buffer.write(data)
    sys.stdout.buffer.flush()


def is_alive(timeout=0.45):
    try:
        with urllib.request.urlopen(HEALTH_URL, timeout=timeout) as r:
            return r.status == 200
    except Exception:
        return False


def pick_pythonw():
    exe = sys.executable
    if os.name == 'nt':
        cand = os.path.join(os.path.dirname(exe), 'pythonw.exe')
        if os.path.isfile(cand):
            return cand
    return exe


def start_detached_server():
    lock_path = os.path.join(tempfile.gettempdir(), f'yt_study_companion_{PORT}.starting')
    now = time.time()
    try:
        if os.path.isfile(lock_path) and (now - os.path.getmtime(lock_path)) < 8.0:
            return
        with open(lock_path, 'w', encoding='utf-8') as lf:
            lf.write(str(os.getpid()))
    except Exception:
        pass
    log_path = os.path.join(tempfile.gettempdir(), 'yt_study_companion.log')
    flags = 0
    if os.name == 'nt':
        flags = (
            getattr(subprocess, 'DETACHED_PROCESS', 0x00000008)
            | getattr(subprocess, 'CREATE_NEW_PROCESS_GROUP', 0x00000200)
            | getattr(subprocess, 'CREATE_NO_WINDOW', 0x08000000)
        )
    logf = open(log_path, 'ab')
    try:
        subprocess.Popen(
            [pick_pythonw(), '-I', '-X', 'utf8', SERVER_PY],
            cwd=COMPANION_DIR,
            stdin=subprocess.DEVNULL,
            stdout=logf,
            stderr=logf,
            close_fds=True,
            creationflags=flags,
        )
    finally:
        logf.close()


def ensure_running(wait_sec=5.0):
    if is_alive():
        return {'ok': True, 'started': False, 'alreadyRunning': True, 'port': PORT}
    if not os.path.isfile(SERVER_PY):
        return {'ok': False, 'error': f'Missing {SERVER_PY}', 'port': PORT}
    start_detached_server()
    deadline = time.time() + wait_sec
    while time.time() < deadline:
        if is_alive(timeout=0.35):
            return {'ok': True, 'started': True, 'alreadyRunning': False, 'port': PORT}
        time.sleep(0.2)
    return {'ok': False, 'started': True, 'error': 'Companion starting slowly; retry /health shortly', 'port': PORT}


def main():
    try:
        msg = read_msg()
        op = (msg or {}).get('op', 'ensure') if isinstance(msg, dict) else 'ensure'
        if op == 'status':
            send_msg({'ok': is_alive(), 'port': PORT})
            return
        send_msg(ensure_running())
    except Exception as exc:
        try:
            send_msg({'ok': False, 'error': str(exc), 'port': PORT})
        except Exception:
            pass


if __name__ == '__main__':
    main()
