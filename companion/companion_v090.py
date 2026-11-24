"""
Clean-Room Python 3 Companion Upgrades for Subtitle Study (127.0.0.1:8787).

Implements:
1. 12-Language (+ variants + vi/th) maps (`PLAMO_LANG_CODES`, `HYMT_LANG_NAMES`,
   `EN_LANG_NAMES`) & upgraded script + diacritic + closed-class `guess_src_lang`.
2. Smart model pair guard `pick_safe_mt_model`.
3. Deterministic `/translate_batch` endpoint (`BatchSegment`, `BatchTextReq`) with
   `<seg id="N">...</seg>` packing (up to 10/chunk), `title`/`summary`/`glossary`
   hints, `temperature=0`, `chat_template_kwargs={'enable_thinking': False}` when
   `not req.think`, `<think>` stripping, and guaranteed per-segment fallback.
4. Local `/ocr` endpoint (`OcrReq`) supporting `data:image/...;base64,...` and raw
   base64 PNG/WebP/JPEG across `rapidocr_onnxruntime` -> `paddleocr` -> `pytesseract`
   with graceful actionable install guidance if none is installed.
"""

from __future__ import annotations

import base64
import binascii
import html
import importlib
import io
import json
import os
import re
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Callable

from pydantic import BaseModel, Field, StrictInt, StrictStr

try:
    from fastapi import APIRouter, FastAPI
except ImportError:  # pragma: no cover - lightweight fallback if FastAPI absent
    APIRouter = None  # type: ignore[assignment]
    FastAPI = None  # type: ignore[assignment]


# ---------------------------------------------------------------------------
# 1. 12-Language Maps (+ zh-hans/zh-hant/fil variants + vi, th) & guess_src_lang
# ---------------------------------------------------------------------------

PLAMO_LANG_CODES: dict[str, str] = {
    "en": "English",
    "zh": "Chinese",
    "zh-hans": "Chinese",
    "zh-hant": "Traditional Chinese",
    "yue": "Cantonese",
    "ja": "Japanese",
    "ko": "Korean",
    "es": "Spanish",
    "fr": "French",
    "de": "German",
    "pt": "Portuguese",
    "it": "Italian",
    "ru": "Russian",
    "tl": "Tagalog",
    "fil": "Filipino",
    "vi": "Vietnamese",
    "th": "Thai",
}

HYMT_LANG_NAMES: dict[str, str] = {
    "en": "英语",
    "zh": "简体中文",
    "zh-hans": "简体中文",
    "zh-hant": "繁体中文",
    "yue": "粤语",
    "ja": "日语",
    "ko": "韩语",
    "es": "西班牙语",
    "fr": "法语",
    "de": "德语",
    "pt": "葡萄牙语",
    "it": "意大利语",
    "ru": "俄语",
    "tl": "他加禄语",
    "fil": "菲律宾语",
    "vi": "越南语",
    "th": "泰语",
}

EN_LANG_NAMES: dict[str, str] = {
    "en": "English",
    "zh": "Simplified Chinese",
    "zh-hans": "Simplified Chinese",
    "zh-hant": "Traditional Chinese",
    "yue": "Cantonese",
    "ja": "Japanese",
    "ko": "Korean",
    "es": "Spanish",
    "fr": "French",
    "de": "German",
    "pt": "Portuguese",
    "it": "Italian",
    "ru": "Russian",
    "tl": "Tagalog",
    "fil": "Filipino",
    "vi": "Vietnamese",
    "th": "Thai",
}


def normalize_lang_code(code: str) -> str:
    """Normalizes BCP-47 language tags to canonical companion keys."""
    raw = (code or "").strip().lower().replace("_", "-")
    if not raw:
        return ""
    if raw in EN_LANG_NAMES:
        return raw
    if raw in ("zh-tw", "zh-hk", "zh-mo", "zh-cht"):
        return "zh-hant"
    if raw in ("zh-cn", "zh-sg", "zh-chs"):
        return "zh-hans"
    base = raw.split("-", 1)[0]
    return base if base in EN_LANG_NAMES else raw


def lang_base(code: str) -> str:
    """Extracts primary base language tag ('zh-hant' -> 'zh', 'pt-BR' -> 'pt')."""
    raw = (code or "").strip().lower().replace("_", "-")
    if not raw:
        return ""
    return raw.split("-", 1)[0]


# Script detection patterns (checked in priority order: Kana -> Hangul -> CJK -> Cyrillic)
_KANA_RE = re.compile(r"[\u3040-\u309f\u30a0-\u30ff\uff66-\uff9f]")
_HANGUL_RE = re.compile(r"[\uac00-\ud7af\u1100-\u11ff\u3130-\u318f]")
_CJK_RE = re.compile(r"[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]")
_YUE_CHARS_RE = re.compile(r"[係唔嘅咁咗嚟冇睇畀諗點樣乜嘢]")
_CYRILLIC_RE = re.compile(r"[\u0400-\u04ff]")

# Unicode letter boundary helpers (treats accented letters as letters, digits/_ as non-letters)
_LB = r"(?<![^\W\d_])"
_RB = r"(?![^\W\d_])"


def _compile_word_re(
    words: tuple[str, ...],
    prefix_elisions: tuple[str, ...] = (),
) -> re.Pattern[str]:
    parts: list[str] = []
    if words:
        escaped = "|".join(re.escape(w) for w in words)
        parts.append(f"{_LB}(?:{escaped}){_RB}")
    if prefix_elisions:
        elided = "|".join(re.escape(p) for p in prefix_elisions)
        parts.append(f"{_LB}(?:{elided})(?=[^\\W\\d_])")
    return re.compile("|".join(parts), re.IGNORECASE)


