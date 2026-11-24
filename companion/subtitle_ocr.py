"""CPU OCR for horizontal bands of light, outlined or dark-backed subtitles."""

from difflib import SequenceMatcher
from pathlib import Path
import unicodedata

import cv2
import numpy as np
import onnxruntime as ort
import yaml


def _stroke_mask(image):
    """Find recurrent light foreground colours beside darker pixels."""
    height, width = image.shape[:2]
    b, g, r = cv2.split(image)
    value = cv2.min(r, g)
    spread = cv2.subtract(cv2.max(cv2.max(r, g), b), cv2.min(value, b))
    yellow = (r >= 175) & (cv2.subtract(g, r) < 20) & (cv2.subtract(g, b) > 36)
    radius = max(2, min(6, round(height / 48)))
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * radius + 1,) * 2)
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    contrast = cv2.subtract(gray, cv2.erode(gray, kernel))
    edge = (value >= 150) & (contrast >= 55)
    palettes = []
    for family in (spread < 42, yellow):
        pixels = image[edge & family]
        if len(pixels) < 8:
            continue
        bins = pixels.astype(np.int32) >> 4
        codes = bins[:, 0] * 256 + bins[:, 1] * 16 + bins[:, 2]
        hist = np.bincount(codes, minlength=4096)
        peak = hist.argmax()
        colour = np.median(pixels[codes == peak], axis=0)
        palettes.append((int(hist[peak]), colour))
    mask = np.zeros((height, width), np.uint8)
    strongest = max((n for n, _ in palettes), default=0)
    for count, colour in palettes:
        if count >= max(6, 0.09 * strongest):
            lo = np.maximum(0, colour - 16).astype(np.uint8)
            hi = np.minimum(255, colour + 16).astype(np.uint8)
            mask |= cv2.inRange(image, lo, hi)
    return ((mask != 0) & (contrast >= 50)).astype(np.uint8)


def _runs(active, gap):
    positions = np.flatnonzero(active)
    if not positions.size:
        return []
    groups = np.split(positions, np.flatnonzero(np.diff(positions) > gap + 1) + 1)
    return [(int(group[0]), int(group[-1]) + 1) for group in groups]


