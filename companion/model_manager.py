"""Offline device discovery and an explicitly requested, checksum-pinned GGUF installer."""
import csv
import hashlib
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import threading
import urllib.request
from contextlib import contextmanager
from dataclasses import dataclass
from functools import lru_cache


@dataclass(frozen=True)
class ModelFile:
    repo: str
    revision: str
    filename: str
    size: int
    sha256: str
    license: str

    @property
    def url(self):
        return f'https://huggingface.co/{self.repo}/resolve/{self.revision}/{self.filename}'


# sizes and SHA-256 are the LFS metadata at the pinned Hub revisions.
CATALOG = {
    'plamo-0.8b': ModelFile('pfnet/plamo-3-translate-0.8b-GGUF', '1cf96ae02133958a20074bfdfab76517bb737d00',
        'plamo-3-translate-0.8b-Q4_K_M.gguf', 573126848, '70891ec70dc7ab4205745a38307867c2881b99239f20327927633abfe4bc9ec6', 'PLaMo Community License'),
    'hy-mt2': ModelFile('tencent/Hy-MT2-1.8B-GGUF', 'a0c709d9fac510f2c807aa3af52872340dc37a4a',
        'Hy-MT2-1.8B-Q8_0.gguf', 1908528192, '5c3fe0b1408a5ceb0143184ef247b11b579c525f4b02b060e6c851bb76fef1a4', 'Apache-2.0'),
    'index-2b-q4': ModelFile('IndexTeam/Index-Translate-2B-GGUF', '3a0eca6ce931d88d00614d427ab3ed8ff0743902',
        'Index-Translate-2B.Q4_K_M.gguf', 1312164352, '044b313d29342bd3b2c77cbb64023ca0d209bd9b3247763f9d162767ef2d746a', 'Apache-2.0'),
    'translategemma-4b': ModelFile('bullerwins/translategemma-4b-it-GGUF', '7c938465a870d8624bcfa98a8e4a3510053c19a8',
        'translategemma-4b-it-Q4_K_M.gguf', 2489909312, '7f7357c14abd9da4eb200b38b05da502cd6e10d7e1d403fbc9f78c19f3209b72', 'Gemma Terms of Use'),
    'qwen3-asr-0.6b': ModelFile('handy-computer/Qwen3-ASR-0.6B-gguf', '7e7c69a577fa2725dfedbe34b5e999336e30a19b',
        'Qwen3-ASR-0.6B-Q8_0.gguf', 850423456, 'f081b2d5e23bd669d92cc331d722a8a0681943b8e6f34b48996fd5c319b5acd8', 'Apache-2.0'),
}