_LATIN_DIACRITIC_RULES: dict[str, tuple[re.Pattern[str], float]] = {
    "de": (re.compile(r"[äöüß]", re.IGNORECASE), 2.2),
    # 1.5 so single shared chars (e.g. 'ù' in Italian 'più', 'ê' in Portuguese 'você')
    # do not override exact closed-class word hits (+2.0) in sibling Romance languages.
    "fr": (re.compile(r"[çœæêàùûî]", re.IGNORECASE), 1.5),
    "es": (re.compile(r"[ñ¿¡]", re.IGNORECASE), 2.5),
    "pt": (re.compile(r"[ãõ]", re.IGNORECASE), 2.5),
}

_LATIN_WORD_RULES: dict[str, re.Pattern[str]] = {
    "de": _compile_word_re(
        ("nicht", "ist", "sich", "und", "ein", "eine", "auf", "mit", "für", "dass")
    ),
    "fr": _compile_word_re(
        ("les", "des", "une", "pas", "est", "dans", "pour", "avec", "plus", "c'est", "n'est"),
        prefix_elisions=("qu'",),
    ),
    "es": _compile_word_re(
        ("los", "las", "una", "pero", "para", "como", "más", "está", "qué", "por", "con")
    ),
    "pt": _compile_word_re(
        ("não", "uma", "com", "são", "para", "mais", "está", "você", "isso", "pelo")
    ),
    "it": _compile_word_re(
        ("gli", "sono", "della", "nella", "che", "non", "una", "più", "questo", "anche", "perché")
    ),
    "tl": _compile_word_re(
        ("ang", "mga", "nang", "hindi", "siya", "nila", "iyon", "ito", "kami", "tayo", "kasi", "lang", "naman")
    ),
}

# Secondary closed-class & spoken discourse markers for short diacritic-free cues
_LATIN_SECONDARY_WORDS: dict[str, re.Pattern[str]] = {
    "de": _compile_word_re(
        ("ich", "wir", "sind", "habe", "oder", "aber", "wenn", "noch", "schon", "auch", "danke", "bitte")
    ),
    "fr": _compile_word_re(
        ("mais", "nous", "vous", "sont", "très", "même", "être", "chez", "donc", "jamais", "oui", "bonjour", "merci"),
        prefix_elisions=("j'",),
    ),
    "es": _compile_word_re(
        ("muy", "hay", "tiene", "también", "aquí", "dónde", "quién", "porque", "todo", "hola", "gracias")
    ),
    "pt": _compile_word_re(
        ("muito", "então", "também", "ainda", "dele", "dela", "eles", "elas", "pela", "obrigado", "obrigada")
    ),
    "it": _compile_word_re(
        ("molto", "però", "così", "può", "grazie", "questi", "questa", "tutto", "tutti", "sempre", "ciao", "buongiorno")
    ),
    "tl": _compile_word_re(
        ("ako", "ikaw", "niya", "namin", "natin", "kayo", "sila", "wala", "huwag", "talaga", "bakit", "paano", "salamat", "kumusta")
    ),
}

_EN_GUARD_WORDS = _compile_word_re(
    (
        "the", "and", "you", "that", "this", "with", "have", "from", "they",
        "would", "there", "their", "what", "when", "your", "about", "which",
        "could", "should", "because", "don't", "doesn't", "didn't", "isn't",
        "aren't", "won't", "can't", "i'm", "you're", "we're", "they're", "it's",
    )
)


def guess_src_lang(text: str) -> str:
    """
    Fast deterministic source-language detector across the 12 core Subtitle Study languages:
      - Kana -> 'ja'
      - Hangul -> 'ko'
      - CJK -> 'zh-hant' if Cantonese-specific characters appear, else 'zh-hans'
      - Cyrillic -> 'ru'
      - Latin -> scores diacritics + closed-class function words for
        'de', 'fr', 'es', 'pt', 'it', 'tl', defaulting to 'en'.
    """
    if not text or not text.strip():
        return "en"

    if _KANA_RE.search(text):
        return "ja"
    if _HANGUL_RE.search(text):
        return "ko"
    if _CJK_RE.search(text):
        if _YUE_CHARS_RE.search(text):
            return "zh-hant"
        return "zh-hans"
    if _CYRILLIC_RE.search(text):
        return "ru"

    # Normalize curly apostrophes so elisions ("c’est", "qu’il", "don’t") match cleanly
    norm = text.replace("\u2019", "'").replace("\u02bc", "'").replace("\u2018", "'")

    scores: dict[str, float] = {
        lang: 0.0 for lang in ("de", "fr", "es", "pt", "it", "tl")
    }
    for lang, (dia_re, weight) in _LATIN_DIACRITIC_RULES.items():
        hits = len(dia_re.findall(norm))
        if hits:
            scores[lang] += hits * weight

    for lang, word_re in _LATIN_WORD_RULES.items():
        hits = len(word_re.findall(norm))
        if hits:
            scores[lang] += hits * 2.0

    for lang, sec_re in _LATIN_SECONDARY_WORDS.items():
        hits = len(sec_re.findall(norm))
        if hits:
            scores[lang] += hits * 1.2

    en_score = len(_EN_GUARD_WORDS.findall(norm)) * 2.0
    best_lang, best_score = max(scores.items(), key=lambda kv: kv[1])
    if best_score <= 0.0 or best_score <= en_score:
        return "en"
    return best_lang


