"""Index verified publisher media for personal study.

Run with the publisher intake directory. The optional archive adds only
credited publisher-caption tracks with original-language evidence.
"""
import argparse
import base64
from collections import Counter
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
from urllib.parse import urlsplit


LANGUAGES = frozenset(('en', 'zh', 'yue', 'ja', 'ko', 'es', 'fr', 'de', 'pt', 'it', 'ru', 'tl'))
VIDEO_ID = re.compile(r'[A-Za-z0-9_-]{11}\Z')
ARCHIVE_AUDIO = {'audio_confirmed', 'audio_sample_confirmed'}
MAX_INDEX_BYTES = 16 * 1024 * 1024


def index_path():
    private = Path(os.environ.get('LOCALAPPDATA') or Path.home() / '.local/share') / 'Phrasebound'
    return Path(os.environ.get('YT_STUDY_MEDIA_CATALOGUE') or private / 'media-catalogue.json')


def read_json(path):
    return json.loads(path.read_text(encoding='utf-8-sig'))


def json_rows(path):
    with path.open(encoding='utf-8-sig') as file:
        for line in file:
            if line.strip():
                yield json.loads(line)


def positive_int(value):
    try:
        return max(0, int(value))
    except (TypeError, ValueError, OverflowError):
        return 0


def episode_cues(directory, record):
    source = (directory / record['path']).resolve()
    if not source.is_relative_to(directory.resolve()) or source.suffix != '.jsonl':
        raise ValueError('Episode transcripts must be JSONL files within their intake directory.')
    for row in json_rows(source):
        if (row.get('lang') != record['lang'] or row.get('use') != 'local-review'
                or row.get('partition', 'development') != 'development'
                or (record.get('document') and row.get('document') != record['document'])
                or (record.get('row_kind') and row.get('kind') != record['row_kind'])):
            continue
        body = row.get('text')
        if isinstance(body, str) and body.strip():
            yield [row.get('start_ms'), row.get('end_ms'), body.strip()]


def video_document(lang, identifier, title, publisher, duration, views, evidence, cues):
    return dict(id='yt:' + identifier, lang=lang, kind='video',
                title=title or identifier, publisher=publisher,
                duration_s=positive_int(duration), views=positive_int(views) or None,
                evidence=evidence, captions='publisher',
                url='https://www.youtube.com/watch?v=' + identifier, cues=cues)


def intake_documents(root):
    for record in read_json(root / 'catalog.json'):
        identifier = record.get('id', '')
        lang = record.get('lang')
        if (lang not in LANGUAGES or not VIDEO_ID.fullmatch(identifier)
                or record.get('provenance') != 'platform_publisher_track' or record.get('use') != 'local-review'):
            continue
        receipt = read_json(root / 'receipts' / (identifier + '.json'))
        evidence = receipt.get('audio_evidence')
        if (receipt.get('status') != 'saved' or receipt.get('lang') != lang
                or evidence not in {'platform_original_track', *ARCHIVE_AUDIO}):
            continue
        cues = list(episode_cues(root, record))
        if cues:
            yield video_document(lang, identifier, receipt.get('title'), record.get('publisher') or receipt.get('uploader'),
                                 receipt.get('duration_s'), receipt.get('observed_views') or receipt.get('views_at_ranking'),
                                 evidence, cues)

    podcasts = root / 'podcasts'
    if not (podcasts / 'catalog.json').is_file():
        return
    for record in read_json(podcasts / 'catalog.json'):
        if (record.get('provenance') != 'publisher_episode_transcript' or record.get('lang') not in LANGUAGES
                or record.get('use') != 'local-review'):
            continue
        url = record.get('url', '')
        parts = urlsplit(url)
        if parts.scheme != 'https' or not parts.hostname or parts.username or parts.password:
            continue
        cues = list(episode_cues(podcasts, record))
        if cues:
            first = next(json_rows(podcasts / record['path']))
            slug = re.sub(r'^(\d+)-', r'#\1 ', Path(parts.path).stem).replace('-', ' ').title()
            yield dict(id='pod:' + record['id'], lang=record['lang'], kind='podcast', url=url,
                       title=record.get('title') or slug[:1].upper() + slug[1:] or record['id'],
                       publisher=first.get('publisher') or parts.hostname,
                       duration_s=positive_int(record.get('duration_s')), views=None,
                       evidence='publisher_episode_transcript', captions='publisher', cues=cues)


def archive_documents(path):
    for record in json_rows(path):
        lang = record.get('language')
        identifier = record.get('video_id', '')
        if (lang not in LANGUAGES or not VIDEO_ID.fullmatch(identifier)
                or record.get('caption_type') != 'publisher' or record.get('language_evidence') not in ARCHIVE_AUDIO):
            continue
        if record.get('cues_ms'):
            yield video_document(lang, identifier, record.get('title'), record.get('source'),
                                 record.get('seconds'), record.get('views'), record['language_evidence'], record['cues_ms'])