def _run(args):
    try:
        result = subprocess.run(args, capture_output=True, text=True, errors='replace', timeout=7,
                                creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        return result.stdout + '\n' + result.stderr if result.returncode == 0 else ''
    except (OSError, subprocess.TimeoutExpired):
        return ''


def _gpu(name, backend, mib, device_id=None, free=None):
    integrated = bool(re.search(r'UHD|Iris|Intel.*Graphics|Radeon(?:\(TM\))? (?:Graphics|Vega|\d{3}M)\b', name, re.I))
    if re.search(r'\bArc\b.*\b[AB]\d{3}\b', name, re.I):
        integrated = False
    return dict(name=name, backend=backend, vram_mib=mib, free_mib=free, id=device_id, integrated=integrated)


def parse_llama_devices(output):
    devices = []
    for line in output.splitlines():
        match = re.match(r'^\s*((CUDA|Vulkan|Metal|SYCL|HIP|ROCm|MUSA)\d*)\s*:\s*(.+?)\s*\((\d+) MiB(?:,\s*(\d+) MiB free)?\)\s*$', line, re.I)
        if match:
            ident, backend, name, total, free = match.groups()
            devices.append(_gpu(name, backend, int(total), ident, int(free) if free else None))
    return devices


def hardware_report(llama, run=_run, system=sys.platform):
    devices = parse_llama_devices(run([llama, '--list-devices']))
    source = 'llama'
    if not devices:
        source = 'nvidia-smi'
        output = run(['nvidia-smi', '--query-gpu=name,memory.total,memory.free', '--format=csv,noheader,nounits'])
        for row in csv.reader(output.splitlines(), skipinitialspace=True):
            if len(row) == 3 and row[1].strip().isdigit() and row[2].strip().isdigit():
                devices.append(_gpu(row[0], 'CUDA', int(row[1]), free=int(row[2])))
    if not devices and system == 'win32':
        source = 'wmic'
        output = run(['wmic', 'path', 'win32_VideoController', 'get', 'Name,AdapterRAM', '/format:csv'])
        for row in csv.DictReader(line.strip() for line in output.splitlines() if line.strip()):
            name = row.get('Name', '').strip()
            if name and not re.search('Basic Display|Remote Display', name, re.I):
                size = (row.get('AdapterRAM') or '').strip()
                # Win32_VideoController.AdapterRAM is uint32 and can saturate on larger cards.
                devices.append(_gpu(name, 'auto', int(size) // 1048576 if size.isdigit() else 0))
    best = max(devices, key=lambda d: (not d['integrated'], d['vram_mib'], d['free_mib'] or 0), default=None)
    mib = best['vram_mib'] if best else 0
    if not best:
        tier, model, layers, slots = 'cpu_only', 'plamo-0.8b', 0, 1
    elif best['integrated'] or mib < 7680:
        tier, model, layers, slots = 'igpu_4gb', 'plamo-0.8b', 16, 1
    elif mib < 11776:
        tier, model, layers, slots = 'gpu_8gb', 'hy-mt2', 99, 2
    elif mib < 15872:
        tier, model, layers, slots = 'gpu_12gb', 'translategemma-4b', 99, 3
    else:
        tier, model, layers, slots = 'gpu_16gb_plus', 'plamo-2b', 99, 4  # 9B was 3x slower on pages (audit 2026-11-23); users can still pick it
    # ASR uses transcribe.cpp's Vulkan backend, independently of llama's backend.
    asr = 'qwen3_small_vulkan' if best and system != 'darwin' else 'faster_whisper'
    return dict(tier=tier, source=source if best else 'cpu', devices=devices, selected=best,
                recommended=dict(mtModel=model, asrBackend=asr, ngl=layers, parallel=slots))


@lru_cache(maxsize=4)
def detect_hardware(llama):
    return hardware_report(llama)


def model_path(env, legacy, key):
    override = os.environ.get(env)
    if override:
        return override
    local_dir = os.environ.get('YT_STUDY_MODEL_DIR')
    if not local_dir and os.path.isfile(legacy):
        return legacy
    return str(Path(local_dir or Path(__file__).parent / 'models') / CATALOG[key].filename)


@contextmanager
def _own_partial(part):
    # Separate processes can share a model directory. OS releases this lock on exit.
    with open(str(part) + '.lock', 'a+b') as lock:
        lock.seek(0)
        if os.name == 'nt':
            import msvcrt
            msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        yield


class DownloadManager:
    def __init__(self, paths, catalog=CATALOG):
        self.paths = {key: Path(paths[key]) for key in catalog}
        self.catalog = catalog
        self.jobs = {}
        self.lock = threading.RLock()

    def status(self, key):
        with self.lock:
            if key in self.jobs:
                return dict(self.jobs[key])
            dest = self.paths[key]
            part = Path(str(dest) + '.part')
            state = 'present' if dest.is_file() else 'partial' if part.is_file() else 'idle'
            path = dest if state == 'present' else part
            return dict(model=key, state=state, bytes=path.stat().st_size if path.is_file() else 0,
                        total=self.catalog[key].size)

    def listing(self):
        return [dict(key=k, filename=m.filename, url=m.url, size_bytes=m.size, sha256=m.sha256,
                     license=m.license, revision=m.revision, installed=self.paths[k].is_file())
                for k, m in self.catalog.items()]

    def _update(self, key, **changes):
        with self.lock:
            self.jobs[key].update(changes)

    def start(self, key):
        with self.lock:
            for job in self.jobs.values():
                if job['state'] in ('downloading', 'verifying'):
                    if job['model'] == key:
                        return dict(job)
                    raise RuntimeError('Another model download is in progress.')
            dest, size = self.paths[key], self.catalog[key].size
            dest.parent.mkdir(parents=True, exist_ok=True)
            part = Path(str(dest) + '.part')
            count = part.stat().st_size if part.is_file() else 0
            if not dest.is_file() and shutil.disk_usage(dest.parent).free < size - (count if count <= size else 0):
                raise OSError('Insufficient disk space for this model.')
            self.jobs[key] = dict(model=key, state='verifying' if dest.is_file() else 'downloading',
                                  bytes=count, total=size)
            threading.Thread(target=self._install, args=(key, dest, part), daemon=True).start()
            return dict(self.jobs[key])

    def _install(self, key, dest, part):
        spec = self.catalog[key]
        try:
            with _own_partial(part):
                present = dest.is_file()
                path = dest if present else part
                if not present:
                    self._fetch(key, part, spec)
                self._update(key, state='verifying', bytes=path.stat().st_size)
                digest = hashlib.sha256()
                with path.open('rb') as src:
                    for chunk in iter(lambda: src.read(1024 * 1024), b''):
                        digest.update(chunk)
                if path.stat().st_size != spec.size or digest.hexdigest() != spec.sha256:
                    if present:
                        raise ValueError('An existing local file differs from the catalog. Its contents were preserved.')
                    part.unlink()
                    raise ValueError('SHA-256 mismatch. Retry to fetch a fresh copy.')
                if not present:
                    os.replace(part, dest)
                self._update(key, state='completed', bytes=spec.size)
        except Exception as exc:
            self._update(key, state='error', error=str(exc))

    def _fetch(self, key, part, spec):
        offset = part.stat().st_size if part.exists() else 0
        if offset > spec.size:
            part.unlink()
            offset = 0
        while offset < spec.size:
            headers = {'Accept-Encoding': 'identity'}
            if offset:
                headers['Range'] = f'bytes={offset}-'
            with urllib.request.urlopen(urllib.request.Request(spec.url, headers=headers), timeout=45) as response:
                if response.status == 206:
                    value = response.headers.get('Content-Range', '')
                    match = re.fullmatch(r'bytes (\d+)-(\d+)/(\d+)', value)
                    if not match:
                        raise ValueError('Missing or invalid Content-Range.')
                    first, last, total = map(int, match.groups())
                    if first != offset or total != spec.size or not first <= last < total:
                        raise ValueError('Range does not match the expected model and offset.')
                    end = last + 1
                elif response.status == 200:
                    offset, end = 0, spec.size
                else:
                    raise ValueError(f'Unexpected HTTP status {response.status}.')
                length = response.headers.get('Content-Length')
                if length is not None and int(length) != end - offset:
                    raise ValueError('Unexpected response length.')
                with part.open('ab' if offset else 'wb') as target:
                    while offset < end:
                        chunk = response.read(min(1024 * 1024, end - offset))
                        if not chunk:
                            raise OSError('Download interrupted. Retry to resume.')
                        target.write(chunk)
                        offset += len(chunk)
                        self._update(key, bytes=offset)
                    if response.read(1):
                        raise ValueError('Response exceeds the advertised size.')