# ---------------------------------------------------------------------------
# 2. Smart Model Pair Guard: pick_safe_mt_model
# ---------------------------------------------------------------------------

_LMT_ALLOWED_BASES = frozenset({"en", "zh", "yue"})
_TAGALOG_BASES = frozenset({"tl", "fil"})
_SUB_1B_MODELS = frozenset({"lmt-0.6b", "plamo-0.8b"})
_TAGALOG_PREFERRED_MODELS: tuple[str, ...] = ("translategemma-4b", "plamo-2b")
_LMT_FALLBACK_ORDER: tuple[str, ...] = (
    "plamo-0.8b",
    "hy-mt-1.8b",
    "translategemma-4b",
    "index-2b",
    "plamo-2b",
)


def pick_safe_mt_model(
    requested_key: str,
    sl: str,
    tl: str,
    available_keys: set[str],
) -> str:
    """
    Guards translation model selection against unsupported language pairs:
      1. When 'tl' or 'fil' is source or target and `requested_key` is sub-1B
         ('lmt-0.6b', 'plamo-0.8b'), upgrades to 'translategemma-4b' or 'plamo-2b'
         if present in `available_keys`.
      2. Blocks 'lmt-0.6b' whenever neither `sl` nor `tl` has base in {'en', 'zh', 'yue'}
         (NiuTrans LMT-60-0.6B only trained X<->zh and X<->en), auto-switching to the
         first available model in ['plamo-0.8b', 'hy-mt-1.8b', 'translategemma-4b',
         'index-2b', 'plamo-2b'].
    """
    chosen = (requested_key or "").strip()
    sl_b = lang_base(sl)
    tl_b = lang_base(tl)
    avail = set(available_keys or ())

    # Rule 1: Tagalog/Filipino sub-1B upgrade preference
    if (sl_b in _TAGALOG_BASES or tl_b in _TAGALOG_BASES) and chosen in _SUB_1B_MODELS:
        for candidate in _TAGALOG_PREFERRED_MODELS:
            if candidate in avail:
                chosen = candidate
                break

    # Rule 2: Block lmt-0.6b when neither side is en/zh/yue
    if (
        chosen == "lmt-0.6b"
        and sl_b not in _LMT_ALLOWED_BASES
        and tl_b not in _LMT_ALLOWED_BASES
    ):
        for candidate in _LMT_FALLBACK_ORDER:
            if candidate in avail:
                chosen = candidate
                break

    return chosen


# ---------------------------------------------------------------------------
# 3. /translate_batch Models, Prompt Packing, <seg id> Parser & Fallback
# ---------------------------------------------------------------------------

MAX_BATCH_SEGMENTS = 10


class BatchSegment(BaseModel):
    # StrictInt | StrictStr preserves exact JS int vs str IDs across Pydantic v1 & v2
    id: StrictInt | StrictStr
    text: str


class BatchTextReq(BaseModel):
    segments: list[BatchSegment]
    target_lang: str = "en"
    source_lang: str = ""
    title: str = ""
    summary: str = ""
    glossary: dict[str, str] = Field(default_factory=dict)
    model: str = ""
    device: str = ""
    think: bool = False


_THINK_BLOCK_RE = re.compile(r"<think\b[^>]*>.*?(?:</think>|$)", re.IGNORECASE | re.DOTALL)
_CODE_FENCE_RE = re.compile(r"^```(?:xml|html|text)?\s*|\s*```$", re.IGNORECASE)
# Negative lookahead (?!</?seg\b) ensures an unclosed <seg id="1"> never swallows <seg id="2">...</seg>
_SEG_CLOSED_RE = re.compile(
    r"<seg\s+id=[\"']?([^\"'>\s]+)[\"']?\s*>((?:(?!</?seg\b).)*?)</seg\s*>",
    re.IGNORECASE | re.DOTALL,
)
_SEG_UNCLOSED_RE = re.compile(
    r"<seg\s+id=[\"']?([^\"'>\s]+)[\"']?\s*>((?:(?!</?seg\b).)+)",
    re.IGNORECASE | re.DOTALL,
)


def _escape_seg_text(text: str) -> str:
    return (
        text.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
    )


def format_seg_batch_xml(indexed_texts: list[tuple[str, str]]) -> str:
    """Packs `(batch_idx_str, text)` pairs into deterministic `<seg id="N">...</seg>` lines."""
    return "\n".join(
        f'<seg id="{idx}">{_escape_seg_text(txt)}</seg>'
        for idx, txt in indexed_texts
    )


