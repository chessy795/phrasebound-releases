"""Refresh the private media catalogue from first-party archives."""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from functools import lru_cache
from hashlib import sha256
from io import BytesIO
import argparse
import base64
import json
import logging
from pathlib import Path
import re
from threading import Lock, Thread
from urllib.parse import urljoin, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener
from xml.etree import ElementTree

if __package__:
    from . import media_catalogue
else:
    import media_catalogue

ERIN = 'https://www.erin.jpf.go.jp'
NORIKO = 'https://www.japanesewithnoriko.com'
CHATTY = 'https://www.chattycantonese.com'
HBL = 'https://hambaanglaang.hk'
CHATTY_SHOW = 'https://podcasts.apple.com/us/podcast/chatty-cantonese/id1588780616'
NORIKO_SHOW = 'https://podcasts.apple.com/us/podcast/learn-japanese-with-noriko/id1500470294'
HOSTS = {urlsplit(url).hostname for url in (ERIN, NORIKO, CHATTY, HBL, CHATTY_SHOW)}
HOSTS |= {'i.ytimg.com', 'images.squarespace-cdn.com', 'static1.squarespace.com',
          'is1-ssl.mzstatic.com', 'is2-ssl.mzstatic.com', 'is3-ssl.mzstatic.com',
          'is4-ssl.mzstatic.com', 'is5-ssl.mzstatic.com', 'docs.google.com'}
HAN = re.compile(r'[\u3400-\u9fff]')
KANA = re.compile(r'[\u3041-\u30fa]')
YUE = set('係佢哋喺嘅唔咗嚟冇嘢啲噉啱睇嗰咁')
CLOCK = r'(\d{2}:\d{2}:\d{2}[,.]\d{3})'
LOG = logging.getLogger(__name__)
REFRESH_INTERVAL = timedelta(hours=12)


class NoTranscript(ValueError):
    """A public page lacks sufficient original-language material."""


def source_url(url):
    u = urlsplit(url)
    allowed = u.hostname in HOSTS or bool(re.fullmatch(r'doc-[a-z0-9-]+\.googleusercontent\.com', u.hostname or ''))
    if u.scheme != 'https' or not allowed or u.netloc != u.hostname:
        raise ValueError('Unsupported publisher address.')
    return url


class PublisherRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return super().redirect_request(req, fp, code, msg, headers, source_url(newurl))


def fetch(url, limit=4_000_000):
    request = Request(source_url(url), headers={'User-Agent': 'Phrasebound Catalogue/1.0'})
    with build_opener(PublisherRedirect()).open(request, timeout=12) as response:
        raw = response.read(limit + 1)
    if len(raw) > limit:
        raise ValueError('Publisher resource is too large.')
    return raw


def soup(html):
    from bs4 import BeautifulSoup
    return BeautifulSoup(html, 'html.parser')


def tidy(text):
    return ' '.join(text.split())


def text_of(tag):
    return tidy(tag.get_text(' ', strip=True)) if tag else ''


def rss_time(value):
    try:
        return parsedate_to_datetime(value).isoformat()
    except (ValueError, TypeError, OverflowError):
        return None


def episode(identifier, lang, kind, title, publisher, url, published=None):
    return dict(id=identifier, lang=lang, kind=kind, title=title, publisher=publisher, url=url,
                duration_s=0, views=None, published_at=published, captions='publisher')


def material(item, locator, raw, lines, art):
    item.update(source_transcript=locator, source_sha256=sha256(raw).hexdigest(),
                evidence='publisher_episode_transcript', cues=[[None, None, line] for line in lines])
    return item, art


def stamp(value):
    hours, minutes, seconds, millis = (int(part) for part in re.split(r'[:,.]', value))
    return ((hours * 60 + minutes) * 60 + seconds) * 1000 + millis


def erin_offers():
    index = soup(fetch(ERIN + '/en/lesson/01/basic/'))
    lessons = list(dict.fromkeys(match[1] for anchor in index.select('a[href]')
                   if (match := re.fullmatch(r'/en/lesson/(\d{2})/basic/', anchor['href']))))
    if not lessons:
        raise NoTranscript('The Japan Foundation lesson index is unavailable.')
    return [(f'erin-{lesson}-{variant}', lesson, variant) for lesson in lessons for variant in ('basic', 'advanced')]


