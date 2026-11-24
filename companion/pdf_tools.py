"""Local PDF extraction, page previews, and searchable bilingual spreads."""

import base64
import binascii
from html import escape
import io
import math
import re


MAX_PDF_BYTES = 32 * 1024 * 1024
MAX_PAGES = 80
MAX_TRANSLATION_CHARS = 1_000_000
PAGE_CSS = """
body { font-family: sans-serif; font-size: 11pt; color: #182435; }
h1 { color: #23445a; font-size: 14pt; margin: 0 0 16pt; }
p { margin: 0 0 10pt; }
"""


def open_pdf(encoded):
    import pymupdf as fitz

    encoded = encoded.strip()
    if encoded.startswith('data:application/pdf;base64,'):
        encoded = encoded.split(',', 1)[1]
    if len(encoded) > (MAX_PDF_BYTES + 2) // 3 * 4:
        raise ValueError('PDF exceeds the 32 MiB local processing limit.')
    try:
        raw = base64.b64decode(encoded, validate=True)
    except (binascii.Error, ValueError) as error:
        raise ValueError('Invalid PDF encoding.') from error
    if len(raw) > MAX_PDF_BYTES or not raw.startswith(b'%PDF-'):
        raise ValueError('Invalid PDF or file exceeds 32 MiB.')
    try:
        doc = fitz.open(stream=raw, filetype='pdf')
    except fitz.FileDataError as error:
        raise ValueError('Cannot open this PDF.') from error
    if doc.needs_pass or not len(doc):
        doc.close()
        raise ValueError('Open an unlocked PDF with at least one page.')
    return doc


def extract_pages(doc, max_pages, keep_empty=False):
    chapters = []
    for page in range(min(len(doc), max(1, min(max_pages, MAX_PAGES)))):
        blocks = doc[page].get_text('blocks')
        blocks.sort(key=lambda b: (round(b[1] / 12), b[0]))
        paragraphs = []
        for block in blocks:
            if block[6] != 0:
                continue
            text = re.sub(r'-\r?\n(?=\w)', '', str(block[4] or ''))
            text = re.sub(r'\s+', ' ', text).strip()
            if text and not (len(text) <= 4 and text.isdigit()):
                paragraphs.append(text)
        if paragraphs or keep_empty:
            chapters.append({'title': f'Page {page + 1}', 'page': page, 'paragraphs': paragraphs})
    return chapters


def page_preview(doc, index):
    import pymupdf as fitz

    if not 0 <= index < min(len(doc), MAX_PAGES):
        raise ValueError('PDF page is out of range.')
    page = doc[index]
    scale = min(1.5, 1180 / max(page.rect.width, page.rect.height, 1))
    return page.get_pixmap(matrix=fitz.Matrix(scale, scale), alpha=False).tobytes('png')


def render_translation(texts, original_page, width, height, rtl):
    import pymupdf as fitz

    paragraphs = ''.join('<p>' + escape(text).replace('\n', '<br>') + '</p>' for text in texts)
    if not paragraphs:
        paragraphs = '<p>This page has no extractable text.</p>'
    direction = 'rtl' if rtl else 'auto'
    html = f'<h1>Translation | page {original_page + 1}</h1><div dir="{direction}">{paragraphs}</div>'
    story = fitz.Story(html=html, user_css=PAGE_CSS)
    result = io.BytesIO()
    writer = fitz.DocumentWriter(result)
    sheet = fitz.Rect(0, 0, width, height)
    region = fitz.Rect(30, 30, width - 30, height - 30)
    try:
        for _ in range(20):
            more, filled = story.place(region)
            if more and fitz.Rect(filled).height <= 0:
                raise ValueError(f'Translation on page {original_page + 1} cannot be laid out.')
            device = writer.begin_page(sheet)
            story.draw(device)
            writer.end_page()
            if not more:
                break
        else:
            raise ValueError(f'Translation on page {original_page + 1} exceeds 20 continuation pages.')
    finally:
        writer.close()
    return result.getvalue()


def export_bilingual(doc, pages, lang):
    import pymupdf as fitz

    if len(doc) > MAX_PAGES:
        raise ValueError(f'PDF export supports documents up to {MAX_PAGES} pages.')
    expected = extract_pages(doc, MAX_PAGES, keep_empty=True)
    if len(doc) != len(pages):
        raise ValueError('Include translations for each PDF page in order.')
    if not any(page['paragraphs'] for page in expected):
        raise ValueError('This PDF has no text layer to translate.')
    if sum(len(text) for page in pages for text in page) > MAX_TRANSLATION_CHARS:
        raise ValueError('Translations exceed the document length limit.')
    rtl = str(lang).lower().split('-')[0] in {'ar', 'fa', 'he', 'ur'}
    with fitz.open() as output:
        output.set_metadata({'title': (doc.metadata or {}).get('title') or 'Bilingual PDF',
                             'author': (doc.metadata or {}).get('author') or '',
                             'creator': 'Phrasebound'})
        for source, paragraphs in zip(expected, pages):
            index = source['page']
            if len(source['paragraphs']) != len(paragraphs) or any(not p.strip() for p in paragraphs):
                raise ValueError(f'Complete all translations on page {index + 1} before exporting.')
            original = doc[index]
            if original.rotation:
                original.remove_rotation()
            rect = original.rect
            if not all(math.isfinite(n) and n > 0 for n in (rect.width, rect.height)):
                raise ValueError(f'Invalid page size on page {index + 1}.')
            scale = min(1, 900 / rect.width, 1200 / rect.height)
            source_width, source_height = rect.width * scale, rect.height * scale
            translation_width = max(360, source_width)
            height = max(540, source_height)
            translation = render_translation(paragraphs, index, translation_width, height, rtl)
            left = fitz.Rect(0, 0, source_width, source_height)
            right = fitz.Rect(source_width + 18, 0, source_width + 18 + translation_width, height)
            with fitz.open(stream=translation, filetype='pdf') as translated:
                for continuation in range(len(translated)):
                    if continuation == 0:
                        spread = output.new_page(width=right.x1, height=height)
                        if original.get_contents():
                            spread.show_pdf_page(left, doc, index)
                        spread.draw_line((source_width + 9, 14), (source_width + 9, height - 14),
                                         color=(0.81, 0.85, 0.89), width=0.5)
                        spread.show_pdf_page(right, translated, continuation)
                    else:
                        output.insert_pdf(translated, from_page=continuation, to_page=continuation)
        output.subset_fonts()
        return output.tobytes(garbage=4, deflate=True)