def build_batch_messages(
    indexed_texts: list[tuple[str, str]],
    sl: str,
    tl: str,
    title: str = "",
    summary: str = "",
    glossary: dict[str, str] | None = None,
) -> list[dict[str, str]]:
    """
    Builds a deterministic chat prompt for up to 10 subtitle segments.
    Context metadata (title, summary, sorted glossary) is placed ahead of `<seg>`
    tags to maximize prefix KV-cache reuse across consecutive batches of a video.
    """
    src_name = EN_LANG_NAMES.get(normalize_lang_code(sl), sl or "Source")
    tgt_name = EN_LANG_NAMES.get(normalize_lang_code(tl), tl or "English")

    system_lines = [
        f"You are a precise subtitle translator from {src_name} to {tgt_name}.",
        "Translate every <seg id=\"N\">...</seg> line naturally for spoken media while preserving speaker tone.",
        "Output ONLY the matching <seg id=\"N\">translated text</seg> tags with the exact same id attributes.",
        "Never merge, split, renumber, omit, or explain segments.",
    ]
    if tl == 'zh-hant':
        system_lines.append('請用繁體中文書寫每一段譯文，保留繁體字形。')
    elif tl == 'zh-hans':
        system_lines.append('请用简体中文书写每一段译文，保留简体字形。')

    context_blocks: list[str] = []
    if title and title.strip():
        context_blocks.append(f"Video Title: {title.strip()}")
    if summary and summary.strip():
        context_blocks.append(f"Context Summary: {summary.strip()}")
    if glossary:
        clean_glossary = {
            str(k).strip(): str(v).strip()
            for k, v in sorted(glossary.items(), key=lambda kv: str(kv[0]))
            if str(k).strip() and str(v).strip()
        }
        if clean_glossary:
            context_blocks.append(
                "Glossary Hints (prefer these exact translations): "
                + json.dumps(clean_glossary, ensure_ascii=False, sort_keys=True)
            )

    user_parts: list[str] = []
    if context_blocks:
        user_parts.append("\n".join(context_blocks))
    user_parts.append(format_seg_batch_xml(indexed_texts))

    return [
        {"role": "system", "content": "\n".join(system_lines)},
        {"role": "user", "content": "\n\n".join(user_parts)},
    ]


def build_chat_completion_payload(
    messages: list[dict[str, str]],
    model_id: str,
    think: bool = False,
    max_tokens: int = 2048,
) -> dict[str, Any]:
    """Builds the deterministic OpenAI/llama-server chat completion request payload."""
    payload: dict[str, Any] = {
        "model": model_id,
        "messages": messages,
        "temperature": 0,
        "max_tokens": max_tokens,
        "stream": False,
    }
    if not think:
        payload["chat_template_kwargs"] = {"enable_thinking": False}
    return payload


def parse_seg_batch_output(raw_output: str, expected_ids: list[str]) -> dict[str, str]:
    """
    Cleanly parses `<seg id="N">...</seg>` outputs from an LLM response:
      - Strips `<think>...</think>` blocks first so echoed tags inside reasoning never match.
      - Strips optional markdown code fences.
      - Recovers unclosed `<seg id="N">...` tags without swallowing subsequent `<seg>` lines.
      - Unescapes XML entities (`&amp;`, `&lt;`, `&gt;`).
    Returns `{id_str: translated_text}` for valid non-empty matches among `expected_ids`.
    """
    if not raw_output:
        return {}

    cleaned = _THINK_BLOCK_RE.sub("", raw_output).strip()
    cleaned = _CODE_FENCE_RE.sub("", cleaned).strip()

    expected_set = set(expected_ids)
    parsed: dict[str, str] = {}

    for match in _SEG_CLOSED_RE.finditer(cleaned):
        seg_id = match.group(1).strip()
        if seg_id in expected_set and seg_id not in parsed:
            val = html.unescape(match.group(2)).strip()
            if val:
                parsed[seg_id] = val

    if len(parsed) < len(expected_set):
        for match in _SEG_UNCLOSED_RE.finditer(cleaned):
            seg_id = match.group(1).strip()
            if seg_id in expected_set and seg_id not in parsed:
                val = html.unescape(match.group(2)).strip()
                if val:
                    parsed[seg_id] = val

    return parsed


BatchChatCaller = Callable[[dict[str, Any], BatchTextReq, str], str]
SingleTranslateCaller = Callable[[str, str, str, str, BatchTextReq], str]