def erin(item_id, lesson, variant):
    url = f'{ERIN}/en/lesson/{lesson}/{variant}/'
    page = soup(fetch(url, 350_000))
    player = page.select_one('.movie-player-module[data-lesson][data-type]')
    code = {'basic': 'ba', 'advanced': 'ad'}[variant]
    if not player or player['data-lesson'] != str(int(lesson) - 1) or player['data-type'] != str(int(variant == 'advanced')):
        raise NoTranscript('Lesson player does not match the caption track.')
    track = f'{ERIN}/movie/srt/{lesson}{code}_niho.txt'
    raw = fetch(track, 128_000)
    cues = []
    for part in re.split(r'\n\s*\n', raw.decode('utf-8-sig').replace('\r\n', '\n').strip()):
        match = re.match(r'\d+\s*\n' + CLOCK + r'\s*-->\s*' + CLOCK + r'\s*\n([\s\S]+)', part)
        if match and stamp(match[2]) > stamp(match[1]) and KANA.search(match[3]):
            cues.append([stamp(match[1]), stamp(match[2]), text_of(soup(match[3]))])
    if not cues:
        raise NoTranscript('Timed Japanese text missing.')
    title = text_of(page.select_one('h1')) or f'Lesson {int(lesson)}'
    title += ' · ' + ('Basic skit' if variant == 'basic' else 'Advanced skit')
    row = episode(item_id, 'ja', 'video', title, 'The Japan Foundation', url)
    row.update(evidence='platform_publisher_track', source_transcript=track,
               source_sha256=sha256(raw).hexdigest(), cues=cues)
    return row, f'{ERIN}/movie/poster/{lesson}-{code}.jpg'


def noriko_offers():
    # The publisher has full show notes in RSS. The sitemap is unnecessary for this rolling feed.
    result = []
    for season in (3, 1):
        url = f'{NORIKO}/season-{season}-transcription?format=rss'
        try:
            feed = ElementTree.fromstring(fetch(url))
        except (OSError, ValueError, ElementTree.ParseError) as exc:
            LOG.warning('Noriko season %s unavailable: %s', season, exc)
            continue
        for item in feed.findall('./channel/item'):
            link = item.findtext('link', '').strip()
            title = tidy(item.findtext('title', ''))
            m = re.match(r'Season\s+3-(\d+)|^(\d+)[.．]', title, re.I)
            if not m or urlsplit(link).hostname != urlsplit(NORIKO).hostname:
                continue
            n = m[1] or m[2]
            identifier = f'pod:noriko-{n}' if season == 1 else f'pod:noriko-s3-{n}'
            artwork = item.find('{http://www.rssboard.org/media-rss}content')
            html = item.findtext('{http://purl.org/rss/1.0/modules/content/}encoded') or item.findtext('description', '')
            result.append((identifier, link, title, rss_time(item.findtext('pubDate')),
                           html, artwork.get('url') if artwork is not None else None))
    return result


def noriko(identifier, url, title, published, html, image):
    page = soup(html)
    if not page.select_one('iframe, audio, .sqs-audio-embed'):
        raise NoTranscript('Publisher feed entry has no episode player.')
    lines = [text_of(p) for p in page.find_all('p') if len(KANA.findall(p.get_text())) >= 8]
    if sum(len(KANA.findall(line)) for line in lines) < 80:
        raise NoTranscript('Japanese transcript missing or too short.')
    row = episode(identifier, 'ja', 'podcast', title, 'Japanese with Noriko', url, published)
    return material(row, url, html.encode('utf-8'), lines, image or show_cover(NORIKO_SHOW))


def chatty_offers():
    sitemap = ElementTree.fromstring(fetch(CHATTY + '/sitemap.xml', 400_000))
    results = []
    for record in sitemap.findall('{*}url'):
        url = record.findtext('{*}loc', '')
        path = urlsplit(url).path
        m = re.fullmatch(r'/(\d{4}/\d{2})/(\d+)-[a-z0-9-]+\.html', path)
        if m and urlsplit(url).hostname == urlsplit(CHATTY).hostname:
            results.append((f'pod:chatty-{m[2]}', url))
    return results


def chatty(identifier, url):
    raw = fetch(url, 1_500_000)
    page = soup(raw)
    post = page.select_one('.post-body')
    title = text_of(page.title)
    if not post or not title or re.search(r'\(english\)', title, re.I):
        raise NoTranscript('No Cantonese transcript-bearing episode.')
    for marker in post.select('sup, span[style*="vertical-align"]'):
        if marker.get_text(strip=True).isdigit():
            marker.decompose()
    lines = [text_of(node) for node in post.find_all(['p', 'div']) if not node.find(['p', 'div'])]
    start = next((idx for idx, line in enumerate(lines) if line.strip(':：').casefold() == 'transcript'), None)
    if start is None:
        raise NoTranscript('Episode transcript heading missing.')
    kept = []
    for line in lines[start + 1:]:
        if line.casefold().rstrip(':：') in {'vocabulary', 'vocab', 'translation', 'words', 'links'}:
            break
        han = len(HAN.findall(line))
        if han >= 8 and han >= len(re.findall(r'[A-Za-z]', line)) * .45:
            kept.append(line)
    if sum(len(HAN.findall(line)) for line in kept) < 160 or len(YUE.intersection(''.join(kept))) < 6:
        raise NoTranscript('Insufficient written Cantonese within the publisher transcript.')
    row = episode(identifier, 'yue', 'podcast', title, 'Chatty Cantonese', url)
    return material(row, url, raw, list(dict.fromkeys(kept)), show_cover(CHATTY_SHOW))


