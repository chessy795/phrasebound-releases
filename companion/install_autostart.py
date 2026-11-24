"""One-click Native Messaging host installer for Chrome & Edge (Windows HKCU).
Auto-discovers Phrasebound Extension IDs in local Chrome/Edge profiles and registers
com.phrasebound.companion so the extension can start companion/server.py automatically.

Usage:
  python -I -X utf8 companion/install_autostart.py
  python -I -X utf8 companion/install_autostart.py --ext-id <32-char-extension-id>
  python -I -X utf8 companion/install_autostart.py --uninstall
"""
import argparse
import glob
import json
import os
import re
import sys

HOST_NAME = 'com.phrasebound.companion'
COMPANION_DIR = os.path.dirname(os.path.abspath(__file__))
HOST_MANIFEST = os.path.join(COMPANION_DIR, f'{HOST_NAME}.json')
HOST_CMD = os.path.join(COMPANION_DIR, 'native_host.cmd')

REG_KEYS = [
    rf'Software\Google\Chrome\NativeMessagingHosts\{HOST_NAME}',
    rf'Software\Microsoft\Edge\NativeMessagingHosts\{HOST_NAME}',
]


def discover_extension_ids() -> list[str]:
    found = set()
    local_app = os.environ.get('LOCALAPPDATA', '')
    if not local_app:
        return []
    pref_globs = [
        os.path.join(local_app, r'Google\Chrome\User Data\*\Preferences'),
        os.path.join(local_app, r'Google\Chrome\User Data\*\Secure Preferences'),
        os.path.join(local_app, r'Microsoft\Edge\User Data\*\Preferences'),
        os.path.join(local_app, r'Microsoft\Edge\User Data\*\Secure Preferences'),
    ]
    for pat in pref_globs:
        for p in glob.glob(pat):
            try:
                data = json.loads(open(p, encoding='utf-8', errors='replace').read())
            except Exception:
                continue
            settings = ((data.get('extensions') or {}).get('settings') or {})
            if not isinstance(settings, dict):
                continue
            for ext_id, meta in settings.items():
                if not re.fullmatch(r'[a-p]{32}', str(ext_id)):
                    continue
                path_str = str((meta or {}).get('path') or '').lower()
                name_str = str((((meta or {}).get('manifest') or {}).get('name')) or '').lower()
                if 'yt_lang_ext' in path_str or 'phrasebound' in path_str or 'phrasebound' in name_str:
                    found.add(ext_id)
    return sorted(found)


def write_manifest(ext_ids: list[str]):
    origins = [f'chrome-extension://{eid}/' for eid in ext_ids if re.fullmatch(r'[a-p]{32}', eid)]
    if not origins:
        raise RuntimeError(
            'No Phrasebound extension ID found in Chrome/Edge yet. '
            'Load ext/ in chrome://extensions first, or pass --ext-id <32-char-id>.'
        )
    py_exe = sys.executable if (sys.executable and os.path.isfile(sys.executable)) else 'python'
    with open(HOST_CMD, 'w', encoding='utf-8') as f:
        f.write(f'@echo off\r\n"{py_exe}" -I -X utf8 "%~dp0native_host.py" %*\r\n')
    obj = {
        'name': HOST_NAME,
        'description': 'Phrasebound Local AI Companion Auto-Start Host',
        'path': HOST_CMD,
        'type': 'stdio',
        'allowed_origins': origins,
    }
    with open(HOST_MANIFEST, 'w', encoding='utf-8') as f:
        json.dump(obj, f, indent=2)
    return obj


def install(ext_ids: list[str]):
    if os.name != 'nt':
        raise RuntimeError('Windows registry auto-install is currently Windows-only.')
    import winreg

    manifest_obj = write_manifest(ext_ids)
    for rk in REG_KEYS:
        with winreg.CreateKeyEx(winreg.HKEY_CURRENT_USER, rk, 0, winreg.KEY_WRITE) as k:
            winreg.SetValueEx(k, '', 0, winreg.REG_SZ, HOST_MANIFEST)
    return manifest_obj


def uninstall():
    if os.name == 'nt':
        import winreg
        for rk in REG_KEYS:
            try:
                winreg.DeleteKey(winreg.HKEY_CURRENT_USER, rk)
            except FileNotFoundError:
                pass
    if os.path.isfile(HOST_MANIFEST):
        os.remove(HOST_MANIFEST)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--ext-id', action='append', default=[])
    ap.add_argument('--uninstall', action='store_true')
    args = ap.parse_args()

    if args.uninstall:
        uninstall()
        print('Uninstalled Native Messaging host:', HOST_NAME)
        return

    ids = sorted(set(discover_extension_ids() + [x.strip() for x in args.ext_id if x.strip()]))
    manifest_obj = install(ids)
    print('Installed Native Messaging host:', HOST_MANIFEST)
    print('Allowed origins:', ', '.join(manifest_obj['allowed_origins']))
    print('Chrome & Edge can now auto-start Phrasebound Companion silently on :8787.')


if __name__ == '__main__':
    main()