def _default_llama_chat_caller(
    payload: dict[str, Any],
    _req: BatchTextReq,
    _model_key: str,
) -> str:
    """Default local llama-server OpenAI-compatible HTTP client."""
    llama_url = os.environ.get(
        "SS_LLAMA_CHAT_URL", "http://127.0.0.1:8080/v1/chat/completions"
    )
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    http_req = urllib.request.Request(
        llama_url,
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(http_req, timeout=60) as resp:
        body = json.loads(resp.read().decode("utf-8"))
    choices = body.get("choices") or []
    if not choices:
        return ""
    msg = choices[0].get("message") or {}
    return str(msg.get("content") or "")


def _default_single_translate(
    text: str,
    sl: str,
    tl: str,
    model_key: str,
    req: BatchTextReq,
    chat_caller: BatchChatCaller = _default_llama_chat_caller,
) -> str:
    """Single-segment deterministic fallback translation when a batch `<seg id>` is missing."""
    src_name = EN_LANG_NAMES.get(normalize_lang_code(sl), sl or "Source")
    tgt_name = EN_LANG_NAMES.get(normalize_lang_code(tl), tl or "English")
    ctx_parts: list[str] = []
    if req.title.strip():
        ctx_parts.append(f"Title: {req.title.strip()}")
    if req.glossary:
        ctx_parts.append(
            "Glossary: " + json.dumps(req.glossary, ensure_ascii=False, sort_keys=True)
        )
    sys_prompt = (
        f"Translate the subtitle segment from {src_name} to {tgt_name}. "
        "Output ONLY the translated text with no tags or commentary."
    )
    if ctx_parts:
        sys_prompt += "\n" + " | ".join(ctx_parts)
    payload = build_chat_completion_payload(
        messages=[
            {"role": "system", "content": sys_prompt},
            {"role": "user", "content": text},
        ],
        model_id=model_key,
        think=req.think,
        max_tokens=512,
    )
    raw = chat_caller(payload, req, model_key)
    cleaned = _THINK_BLOCK_RE.sub("", raw or "").strip()
    m = _SEG_CLOSED_RE.search(cleaned)
    if m:
        return html.unescape(m.group(2)).strip()
    return cleaned


def execute_translate_batch(
    req: BatchTextReq,
    *,
    available_keys: set[str] | None = None,
    default_model: str = "hy-mt-1.8b",
    chat_caller: BatchChatCaller | None = None,
    single_caller: SingleTranslateCaller | None = None,
    native_workers: int = 0,
) -> dict[str, Any]:
    """
    Core implementation of `/translate_batch`:
      - Auto-detects `source_lang` via `guess_src_lang` if omitted or `'auto'`.
      - Applies `pick_safe_mt_model` guard.
      - Packs non-empty segments in chunks of up to 10 `<seg id="0..9">` tags.
      - Uses individual native prompts when the model lacks XML batch support.
      - Falls back per-segment for any missing/malformed `id` so output length and IDs
        100% match `req.segments` in exact order.
    """
    avail = (
        set(available_keys)
        if available_keys is not None
        else {"lmt-0.6b", "plamo-0.8b", "hy-mt-1.8b", "translategemma-4b", "plamo-2b"}
    )
    tl = normalize_lang_code(req.target_lang) or "en"
    raw_sl = normalize_lang_code(req.source_lang)
    if not raw_sl or raw_sl == "auto":
        joined_sample = " ".join(s.text for s in req.segments if s.text and s.text.strip())
        sl = guess_src_lang(joined_sample) if joined_sample else "en"
    else:
        sl = raw_sl

    requested_model = (req.model or "").strip() or default_model
    effective_model = pick_safe_mt_model(requested_model, sl, tl, avail)

    if not req.segments:
        return {
            "ok": True,
            "model": effective_model,
            "requested_model": requested_model,
            "source_lang": sl,
            "target_lang": tl,
            "segments": [],
            "translations": [],
            "fallbacks": 0,
        }

    batch_fn = chat_caller or _default_llama_chat_caller
    single_fn: SingleTranslateCaller = single_caller or (
        lambda txt, s_l, t_l, m_k, r: _default_single_translate(
            txt, s_l, t_l, m_k, r, chat_caller=batch_fn
        )
    )

    resolved_texts: list[str] = [""] * len(req.segments)
    non_empty_positions: list[int] = [
        idx for idx, seg in enumerate(req.segments) if seg.text and seg.text.strip()
    ]
    fallback_count = 0
    failed_ids = []

    def translate_single(pos: int) -> str:
        try:
            return (single_fn(req.segments[pos].text.strip(), sl, tl, effective_model, req) or "").strip()
        except Exception:
            return ""

    for start in range(0, len(non_empty_positions), MAX_BATCH_SEGMENTS):
        chunk_positions = non_empty_positions[start : start + MAX_BATCH_SEGMENTS]
        if native_workers:
            with ThreadPoolExecutor(max_workers=min(native_workers, len(chunk_positions))) as executor:
                translations = list(executor.map(translate_single, chunk_positions))
        else:
            indexed_pairs = [
                (str(local_idx), req.segments[pos].text.strip())
                for local_idx, pos in enumerate(chunk_positions)
            ]
            messages = build_batch_messages(
                indexed_pairs, sl=sl, tl=tl,
                title=req.title, summary=req.summary, glossary=req.glossary,
            )
            payload = build_chat_completion_payload(
                messages=messages, model_id=effective_model, think=req.think,
            )
            try:
                raw_resp = batch_fn(payload, req, effective_model)
                parsed_map = parse_seg_batch_output(raw_resp, [pair[0] for pair in indexed_pairs])
            except Exception:
                parsed_map = {}
            translations = []
            for local_idx, pos in enumerate(chunk_positions):
                translated = parsed_map.get(str(local_idx), "").strip()
                if not translated:
                    fallback_count += 1
                    translated = translate_single(pos)
                translations.append(translated)

        for pos, translated in zip(chunk_positions, translations):
            if not translated:
                failed_ids.append(req.segments[pos].id)
            resolved_texts[pos] = translated or req.segments[pos].text

    out_segments = [
        {"id": seg.id, "text": trans}
        for seg, trans in zip(req.segments, resolved_texts)
    ]
    return {
        "ok": True,
        "model": effective_model,
        "requested_model": requested_model,
        "source_lang": sl,
        "target_lang": tl,
        "segments": out_segments,
        "translations": resolved_texts,
        "fallbacks": fallback_count,
        "failed_ids": failed_ids,
    }


# ---------------------------------------------------------------------------
# 4. Local /ocr Endpoint Implementation (RapidOCR -> PaddleOCR -> pytesseract)
# ---------------------------------------------------------------------------


class OcrReq(BaseModel):
    subtitle_band: bool = False
    image_b64: str = ""
    image: str = ""
    lang: str = "auto"


_NO_OCR_INSTALL_MSG = (
    "No local OCR engine installed (pip install rapidocr-onnxruntime). "
    "Alternatives: pip install paddleocr or pip install pytesseract + tesseract-ocr."
)

_PADDLE_LANG_MAP: dict[str, str] = {
    "auto": "ch",
    "en": "en",
    "zh": "ch",
    "zh-hans": "ch",
    "zh-hant": "chinese_cht",
    "yue": "chinese_cht",
    "ja": "japan",
    "ko": "korean",
    "ru": "ru",
    "fr": "fr",
    "de": "german",
    "es": "latin",
    "pt": "latin",
    "it": "latin",
    "tl": "latin",
    "fil": "latin",
    "vi": "latin",
}

_TESS_LANG_MAP: dict[str, str] = {
    "auto": "eng",
    "en": "eng",
    "zh": "chi_sim",
    "zh-hans": "chi_sim",
    "zh-hant": "chi_tra",
    "yue": "chi_tra",
    "ja": "jpn",
    "ko": "kor",
    "ru": "rus",
    "es": "spa",
    "fr": "fra",
    "de": "deu",
    "pt": "por",
    "it": "ita",
    "tl": "tgl",
    "fil": "tgl",
    "vi": "vie",
    "th": "tha",
}

_OCR_INSTANCE_CACHE: dict[str, Any] = {}


def decode_image_b64(image_b64: str) -> bytes:
    """
    Decodes `data:image/...;base64,...` URIs or raw base64/URL-safe base64 strings
    and validates PNG, WebP, or JPEG image payloads.
    """
    raw = (image_b64 or "").strip()
    if not raw:
        raise ValueError("Empty image_b64 payload.")

    if raw.lower().startswith("data:"):
        comma_idx = raw.find(",")
        if comma_idx == -1:
            raise ValueError("Malformed data:image URI (missing comma separator).")
        raw = raw[comma_idx + 1 :].strip()

    compact = re.sub(r"\s+", "", raw).replace("-", "+").replace("_", "/")
    pad = (-len(compact)) % 4
    if pad:
        compact += "=" * pad

    try:
        img_bytes = base64.b64decode(compact, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise ValueError(f"Invalid base64 image encoding: {exc}") from exc

    if len(img_bytes) < 8:
        raise ValueError("Decoded image payload is too short to be a valid image.")

    is_png = img_bytes.startswith(b"\x89PNG\r\n\x1a\n")
    is_jpeg = img_bytes.startswith(b"\xff\xd8\xff")
    is_webp = img_bytes[:4] == b"RIFF" and img_bytes[8:12] == b"WEBP"
    if not (is_png or is_jpeg or is_webp):
        try:
            from PIL import Image

            with Image.open(io.BytesIO(img_bytes)) as im:
                im.verify()
        except ImportError as exc:
            raise ValueError(
                "Unsupported image header (expected PNG, WebP, or JPEG)."
            ) from exc
        except Exception as exc:
            raise ValueError(f"Invalid or corrupt image bytes: {exc}") from exc

    return img_bytes


def _poly_to_norm_box(poly: Any, img_w: int, img_h: int) -> list[int] | None:
    if not img_w or not img_h or not isinstance(poly, (list, tuple)) or len(poly) < 4:
        return None
    try:
        xs = [float(pt[0]) for pt in poly if isinstance(pt, (list, tuple)) and len(pt) >= 2]
        ys = [float(pt[1]) for pt in poly if isinstance(pt, (list, tuple)) and len(pt) >= 2]
        if not xs or not ys:
            return None
        x0 = max(0, min(999, int(round(min(xs) * 1000.0 / img_w))))
        y0 = max(0, min(999, int(round(min(ys) * 1000.0 / img_h))))
        x1 = max(x0 + 1, min(1000, int(round(max(xs) * 1000.0 / img_w))))
        y1 = max(y0 + 1, min(1000, int(round(max(ys) * 1000.0 / img_h))))
        return [x0, y0, x1 - x0, y1 - y0]
    except Exception:
        return None


_SUBTITLE_MODELS = {
    'ko': 'kor', 'ja': 'jpn', 'zh-hant': 'chi_tra', 'zh-tw': 'chi_tra',
    'zh-hk': 'chi_tra', 'yue': 'chi_tra',
}


def _run_subtitle_model(img_bytes: bytes, language: str) -> list[str]:
    import tesserocr
    from PIL import Image

    model = _SUBTITLE_MODELS[language]
    folder = os.path.join(os.path.dirname(__file__), 'models', 'tessdata')
    with Image.open(io.BytesIO(img_bytes)) as frame:
        text = tesserocr.image_to_text(frame, path=folder, lang=model, psm=tesserocr.PSM.SINGLE_BLOCK)
    return [line.strip() for line in text.splitlines() if line.strip()]


_SUBTITLE_OCR_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'models', 'ocr_v5')


def _run_subtitle_v5(img_bytes: bytes, _lang: str) -> tuple[list[str], list[dict[str, Any]]]:
    """PP-OCRv5 subtitle-band reader (subtitle_ocr.py); handles Cantonese characters v5 lacks."""
    if not os.path.isfile(os.path.join(_SUBTITLE_OCR_DIR, 'droid_han_glyphs.npz')):
        raise ImportError('subtitle OCR models missing')
    ocr = _OCR_INSTANCE_CACHE.get('subtitle_v5')
    if ocr is None:
        import importlib.util
        spec = importlib.util.spec_from_file_location(
            'subtitle_ocr', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'subtitle_ocr.py'))
        if spec is None or spec.loader is None:
            raise ImportError('subtitle_ocr.py missing')
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        ocr = mod.SubtitleOCR(_SUBTITLE_OCR_DIR)
        _OCR_INSTANCE_CACHE['subtitle_v5'] = ocr
    from PIL import Image

    with Image.open(io.BytesIO(img_bytes)) as im:
        img_w, img_h = im.size
    lines, raw_regions = ocr(img_bytes)
    if not lines:
        raise ValueError('no subtitle rows found')  # let the general engines try
    regions: list[dict[str, Any]] = []
    for r in raw_regions:
        x0, y0, x1, y1 = r['box']
        box = _poly_to_norm_box([[x0, y0], [x1, y0], [x1, y1], [x0, y1]], img_w, img_h)
        if box and r.get('text'):
            regions.append({'box': box, 'text': r['text']})
    return lines, regions