def hbl_offers():
    root = HBL + '/wp-json/wp/v2/'
    categories = json.loads(fetch(root + 'categories?search=level&per_page=50&_fields=id,slug'))
    levels = [row['id'] for row in categories if re.fullmatch(r'level-[1-7]', row['slug'])]
    if not levels:
        raise NoTranscript('Story categories are unavailable.')
    # Keep the manifest lightweight. Fetch the story page only for candidates we do not have.
    category = ','.join(str(level) for level in levels)
    results = []
    for page in range(1, 7):
        url = root + f'posts?categories={category}&per_page=50&page={page}&_fields=id,link,title,date_gmt'
        rows = json.loads(fetch(url))
        results.extend((f'hbl:{row["id"]}', row['link'], text_of(soup(row['title']['rendered'])),
                        row['date_gmt'] + 'Z' if row.get('date_gmt') else None) for row in rows)
        if len(rows) < 50:
            break
    return results


def hbl(identifier, url, title, published):
    page = soup(fetch(url, 1_200_000))
    player = page.select_one('meta[property="twitter:player"]')
    video = re.fullmatch(r'https://youtu\.be/([A-Za-z0-9_-]{11})', player.get('content', '') if player else '')
    doc = next((m[1] for a in page.select('a[href]') if 'Download Text File' in text_of(a)
                and (m := re.fullmatch(r'https://docs\.google\.com/document/d/([A-Za-z0-9_-]+)/edit(?:\?.*)?', a['href']))), None)
    if not video or not doc:
        raise NoTranscript('Story page does not link both its video and published text.')
    track = f'https://docs.google.com/document/d/{doc}/export?format=txt'
    raw = fetch(track, 128_000)
    text = raw.decode('utf-8-sig').split('________________', 1)[0]
    lines = [tidy(line) for line in text.splitlines() if len(HAN.findall(line)) >= 4]
    if sum(len(HAN.findall(line)) for line in lines) < 45 or len(YUE.intersection(''.join(lines))) < 3:
        raise NoTranscript('Insufficient written Cantonese in the linked text file.')
    watch = 'https://www.youtube.com/watch?v=' + video[1]
    row = episode('yt:' + video[1], 'yue', 'video', title, 'Hambaanglaang', watch, published)
    row.update(discovery_id=identifier, publisher_page=url)
    return material(row, track, raw, lines, f'https://i.ytimg.com/vi/{video[1]}/mqdefault.jpg')


@lru_cache(maxsize=2)
def show_cover(url):
    page = soup(fetch(url))
    cover = page.select_one('meta[property="og:image"][content]')
    if not cover:
        raise NoTranscript('Publisher show cover unavailable.')
    return cover['content']


@lru_cache(maxsize=80)
def thumbnail(url):
    from PIL import Image
    if urlsplit(url).hostname in {'images.squarespace-cdn.com', 'static1.squarespace.com'}:
        url = re.sub(r'\?format=\d+w$', '?format=500w', url)
    raw = fetch(url, 2_600_000)
    with Image.open(BytesIO(raw)) as image:
        if min(image.size) < 64 or max(image.size) > 4096:
            raise NoTranscript('Publisher artwork missing or invalid.')
        image.thumbnail((480, 330))
        output = BytesIO()
        image.convert('RGB').save(output, format='JPEG', quality=76, optimize=True)
    value = base64.b64encode(output.getvalue()).decode('ascii')
    return 'data:image/jpeg;base64,' + value


def artwork_key(value):
    return sha256(value.encode('ascii')).hexdigest()[:24]


def state_path(index_path):
    return index_path.with_name(index_path.stem + '-refresh.json')


def read_state(index_path):
    try:
        state = media_catalogue.read_json(state_path(index_path))
        return state if isinstance(state, dict) else {}
    except (OSError, ValueError):
        return {}