def supplement_documents(manifest):
    for record in read_json(manifest):
        lang, identifier = record.get('lang'), record.get('id', '')
        if lang not in LANGUAGES or record.get('use') != 'local-review':
            continue
        cues = list(episode_cues(manifest.parent, record))
        if not cues:
            continue
        if record.get('kind') == 'video' and record.get('row_kind') == 'publisher-caption' and VIDEO_ID.fullmatch(identifier):
            yield video_document(lang, identifier, record['title'], record['publisher'], record.get('duration_s'),
                                 record.get('views'), 'publisher_caption_review', cues)
        elif record.get('kind') in {'audio', 'podcast'} and record.get('row_kind') == 'publisher-transcript':
            address = urlsplit(record['url'])
            if address.scheme != 'https' or not address.hostname or address.username or address.password:
                continue
            yield dict(id='pod:' + identifier, lang=lang, kind=record['kind'], title=record['title'],
                       publisher=record['publisher'], duration_s=positive_int(record.get('duration_s')), views=None,
                       evidence='publisher_episode_transcript', captions='publisher', url=record['url'], cues=cues)


def embed_artwork(items, directory):
    formats = {'.jpg': ('jpeg', b'\xff\xd8\xff'), '.png': ('png', b'\x89PNG\r\n\x1a\n'),
               '.webp': ('webp', b'RIFF')}
    for item in items:
        identifier = item['id'].split(':', 1)[-1]
        if not re.fullmatch(r'[\w-]{1,160}', identifier, flags=re.ASCII):
            continue
        for suffix, (kind, signature) in formats.items():
            file = directory / (identifier + suffix)
            if not file.is_file() or file.stat().st_size > 350_000:
                continue
            data = file.read_bytes()
            if not data.startswith(signature) or (kind == 'webp' and data[8:12] != b'WEBP'):
                continue
            item['thumbnail'] = 'data:image/' + kind + ';base64,' + base64.b64encode(data).decode('ascii')
            break


def index_documents(documents, extension=None):
    extension = extension or Path(__file__).resolve().parents[1] / 'ext'
    input_text = json.dumps(documents, ensure_ascii=False)
    result = subprocess.run(['node', str(Path(__file__).with_suffix('.mjs')), str(extension)],
                            input=input_text, encoding='utf-8', capture_output=True, check=False, timeout=360)
    if result.returncode:
        raise RuntimeError(result.stderr.strip() or 'Catalogue indexing failed.')
    return json.loads(result.stdout)


def write_json(output, value, limit=None):
    data = json.dumps(value, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
    if limit and len(data) > limit:
        raise ValueError('The local media catalogue would exceed its storage limit.')
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile('wb', dir=output.parent, delete=False) as file:
        pending = Path(file.name)
        try:
            file.write(data)
            file.close()
            pending.replace(output)
        finally:
            pending.unlink(missing_ok=True)


def build(intake, output, archive=None, extension=None, supplements=(), artwork=None):
    documents = {(d['lang'], d['id']): d for d in intake_documents(intake)}
    if archive:
        for document in archive_documents(archive):
            documents.setdefault((document['lang'], document['id']), document)
    for manifest in supplements:
        for document in supplement_documents(manifest):
            documents.setdefault((document['lang'], document['id']), document)
    if not documents:
        raise ValueError('No eligible publisher media found.')
    items = index_documents(list(documents.values()), extension)
    if artwork:
        embed_artwork(items, artwork)
    index = dict(version=1, built_at=datetime.now(timezone.utc).isoformat(timespec='seconds'), items=items)
    write_json(output, index, MAX_INDEX_BYTES)
    return dict(Counter((item['lang'] + '/' + item['kind']) for item in items))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--intake', required=True, type=Path, help='publisher-caption intake folder with catalog.json')
    parser.add_argument('--archive', type=Path, help='optional credited.jsonl from the views-ranked intake')
    parser.add_argument('--output', type=Path, default=index_path(), help='private catalogue index JSON')
    parser.add_argument('--extension', type=Path, help='extension folder if running from a staged checkout')
    parser.add_argument('--supplement', type=Path, action='append', default=[],
                        help='additional local manifest of publisher-caption or publisher-transcript documents')
    parser.add_argument('--artwork', type=Path, help='directory of locally cached official thumbnail assets')
    args = parser.parse_args()
    print(json.dumps(build(args.intake, args.output, args.archive, args.extension, args.supplement, args.artwork), sort_keys=True))