def _run_rapidocr(img_bytes: bytes, _lang: str) -> tuple[list[str], list[dict[str, Any]]]:
    mod = importlib.import_module("rapidocr_onnxruntime")
    from PIL import Image

    with Image.open(io.BytesIO(img_bytes)) as im:
        img_w, img_h = im.size
    ocr = _OCR_INSTANCE_CACHE.get("rapidocr")
    if ocr is None:
        ocr = mod.RapidOCR()
        _OCR_INSTANCE_CACHE["rapidocr"] = ocr
    result, _elapse = ocr(img_bytes)
    lines: list[str] = []
    regions: list[dict[str, Any]] = []
    for item in result or []:
        if isinstance(item, (list, tuple)) and len(item) >= 2:
            txt = str(item[1]).strip()
            if txt:
                lines.append(txt)
                box = _poly_to_norm_box(item[0], img_w, img_h)
                if box:
                    regions.append({"box": box, "text": txt})
    return lines, regions


def _run_paddleocr(img_bytes: bytes, lang: str) -> tuple[list[str], list[dict[str, Any]]]:
    paddle_mod = importlib.import_module("paddleocr")
    np = importlib.import_module("numpy")
    from PIL import Image

    norm_lang = normalize_lang_code(lang) or "auto"
    p_lang = _PADDLE_LANG_MAP.get(norm_lang, "en")
    cache_key = f"paddleocr:{p_lang}"
    ocr = _OCR_INSTANCE_CACHE.get(cache_key)
    if ocr is None:
        ocr = paddle_mod.PaddleOCR(use_angle_cls=False, lang=p_lang, show_log=False)
        _OCR_INSTANCE_CACHE[cache_key] = ocr

    with Image.open(io.BytesIO(img_bytes)) as im:
        img_w, img_h = im.size
        arr = np.asarray(im.convert("RGB"))

    raw_res = ocr.ocr(arr, cls=False)
    lines: list[str] = []
    regions: list[dict[str, Any]] = []
    for page in raw_res or []:
        if isinstance(page, dict) and "rec_texts" in page:
            polys = page.get("rec_polys") or page.get("dt_polys") or []
            for idx_t, txt in enumerate(page.get("rec_texts") or []):
                s_txt = str(txt).strip()
                if s_txt:
                    lines.append(s_txt)
                    if idx_t < len(polys):
                        box = _poly_to_norm_box(polys[idx_t], img_w, img_h)
                        if box:
                            regions.append({"box": box, "text": s_txt})
        elif isinstance(page, (list, tuple)):
            for det in page:
                if (
                    isinstance(det, (list, tuple))
                    and len(det) >= 2
                    and isinstance(det[1], (list, tuple))
                    and det[1]
                ):
                    txt = str(det[1][0]).strip()
                    if txt:
                        lines.append(txt)
                        box = _poly_to_norm_box(det[0], img_w, img_h)
                        if box:
                            regions.append({"box": box, "text": txt})
    return lines, regions


