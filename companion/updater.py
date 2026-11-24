"""Phrasebound self-updater for the companion code and the unpacked extension (never the models).

The update source is a base URL that serves update.json, e.g.
    https://raw.githubusercontent.com/chessy795/phrasebound-releases/main/
update.json:
    {"version": "1.1.1", "files_base": "https://raw.githubusercontent.com/<repo>/<commit>/",
     "files": {"companion/server.py": "<sha256>", "extension/manifest.json": "<sha256>", ...}}
Only files whose SHA-256 differs from the local copy are downloaded; each download is checked
against its SHA-256 before it replaces anything. Replaced files are backed up for --rollback.

  companion/<path>  ->  this app folder (code and small data files only)
  extension/<path>  ->  ../extension (the folder Chrome loads unpacked)

Source, first match wins: env PHRASEBOUND_UPDATE_URL, then the first non-comment line of
update_source.txt. No source means no checks. The server calls start_background() at startup;
it checks at most every 12 hours. The extension reloads itself when ../extension/manifest.json
has a newer version than the one it is running.

  python updater.py             check now
  python updater.py --rollback  undo the last update
"""
import hashlib, json, os, re, shutil, sys, threading, time, urllib.request

APP_DIR = os.path.dirname(os.path.abspath(__file__))
EXT_DIR = os.environ.get('PHRASEBOUND_EXT_DIR') or os.path.normpath(os.path.join(APP_DIR, '..', 'extension'))
STATE_DIR = os.path.join(APP_DIR, '.update')
VERSION_FILE = os.path.join(APP_DIR, 'VERSION')
SOURCE_FILE = os.path.join(APP_DIR, 'update_source.txt')
LOG_FILE = os.path.join(STATE_DIR, 'update.log')
STAMP_FILE = os.path.join(STATE_DIR, 'last_check')
CHECK_EVERY = 12 * 3600
MAX_FILE = 95 * 1024 * 1024
APP_EXT = {'.py', '.json', '.cmd', '.bat', '.txt', '.md', '.mjs'}
EXT_EXT = {'.js', '.json', '.html', '.css', '.png', '.svg', '.webp', '.jpg', '.txt', '.md',
           '.woff', '.woff2', '.ttf', '.wasm', '.mp3', '.ogg', '.gz', '.bin', '.tsv', '.csv', '.xml'}


def _log(msg):
    os.makedirs(STATE_DIR, exist_ok=True)
    try:
        with open(LOG_FILE, 'a', encoding='utf-8') as f:
            f.write(time.strftime('%Y-%m-%d %H:%M:%S ') + msg + '\n')
    except Exception:
        pass
    print('[updater] ' + msg)


def current_version():
    try:
        return open(VERSION_FILE, encoding='utf-8').read().strip() or '0'
    except Exception:
        return '0'


def ext_disk_version():
    try:
        return json.load(open(os.path.join(EXT_DIR, 'manifest.json'), encoding='utf-8')).get('version')
    except Exception:
        return None


def _vt(v):
    return tuple(int(x) for x in re.findall(r'\d+', str(v))[:4]) or (0,)


def update_source():
    env = os.environ.get('PHRASEBOUND_UPDATE_URL', '').strip()
    if env:
        return env
    try:
        for line in open(SOURCE_FILE, encoding='utf-8'):
            line = line.strip()
            if line and not line.startswith('#'):
                return line
    except Exception:
        pass
    return ''


def _get(url, limit):
    req = urllib.request.Request(url, headers={'User-Agent': 'phrasebound-updater', 'Cache-Control': 'no-cache'})
    with urllib.request.urlopen(req, timeout=60) as r:
        data = r.read(limit + 1)
    if len(data) > limit:
        raise ValueError('download too large: ' + url)
    return data


