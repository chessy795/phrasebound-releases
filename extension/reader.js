/**
 * Subtitle Study — Standalone Local Bilingual Bookshelf & File Reader (ext/reader.js)
 * Clean-room Manifest V3 module:
 *   - Pure-JS ZIP Central Directory + DecompressionStream('deflate-raw') DRM-free .epub parser
 *   - Markdown (.md), Plain Text (.txt), and Timed Subtitle (.srt / .vtt / .ass) ingestion
 *   - 12-Language SS_IDIOMS noticing, offline/Wiktionary + Tatoeba inspector, Web Speech TTS
 *   - Batch chapter translation via Companion /translate_batch with {v0} inline code/math masking
 *   - 1-click Bilingual Markdown (.md) and Bilingual SubRip (.srt) export
 * Strictly zero external dependencies and zero .innerHTML / .outerHTML assignments.
 */
(function (root) {
  'use strict';

  var XML_ENTITIES = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–', hellip: '…'
  };

  function decodeEntities(str) {
    return String(str || '').replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, function (m, code) {
      if (code.charAt(0) === '#') {
        var hex = code.charAt(1) === 'x' || code.charAt(1) === 'X';
        var cp = parseInt(hex ? code.slice(2) : code.slice(1), hex ? 16 : 10);
        if (!Number.isNaN(cp) && cp > 0 && cp <= 0x10ffff) {
          try { return String.fromCodePoint(cp); } catch (_e) { return m; }
        }
        return m;
      }
      var low = code.toLowerCase();
      return Object.prototype.hasOwnProperty.call(XML_ENTITIES, low) ? XML_ENTITIES[low] : m;
    });
  }

  function utf8Decode(bytes) {
    if (typeof TextDecoder !== 'undefined') {
      return new TextDecoder('utf-8').decode(bytes);
    }
    if (typeof Buffer !== 'undefined') {
      return Buffer.from(bytes).toString('utf8');
    }
    var out = '';
    for (var i = 0; i < bytes.length; i++) out += String.fromCharCode(bytes[i]);
    return out;
  }

  /* ==========================================================================
   * 1. Pure-JS ZIP & Deflate-Raw Extractor (Browser DecompressionStream + Node fallback)
   * ========================================================================== */

  async function inflateRawBytes(compressedBytes) {
    if (typeof DecompressionStream !== 'undefined' && typeof Response !== 'undefined') {
      try {
        var ds = new DecompressionStream('deflate-raw');
        var writer = ds.writable.getWriter();
        writer.write(compressedBytes);
        writer.close();
        var ab = await new Response(ds.readable).arrayBuffer();
        return new Uint8Array(ab);
      } catch (_dsErr) {
        // Node 18 lacks 'deflate-raw' in WebStreams; fall through to Node zlib
      }
    }
    if (typeof require === 'function') {
      var zlib = require('zlib');
      return new Uint8Array(zlib.inflateRawSync(Buffer.from(compressedBytes)));
    }
    throw new Error('Deflate decompression unavailable in this environment');
  }

  async function parseZipEntries(arrayBuffer) {
    var u8 = arrayBuffer instanceof Uint8Array
      ? arrayBuffer
      : new Uint8Array(arrayBuffer);
    var dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);

    // Locate End of Central Directory (EOCD: 0x06054b50) within final 65KB
    var eocdPos = -1;
    var minSearch = Math.max(0, u8.length - 65557);
    for (var i = u8.length - 22; i >= minSearch; i--) {
      if (dv.getUint32(i, true) === 0x06054b50) {
        eocdPos = i;
        break;
      }
    }
    if (eocdPos < 0) {
      throw new Error('Invalid ZIP/EPUB archive: End-of-Central-Directory not found');
    }

    var totalEntries = dv.getUint16(eocdPos + 10, true);
    var cdSize = dv.getUint32(eocdPos + 12, true);
    var cdOffset = dv.getUint32(eocdPos + 16, true);
    if (cdOffset + cdSize > u8.length) {
      throw new Error('Corrupt ZIP Central Directory bounds');
    }

    var entries = new Map();
    var ptr = cdOffset;
    for (var e = 0; e < totalEntries && ptr + 46 <= u8.length; e++) {
      if (dv.getUint32(ptr, true) !== 0x02014b50) break;
      var flags = dv.getUint16(ptr + 8, true);
      var method = dv.getUint16(ptr + 10, true);
      var compSize = dv.getUint32(ptr + 20, true);
      var uncompSize = dv.getUint32(ptr + 24, true);
      var nameLen = dv.getUint16(ptr + 28, true);
      var extraLen = dv.getUint16(ptr + 30, true);
      var commentLen = dv.getUint16(ptr + 32, true);
      var localHdrOffset = dv.getUint32(ptr + 42, true);

      var nameBytes = u8.subarray(ptr + 46, ptr + 46 + nameLen);
      var fileName = utf8Decode(nameBytes).replace(/\\/g, '/');
      ptr += 46 + nameLen + extraLen + commentLen;

      if ((flags & 0x01) !== 0) continue; // Skip encrypted entries (DRM)
      if (fileName.endsWith('/')) continue;
      if (localHdrOffset + 30 > u8.length) continue;
      if (dv.getUint32(localHdrOffset, true) !== 0x04034b50) continue;

      var lNameLen = dv.getUint16(localHdrOffset + 26, true);
      var lExtraLen = dv.getUint16(localHdrOffset + 28, true);
      var dataStart = localHdrOffset + 30 + lNameLen + lExtraLen;
      var dataEnd = dataStart + compSize;
      if (dataEnd > u8.length) continue;

      var rawSlice = u8.subarray(dataStart, dataEnd);
      var outBytes;
      if (method === 0) {
        outBytes = rawSlice;
      } else if (method === 8) {
        outBytes = await inflateRawBytes(rawSlice);
      } else {
        continue;
      }

      entries.set(fileName, {
        name: fileName,
        size: uncompSize || outBytes.length,
        bytes: outBytes,
        text: function () { return utf8Decode(this.bytes); }
      });
    }
    return entries;
  }

  /* ==========================================================================
   * 2. DRM-Free EPUB OPF Spine & XHTML Chapter Extractor
   * ========================================================================== */

  function normalizeZipPath(baseDir, relHref) {
    var cleanHref = String(relHref || '').split('#')[0].split('?')[0].trim();
    try { cleanHref = decodeURIComponent(cleanHref); } catch (_e) {}
    var combined = (baseDir ? baseDir + '/' : '') + cleanHref;
    var parts = combined.split('/');
    var stack = [];
    for (var i = 0; i < parts.length; i++) {
      var seg = parts[i];
      if (!seg || seg === '.') continue;
      if (seg === '..') stack.pop();
      else stack.push(seg);
    }
    return stack.join('/');
  }

  function matchAttr(tagStr, attrName) {
    var re = new RegExp('\\b' + attrName + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\')', 'i');
    var m = re.exec(tagStr);
    return m ? decodeEntities(m[1] != null ? m[1] : m[2]) : '';
  }

  function extractXmlTagText(xml, localName) {
    var re = new RegExp('<(?:[a-zA-Z0-9_-]+:)?' + localName + '\\b[^>]*>([\\s\\S]*?)<\\/(?:[a-zA-Z0-9_-]+:)?' + localName + '>', 'i');
    var m = re.exec(xml);
    if (!m) return '';
    return decodeEntities(m[1].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
  }

  function extractBlocksFromXhtml(xhtmlStr, fallbackTitle) {
    var src = String(xhtmlStr || '')
      .replace(/<head\b[\s\S]*?<\/head>/gi, '')
      .replace(/<(?:script|style|svg|nav)\b[\s\S]*?<\/(?:script|style|svg|nav)>/gi, '')
      .replace(/<rt\b[^>]*>[\s\S]*?<\/rt>/gi, '')
      .replace(/<rp\b[^>]*>[\s\S]*?<\/rp>/gi, '');

    var blocks = [];
    var chapTitle = '';

    // Match headings, paragraphs, blockquotes, preformatted code, or list items cleanly in document order
    var blockRe = /<(h[1-4]|p|blockquote|pre|li)\b[^>]*>([\s\S]*?)<\/\1>/gi;
    var match;
    while ((match = blockRe.exec(src)) !== null) {
      var tag = match[1].toLowerCase();
      var inner = match[2];
      if (tag === 'li' && /<p\b/i.test(inner)) continue;

      if (tag === 'pre') {
        var codeTxt = decodeEntities(inner.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')).replace(/\r\n?/g, '\n').trim();
        if (codeTxt) blocks.push({ type: 'code', text: codeTxt });
        continue;
      }

      // Preserve inline <code> snippets as backticked literals so {vN} masker protects them
      var withInlineCode = inner.replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, function (_all, cTxt) {
        var cleanC = decodeEntities(cTxt.replace(/<[^>]+>/g, '')).trim();
        return cleanC ? ('`' + cleanC + '`') : '';
      });
      var plain = decodeEntities(
        withInlineCode
          .replace(/<br\s*\/?>/gi, '\n')
          .replace(/<[^>]+>/g, ' ')
      ).replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();

      if (!plain) continue;
      if (tag.charAt(0) === 'h') {
        if (!chapTitle) chapTitle = plain;
        blocks.push({ type: 'h', text: plain });
      } else if (tag === 'blockquote') {
        blocks.push({ type: 'quote', text: plain });
      } else {
        blocks.push({ type: 'p', text: plain });
      }
    }

    if (blocks.length === 0) {
      var bodyOnly = decodeEntities(src.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' '));
      var paras = bodyOnly.split(/\n{2,}/);
      for (var p = 0; p < paras.length; p++) {
        var t = paras[p].replace(/\s+/g, ' ').trim();
        if (t.length >= 2) blocks.push({ type: 'p', text: t });
      }
    }

    return {
      title: chapTitle || fallbackTitle || 'Chapter',
      blocks: blocks
    };
  }

  async function parseEpubBuffer(arrayBuffer, fallbackFileName) {
    var entries = await parseZipEntries(arrayBuffer);
    var containerEntry = entries.get('META-INF/container.xml');
    var opfPath = '';

    if (containerEntry) {
      var containerXml = containerEntry.text();
      var rfMatch = /<rootfile\b[^>]*>/i.exec(containerXml);
      if (rfMatch) opfPath = matchAttr(rfMatch[0], 'full-path');
    }
    if (!opfPath) {
      entries.forEach(function (_val, key) {
        if (!opfPath && /\.opf$/i.test(key)) opfPath = key;
      });
    }
    if (!opfPath || !entries.has(opfPath)) {
      throw new Error('DRM-protected or unsupported EPUB: package .opf not found');
    }

    var opfXml = entries.get(opfPath).text();
    var lastSlash = opfPath.lastIndexOf('/');
    var opfDir = lastSlash >= 0 ? opfPath.slice(0, lastSlash) : '';

    var title = extractXmlTagText(opfXml, 'title') || String(fallbackFileName || 'Untitled Book').replace(/\.epub$/i, '');
    var author = extractXmlTagText(opfXml, 'creator') || '';
    var lang = extractXmlTagText(opfXml, 'language') || 'auto';

    // Parse <manifest> items
    var manifest = new Map();
    var itemRe = /<item\b[^>]*\/?>/gi;
    var im;
    while ((im = itemRe.exec(opfXml)) !== null) {
      var id = matchAttr(im[0], 'id');
      var href = matchAttr(im[0], 'href');
      var mediaType = matchAttr(im[0], 'media-type');
      var props = matchAttr(im[0], 'properties');
      if (id && href) {
        manifest.set(id, {
          id: id,
          href: normalizeZipPath(opfDir, href),
          mediaType: mediaType,
          isNav: /\bnav\b/i.test(props)
        });
      }
    }

    // Parse <spine> reading order
    var spineIds = [];
    var itemrefRe = /<itemref\b[^>]*\/?>/gi;
    var sm;
    while ((sm = itemrefRe.exec(opfXml)) !== null) {
      var idref = matchAttr(sm[0], 'idref');
      var linear = matchAttr(sm[0], 'linear');
      if (idref && linear.toLowerCase() !== 'no') spineIds.push(idref);
    }

    var chapters = [];
    for (var s = 0; s < spineIds.length; s++) {
      var mfItem = manifest.get(spineIds[s]);
      if (!mfItem || mfItem.isNav) continue;
      if (mfItem.mediaType && !/html|xml/i.test(mfItem.mediaType)) continue;
      var zipFile = entries.get(mfItem.href);
      if (!zipFile) continue;
      var parsedChap = extractBlocksFromXhtml(zipFile.text(), 'Chapter ' + (chapters.length + 1));
      if (parsedChap.blocks.length === 0) continue;
      chapters.push({
        id: 'chap-' + (chapters.length + 1),
        title: parsedChap.title,
        blocks: parsedChap.blocks
      });
    }

    if (chapters.length === 0) {
      throw new Error('No readable XHTML text chapters found in EPUB (check if book is image-only or DRM-locked)');
    }

    return {
      format: 'epub',
      title: title,
      author: author,
      lang: lang,
      chapters: chapters
    };
  }

  /* ==========================================================================
   * 2b. PDF Parser (Companion PyMuPDF /pdf_extract + Offline FlateDecode Stream)
   * ========================================================================== */

  function decodePdfStringLiteral(raw) {
    var out = '';
    for (var i = 0; i < raw.length; i++) {
      var ch = raw.charAt(i);
      if (ch !== '\\') { out += ch; continue; }
      i++;
      var nxt = raw.charAt(i);
      if (nxt === 'n') out += '\n';
      else if (nxt === 'r') out += '\r';
      else if (nxt === 't') out += '\t';
      else if (nxt === 'b' || nxt === 'f') continue;
      else if (/[0-7]/.test(nxt)) {
        var oct = nxt;
        if (/[0-7]/.test(raw.charAt(i + 1))) oct += raw.charAt(++i);
        if (/[0-7]/.test(raw.charAt(i + 1))) oct += raw.charAt(++i);
        out += String.fromCharCode(parseInt(oct, 8));
      } else out += nxt;
    }
    return out;
  }

  function extractTextFromPdfStream(streamStr) {
    var chunks = [];
    var btRe = /BT([\s\S]*?)ET/g;
    var m;
    while ((m = btRe.exec(streamStr)) !== null) {
      var blk = m[1];
      var strRe = /\((?:\\.|[^\\()])*\)/g;
      var sm;
      var lineParts = [];
      while ((sm = strRe.exec(blk)) !== null) {
        var val = decodePdfStringLiteral(sm[0].slice(1, -1));
        if (val) lineParts.push(val);
      }
      var joined = lineParts.join('').replace(/\s+/g, ' ').trim();
      if (joined.length >= 2) chunks.push(joined);
    }
    return chunks.join('\n\n');
  }

  async function inflateZlibBytes(bytes) {
    if (typeof DecompressionStream !== 'undefined' && typeof Response !== 'undefined') {
      try {
        var ds = new DecompressionStream('deflate');
        var w = ds.writable.getWriter();
        w.write(bytes);
        w.close();
        return new Uint8Array(await new Response(ds.readable).arrayBuffer());
      } catch (_e) {}
    }
    if (typeof require === 'function') {
      try { return new Uint8Array(require('zlib').inflateSync(Buffer.from(bytes))); } catch (_e2) {}
    }
    return null;
  }

  async function parsePdfBuffer(arrayBuffer, fileName, compUrl) {
    var u8 = arrayBuffer instanceof Uint8Array ? arrayBuffer : new Uint8Array(arrayBuffer);
    var cleanTitle = String(fileName || 'PDF Document').replace(/\.pdf$/i, '');

    if (typeof chrome !== 'undefined' && chrome.runtime && typeof chrome.runtime.sendMessage === 'function' && typeof btoa === 'function') {
      var bin = '';
      for (var b = 0; b < u8.length; b += 0x8000) bin += String.fromCharCode.apply(null, u8.subarray(b, b + 0x8000));
      var b64 = btoa(bin);
      var compRes = await new Promise(function (resolve) {
        chrome.runtime.sendMessage({ op: 'companion', path: '/pdf_extract', body: { b64: b64, title: cleanTitle, layout: true }, method: 'POST', timeoutMs: 25000, url: compUrl || 'http://127.0.0.1:8787' }, function (r) {
          void (chrome.runtime && chrome.runtime.lastError);
          resolve(r || null);
        });
      });
      if (compRes && compRes.ok && Array.isArray(compRes.chapters) && compRes.chapters.length) {
        return {
          title: compRes.title || cleanTitle,
          author: compRes.author || '',
          format: 'pdf',
          pdf: Number.isInteger(compRes.total_pages)
            ? { b64: b64, pageCount: compRes.total_pages, previews: new Map() } : null,
          chapters: compRes.chapters.map(function (c, idx) {
            return {
              id: 'pdf-' + idx,
              title: c.title || ('Page ' + (idx + 1)),
              page: c.page,
              blocks: (c.paragraphs || []).map(function (t) { return { type: 'p', text: t, tr: '' }; })
            };
          })
        };
      }
    }

    var latin = '';
    for (var i = 0; i < u8.length; i++) latin += String.fromCharCode(u8[i]);
    var streamRe = /stream\r?\n([\s\S]*?)\r?\n?endstream/g;
    var texts = [];
    var sm;
    while ((sm = streamRe.exec(latin)) !== null && texts.length < 180) {
      var rawStart = sm.index + sm[0].indexOf(sm[1]);
      var rawSlice = u8.subarray(rawStart, rawStart + sm[1].length);
      var streamStr = sm[1];
      if (/FlateDecode/.test(latin.slice(Math.max(0, sm.index - 220), sm.index))) {
        var dec = await inflateZlibBytes(rawSlice);
        if (dec) streamStr = utf8Decode(dec);
      }
      if (streamStr.indexOf('BT') !== -1 && (streamStr.indexOf('Tj') !== -1 || streamStr.indexOf('TJ') !== -1)) {
        var ext = extractTextFromPdfStream(streamStr);
        if (ext && ext.trim()) texts.push(ext.trim());
      }
    }
    if (!texts.length) {
      throw new Error('Could not extract text from this PDF offline (start local companion for PyMuPDF layout extraction).');
    }
    var pages = texts.map(function (chunk, idx) {
      var paras = chunk.split(/\n{2,}/).map(function (s) { return s.replace(/\s+/g, ' ').trim(); }).filter(Boolean);
      return {
        id: 'pdf-' + idx,
        title: 'Section ' + (idx + 1),
        blocks: paras.map(function (t) { return { type: 'p', text: t, tr: '' }; })
      };
    });
    return { title: cleanTitle, author: '', format: 'pdf', chapters: pages };
  }

  /* ==========================================================================
   * 3. Markdown / Plain-Text & Subtitle (.SRT / .VTT / .ASS) Parsers
   * ========================================================================== */

  function parseMarkdownOrText(rawText, fileName) {
    var src = String(rawText || '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
    var lines = src.split('\n');
    var docTitle = String(fileName || 'Document').replace(/\.(md|markdown|txt)$/i, '');
    var chapters = [];
    var curChap = { id: 'chap-1', title: docTitle, blocks: [] };

    var inFence = false;
    var fenceLines = [];
    var paraLines = [];

    function flushPara() {
      if (paraLines.length === 0) return;
      var joined = paraLines.join(' ').replace(/\s+/g, ' ').trim();
      paraLines = [];
      if (!joined) return;
      if (joined.indexOf('>') === 0) {
        curChap.blocks.push({ type: 'quote', text: joined.replace(/^>\s*/, '') });
      } else {
        curChap.blocks.push({ type: 'p', text: joined });
      }
    }

    for (var i = 0; i < lines.length; i++) {
      var ln = lines[i];
      if (/^\s*```/.test(ln)) {
        if (!inFence) {
          flushPara();
          inFence = true;
          fenceLines = [];
        } else {
          inFence = false;
          if (fenceLines.length > 0) {
            curChap.blocks.push({ type: 'code', text: fenceLines.join('\n') });
          }
          fenceLines = [];
        }
        continue;
      }
      if (inFence) {
        fenceLines.push(ln);
        continue;
      }

      var trimmed = ln.trim();
      if (!trimmed) {
        flushPara();
        continue;
      }

      var hMatch = /^(#{1,4})\s+(.+)$/.exec(trimmed);
      if (hMatch) {
        flushPara();
        var level = hMatch[1].length;
        var hText = hMatch[2].trim();
        if (level === 1) {
          if (curChap.blocks.length === 0 && chapters.length === 0) {
            curChap.title = hText;
            docTitle = hText;
          } else {
            chapters.push(curChap);
            curChap = { id: 'chap-' + (chapters.length + 1), title: hText, blocks: [] };
          }
        }
        curChap.blocks.push({ type: 'h', text: hText });
        continue;
      }

      if (/^[-*+]\s+/.test(trimmed) || /^\d+\.\s+/.test(trimmed)) {
        flushPara();
        curChap.blocks.push({ type: 'p', text: trimmed.replace(/^([-*+]|\d+\.)\s+/, '• ') });
        continue;
      }

      paraLines.push(trimmed);
    }
    flushPara();
    if (curChap.blocks.length > 0 || chapters.length === 0) chapters.push(curChap);

    return {
      format: /\.md|markdown$/i.test(String(fileName || '')) ? 'md' : 'txt',
      title: docTitle,
      author: '',
      lang: 'auto',
      chapters: chapters
    };
  }

  function formatSecToClock(sec) {
    var total = Math.max(0, Math.floor(sec || 0));
    var hh = Math.floor(total / 3600);
    var mm = Math.floor((total % 3600) / 60);
    var ss = total % 60;
    var mmStr = String(mm).padStart(2, '0') + ':' + String(ss).padStart(2, '0');
    return hh > 0 ? (hh + ':' + mmStr) : mmStr;
  }

  function formatSecToSrtTime(sec) {
    var msTotal = Math.max(0, Math.round((sec || 0) * 1000));
    var hh = Math.floor(msTotal / 3600000);
    var mm = Math.floor((msTotal % 3600000) / 60000);
    var ss = Math.floor((msTotal % 60000) / 1000);
    var ms = msTotal % 1000;
    return String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0') + ':' +
      String(ss).padStart(2, '0') + ',' + String(ms).padStart(3, '0');
  }

  function parseTimestampFlex(raw) {
    var s = String(raw || '').trim();
    var m3 = /^(\d{1,3}):([0-5]?\d):([0-5]?\d)[,.](\d{1,3})$/.exec(s);
    if (m3) {
      var frac = m3[4].length === 2 && s.indexOf('.') !== -1 && !s.includes(',')
        ? parseInt(m3[4], 10) / 100
        : parseInt(m3[4].padEnd(3, '0'), 10) / 1000;
      return parseInt(m3[1], 10) * 3600 + parseInt(m3[2], 10) * 60 + parseInt(m3[3], 10) + frac;
    }
    var m2 = /^([0-5]?\d):([0-5]?\d)[,.](\d{1,3})$/.exec(s);
    if (m2) {
      return parseInt(m2[1], 10) * 60 + parseInt(m2[2], 10) + parseInt(m2[3].padEnd(3, '0'), 10) / 1000;
    }
    return NaN;
  }

  function parseSubtitleDocument(rawText, fileName) {
    var src = String(rawText || '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
    var ext = (/\.([a-z0-9]+)$/i.exec(String(fileName || '')) || ['', 'srt'])[1].toLowerCase();
    var blocks = [];

    if (ext === 'ass' || ext === 'ssa' || /\[Events\]/i.test(src)) {
      var lines = src.split('\n');
      var inEvents = false;
      for (var i = 0; i < lines.length; i++) {
        var ln = lines[i].trim();
        if (/^\[Events\]$/i.test(ln)) { inEvents = true; continue; }
        if (/^\[.*\]$/.test(ln)) { inEvents = false; continue; }
        if (!inEvents || !/^Dialogue\s*:/i.test(ln)) continue;
        var rest = ln.slice(ln.indexOf(':') + 1);
        var parts = rest.split(',');
        if (parts.length < 10) continue;
        var sSec = parseTimestampFlex(parts[1]);
        var eSec = parseTimestampFlex(parts[2]);
        var body = decodeEntities(parts.slice(9).join(',').replace(/\{[^}]*\}/g, '').replace(/\\[Nn]/g, ' ').replace(/\\h/g, ' ')).replace(/\s+/g, ' ').trim();
        if (!body || Number.isNaN(sSec)) continue;
        blocks.push({ type: 'cue', s: sSec, e: Number.isNaN(eSec) ? sSec + 2.5 : eSec, timeLabel: formatSecToClock(sSec), text: body });
      }
    } else {
      var chunks = src.split(/\n{2,}/);
      for (var c = 0; c < chunks.length; c++) {
        var blk = chunks[c].trim();
        if (!blk || /^WEBVTT\b/i.test(blk) && !blk.includes('-->')) continue;
        var cLines = blk.split('\n');
        var tIdx = cLines.findIndex(function (x) { return x.indexOf('-->') !== -1; });
        if (tIdx < 0) continue;
        var arrow = cLines[tIdx].split('-->');
        var st = parseTimestampFlex(arrow[0].trim().split(/\s+/)[0]);
        var et = parseTimestampFlex(arrow[1].trim().split(/\s+/)[0]);
        if (Number.isNaN(st)) continue;
        var txt = decodeEntities(cLines.slice(tIdx + 1).join(' ').replace(/<[^>]+>/g, '').replace(/\{[^}]*\}/g, '')).replace(/\s+/g, ' ').trim();
        if (!txt) continue;
        blocks.push({ type: 'cue', s: st, e: Number.isNaN(et) ? st + 2.5 : et, timeLabel: formatSecToClock(st), text: txt });
      }
    }

    var title = String(fileName || 'Subtitles').replace(/\.(srt|vtt|ass|ssa)$/i, '');
    return {
      format: 'sub',
      title: title,
      author: '',
      lang: 'auto',
      chapters: [{ id: 'chap-1', title: title, blocks: blocks }]
    };
  }

  /* ==========================================================================
   * 4. Inline Placeholder Masking & Bilingual Exporters (.MD / .SRT)
   * ========================================================================== */

  function maskInlineTokens(text) {
    var map = {};
    var idx = 0;
    var masked = String(text || '').replace(/`[^`]+`|\$(?!\s)[^$\n]+?\S\$|https?:\/\/\S+/g, function (m) {
      var tok = '{v' + (idx++) + '}';
      map[tok] = m;
      return tok;
    });
    return { text: masked, map: map };
  }

  function restoreInlineTokens(text, map) {
    if (!map) return String(text || '');
    return String(text || '').replace(/[{\uFF5B]\s*v\s*(\d+)\s*[}\uFF5D]/gi, function (full, n) {
      var k = '{v' + n + '}';
      return Object.prototype.hasOwnProperty.call(map, k) ? map[k] : full;
    });
  }

  function exportBilingualMarkdown(book) {
    if (!book || !Array.isArray(book.chapters)) return '';
    var out = ['# ' + (book.title || 'Bilingual Study Export')];
    if (book.author) out.push('*' + book.author + '*');
    out.push('');
    for (var c = 0; c < book.chapters.length; c++) {
      var chap = book.chapters[c];
      if (book.chapters.length > 1 || (chap.title && chap.title !== book.title)) {
        out.push('## ' + chap.title);
        out.push('');
      }
      for (var b = 0; b < chap.blocks.length; b++) {
        var blk = chap.blocks[b];
        if (blk.type === 'code') {
          out.push('```');
          out.push(blk.text);
          out.push('```');
        } else if (blk.type === 'h') {
          out.push('### ' + blk.text);
          if (blk.tr) out.push('> ' + blk.tr);
        } else if (blk.type === 'cue') {
          out.push('**[' + (blk.timeLabel || '00:00') + ']** ' + blk.text);
          if (blk.tr) out.push('> ' + blk.tr);
        } else {
          out.push(blk.text);
          if (blk.tr) out.push('> ' + blk.tr);
        }
        out.push('');
      }
    }
    return out.join('\n').trim() + '\n';
  }

  function exportBilingualSrt(chapter) {
    if (!chapter || !Array.isArray(chapter.blocks)) return '';
    var rows = [];
    var idx = 1;
    for (var i = 0; i < chapter.blocks.length; i++) {
      var blk = chapter.blocks[i];
      var s = typeof blk.s === 'number' ? blk.s : (idx - 1) * 3;
      var e = typeof blk.e === 'number' ? blk.e : s + 2.5;
      rows.push(String(idx++));
      rows.push(formatSecToSrtTime(s) + ' --> ' + formatSecToSrtTime(e));
      rows.push(blk.tr ? (blk.text + '\n' + blk.tr) : blk.text);
      rows.push('');
    }
    return rows.join('\n');
  }

  function utf8Encode(str) {
    if (typeof TextEncoder !== 'undefined') {
      return new TextEncoder().encode(String(str || ''));
    }
    if (typeof Buffer !== 'undefined') {
      return new Uint8Array(Buffer.from(String(str || ''), 'utf8'));
    }
    var s = unescape(encodeURIComponent(String(str || '')));
    var u = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
    return u;
  }

  function escapeXmlText(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  var CRC32_TABLE = (function () {
    var tbl = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) {
        c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      }
      tbl[n] = c >>> 0;
    }
    return tbl;
  })();

  function crc32Bytes(u8) {
    var crc = 0xffffffff;
    for (var i = 0; i < u8.length; i++) {
      crc = CRC32_TABLE[(crc ^ u8[i]) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  // Pure-JS Stored (method=0) ZIP writer — compliant with EPUB OCF 3.2 (mimetype first, uncompressed, 0 extra bytes)
  function buildStoredZipBuffer(fileEntries) {
    var localChunks = [];
    var cdChunks = [];
    var offset = 0;

    for (var i = 0; i < fileEntries.length; i++) {
      var entry = fileEntries[i];
      var nameBytes = utf8Encode(entry.name);
      var dataBytes = entry.data instanceof Uint8Array ? entry.data : utf8Encode(entry.data || '');
      var crc = crc32Bytes(dataBytes);
      var size = dataBytes.length;

      var localHdr = new Uint8Array(30 + nameBytes.length);
      var ldv = new DataView(localHdr.buffer);
      ldv.setUint32(0, 0x04034b50, true);
      ldv.setUint16(4, 20, true);
      ldv.setUint16(6, 0x0800, true); // UTF-8 filename bit
      ldv.setUint16(8, 0, true);      // Stored (no compression)
      ldv.setUint16(10, 0, true);
      ldv.setUint16(12, 0x2100, true);
      ldv.setUint32(14, crc, true);
      ldv.setUint32(18, size, true);
      ldv.setUint32(22, size, true);
      ldv.setUint16(26, nameBytes.length, true);
      ldv.setUint16(28, 0, true);
      localHdr.set(nameBytes, 30);

      var cdHdr = new Uint8Array(46 + nameBytes.length);
      var cdv = new DataView(cdHdr.buffer);
      cdv.setUint32(0, 0x02014b50, true);
      cdv.setUint16(4, 20, true);
      cdv.setUint16(6, 20, true);
      cdv.setUint16(8, 0x0800, true);
      cdv.setUint16(10, 0, true);
      cdv.setUint16(12, 0, true);
      cdv.setUint16(14, 0x2100, true);
      cdv.setUint32(16, crc, true);
      cdv.setUint32(20, size, true);
      cdv.setUint32(24, size, true);
      cdv.setUint16(28, nameBytes.length, true);
      cdv.setUint16(30, 0, true);
      cdv.setUint16(32, 0, true);
      cdv.setUint16(34, 0, true);
      cdv.setUint16(36, 0, true);
      cdv.setUint32(38, 0, true);
      cdv.setUint32(42, offset, true);
      cdHdr.set(nameBytes, 46);

      localChunks.push(localHdr, dataBytes);
      cdChunks.push(cdHdr);
      offset += localHdr.length + dataBytes.length;
    }

    var cdSize = 0;
    for (var c = 0; c < cdChunks.length; c++) cdSize += cdChunks[c].length;

    var eocd = new Uint8Array(22);
    var edv = new DataView(eocd.buffer);
    edv.setUint32(0, 0x06054b50, true);
    edv.setUint16(4, 0, true);
    edv.setUint16(6, 0, true);
    edv.setUint16(8, fileEntries.length, true);
    edv.setUint16(10, fileEntries.length, true);
    edv.setUint32(12, cdSize, true);
    edv.setUint32(16, offset, true);
    edv.setUint16(20, 0, true);

    var out = new Uint8Array(offset + cdSize + 22);
    var pos = 0;
    for (var l = 0; l < localChunks.length; l++) {
      out.set(localChunks[l], pos);
      pos += localChunks[l].length;
    }
    for (var d = 0; d < cdChunks.length; d++) {
      out.set(cdChunks[d], pos);
      pos += cdChunks[d].length;
    }
    out.set(eocd, pos);
    return out;
  }

  // MIT bilingual_book_maker-inspired re-packager: builds a valid DRM-free .bilingual.epub Uint8Array
  function exportBilingualEpubBuffer(book) {
    if (!book || !Array.isArray(book.chapters) || book.chapters.length === 0) {
      throw new Error('Cannot export empty book to EPUB');
    }
    var title = book.title || 'Phrasebound Bilingual Book';
    var author = book.author || 'Phrasebound';
    var lang = book.lang || 'en';
    var bookId = 'urn:uuid:phrasebound-' + Date.now();

    var files = [
      { name: 'mimetype', data: 'application/epub+zip' },
      {
        name: 'META-INF/container.xml',
        data: '<?xml version="1.0" encoding="UTF-8"?>\n' +
          '<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">\n' +
          '  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>\n' +
          '</container>'
      },
      {
        name: 'OEBPS/style.css',
        data: 'body { font-family: Georgia, serif; line-height: 1.68; margin: 1.2em; color: #111827; }\n' +
          'h1, h2, h3 { font-family: sans-serif; line-height: 1.25; }\n' +
          'p.ss-orig { margin: 0.75em 0 0.2em; }\n' +
          'p.ss-bilingual-tr { margin: 0 0 0.9em; padding-left: 0.75em; border-left: 2px solid #0f766e; color: #334155; font-size: 0.94em; }\n' +
          'pre { background: #f1f5f9; padding: 0.75em; overflow-x: auto; font-size: 0.88em; }\n'
      }
    ];

    var manifestItems = [
      '    <item id="css" href="style.css" media-type="text/css"/>',
      '    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>'
    ];
    var spineItems = [];
    var navLinks = [];

    for (var idx = 0; idx < book.chapters.length; idx++) {
      var chap = book.chapters[idx];
      var chapId = 'chap_' + (idx + 1);
      var href = chapId + '.xhtml';
      var cTitle = chap.title || ('Chapter ' + (idx + 1));

      manifestItems.push('    <item id="' + chapId + '" href="' + href + '" media-type="application/xhtml+xml"/>');
      spineItems.push('    <itemref idref="' + chapId + '"/>');
      navLinks.push('      <li><a href="' + href + '">' + escapeXmlText(cTitle) + '</a></li>');

      var bodyLines = ['  <h2>' + escapeXmlText(cTitle) + '</h2>'];
      var blocks = Array.isArray(chap.blocks) ? chap.blocks : [];
      for (var b = 0; b < blocks.length; b++) {
        var blk = blocks[b];
        if (!blk || !blk.text) continue;
        if (blk.type === 'code') {
          bodyLines.push('  <pre><code>' + escapeXmlText(blk.text) + '</code></pre>');
        } else if (blk.type === 'h') {
          if (blk.text !== cTitle) bodyLines.push('  <h3>' + escapeXmlText(blk.text) + '</h3>');
          if (blk.tr) bodyLines.push('  <p class="ss-bilingual-tr">' + escapeXmlText(blk.tr) + '</p>');
        } else if (blk.type === 'quote') {
          bodyLines.push('  <blockquote><p class="ss-orig">' + escapeXmlText(blk.text) + '</p></blockquote>');
          if (blk.tr) bodyLines.push('  <p class="ss-bilingual-tr">' + escapeXmlText(blk.tr) + '</p>');
        } else {
          var prefix = blk.type === 'cue' && blk.timeLabel ? ('[' + blk.timeLabel + '] ') : '';
          bodyLines.push('  <p class="ss-orig">' + escapeXmlText(prefix + blk.text) + '</p>');
          if (blk.tr) bodyLines.push('  <p class="ss-bilingual-tr">' + escapeXmlText(blk.tr) + '</p>');
        }
      }

      var chapXhtml = '<?xml version="1.0" encoding="UTF-8"?>\n' +
        '<!DOCTYPE html>\n' +
        '<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="' + escapeXmlText(lang) + '">\n' +
        '<head><meta charset="UTF-8"/><title>' + escapeXmlText(cTitle) + '</title><link rel="stylesheet" type="text/css" href="style.css"/></head>\n' +
        '<body>\n' + bodyLines.join('\n') + '\n</body>\n</html>';

      files.push({ name: 'OEBPS/' + href, data: chapXhtml });
    }

    var navXhtml = '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<!DOCTYPE html>\n' +
      '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">\n' +
      '<head><meta charset="UTF-8"/><title>' + escapeXmlText(title) + '</title></head>\n' +
      '<body><nav epub:type="toc"><h1>' + escapeXmlText(title) + '</h1><ol>\n' +
      navLinks.join('\n') + '\n</ol></nav></body></html>';
    files.push({ name: 'OEBPS/nav.xhtml', data: navXhtml });

    var opfXml = '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">\n' +
      '  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">\n' +
      '    <dc:identifier id="bookid">' + escapeXmlText(bookId) + '</dc:identifier>\n' +
      '    <dc:title>' + escapeXmlText(title) + '</dc:title>\n' +
      '    <dc:creator>' + escapeXmlText(author) + '</dc:creator>\n' +
      '    <dc:language>' + escapeXmlText(lang) + '</dc:language>\n' +
      '  </metadata>\n' +
      '  <manifest>\n' + manifestItems.join('\n') + '\n  </manifest>\n' +
      '  <spine>\n' + spineItems.join('\n') + '\n  </spine>\n' +
      '</package>';
    files.push({ name: 'OEBPS/content.opf', data: opfXml });

    return buildStoredZipBuffer(files);
  }

  /* ==========================================================================
   * 5. Browser Reader UI Controller (Zero innerHTML / Trusted-Types Safe)
   * ========================================================================== */

  function initReaderBrowserUI() {
    if (typeof document === 'undefined' || !document.getElementById) return;
    var articleEl = document.getElementById('rdArticle');
    if (!articleEl) return;

    var $ = function (id) { return document.getElementById(id); };
    var state = {
      book: null,
      chapIdx: 0,
      srcLang: 'auto',
      tl: 'en',
      mtModel: 'plamo-0.8b',
      companionUrl: 'http://127.0.0.1:8787',
      sceneServices: {},
      customApi: null,
      translating: false,
      pdfPreview: true,
      pdfEditing: false,
      readerAid: true,
      patterns: false,
      posColors: true,
      showPitchAccent: true,
      readingAidMode: 'romaji',
      readDicts: {},
      blockFes: {}
    };

    function clearEl(el) {
      while (el && el.firstChild) el.removeChild(el.firstChild);
    }

    function mk(tag, cls, text) {
      var n = document.createElement(tag);
      if (cls) n.className = cls;
      if (text != null) n.textContent = String(text);
      return n;
    }

    function sendMsg(payload) {
      return new Promise(function (resolve) {
        if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.sendMessage) {
          resolve(null);
          return;
        }
        try {
          chrome.runtime.sendMessage(payload, function (r) {
            void (chrome.runtime && chrome.runtime.lastError);
            resolve(r || null);
          });
        } catch (_e) { resolve(null); }
      });
    }

    function pdfRequest(action, book, body) {
      return sendMsg({
        op: 'companion', path: '/pdf_' + action, url: state.companionUrl, method: 'POST',
        timeoutMs: action === 'export' ? 120000 : 25000, body: Object.assign({ b64: book.pdf.b64 }, body),
      });
    }

    function setBlockTranslation(book, block, value, lang) {
      block.tr = value;
      if (book.pdf) {
        if (!block.pdfTranslations) block.pdfTranslations = Object.create(null);
        block.pdfTranslations[lang] = value;
      }
    }

    function syncPdfControls() {
      if (!$('btnPdfPreview')) return;
      var book = state.book;
      var layout = book && book.pdf;
      var canExport = layout && layout.pageCount === book.chapters.length
        && book.chapters.some(function (chapter) { return chapter.blocks.length; });
      $('btnPdfPreview').hidden = !layout;
      $('btnPdfPreview').setAttribute('aria-pressed', String(state.pdfPreview));
      $('btnPdfEdit').hidden = !layout;
      $('btnPdfEdit').setAttribute('aria-pressed', String(state.pdfEditing));
      $('btnPdfExport').hidden = !canExport;
      $('btnPdfExport').disabled = state.translating;
    }

    async function renderPdfPreview(book, chapter, render) {
      var panel = $('rdPdfOriginal');
      if (!panel) return;
      panel.hidden = !book.pdf || !state.pdfPreview;
      clearEl(panel);
      if (panel.hidden) return;
      panel.appendChild(mk('p', '', 'Loading original ' + chapter.title.toLowerCase() + '…'));
      var cache = book.pdf.previews;
      var image = cache.get(chapter.page);
      if (!image) {
        var res = await pdfRequest('render', book, { page: chapter.page });
        if (res && res.ok && res.png_b64) {
          image = 'data:image/png;base64,' + res.png_b64;
          cache.set(chapter.page, image);
          if (cache.size > 8) cache.delete(cache.keys().next().value);
        }
      }
      if (render !== chapterRender) return;
      clearEl(panel);
      if (!image) {
        panel.appendChild(mk('p', '', 'Could not render the original page. Check the local Companion.'));
        return;
      }
      var img = mk('img');
      img.src = image;
      img.alt = 'Original PDF ' + chapter.title.toLowerCase();
      panel.appendChild(img);
    }

    function speakText(text, langHint) {
      if (typeof window === 'undefined' || !window.speechSynthesis || !text) return;
      window.speechSynthesis.cancel();
      var chunks = String(text).match(/[^.!?。！？；;\n]+[.!?。！？；;\n]*/g) || [text];
      for (var i = 0; i < chunks.length; i++) {
        var c = chunks[i].trim();
        if (!c) continue;
        var utt = new SpeechSynthesisUtterance(c);
        if (langHint && langHint !== 'auto') utt.lang = langHint === 'yue' ? 'zh-HK' : langHint;
        window.speechSynthesis.speak(utt);
      }
    }

    function detectDocLang(sampleText) {
      if (state.srcLang && state.srcLang !== 'auto') return state.srcLang;
      var s = String(sampleText || '');
      if (/[\u3040-\u30ff]/.test(s)) return 'ja';
      if (/[\uac00-\ud7af]/.test(s)) return 'ko';
      if (/[\u3400-\u9fff]/.test(s)) return /[係唔嘅咁咗嚟冇睇畀諗點樣乜嘢]/.test(s) ? 'yue' : 'zh';
      if (/[\u0400-\u04ff]/.test(s)) return 'ru';
      return 'en';
    }

    var inspectVersion = 0;
    async function openInspector(term, contextLine, phraseHit) {
      var currentInspection = ++inspectVersion;
      var insp = $('rdInspector');
      var wordH = $('rdInspWord');
      var body = $('rdInspBody');
      if (!insp || !body) return;
      insp.hidden = false;
      wordH.textContent = term;
      clearEl(body);
      var loading = mk('div', 'rd-insp-ex', 'Looking up the definition…');
      body.appendChild(loading);

      var lang = detectDocLang(contextLine || term);
      if (contextLine && globalThis.SS_LOCAL_STUDY) {
        body.prepend(globalThis.SS_LOCAL_STUDY.create(document, {
          buttonClass: 'rd-btn rd-btn-sm',
          request: (mode) => sendMsg({ op: 'companion', path: '/explain', method: 'POST', timeoutMs: 120000,
            body: { word: term, lemma: phraseHit?.canonical || term, line: contextLine, mode,
              title: state.book?.title || '', source_lang: lang, target_lang: state.tl } }),
        }));
      }
      globalThis.SS_LITERARY?.append(body, lang, term, contextLine);
      if ($('btnInspSpeak')) {
        $('btnInspSpeak').onclick = function () { speakText(term, lang); };
      }

      var canonical = phraseHit?.canonical || root.SS_LANG?.get(lang)?.lemma?.(term) || term;
      var exampleRequest = sendMsg({ op: 'examples', query: canonical, lang: lang, tl: state.tl });
      var defRes = await sendMsg({ op: 'defineAll', words: [...new Set([term, canonical])], lang: lang, tl: state.tl });
      if (currentInspection !== inspectVersion) return;
      loading.remove();
      var firstEntry = defRes && defRes.sources && defRes.sources[0] && defRes.sources[0].entries && defRes.sources[0].entries[0];
      var meaning = (phraseHit && phraseHit.gloss) || (firstEntry && firstEntry.defs && firstEntry.defs[0]);
      if (phraseHit && phraseHit.gloss) body.appendChild(mk('div', 'rd-insp-sec', phraseHit.gloss));
      if (meaning) {
        var saveCard = mk('button', 'rd-btn rd-btn-sm', 'Save to review');
        saveCard.type = 'button';
        saveCard.onclick = async function () {
          saveCard.disabled = true;
          var reading = (phraseHit && phraseHit.reading) || (firstEntry && firstEntry.reading) || '';
          var result = await sendMsg({ op: 'saveWebItem', item: { word: term, lang: lang, def: meaning,
            reading: reading, line: contextLine, title: state.book && state.book.title, type: phraseHit ? 'phrase' : 'word' } });
          saveCard.textContent = result && result.ok ? 'Saved' : 'Retry save';
          saveCard.disabled = Boolean(result && result.ok);
        };
        body.appendChild(saveCard);
      }

      if (defRes && defRes.ok && Array.isArray(defRes.sources) && defRes.sources.length) {
        for (var s = 0; s < defRes.sources.length; s++) {
          var src = defRes.sources[s];
          var sec = mk('div', 'rd-insp-sec');
          var sLbl = src.name || 'Dictionary';
          var noteTxt = String(src.note || '').replace(/^offline pack\s*·?\s*/i, '').trim();
          sec.appendChild(mk('div', 'rd-insp-pos', noteTxt ? (sLbl + ' · ' + noteTxt) : sLbl));
          var entries = src.entries || [];
          for (var e = 0; e < Math.min(3, entries.length); e++) {
            var ent = entries[e];
            var hdrParts = [ent.head, ent.reading ? '[' + ent.reading + ']' : '', ent.pos ? '(' + ent.pos + ')' : ''].filter(Boolean);
            if (hdrParts.length) sec.appendChild(mk('div', 'rd-insp-pos', hdrParts.join(' ')));
            var defs = ent.defs || [];
            for (var d = 0; d < Math.min(4, defs.length); d++) {
              sec.appendChild(mk('div', '', (d + 1) + '. ' + defs[d]));
            }
          }
          body.appendChild(sec);
        }
      } else {
        body.appendChild(mk('div', 'rd-insp-sec', 'No dictionary entry found. Open Explain to check the meaning in this line.'));
      }

      var exRes = await exampleRequest;
      if (currentInspection !== inspectVersion) return;
      if (exRes && exRes.ok && Array.isArray(exRes.items) && exRes.items.length) {
        var exSec = mk('div', 'rd-insp-sec');
        exSec.appendChild(mk('div', 'rd-insp-pos', 'Tatoeba Parallel Sentences'));
        for (var x = 0; x < Math.min(3, exRes.items.length); x++) {
          exSec.appendChild(mk('div', '', exRes.items[x].text));
          exSec.appendChild(mk('div', 'rd-insp-ex', exRes.items[x].trans));
        }
        body.appendChild(exSec);
      }
    }

    function normReaderLang(lang) {
      var c = String(lang || '').toLowerCase().trim();
      if (!c || c === 'auto') return 'en';
      if (c === 'yue') return 'yue';
      if (c === 'fil' || c === 'tgl') return 'tl';
      return c.split(/[-_]/)[0];
    }

    async function ensureReaderDict(docLang) {
      var norm = normReaderLang(docLang);
      if (!/^(ja|zh|yue|ko|ru|tl)$/.test(norm)) return null;
      if (state.readDicts[norm] !== undefined) return state.readDicts[norm];
      var file = 'read_' + norm + '.json';
      var raw = null;
      try {
        if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL && typeof fetch === 'function') {
          var resp = await fetch(chrome.runtime.getURL('data/' + file));
          if (resp && resp.ok) raw = await resp.json();
        }
      } catch (_e1) {}
      if (!raw) {
        var rMsg = await sendMsg({ op: 'loadExtData', file: file });
        if (rMsg && rMsg.ok && rMsg.data) raw = rMsg.data;
      }
      var rich = raw && root.SS_READINGS && typeof root.SS_READINGS.normalizeRichReadDict === 'function'
        ? root.SS_READINGS.normalizeRichReadDict(raw)
        : (raw || null);
      state.readDicts[norm] = rich;
      return rich;
    }

    function makeRtNode(rtTagCls, txt) {
      var rt = document.createElement('rt');
      if (rtTagCls) rt.className = rtTagCls;
      var segs = String(txt || '').split(/([ꜜ‾])/);
      for (var i = 0; i < segs.length; i++) {
        var sg = segs[i];
        if (!sg) continue;
        if (sg === 'ꜜ' || sg === '‾') rt.appendChild(mk('span', 'rd-pitch-mark', sg));
        else rt.appendChild(document.createTextNode(sg));
      }
      return rt;
    }

    function appendReaderTokenDom(targetEl, wStr, docLang, richDict) {
      var RD = root.SS_READINGS;
      var norm = normReaderLang(docLang);
      var wantAid = !!state.readerAid;
      var wantPos = !!state.posColors;
      var aid = (RD && typeof RD.lookupTokenAid === 'function' && (wantAid || wantPos) && /^(ja|zh|yue|ko|ru|tl)$/.test(norm))
        ? RD.lookupTokenAid(wStr, norm, richDict, { mode: state.readingAidMode || 'romaji', showPitchAccent: state.showPitchAccent !== false })
        : null;
      if (wantAid && aid && (aid.stress || (aid.reading && !Array.isArray(aid.reading) && (norm === 'ru' || norm === 'tl')))) {
        targetEl.textContent = aid.stress || aid.reading;
        return;
      }
      if (wantPos && aid && (aid.pos === 'n' || aid.pos === 'v' || aid.pos === 'a')) {
        targetEl.classList.add('rd-pos-' + aid.pos);
      }
      if (wantAid && aid && Array.isArray(aid.reading) && aid.reading.length) {
        for (var i = 0; i < aid.reading.length; i++) {
          var pair = aid.reading[i];
          var b = pair[0] || '';
          var rt = pair[1] || '';
          if (rt) {
            var rb = document.createElement('ruby');
            rb.className = 'rd-ruby';
            rb.appendChild(document.createTextNode(b));
            rb.appendChild(makeRtNode('', rt));
            targetEl.appendChild(rb);
          } else if (b) {
            targetEl.appendChild(document.createTextNode(b));
          }
        }
        return;
      }
      if (wantAid && aid && typeof aid.reading === 'string' && aid.reading) {
        var rb2 = document.createElement('ruby');
        rb2.className = 'rd-ruby';
        rb2.appendChild(document.createTextNode(wStr));
        rb2.appendChild(makeRtNode('', aid.reading));
        targetEl.appendChild(rb2);
        return;
      }
      targetEl.textContent = wStr;
    }

    function renderInteractiveSentence(container, text, docLang, richDict) {
      var RD = root.SS_READINGS;
      var norm = normReaderLang(docLang);
      var idioms = (root.SS_IDIOMS && typeof root.SS_IDIOMS.findInText === 'function')
        ? root.SS_IDIOMS.findInText(text, state.tl, norm, { patterns: state.patterns })
        : [];

      var spans = [];
      for (var i = 0; i < idioms.length; i++) {
        var it = idioms[i];
        if (typeof it.start === 'number' && typeof it.end === 'number' && it.end > it.start) {
          spans.push(it);
        }
      }
      spans.sort(function (a, b) { return a.start - b.start || (b.end - b.start) - (a.end - a.start); });

      function appendTokenizedSegment(parentEl, segment, clickableWords) {
        var langHub = root.SS_LANG && typeof root.SS_LANG.get === 'function' ? root.SS_LANG.get(norm) : null;
        if (!langHub) {
          parentEl.appendChild(document.createTextNode(segment));
          return;
        }
        var toks = langHub.split(segment);
        if ((norm === 'yue' || norm === 'zh') && richDict && RD && typeof RD.mergeCjkDictTokens === 'function') {
          toks = RD.mergeCjkDictTokens(toks, norm, richDict, null);
        }
        for (var t = 0; t < toks.length; t++) {
          if (toks[t].word) {
            (function (wStr) {
              var sp = mk('span', clickableWords ? 'rd-word' : 'rd-word rd-word-in-fe', '');
              appendReaderTokenDom(sp, wStr, norm, richDict);
              if (clickableWords) {
                sp.addEventListener('click', function () { openInspector(wStr, text); });
              }
              parentEl.appendChild(sp);
            })(toks[t].w);
          } else {
            parentEl.appendChild(document.createTextNode(toks[t].w));
          }
        }
      }

      var cur = 0;
      for (var j = 0; j < spans.length; j++) {
        var spItem = spans[j];
        if (spItem.start < cur) continue;
        if (spItem.start > cur) appendTokenizedSegment(container, text.slice(cur, spItem.start), true);
        (function (feItem, surfTxt) {
          var mark = mk('span', 'rd-fe-mark', '');
          mark.title = feItem.phrase + (feItem.gloss ? ' — ' + feItem.gloss : '');
          appendTokenizedSegment(mark, surfTxt, false);
          mark.addEventListener('click', function () { openInspector(feItem.phrase || surfTxt, text, feItem); });
          container.appendChild(mark);
        })(spItem, text.slice(spItem.start, spItem.end));
        cur = spItem.end;
      }
      if (cur < text.length) appendTokenizedSegment(container, text.slice(cur), true);
      return idioms;
    }

    var chapterRender = 0;
    async function renderCurrentChapter() {
      var render = ++chapterRender;
      if (!state.book || !state.book.chapters.length) return;
      var book = state.book;
      var chap = book.chapters[state.chapIdx] || book.chapters[0];
      syncPdfControls();
      renderPdfPreview(book, chap, render);

      var sample = chap.blocks.slice(0, 6).map(function (b) { return b.text; }).join(' ');
      var docLang = detectDocLang(sample);
      if ($('btnReaderPatterns')) $('btnReaderPatterns').hidden = docLang !== 'ja';
      if (root.SS_IDIOMS && typeof root.SS_IDIOMS.ensureWebFeIndex === 'function') {
        await root.SS_IDIOMS.ensureWebFeIndex(docLang);
      }
      var richDict = await ensureReaderDict(docLang);
      if (render !== chapterRender) return;
      clearEl(articleEl);
      state.blockFes = {};
      articleEl.classList.toggle('rd-pos-on', !!state.posColors);

      articleEl.appendChild(mk('h1', 'rd-chap-h1', chap.title));
      if (book.pdf && !chap.blocks.length) articleEl.appendChild(mk('p', 'rd-block-p', 'This page has no extractable text.'));
      for (var i = 0; i < chap.blocks.length; i++) {
        var blk = chap.blocks[i];
        var wrap = mk('div', 'rd-block');
        if (blk.type === 'code') {
          wrap.appendChild(mk('pre', 'rd-block-code', blk.text));
          articleEl.appendChild(wrap);
          continue;
        }

        var lineEl = mk(blk.type === 'h' ? 'h2' : 'p',
          blk.type === 'h' ? 'rd-block-h' : (blk.type === 'quote' ? 'rd-block-p rd-block-quote' : 'rd-block-p'));

        if (blk.type === 'cue' && blk.timeLabel) {
          lineEl.appendChild(mk('span', 'rd-time-pill', blk.timeLabel));
        }
        var idioms = renderInteractiveSentence(lineEl, blk.text, docLang, richDict);
        state.blockFes[i] = idioms;
        wrap.appendChild(lineEl);

        if (idioms.length > 0) {
          var chipRow = mk('div', 'rd-fe-chips');
          for (var k = 0; k < Math.min(4, idioms.length); k++) {
            (function (fe) {
              var lbl = fe.gloss ? (fe.phrase + ' · ' + fe.gloss) : fe.phrase;
              var btn = mk('button', 'rd-fe-chip', lbl);
              btn.type = 'button';
              btn.addEventListener('click', function () { openInspector(fe.phrase, blk.text, fe); });
              chipRow.appendChild(btn);
            })(idioms[k]);
          }
          wrap.appendChild(chipRow);
        }

        if (book.pdf && state.pdfEditing) {
          (function (block, index, lang) {
            var edit = mk('textarea', 'rd-tr-line rd-pdf-edit');
            edit.setAttribute('aria-label', 'Translation of paragraph ' + (index + 1));
            edit.value = block.tr || '';
            edit.addEventListener('input', function () { setBlockTranslation(book, block, edit.value, lang); });
            wrap.appendChild(edit);
          })(blk, i, state.tl);
        } else if (blk.tr) {
          wrap.appendChild(mk('div', 'rd-tr-line', blk.tr));
        }
        articleEl.appendChild(wrap);
      }

      // Sync TOC active button & compute readability / character telemetry (ttu-ebook-reader + vocabsieve style)
      var toc = $('rdToc');
      if (toc) {
        var btns = toc.querySelectorAll('.rd-toc-item');
        for (var t = 0; t < btns.length; t++) {
          btns[t].classList.toggle('active', t === state.chapIdx);
        }
      }
      var charCount = 0;
      var tokTotal = 0;
      var feCountChap = 0;
      for (var bi = 0; bi < chap.blocks.length; bi++) {
        var btxt = String(chap.blocks[bi].text || '');
        charCount += btxt.replace(/\s+/g, '').length;
        var wList = btxt.trim() ? btxt.trim().split(/\s+/) : [];
        tokTotal += wList.length;
        if (state.blockFes && state.blockFes[bi]) feCountChap += state.blockFes[bi].length;
      }
      if ($('rdStatus')) {
        $('rdStatus').textContent = state.book.title + ' · Ch ' + (state.chapIdx + 1) + '/' + state.book.chapters.length + ' · ' + charCount.toLocaleString() + ' chars' + (feCountChap ? (' · ' + feCountChap + ' FEs') : '');
        if (book.pdf && book.pdf.pageCount > book.chapters.length) $('rdStatus').textContent += ' · Preview limited to the first ' + book.chapters.length + ' of ' + book.pdf.pageCount + ' pages';
      }
      saveReaderBookmark();
    }

    var bmSaveTimer = null;
    function saveReaderBookmark() {
      if (!state.book || !state.book.title || typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return;
      clearTimeout(bmSaveTimer);
      bmSaveTimer = setTimeout(function () {
        var art = $('rdArticle');
        var pos = art ? (state.vertical ? art.scrollLeft : art.scrollTop) : 0;
        chrome.storage.local.get(['ss_reader_bookmarks_v1'], function (res) {
          var map = (res && res.ss_reader_bookmarks_v1) || {};
          map[state.book.title] = { chapIdx: state.chapIdx, scrollPos: pos, vertical: !!state.vertical, updatedAt: Date.now() };
          chrome.storage.local.set({ ss_reader_bookmarks_v1: map });
        });
      }, 450);
    }

    function renderToc() {
      var toc = $('rdToc');
      var metaBox = $('rdBookMeta');
      if (!toc || !state.book) return;
      clearEl(toc);
      if (metaBox) {
        metaBox.hidden = false;
        $('rdBookTitle').textContent = state.book.title;
        $('rdBookAuthor').textContent = state.book.author || state.book.format.toUpperCase();
      }
      state.book.chapters.forEach(function (ch, idx) {
        var btn = mk('button', 'rd-toc-item' + (idx === state.chapIdx ? ' active' : ''), (idx + 1) + '. ' + ch.title);
        btn.type = 'button';
        btn.addEventListener('click', function () {
          state.chapIdx = idx;
          renderCurrentChapter();
        });
        toc.appendChild(btn);
      });
    }

    async function translateChapter(book, chap, skipTranslated) {
      var tl = state.tl;
      var targets = [];
      for (var i = 0; i < chap.blocks.length; i++) {
        if (chap.blocks[i].type !== 'code' && chap.blocks[i].text
            && !(skipTranslated && String(chap.blocks[i].tr || '').trim())) {
          targets.push({ idx: i, blk: chap.blocks[i], masked: maskInlineTokens(chap.blocks[i].text) });
        }
      }

      var webSvc = (state.sceneServices && state.sceneServices.webpage) || 'auto';
      var localModelMap = { local_plamo2b: 'plamo-2b', local_index2b: 'index-2b', local_gemma_e4b: 'gemma-e4b', local_hymt7b: 'hy-mt2-7b' };
      var activeModel = localModelMap[webSvc] || state.mtModel;

      if (book.format === 'pdf' && webSvc === 'browser_api' && targets.length) {
        var translator;
        try {
          var source = state.srcLang === 'auto'
            ? (root.SS_LANG?.detectLang(targets.map(function (item) { return item.blk.text; }), '') || detectDocLang(targets[0].blk.text))
            : state.srcLang;
          translator = await globalThis.Translator.create({ sourceLanguage: source, targetLanguage: tl });
          for (var item of targets) {
            var tr = await translator.translate(item.masked.text);
            if (tr && tr.trim()) setBlockTranslation(book, item.blk, restoreInlineTokens(tr, item.masked.map), tl);
          }
        } catch (_) {
          throw new Error('Chrome on-device translation is unavailable for this PDF and language pair.');
        } finally {
          translator?.destroy?.();
        }
        return;
      }

      var batchSize = 10;
      for (var b = 0; b < targets.length; b += batchSize) {
        var slice = targets.slice(b, b + batchSize);
        if ($('rdStatus')) {
          $('rdStatus').textContent = chap.title + ' · Translating blocks ' + (b + 1) + '–' + Math.min(targets.length, b + slice.length) + ' of ' + targets.length + '…';
        }
        var translated = false;
        if (webSvc === 'custom_openai') {
          var ctResp = await sendMsg({
            op: 'customTranslate',
            texts: slice.map(function (it) { return it.masked.text; }),
            tl: tl,
            customApi: state.customApi || null,
            timeoutMs: 35000
          });
          if (ctResp && ctResp.ok && Array.isArray(ctResp.translations)) {
            for (var c = 0; c < slice.length; c++) {
              if (ctResp.translations[c]) setBlockTranslation(book, slice[c].blk, restoreInlineTokens(ctResp.translations[c], slice[c].masked.map), tl);
            }
            translated = true;
          }
        } else if (webSvc !== 'free_web') {
          var segs = slice.map(function (item) { return { id: String(item.idx), text: item.masked.text }; });
          var resp = await sendMsg({
            op: 'translateBatch',
            url: state.companionUrl,
            body: {
              segments: segs,
              target_lang: tl,
              title: book.title + ' — ' + chap.title,
              model: activeModel,
              device: 'gpu'
            }
          });
          if (resp && resp.ok && Array.isArray(resp.translations)) {
            for (var r = 0; r < slice.length; r++) {
              var rawTr = resp.translations[r];
              var txt = typeof rawTr === 'string' ? rawTr : (rawTr && (rawTr.translation || rawTr.text) || '');
              if (txt) setBlockTranslation(book, slice[r].blk, restoreInlineTokens(txt, slice[r].masked.map), tl);
            }
            translated = true;
          }
        }
        if (!translated && (book.format !== 'pdf' || webSvc === 'free_web')) {
          var wtResp = await sendMsg({
            op: 'webTranslate',
            texts: slice.map(function (it) { return it.masked.text; }),
            sl: state.srcLang || 'auto',
            tl: tl
          });
          if (wtResp && wtResp.ok && Array.isArray(wtResp.translations)) {
            for (var w = 0; w < slice.length; w++) {
              if (wtResp.translations[w]) {
                setBlockTranslation(book, slice[w].blk, restoreInlineTokens(wtResp.translations[w], slice[w].masked.map), tl);
              }
            }
          }
        }
      }
      if (book.format === 'pdf' && targets.some(function (item) { return !String(item.blk.tr || '').trim(); })) {
        throw new Error(chap.title + ' has missing translations. Check the selected service or edit those paragraphs and retry.');
      }
    }

    function setTranslationBusy(busy) {
      state.translating = busy;
      $('btnTranslateChapter').disabled = busy;
      $('btnTranslateChapter').textContent = busy ? 'Translating…' : 'Translate Chapter';
      $('rdTlLang').disabled = busy;
      $('rdSrcLang').disabled = busy;
      syncPdfControls();
    }

    async function translateActiveChapter() {
      if (!state.book || state.translating) return;
      var chap = state.book.chapters[state.chapIdx];
      if (!chap) return;
      setTranslationBusy(true);
      try {
        await translateChapter(state.book, chap, Boolean(state.book.pdf));
        await renderCurrentChapter();
      } catch (err) {
        await renderCurrentChapter();
        $('rdStatus').textContent = err.message;
      } finally {
        setTranslationBusy(false);
      }
    }

    async function exportPdf() {
      var book = state.book;
      if (state.translating || !book || !book.pdf || book.pdf.pageCount !== book.chapters.length) return;
      setTranslationBusy(true);
      try {
        for (var page of book.chapters) {
          await translateChapter(book, page, true);
        }
        $('rdStatus').textContent = 'Building searchable bilingual PDF…';
        var result = await pdfRequest('export', book, {
          pages: book.chapters.map(function (chapter) { return chapter.blocks.map(function (b) { return b.tr; }); }),
          target_lang: state.tl,
        });
        if (!result || !result.ok || !result.pdf_b64) throw new Error(result?.error || 'The local Companion did not return a PDF.');
        var fileName = book.title.replace(/[\\/:*?"<>|]/g, '_') || 'study-export';
        downloadTextFile(fileName + '.bilingual.pdf', Uint8Array.from(atob(result.pdf_b64), function (ch) { return ch.charCodeAt(0); }), 'application/pdf');
        await renderCurrentChapter();
      } catch (err) {
        await renderCurrentChapter();
        $('rdStatus').textContent = err.message;
      } finally {
        setTranslationBusy(false);
      }
    }

    function downloadTextFile(filename, content, mime) {
      var blob = new Blob([content], { type: mime || 'text/plain;charset=utf-8' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 1200);
    }

    async function handleFileObject(file) {
      if (!file || state.translating) return;
      var name = file.name || 'document.txt';
      try {
        if (/\.epub$/i.test(name)) {
          var ab = await file.arrayBuffer();
          state.book = await parseEpubBuffer(ab, name);
        } else if (/\.pdf$/i.test(name)) {
          if (file.size > 32 * 1024 * 1024) throw new Error('PDF exceeds the 32 MiB local processing limit.');
          if ($('rdStatus')) $('rdStatus').textContent = 'Extracting PDF text…';
          var pdfAb = await file.arrayBuffer();
          state.book = await parsePdfBuffer(pdfAb, name, state.companionUrl);
        } else if (/\.(srt|vtt|ass|ssa)$/i.test(name)) {
          var subTxt = await file.text();
          state.book = parseSubtitleDocument(subTxt, name);
        } else {
          var mdTxt = await file.text();
          state.book = parseMarkdownOrText(mdTxt, name);
        }
        state.chapIdx = 0;
        state.pdfEditing = false;
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
          chrome.storage.local.get(['ss_reader_bookmarks_v1'], async function (res) {
            var bm = res && res.ss_reader_bookmarks_v1 && res.ss_reader_bookmarks_v1[state.book.title];
            if (bm && typeof bm.chapIdx === 'number' && bm.chapIdx >= 0 && bm.chapIdx < state.book.chapters.length) {
              state.chapIdx = bm.chapIdx;
            }
            if (bm && bm.vertical && $('rdArticle')) {
              state.vertical = true;
              $('rdArticle').classList.add('rd-vertical');
              if ($('btnVerticalMode')) $('btnVerticalMode').textContent = 'Horizontal';
            }
            renderToc();
            await renderCurrentChapter();
            if (bm && bm.scrollPos && $('rdArticle')) {
              if (state.vertical) $('rdArticle').scrollLeft = bm.scrollPos;
              else $('rdArticle').scrollTop = bm.scrollPos;
            }
          });
          return;
        }
        renderToc();
        await renderCurrentChapter();
      } catch (err) {
        if ($('rdStatus')) $('rdStatus').textContent = String((err && err.message) || err);
      }
    }

    function syncAidToolbarButtons() {
      if ($('btnReaderAid')) {
        $('btnReaderAid').textContent = state.readerAid ? 'Reading aids: On' : 'Reading aids: Off';
        $('btnReaderAid').classList.toggle('active', !!state.readerAid);
        $('btnReaderAid').setAttribute('aria-pressed', String(!!state.readerAid));
      }
      if ($('btnPosAid')) {
        $('btnPosAid').textContent = state.posColors ? 'POS: On' : 'POS: Off';
        $('btnPosAid').classList.toggle('active', !!state.posColors);
      }
    }

    // Wire events & load user settings
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      try {
        chrome.storage.local.get(['ss_set'], function (res) {
          var s = (res && res.ss_set) || {};
          if (s.tl) { state.tl = s.tl; if ($('rdTlLang')) $('rdTlLang').value = s.tl; }
          if (s.mtModel) state.mtModel = s.mtModel;
          if (s.companionUrl) state.companionUrl = s.companionUrl;
          if (s.sceneServices && typeof s.sceneServices === 'object') state.sceneServices = s.sceneServices;
          if (s.customApi && typeof s.customApi === 'object') state.customApi = s.customApi;
          if (typeof s.webReaderAid === 'boolean') state.readerAid = s.webReaderAid;
          if (typeof s.posColors === 'boolean') state.posColors = s.posColors;
          if (typeof s.showPitchAccent === 'boolean') state.showPitchAccent = s.showPitchAccent;
          if (typeof s.readingAid === 'string' && s.readingAid) {
            if (s.readingAid === 'off') state.readerAid = false;
            else state.readingAidMode = s.readingAid;
          }
          syncAidToolbarButtons();
        });
        chrome.storage.local.get(['ss_pending_reader_doc'], function (pRes) {
          var docObj = pRes && pRes.ss_pending_reader_doc;
          if (docObj && docObj.text) {
            chrome.storage.local.remove('ss_pending_reader_doc');
            state.book = parseMarkdownOrText(docObj.text, (docObj.title || 'Web Article') + '.md');
            if (docObj.title) state.book.title = docObj.title;
            state.chapIdx = 0;
            renderToc();
            renderCurrentChapter();
          }
        });
      } catch (_e) {}
    }

    if ($('rdFileInput')) {
      $('rdFileInput').addEventListener('change', function (e) {
        var f = e.target.files && e.target.files[0];
        if (f) handleFileObject(f);
      });
    }
    var dz = $('rdDropZone');
    if (dz) {
      dz.addEventListener('dragover', function (e) { e.preventDefault(); dz.classList.add('dragover'); });
      dz.addEventListener('dragleave', function () { dz.classList.remove('dragover'); });
      dz.addEventListener('drop', function (e) {
        e.preventDefault();
        dz.classList.remove('dragover');
        var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
        if (f) handleFileObject(f);
      });
    }
    if ($('btnToggleToc')) {
      $('btnToggleToc').addEventListener('click', function () {
        if ($('rdSidebar')) $('rdSidebar').classList.toggle('collapsed');
      });
    }
    if ($('btnReaderPatterns')) {
      $('btnReaderPatterns').addEventListener('click', function () {
        state.patterns = !state.patterns;
        $('btnReaderPatterns').setAttribute('aria-pressed', String(state.patterns));
        $('btnReaderPatterns').classList.toggle('active', state.patterns);
        renderCurrentChapter();
      });
    }
    if ($('btnReaderAid')) {
      $('btnReaderAid').addEventListener('click', function () {
        state.readerAid = !state.readerAid;
        syncAidToolbarButtons();
        renderCurrentChapter();
      });
    }
    if ($('btnPosAid')) {
      $('btnPosAid').addEventListener('click', function () {
        state.posColors = !state.posColors;
        syncAidToolbarButtons();
        renderCurrentChapter();
      });
    }
    if ($('btnVerticalMode')) {
      $('btnVerticalMode').addEventListener('click', function () {
        state.vertical = !state.vertical;
        if ($('rdArticle')) $('rdArticle').classList.toggle('rd-vertical', state.vertical);
        $('btnVerticalMode').textContent = state.vertical ? 'Horizontal' : 'Vertical';
        saveReaderBookmark();
      });
    }
    if ($('rdArticle')) {
      $('rdArticle').addEventListener('scroll', saveReaderBookmark, { passive: true });
    }
    if ($('rdSrcLang')) {
      $('rdSrcLang').addEventListener('change', function (e) {
        state.srcLang = e.target.value;
        renderCurrentChapter();
      });
    }
    if ($('rdTlLang')) {
      $('rdTlLang').addEventListener('change', function (e) {
        state.tl = e.target.value;
        if (state.book?.pdf) state.book.chapters.forEach(function (chapter) {
          chapter.blocks.forEach(function (block) { block.tr = block.pdfTranslations?.[state.tl] || ''; });
        });
        renderCurrentChapter();
      });
    }
    if ($('btnTranslateChapter')) {
      $('btnTranslateChapter').addEventListener('click', translateActiveChapter);
    }
    $('btnPdfPreview')?.addEventListener('click', function () {
      state.pdfPreview = !state.pdfPreview;
      renderCurrentChapter();
    });
    $('btnPdfEdit')?.addEventListener('click', function () {
      state.pdfEditing = !state.pdfEditing;
      renderCurrentChapter();
    });
    $('btnPdfExport')?.addEventListener('click', exportPdf);
    if ($('btnExportMd')) {
      $('btnExportMd').addEventListener('click', function () {
        if (!state.book) return;
        var base = (state.book.title || 'study-export').replace(/[^a-zA-Z0-9_\u4e00-\u9fff-]+/g, '_');
        if (state.book.format === 'sub') {
          downloadTextFile(base + '.bilingual.srt', exportBilingualSrt(state.book.chapters[0]), 'application/x-subrip;charset=utf-8');
        } else {
          downloadTextFile(base + '.bilingual.md', exportBilingualMarkdown(state.book), 'text/markdown;charset=utf-8');
        }
      });
    }
    if ($('btnExportEpub')) {
      $('btnExportEpub').addEventListener('click', function () {
        if (!state.book) return;
        var base = (state.book.title || 'study-export').replace(/[^a-zA-Z0-9_\u4e00-\u9fff-]+/g, '_');
        var epubBytes = exportBilingualEpubBuffer(state.book);
        var blob = new Blob([epubBytes], { type: 'application/epub+zip' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = base + '.bilingual.epub';
        document.body.appendChild(a);
        a.click();
        setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 2000);
      });
    }
    if ($('btnInspClose')) {
      $('btnInspClose').addEventListener('click', function () {
        if ($('rdInspector')) $('rdInspector').hidden = true;
      });
    }
  }

  initReaderBrowserUI();

  var api = {
    parseZipEntries: parseZipEntries,
    parseEpubBuffer: parseEpubBuffer,
    parsePdfBuffer: parsePdfBuffer,
    extractBlocksFromXhtml: extractBlocksFromXhtml,
    parseMarkdownOrText: parseMarkdownOrText,
    parseSubtitleDocument: parseSubtitleDocument,
    maskInlineTokens: maskInlineTokens,
    restoreInlineTokens: restoreInlineTokens,
    exportBilingualMarkdown: exportBilingualMarkdown,
    exportBilingualSrt: exportBilingualSrt,
    buildStoredZipBuffer: buildStoredZipBuffer,
    exportBilingualEpubBuffer: exportBilingualEpubBuffer,
    crc32Bytes: crc32Bytes
  };

  root.SS_READER = api;
  if (typeof module !== 'undefined' && module && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));