def _run_pytesseract(img_bytes: bytes, lang: str) -> list[str]:
    pytesseract = importlib.import_module("pytesseract")
    from PIL import Image

    norm_lang = normalize_lang_code(lang) or "auto"
    t_lang = _TESS_LANG_MAP.get(norm_lang, "eng")

    with Image.open(io.BytesIO(img_bytes)) as im:
        rgb = im.convert("RGB")
        try:
            raw_text = pytesseract.image_to_string(rgb, lang=t_lang)
        except Exception as exc:
            if exc.__class__.__name__ == "TesseractNotFoundError":
                raise ImportError(str(exc)) from exc
            raw_text = pytesseract.image_to_string(rgb)

    return [ln.strip() for ln in (raw_text or "").splitlines() if ln.strip()]


DEFAULT_OCR_BACKENDS: tuple[tuple[str, Callable[[bytes, str], Any]], ...] = (
    ("rapidocr_onnxruntime", _run_rapidocr),
    ("paddleocr", _run_paddleocr),
    ("pytesseract", _run_pytesseract),
)


def cluster_ocr_regions(regions: list[dict[str, Any]], lang: str = "auto") -> list[dict[str, Any]]:
    """
    Groups spatially close OCR line regions into comic/manga speech bubbles (mokuro-style)
    and orders bubbles RTL (right-to-left top-to-bottom) for vertical CJK or LTR otherwise.
    """
    if not regions or len(regions) <= 1:
        return [dict(r) for r in regions]

    norm_l = normalize_lang_code(lang) or "auto"
    n = len(regions)
    adj: list[list[int]] = [[] for _ in range(n)]
    boxes = [r.get("box") or [0, 0, 100, 30] for r in regions]
    for i in range(n):
        x1, y1, w1, h1 = boxes[i]
        r1, b1 = x1 + w1, y1 + h1
        s1 = min(w1, h1)
        for j in range(i + 1, n):
            x2, y2, w2, h2 = boxes[j]
            r2, b2 = x2 + w2, y2 + h2
            pad = max(10, min(32, min(s1, w2, h2) * 0.6))
            if not (r1 + pad < x2 or r2 + pad < x1 or b1 + pad < y2 or b2 + pad < y1):
                adj[i].append(j)
                adj[j].append(i)

    seen = [False] * n
    bubbles: list[dict[str, Any]] = []
    for i in range(n):
        if seen[i]:
            continue
        comp: list[int] = []
        stack = [i]
        seen[i] = True
        while stack:
            u = stack.pop()
            comp.append(u)
            for v in adj[u]:
                if not seen[v]:
                    seen[v] = True
                    stack.append(v)

        xs = [boxes[k][0] for k in comp]
        ys = [boxes[k][1] for k in comp]
        rs = [boxes[k][0] + boxes[k][2] for k in comp]
        bs = [boxes[k][1] + boxes[k][3] for k in comp]
        bx, by = min(xs), min(ys)
        bw, bh = max(1, max(rs) - bx), max(1, max(bs) - by)
        vertical_cjk = (norm_l in ("ja", "zh", "yue")) and bh >= bw * 1.15
        if vertical_cjk:
            comp.sort(key=lambda k: (-round((boxes[k][0] + boxes[k][2] / 2) / 30), boxes[k][1]))
        else:
            comp.sort(key=lambda k: (boxes[k][1], boxes[k][0]))
        joiner = "" if norm_l in ("ja", "zh", "yue") else " "
        txt = joiner.join(str(regions[k].get("text") or "").strip() for k in comp if regions[k].get("text")).strip()
        if txt:
            bubbles.append({"box": [bx, by, bw, bh], "text": txt, "lines": len(comp)})

    is_cjk_rtl = norm_l in ("ja", "zh", "yue")
    if is_cjk_rtl:
        bubbles.sort(key=lambda b: (-round(b["box"][0] / 120), b["box"][1]))
    else:
        bubbles.sort(key=lambda b: (b["box"][1], b["box"][0]))
    return bubbles