def _sha(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()


def _target(name):
    """Map a manifest path to a local path, or None to skip. Raises on unsafe paths."""
    name = name.replace('\\', '/')
    parts = name.split('/')
    if name.startswith('/') or ':' in name or '..' in parts or '' in parts:
        raise ValueError('unsafe path in update: ' + name)
    root, rest = parts[0], parts[1:]
    ext = os.path.splitext(name)[1].lower()
    if root == 'companion':
        if rest[0] in ('models', '.update') or rest[-1] in ('update_source.txt', 'VERSION') or ext not in APP_EXT:
            return None
        return os.path.join(APP_DIR, *rest)
    if root == 'extension':
        if not os.path.isdir(EXT_DIR) or ext not in EXT_EXT:
            return None
        return os.path.join(EXT_DIR, *rest)
    return None


def check_and_apply(force=False):
    src = update_source()
    if not src:
        return {'ok': True, 'skipped': 'no update source configured'}
    os.makedirs(STATE_DIR, exist_ok=True)
    if not force:
        try:
            if time.time() - os.path.getmtime(STAMP_FILE) < CHECK_EVERY:
                return {'ok': True, 'skipped': 'checked recently'}
        except OSError:
            pass
    open(STAMP_FILE, 'w').close()
    cur = current_version()
    man = json.loads(_get(src.rstrip('/') + '/update.json' if not src.endswith('.json') else src, 4 << 20).decode('utf-8'))
    new = str(man['version'])
    if _vt(new) <= _vt(cur):
        return {'ok': True, 'current': cur, 'latest': new, 'updated': False}
    base = man['files_base'].rstrip('/') + '/'
    todo = []
    for name, sha in man['files'].items():
        dest = _target(name)
        if dest and not (os.path.isfile(dest) and _sha(dest) == sha):
            todo.append((name, sha, dest))
    staged = []
    stage = os.path.join(STATE_DIR, 'staging')
    shutil.rmtree(stage, ignore_errors=True)
    os.makedirs(stage)
    for i, (name, sha, dest) in enumerate(todo):   # download and verify everything before touching anything
        data = _get(base + urllib.request.quote(name), MAX_FILE)
        if hashlib.sha256(data).hexdigest() != sha:
            raise ValueError('checksum mismatch, update refused: ' + name)
        tmp = os.path.join(stage, str(i))
        with open(tmp, 'wb') as f:
            f.write(data)
        staged.append((name, tmp, dest))
    backup = os.path.join(STATE_DIR, 'backup_' + cur)
    shutil.rmtree(backup, ignore_errors=True)
    os.makedirs(backup)
    record = []
    for name, tmp, dest in staged:
        existed = os.path.isfile(dest)
        if existed:
            b = os.path.join(backup, *name.split('/'))
            os.makedirs(os.path.dirname(b), exist_ok=True)
            shutil.copy2(dest, b)
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        os.replace(tmp, dest) if os.path.splitdrive(tmp)[0] == os.path.splitdrive(dest)[0] else shutil.move(tmp, dest)
        record.append({'name': name, 'dest': dest, 'existed': existed})
    shutil.rmtree(stage, ignore_errors=True)
    json.dump({'from': cur, 'files': record}, open(os.path.join(backup, '_record.json'), 'w', encoding='utf-8'))
    with open(VERSION_FILE, 'w', encoding='utf-8') as f:
        f.write(new)
    with open(os.path.join(STATE_DIR, 'last_backup'), 'w', encoding='utf-8') as f:
        f.write(backup)
    _log(f'updated {cur} -> {new}: {len(record)} files changed')
    return {'ok': True, 'current': cur, 'latest': new, 'updated': True, 'files': len(record)}


def rollback():
    try:
        backup = open(os.path.join(STATE_DIR, 'last_backup'), encoding='utf-8').read().strip()
        rec = json.load(open(os.path.join(backup, '_record.json'), encoding='utf-8'))
    except Exception:
        return {'ok': False, 'error': 'no backup to restore'}
    for r in rec['files']:
        b = os.path.join(backup, *r['name'].split('/'))
        if r['existed'] and os.path.isfile(b):
            shutil.copy2(b, r['dest'])
        elif not r['existed'] and os.path.isfile(r['dest']):
            os.remove(r['dest'])
    with open(VERSION_FILE, 'w', encoding='utf-8') as f:
        f.write(rec['from'])
    os.remove(os.path.join(STATE_DIR, 'last_backup'))
    _log(f"rolled back to {rec['from']} ({len(rec['files'])} files)")
    return {'ok': True, 'restored': len(rec['files']), 'version': rec['from']}


_last = {'ok': True, 'skipped': 'not run yet'}


def status():
    return dict(_last, version=current_version(), ext_version=ext_disk_version(), source=bool(update_source()))


def start_background():
    def run():
        global _last
        while True:   # the companion may stay up for days; the 12-hour stamp limits real checks
            try:
                r = check_and_apply()
                if not r.get('skipped') or _last.get('skipped') == 'not run yet':
                    _last = r
            except Exception as e:
                _last = {'ok': False, 'error': str(e)}
                _log('update check failed: ' + str(e))
            time.sleep(3600)
    threading.Thread(target=run, daemon=True).start()


if __name__ == '__main__':
    if '--rollback' in sys.argv:
        print(json.dumps(rollback()))
    else:
        try:
            print(json.dumps(check_and_apply(force=True)))
        except Exception as e:
            print(json.dumps({'ok': False, 'error': str(e)}))
            sys.exit(1)