def run(index_path, limit=18, extension=None):
    now = datetime.now(timezone.utc)
    index = (media_catalogue.read_json(index_path) if index_path.exists()
             else {'version': 1, 'items': []})
    if index.get('version') != 1 or not isinstance(index.get('items'), list):
        raise ValueError('The saved catalogue has an unsupported format.')
    items = index['items']
    artwork = dict(index.get('artwork', {}))
    keys = {(row['lang'], row['id']) for row in items}
    known = {row.get('discovery_id', row['id']) for row in items}
    previous = read_state(index_path)
    rejected = {key: expiry for key, expiry in previous.get('retry_after', {}).items() if expiry > now.isoformat()}
    additions, assets, publishers = [], {}, {}
    sources = [(erin_offers, erin, 'The Japan Foundation'), (noriko_offers, noriko, 'Japanese with Noriko'),
               (chatty_offers, chatty, 'Chatty Cantonese'), (hbl_offers, hbl, 'Hambaanglaang')]

    def collect(entry):
        loader, offer = entry
        try:
            row, url = loader(*offer)
            if not url:
                raise NoTranscript('Publisher artwork missing.')
            row['thumbnail_source'] = url
            image = thumbnail(url)
            row['artwork_id'] = artwork_key(image)
            return offer[0], row, image, None, False
        except NoTranscript as exc:
            return offer[0], None, None, str(exc), True
        except (OSError, ValueError, KeyError) as exc:
            return offer[0], None, None, str(exc), False

    for discover, loader, name in sources:
        summary = publishers[name] = {'added': 0, 'skipped': 0, 'unavailable': 0}
        try:
            offers = list({row[0]: row for row in discover()}.values())
        except (OSError, ValueError, ElementTree.ParseError, KeyError) as exc:
            LOG.warning('Media catalogue source %s: %s', name, exc)
            summary['unavailable'] = 1
            continue
        pending = [offer for offer in offers if offer[0] not in known and offer[0] not in rejected][:limit]
        with ThreadPoolExecutor(max_workers=4) as pool:
            for identifier, row, illustration, reason, ineligible in pool.map(collect, ((loader, offer) for offer in pending)):
                if reason:
                    LOG.debug('Media catalogue %s: %s', identifier, reason)
                    summary['skipped' if ineligible else 'unavailable'] += 1
                    rejected[identifier] = (now + timedelta(days=7) if ineligible else now + timedelta(hours=1)).isoformat()
                    continue
                key = (row['lang'], row['id'])
                if key in keys:
                    rejected[identifier] = (now + timedelta(days=7)).isoformat()
                    continue
                keys.add(key)
                additions.append(row)
                assets[row['artwork_id']] = illustration
                summary['added'] += 1

    if additions:
        indexed = media_catalogue.index_documents(additions, extension)
        for row in items:
            value = row.pop('thumbnail', None)
            if value:
                row['artwork_id'] = artwork_key(value)
                artwork[row['artwork_id']] = value
        artwork.update({row['artwork_id']: assets[row['artwork_id']] for row in indexed})
        index.update(items=items + indexed, artwork=artwork, built_at=now.isoformat(timespec='seconds'))
        media_catalogue.write_json(index_path, index, media_catalogue.MAX_INDEX_BYTES)
    else:
        indexed = []
    state = dict(finished_at=datetime.now(timezone.utc).isoformat(), total=len(index['items']), added=len(indexed),
                 publishers=publishers, retry_after=rejected)
    media_catalogue.write_json(state_path(index_path), state)
    return state


_guard = Lock()
_running = False
_error = None


def status(index_path):
    state = read_state(index_path)
    state.pop('retry_after', None)
    with _guard:
        return dict(state, running=_running, error=_error)


def start(index_path, force=False):
    global _running, _error
    with _guard:
        if _running:
            return True
        last = read_state(index_path).get('finished_at')
        if last and not force and datetime.now(timezone.utc) - datetime.fromisoformat(last) < REFRESH_INTERVAL:
            return False
        _running, _error = True, None

    def work():
        global _running, _error
        failure = None
        try:
            run(index_path)
        except Exception:
            LOG.exception('Media catalogue refresh failed')
            failure = 'Could not check publisher sources. The saved catalogue is available.'
        finally:
            with _guard:
                _running, _error = False, failure

    Thread(target=work, name='media-catalogue-refresh', daemon=True).start()
    return True


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--index', type=Path, default=media_catalogue.index_path())
    parser.add_argument('--extension', type=Path)
    parser.add_argument('--limit', type=int, choices=range(1, 101), metavar='1–100', default=18,
                        help='maximum candidates checked per publisher')
    args = parser.parse_args()
    report = run(args.index, args.limit, args.extension)
    del report['retry_after']
    print(json.dumps(report, ensure_ascii=False))