def execute_local_ocr(
    req: OcrReq,
    *,
    backends: tuple[tuple[str, Callable[[bytes, str], Any]], ...] | None = None,
) -> dict[str, Any]:
    """
    Decodes base64 PNG/WebP/JPEG and tries local OCR engines in strict priority order:
      (a) rapidocr_onnxruntime -> (b) paddleocr -> (c) pytesseract.
    Returns `text`, `lines`, and optional normalized [0..1000] `regions` + clustered `bubbles`.
    """
    try:
        img_bytes = decode_image_b64(req.image_b64 or req.image)
    except ValueError as exc:
        return {"ok": False, "error": str(exc)}

    chain = backends if backends is not None else DEFAULT_OCR_BACKENDS
    lang = req.lang.lower().replace('_','-')
    if lang.startswith(('ko-', 'ja-', 'yue-')):
        lang = lang.split('-')[0]
    if backends is None and req.subtitle_band and lang in _SUBTITLE_MODELS:
        chain = ((f'tesseract-{_SUBTITLE_MODELS[lang]}', _run_subtitle_model),) + chain
    if backends is None and req.subtitle_band:
        chain = (('ppocr-v5-subtitle', _run_subtitle_v5),) + chain
    runtime_errors: list[str] = []

    for engine_name, runner in chain:
        try:
            raw_out = runner(img_bytes, lang if runner is _run_subtitle_model else req.lang)
            if isinstance(raw_out, tuple) and len(raw_out) == 2:
                lines, regions = raw_out
            else:
                lines, regions = list(raw_out), []
            out: dict[str, Any] = {
                "ok": True,
                "text": "\n".join(lines),
                "lines": lines,
                "engine": engine_name,
            }
            if regions:
                out["regions"] = regions
                out["bubbles"] = cluster_ocr_regions(regions, req.lang)
            return out
        except (ImportError, ModuleNotFoundError):
            continue
        except Exception as exc:
            runtime_errors.append(f"{engine_name}: {exc}")
            continue

    if runtime_errors:
        return {
            "ok": False,
            "error": f"{_NO_OCR_INSTALL_MSG} Backend errors: {'; '.join(runtime_errors)}",
        }
    return {"ok": False, "error": _NO_OCR_INSTALL_MSG}


# ---------------------------------------------------------------------------
# FastAPI Router & Standalone Companion App Factory
# ---------------------------------------------------------------------------


def create_companion_router(
    *,
    available_keys: set[str] | None = None,
    default_model: str = "hy-mt-1.8b",
    chat_caller: BatchChatCaller | None = None,
    single_caller: SingleTranslateCaller | None = None,
    ocr_backends: tuple[tuple[str, Callable[[bytes, str], list[str]]], ...] | None = None,
    batch_handler: Callable[[BatchTextReq], dict[str, Any]] | None = None,
) -> Any:
    """Creates a FastAPI `APIRouter` exposing `/translate_batch` and `/ocr`."""
    if APIRouter is None:  # pragma: no cover
        raise RuntimeError("FastAPI is required to build APIRouter (pip install fastapi).")

    router = APIRouter()

    @router.post("/translate_batch")
    def translate_batch_endpoint(req: BatchTextReq) -> dict[str, Any]:
        if batch_handler is not None:
            return batch_handler(req)
        return execute_translate_batch(
            req,
            available_keys=available_keys,
            default_model=default_model,
            chat_caller=chat_caller,
            single_caller=single_caller,
        )

    @router.post("/ocr")
    def ocr_endpoint(req: OcrReq) -> dict[str, Any]:
        return execute_local_ocr(req, backends=ocr_backends)

    return router


def create_companion_app(**kwargs: Any) -> Any:
    """Creates a standalone FastAPI app mounting the upgraded companion endpoints."""
    if FastAPI is None:  # pragma: no cover
        raise RuntimeError("FastAPI is required to create app (pip install fastapi).")
    app = FastAPI(title="Subtitle Study Companion", version="0.8.1")
    app.include_router(create_companion_router(**kwargs))
    return app