def _row_boxes(image, threshold_fraction=0.09):
    """Locate horizontal lines by their row and column projections."""
    height, width = image.shape[:2]
    mask = _stroke_mask(image)
    middle = width // 4
    rows = mask[:, middle:width - middle].sum(axis=1)
    if rows.max() < 5:
        rows = mask.sum(axis=1)
    threshold = max(2, rows.max() * threshold_fraction)
    candidates = []
    for y0, y1 in _runs(rows >= threshold, max(2, min(4, height // 50))):
        if y1 - y0 < 5:
            continue
        cols = mask[y0:y1].sum(axis=0)
        spans = _runs(cols > 0, max(7, round((y1 - y0) * 1.05)))
        best_score = 0
        for x0, x1 in spans:
            pixels = int(cols[x0:x1].sum())
            centre_distance = abs((x0 + x1) / 2 - width / 2) / width
            score = pixels / (1 + (4 * centre_distance) ** 2)
            if pixels < max(12, 0.045 * (x1 - x0) * (y1 - y0)) or score <= best_score:
                continue
            best_score = score
            box = [x0, y0, x1, y1]
        if best_score:
            candidates.append((best_score, box))
    candidates.sort(key=lambda pair: pair[0], reverse=True)
    boxes = [box for score, box in candidates[:2] if score >= candidates[0][0] * 0.055]
    return sorted(boxes, key=lambda box: box[1])


def _paper(crop):
    """Turn light glyphs into dark ink while keeping antialiased edges."""
    b, g, r = cv2.split(crop)
    value = cv2.min(g, r)
    radius = max(3, min(10, round(crop.shape[0] * 0.14)))
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * radius + 1,) * 2)
    floor = cv2.erode(value, kernel).astype(np.float32)
    brightness = value.astype(np.float32)
    ink = np.clip(((brightness - floor) / np.maximum(235 - floor, 65) - 0.08) * 1.12, 0, 1)
    ink *= np.clip((brightness - 105) / 75, 0, 1)
    return cv2.cvtColor(np.rint(255 * (1 - ink)).astype(np.uint8), cv2.COLOR_GRAY2BGR)


def _light_ink(crop, seeds=None, paper=None):
    if seeds is None:
        seeds = _stroke_mask(crop)
    if paper is None:
        paper = _paper(crop)
    support = cv2.dilate(seeds, np.ones((5, 5), np.uint8))
    return (255 - paper[:, :, 0]) * support


def _connected_ink(crop, seeds=None, core=None):
    """Follow dim, colour-consistent strokes up to their dark outline."""
    if seeds is None:
        seeds = _stroke_mask(crop)
    if not seeds.any():
        return seeds
    colour = np.median(crop[seeds != 0], axis=0).astype(np.float32)
    source = crop.astype(np.float32)
    alpha = np.clip((source * colour).sum(axis=2) / max(float(colour @ colour), 1), 0, 1)
    residual = np.abs(source - alpha[:, :, None] * colour).max(axis=2)
    possible = ((alpha > 0.13) & (residual < 15 + 13 * alpha)).astype(np.uint8)
    n, labels, stats, _ = cv2.connectedComponentsWithStats(possible)
    keep = np.bincount(labels[seeds != 0], minlength=n) > 0
    keep &= (stats[:, cv2.CC_STAT_WIDTH] <= 2 * crop.shape[0])
    keep &= (stats[:, cv2.CC_STAT_AREA] < 0.29 * crop.shape[0] * crop.shape[1])
    keep[0] = False
    traced = np.rint(255 * alpha ** 0.75 * keep[labels]).astype(np.uint8)
    if core is None:
        core = _light_ink(crop, seeds)
    return np.maximum(core, traced)


def _combine(text, confidence, alternate, other_conf):
    """Keep the colour reading unless a second exposure resolves an uncertain token."""
    chars, scores = [], []
    for tag, i, j, a, b in SequenceMatcher(None, text, alternate, autojunk=False).get_opcodes():
        if tag == "equal":
            chars.extend(text[i:j])
            scores.extend(max(x, y) for x, y in zip(confidence[i:j], other_conf[a:b]))
        elif tag == "replace" and j-i == b-a:
            for char, score, other, other_score in zip(text[i:j], confidence[i:j], alternate[a:b], other_conf[a:b]):
                if other_score > score + 0.06:
                    char, score = other, other_score
                chars.append(char)
                scores.append(score)
        elif tag == "insert" and min(other_conf[a:b]) >= 0.55:
            chars.extend(alternate[a:b])
            scores.extend(other_conf[a:b])
        else:
            chars.extend(text[i:j])
            scores.extend(confidence[i:j])
    return "".join(chars), scores


def _reread_marks(text, scores, alternate, other_conf, second=None):
    """Resolve punctuation using aligned observations from differently processed crops."""
    votes = {}
    if second is not None:
        other, confidence = second
        for tag, i, j, a, b in SequenceMatcher(None, text, other, autojunk=False).get_opcodes():
            if tag in ("equal", "replace") and j-i == b-a:
                votes.update((k, (other[q], confidence[q])) for k, q in zip(range(i, j), range(a, b)))
    chars = list(text)
    for tag, i, j, a, b in SequenceMatcher(None, text, alternate, autojunk=False).get_opcodes():
        if tag == "replace" and j-i == b-a:
            for k, q in zip(range(i, j), range(a, b)):
                voter, strength = votes.get(k, ("", 0))
                agreement = voter == alternate[q] and min(strength, other_conf[q]) >= 0.65
                if (unicodedata.category(chars[k]).startswith("P")
                        and unicodedata.category(alternate[q]).startswith("P")
                        and scores[k] < 0.9 and (other_conf[q] > scores[k] or agreement)):
                    chars[k], scores[k] = alternate[q], other_conf[q]
    return "".join(chars), scores


def _glyph_feature(ink):
    """Compare visual structure across fonts after trimming the glyph's bearings."""
    x, y, w, h = cv2.boundingRect((ink > 35).astype(np.uint8))
    if not w or not h:
        return None
    scaled = cv2.resize(ink[y:y+h, x:x+w], (40, 40), interpolation=cv2.INTER_AREA)
    tile = np.pad(scaled.astype(np.float32) / 255, 3)
    smooth = cv2.GaussianBlur(tile, (0, 0), 1.2)
    low = cv2.resize(smooth, (18, 18), interpolation=cv2.INTER_AREA).ravel()
    low -= low.mean()
    dx = cv2.Sobel(smooth, cv2.CV_32F, 1, 0)
    dy = cv2.Sobel(smooth, cv2.CV_32F, 0, 1)
    directions = [np.abs(dx), np.abs(dy), np.abs(dx + dy) * 0.7071, np.abs(dx - dy) * 0.7071]
    edges = np.concatenate([cv2.resize(a, (7, 7), interpolation=cv2.INTER_AREA).ravel()
                            for a in directions])
    edges -= edges.mean()
    return np.concatenate((low * (0.8 / max(np.linalg.norm(low), 1e-6)),
                           edges * (0.6 / max(np.linalg.norm(edges), 1e-6))))


def _han(char):
    cp = ord(char)
    return 0x3400 <= cp <= 0x9fff or 0x20000 <= cp <= 0x323af


def _has_kana(text):
    return sum(0x3040 <= ord(c) <= 0x30ff and c != "・" for c in text) >= 2


def _glyph_tiles(ink, length):
    """Fit an evenly spaced character grid to valleys in the ink projection."""
    core = ink >= 95
    rows = core.sum(axis=1)
    ys = np.flatnonzero(rows >= max(2, rows.max() * 0.06))
    if not ys.size:
        return []
    ink = ink[max(0, ys[0]-1):ys[-1]+2]
    height = ink.shape[0]
    cols = (ink >= 95).sum(axis=0).astype(np.float32)
    xs = np.flatnonzero(cols)
    if not xs.size or height < 8:
        return []
    left, right = xs[0], xs[-1] + 1
    smooth = cv2.GaussianBlur(cols[None, :], (0, 0), 1.2)[0]
    pad = np.arange(0, max(3, round(height * 0.21)) + 1, 1.5)
    lp, rp = np.meshgrid(pad, pad)
    starts = left - lp.ravel()
    ends = right + rp.ravel()
    gap = max(2, round(length * 0.22))
    best_cost = float("inf")
    edges = None
    for count in range(max(2, length - gap), length + gap + 1):
        pitch = (ends - starts) / count
        valid = (pitch >= 0.82 * height) & (pitch <= 1.65 * height)
        if not np.any(valid):
            continue
        grid = starts[:, None] + pitch[:, None] * np.arange(count + 1)
        cuts = np.interp(grid[:, 1:-1], np.arange(len(cols)), smooth)
        cost = cuts.mean(axis=1) / height + 0.045 * np.abs(pitch / height - 1.08)
        cost += 0.008 * abs(count - length) / length
        cost[~valid] = np.inf
        idx = cost.argmin()
        if cost[idx] < best_cost:
            best_cost = cost[idx]
            edges = np.rint(grid[idx]).astype(int).clip(0, ink.shape[1])
    if edges is None:
        return []
    return [ink[:, a:b] for a, b in zip(edges, edges[1:])]


def _cell_feature(tile):
    _, _, w, h = cv2.boundingRect((tile > 70).astype(np.uint8))
    if h >= tile.shape[0] * 0.38 and w >= tile.shape[1] * 0.24:
        return _glyph_feature(tile)
    return None


def _align_cells(text, labels, distances):
    """Align visual cells and CTC tokens while allowing dropped or extra tokens."""
    n, m = len(labels), len(text)
    cost = np.zeros((n + 1, m + 1))
    step = np.zeros((n + 1, m + 1), np.uint8)
    cost[:, 0] = np.arange(n + 1) * 0.8
    cost[0, :] = np.arange(m + 1) * 0.8
    step[1:, 0] = 1
    step[0, 1:] = 2
    for i, label in enumerate(labels, 1):
        for j, char in enumerate(text, 1):
            if label == char or (label is None and not _han(char)):
                pair_cost = 0.0
            else:
                pair_cost = min(1.12, 0.36 + 2.7 * distances[i-1, j-1])
            options = (cost[i-1, j-1] + pair_cost, cost[i-1, j] + 0.8, cost[i, j-1] + 0.8)
            direction = min(range(3), key=options.__getitem__)
            cost[i, j], step[i, j] = options[direction], direction
    pairs = []
    i, j = n, m
    while i or j:
        direction = step[i, j]
        pairs.append((i - 1 if direction != 2 else None, j - 1 if direction != 1 else None))
        i -= direction != 2
        j -= direction != 1
    return pairs[::-1]


class _GlyphReference:
    def __init__(self, path):
        with np.load(path, allow_pickle=False) as model:
            self.chars = [chr(cp) for cp in model["codepoints"]]
            self.features = model["features"].astype(np.float32) / 512
        self.index = {c: i for i, c in enumerate(self.chars)}

    @staticmethod
    def _eligible(text):
        if len(text) < 2 or sum(map(_han, text)) < 0.72 * len(text):
            return False
        return not _has_kana(text)

    @staticmethod
    def _accept(best, margin, distance, confidence, char):
        if confidence is None:
            return best >= 0.73 and margin >= 0.018
        if confidence >= 0.975:
            return False
        return (best >= 0.59 and margin >= 0.016 + 0.012 * confidence
                and distance >= 0.024 + 0.022 * confidence)

    def read(self, ink, text, confidence):
        tiles = _glyph_tiles(ink, len(text))
        cells = [_cell_feature(tile) for tile in tiles]
        active = [i for i, v in enumerate(cells) if v is not None]
        if not active:
            return text, -1
        query = np.stack([cells[i] for i in active])
        norms, nearest = cv2.batchDistance(query, self.features, cv2.CV_32F, normType=cv2.NORM_L2, K=2)
        # Both descriptors have unit length, so 1 - distance²/2 is cosine similarity.
        scores = 1.0 - norms * norms / 2
        labels = [None] * len(cells)
        best = np.zeros(len(cells))
        margin = np.zeros(len(cells))
        distances = np.full((len(cells), len(text)), 0.35)
        for k, i in enumerate(active):
            labels[i] = self.chars[nearest[k, 0]]
            best[i], margin[i] = scores[k, 0], scores[k, 0] - scores[k, 1]
            for j, char in enumerate(text):
                index = self.index.get(char)
                if index is not None:
                    distances[i, j] = max(0, best[i] - float(query[k] @ self.features[index]))
        pairs = _align_cells(text, labels, distances)
        anchors = sum(i is not None and j is not None and labels[i] == text[j] for i, j in pairs)
        if anchors < max(1, len(active) * 0.30):
            return text, -1
        fit = sum((best[i] - distances[i, j]) + 0.25 * (labels[i] == text[j]) for i, j in pairs
                  if i is not None and j is not None and confidence[j] >= 0.90 and _han(text[j]))
        output = self._choose(tiles, pairs, labels, best, margin, distances, text, confidence)
        return "".join(output), fit

    def _choose(self, tiles, pairs, labels, best, margin, distances, text, confidence):
        out = []
        for i, j in pairs:
            if i is not None and labels[i]:
                prior = confidence[j] if j is not None else None
                distance = distances[i, j] if j is not None else 0
                if self._accept(best[i], margin[i], distance, prior, text[j] if j is not None else ""):
                    out.append(labels[i])
                    continue
            out.append(text[j] if j is not None else "")
        return out


def _cpu_session(path, threads):
    options = ort.SessionOptions()
    options.log_severity_level = 3
    options.intra_op_num_threads = threads
    options.inter_op_num_threads = 1
    options.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
    options.add_session_config_entry("session.intra_op.allow_spinning", "0")
    return ort.InferenceSession(str(path), sess_options=options, providers=["CPUExecutionProvider"])


class _TextDetector:
    def __init__(self, folder, threads):
        from rapidocr_onnxruntime.ch_ppocr_v3_det.utils import DBPostProcess, DetResizeForTest, NormalizeImage

        with (folder / "inference.yml").open(encoding="utf-8") as handle:
            cfg = yaml.safe_load(handle)
        ops = {k: v for step in cfg["PreProcess"]["transform_ops"] for k, v in step.items()}
        self.resize = DetResizeForTest(**ops["DetResizeForTest"])
        normalization = dict(ops["NormalizeImage"])
        normalization["scale"] = 1 / 255
        self.normalize = NormalizeImage(**normalization)
        post = {k: v for k, v in cfg["PostProcess"].items() if k != "name"}
        self.post = DBPostProcess(**post, use_dilation=False)
        self.session = _cpu_session(folder / "inference.onnx", threads)
        self.input_name = self.session.get_inputs()[0].name

    def quads(self, image):
        data = self.normalize(self.resize({"image": image}))
        tensor = np.ascontiguousarray(data["image"].transpose(2, 0, 1)[None], dtype=np.float32)
        pred = self.session.run(None, {self.input_name: tensor})[0]
        points = self.post(pred, data["shape"][None])[0]["points"]
        height, width = image.shape[:2]
        quads = []
        for points_in_box in points:
            # DBPostProcess returns top left, top right, bottom right, bottom left.
            quad = np.clip(points_in_box, (0, 0), (width-1, height-1)).astype(np.float32)
            if np.linalg.norm(quad[1]-quad[0]) > 3 and np.linalg.norm(quad[3]-quad[0]) > 3:
                quads.append(quad)
        return quads


def _overlap(box, other):
    x, y, r, b = box
    x0, y0, x1, y1 = other
    area = max(0, min(r, x1)-max(x, x0)) * max(0, min(b, y1)-max(y, y0))
    return area / ((r-x)*(b-y) + (x1-x0)*(y1-y0) - area)


def _rectify(image, quad):
    tl, tr, br, bl = quad
    width = int(max(np.linalg.norm(tr-tl), np.linalg.norm(br-bl)))
    height = int(max(np.linalg.norm(bl-tl), np.linalg.norm(br-tr)))
    target = np.float32([[0, 0], [width, 0], [width, height], [0, height]])
    transform = cv2.getPerspectiveTransform(quad, target)
    return cv2.warpPerspective(image, transform, (width, height), flags=cv2.INTER_CUBIC,
                               borderMode=cv2.BORDER_REPLICATE)


class SubtitleOCR:
    """Load once and reuse for PNG bands. Boxes contain [x0, y0, x1, y1] in source pixels.
    The right and bottom coordinates are exclusive.

    model_dir contains the v5 mobile rec/det directories and droid_han_glyphs.npz.
    The recognizer files can also sit directly beside the glyph reference.
    A recognizer-only package uses the colour-based row boxes for every script.
    """

    _threads = 4
    _row_threshold = 0.09
    _detector = None

    def __init__(self, model_dir):
        folder = Path(model_dir)
        rec_dir = folder if (folder / "inference.onnx").is_file() else folder / "PP-OCRv5_mobile_rec_onnx"
        self._load_recognizer(rec_dir)
        self._glyphs = _GlyphReference(folder / "droid_han_glyphs.npz")
        det_dir = folder / "PP-OCRv5_mobile_det_onnx"
        if det_dir.is_dir():
            self._detector = _TextDetector(det_dir, self._threads)

    def _load_recognizer(self, folder):
        with (folder / "inference.yml").open(encoding="utf-8") as handle:
            config = yaml.load(handle, Loader=getattr(yaml, "CSafeLoader", yaml.SafeLoader))
        self._alphabet = [""] + list(config["PostProcess"]["character_dict"]) + [" "]
        self._session = _cpu_session(folder / "inference.onnx", self._threads)
        self._input_name = self._session.get_inputs()[0].name
        output = self._session.get_outputs()[0]
        self._output_name = output.name
        if isinstance(output.shape[-1], int) and output.shape[-1] != len(self._alphabet):
            raise ValueError("Character dictionary does not match the recognizer output")

    def _tokens(self, crop, detector_crop=False):
        h, w = crop.shape[:2]
        scaled_width = w * 48 / h
        width = max(1, min(3200, int(scaled_width) if detector_crop else round(scaled_width)))
        padded_width = width if detector_crop else max(320, (width + 7) // 8 * 8)
        resized = cv2.resize(crop, (width, 48), interpolation=cv2.INTER_LINEAR)
        tensor = np.zeros((1, 3, 48, padded_width), dtype=np.float32)
        tensor[0, :, :, :width] = resized.transpose(2, 0, 1).astype(np.float32) / 127.5 - 1
        probs = self._session.run([self._output_name], {self._input_name: tensor})[0][0]
        ids = probs.argmax(axis=1)
        keep = (ids != 0) & np.r_[True, ids[1:] != ids[:-1]]
        if not keep.any():
            return "", []
        emitted = ids[keep]
        tokens = [self._alphabet[i] for i in emitted]
        text = "".join(tokens)
        scores = [float(p) for token, p in zip(tokens, probs[np.flatnonzero(keep), emitted]) for _ in token]
        left = len(text) - len(text.lstrip())
        return text.strip(), scores[left:len(text.rstrip())]

    def _read_line(self, crop):
        text, scores = self._tokens(crop)
        if self._glyphs._eligible(text):
            seeds = _stroke_mask(crop)
            paper = _paper(crop)
            core = _light_ink(crop, seeds, paper)
            traced = _connected_ink(crop, seeds, core)
            second = self._tokens(cv2.cvtColor(traced, cv2.COLOR_GRAY2BGR))
            text, scores = _combine(text, scores, *second)
            if any(unicodedata.category(c).startswith("P") and p < 0.9 for c, p in zip(text, scores)):
                binary = cv2.threshold(paper, 155, 255, cv2.THRESH_BINARY)[1]
                text, scores = _reread_marks(text, scores, *self._tokens(binary), second=second)
            # Prefer the grid that most closely fits the recognizer's confident Han tokens.
            readings = [self._glyphs.read(ink, text, scores) for ink in (traced, core)]
            text = max(readings, key=lambda pair: pair[1])[0]
        return text, float(np.mean(scores)) if scores else 0.0

    def _refine_kana_boxes(self, image, regions):
        candidates = []
        for quad in self._detector.quads(image):
            left, top = quad.min(axis=0).astype(int).tolist()
            right, bottom = quad.max(axis=0).astype(int).tolist()
            candidates.append(([left, top, right + 1, bottom + 1], quad))
        for region in regions:
            if not candidates or not _has_kana(region["text"]):
                continue
            index = max(range(len(candidates)), key=lambda k: _overlap(region["box"], candidates[k][0]))
            box, quad = candidates[index]
            if _overlap(region["box"], box) < 0.40:
                continue
            crop = _rectify(image, quad)
            text, scores = self._tokens(crop, detector_crop=True)
            if _has_kana(text) and np.mean(scores) >= 0.50:
                region.update(box=box, text=text)
                candidates.pop(index)
        regions.sort(key=lambda region: (region["box"][1], region["box"][0]))

    def _read_detected(self, image):
        """Read every wide text box the v5 detector finds (real videos: boxes, side captions, bilingual rows)."""
        height, width = image.shape[:2]
        regions = []
        for quad in self._detector.quads(image):
            qw = float(np.linalg.norm(quad[1] - quad[0]))
            qh = float(np.linalg.norm(quad[3] - quad[0]))
            if qw < 2.0 * qh:  # skip big title glyphs and stickers
                continue
            text, confidence = self._read_line(_rectify(image, quad))
            if len(text) < 2 or confidence < 0.50:
                continue
            left, top = quad.min(axis=0).astype(int).tolist()
            right, bottom = quad.max(axis=0).astype(int).tolist()
            regions.append({"box": [max(0, left), max(0, top), min(width, right + 1), min(height, bottom + 1)],
                            "text": text, "_h": qh})
        rowh = max((r["_h"] for r in regions), default=1)
        regions.sort(key=lambda r: (round((r["box"][1] + r["box"][3]) / 2 / (0.6 * rowh)), r["box"][0]))
        for r in regions:
            r.pop("_h")
        return regions

    def __call__(self, png_bytes: bytes) -> tuple[list[str], list[dict]]:
        if not png_bytes:
            raise ValueError("Expected a nonempty encoded subtitle band")
        image = cv2.imdecode(np.frombuffer(png_bytes, dtype=np.uint8), cv2.IMREAD_UNCHANGED)
        if image is None:
            raise ValueError("Could not decode the subtitle band")
        if image.dtype == np.uint16:
            image = (image // 257).astype(np.uint8)
        if image.ndim == 2:
            image = cv2.cvtColor(image, cv2.COLOR_GRAY2BGR)
        elif image.shape[2] == 4:
            alpha = image[:, :, 3:4].astype(np.uint16)
            image = ((image[:, :, :3].astype(np.uint16) * alpha + 127) // 255).astype(np.uint8)
        if self._detector is not None:
            regions = self._read_detected(image)
            if regions:
                return [r["text"] for r in regions], regions
        height, width = image.shape[:2]
        boxes = _row_boxes(image, self._row_threshold)
        regions = []
        for i, (x0, y0, x1, y1) in enumerate(boxes):
            margin = max(2, round((y1 - y0) * 0.13))
            top = (boxes[i - 1][3] + y0) // 2 if i else 0
            bottom = (y1 + boxes[i + 1][1]) // 2 if i + 1 < len(boxes) else height
            crop = image[max(top, y0 - margin):min(bottom, y1 + margin),
                         max(0, x0 - margin):min(width, x1 + margin)]
            text, confidence = self._read_line(crop)
            if text and confidence >= 0.50:
                box = [max(0, x0 - 1), max(0, y0 - 1), min(width, x1 + 1), min(height, y1 + 1)]
                regions.append({"box": box, "text": text})
        if self._detector is not None and any(_has_kana(r["text"]) for r in regions):
            self._refine_kana_boxes(image, regions)
        return [r["text"] for r in regions], regions
