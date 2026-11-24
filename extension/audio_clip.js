/**
 * Clean-Room Manifest V3 Media Capture & AnkiConnect Audio Helpers (`audio_clip.js`)
 * Drop-in helpers for `ext/export.js` and `ext/offscreen.js`.
 *
 * Security & CSP Guarantees:
 *   - Strictly ZERO DOM HTML-string injection APIs (Trusted-Types compliant).
 *   - Gracefully returns `null` on DRM/EME (`mediaKeys`), cross-origin tainted
 *     media streams, missing audio tracks, or unsupported `MediaRecorder` codecs
 *     without throwing uncaught exceptions.
 */
(function initSubtitleStudyAudioClip(root) {
  'use strict';

  const PREFERRED_AUDIO_MIMES = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/mp4',
  ];

  const DEFAULT_ANKI_URL = 'http://127.0.0.1:8765';
  const DEFAULT_CLIP_MS = 3500;
  const MIN_CLIP_MS = 200;
  const MAX_CLIP_MS = 30000;

  /**
   * Converts an ArrayBuffer or Uint8Array to standard Base64 in 32 KiB chunks
   * so multi-second audio clips never overflow the JS call stack.
   * @param {ArrayBuffer | Uint8Array} buffer
   * @returns {string}
   */
  function arrayBufferToBase64(buffer) {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    if (bytes.byteLength === 0) return '';
    const chunkSize = 0x8000;
    const parts = [];
    for (let offset = 0; offset < bytes.byteLength; offset += chunkSize) {
      const sub = bytes.subarray(offset, Math.min(offset + chunkSize, bytes.byteLength));
      parts.push(String.fromCharCode.apply(null, sub));
    }
    return btoa(parts.join(''));
  }

  /**
   * Picks the best supported Opus/WebM MIME type for `MediaRecorder`.
   * @returns {string}
   */
  function pickSupportedAudioMime() {
    if (typeof MediaRecorder === 'undefined') return '';
    if (typeof MediaRecorder.isTypeSupported !== 'function') {
      return 'audio/webm;codecs=opus';
    }
    for (const mime of PREFERRED_AUDIO_MIMES) {
      try {
        if (MediaRecorder.isTypeSupported(mime)) return mime;
      } catch (_err) {
        // Ignore browser quirks on exotic MIME probes
      }
    }
    return '';
  }

  /**
   * Maps a recorded MIME string to a clean Anki-safe file extension.
   * @param {string} mime
   * @returns {string}
   */
  function extForAudioMime(mime) {
    const lower = String(mime || '').toLowerCase();
    if (lower.includes('ogg')) return 'ogg';
    if (lower.includes('mp4') || lower.includes('aac')) return 'm4a';
    return 'webm';
  }

  /**
   * Sanitizes a media filename for AnkiConnect `storeMediaFile` and `[sound:...]`.
   * Removes path separators and square brackets that would break `[sound:...]`.
   * @param {string} rawName
   * @returns {string}
   */
  function sanitizeAnkiMediaFilename(rawName) {
    const cleaned = String(rawName || '')
      .replace(/[\\/[\]:*?"<>|\x00-\x1f]/g, '_')
      .trim();
    return cleaned || `ss_clip_${Date.now()}.webm`;
  }

  /**
   * Captures a live audio slice from an HTMLVideoElement using `captureStream()`
   * (or `mozCaptureStream()`) -> audio-only `MediaStream` -> `MediaRecorder`.
   *
   * Returns `{ filename, dataBase64, mime }` on success, or `null` on DRM/EME
   * encrypted streams, tainted cross-origin elements, paused/ended tracks, or errors.
   *
   * @param {HTMLVideoElement | null | undefined} videoEl
   * @param {number} durationMs
   * @param {{ filenamePrefix?: string, signal?: AbortSignal }} [opts]
   * @returns {Promise<{ filename: string, dataBase64: string, mime: string } | null>}
   */
  async function captureVideoAudioSlice(videoEl, durationMs, opts) {
    const options = opts || {};
    try {
      if (!videoEl || typeof MediaRecorder === 'undefined' || typeof MediaStream === 'undefined') {
        return null;
      }

      // EME / Widevine DRM check (Netflix, Prime Video, Disney+ encrypted playback)
      if (videoEl.mediaKeys) {
        return null;
      }

      const captureFn =
        typeof videoEl.captureStream === 'function'
          ? videoEl.captureStream.bind(videoEl)
          : typeof videoEl.mozCaptureStream === 'function'
            ? videoEl.mozCaptureStream.bind(videoEl)
            : null;
      if (!captureFn) {
        return null;
      }

      let fullStream = null;
      try {
        fullStream = captureFn();
      } catch (_captureErr) {
        // SecurityError on CORS-tainted / EME stream or InvalidStateError
        return null;
      }
      if (!fullStream || typeof fullStream.getAudioTracks !== 'function') {
        return null;
      }

      const sourceAudioTracks = fullStream.getAudioTracks();
      if (!sourceAudioTracks || sourceAudioTracks.length === 0) {
        return null;
      }

      const liveTracks = sourceAudioTracks.filter(
        (t) => t && t.readyState !== 'ended' && t.enabled !== false
      );
      if (liveTracks.length === 0) {
        return null;
      }

      // Clone tracks when supported so stopping our recording tracks never mutes <video>
      const clonedTracks = [];
      const recordTracks = liveTracks.map((track) => {
        if (typeof track.clone === 'function') {
          const cloned = track.clone();
          clonedTracks.push(cloned);
          return cloned;
        }
        return track;
      });

      const cleanupClones = () => {
        for (const cloned of clonedTracks) {
          try {
            cloned.stop();
          } catch (_stopErr) {
            // Ignore cleanup errors
          }
        }
      };

      const mime = pickSupportedAudioMime();
      if (!mime) {
        cleanupClones();
        return null;
      }

      const clampedMs = Math.max(
        MIN_CLIP_MS,
        Math.min(MAX_CLIP_MS, Number.isFinite(durationMs) ? Number(durationMs) : DEFAULT_CLIP_MS)
      );

      const audioOnlyStream = new MediaStream(recordTracks);
      let recorder = null;
      try {
        recorder = new MediaRecorder(audioOnlyStream, { mimeType: mime });
      } catch (_recInitErr) {
        cleanupClones();
        return null;
      }

      return await new Promise((resolve) => {
        const chunks = [];
        let settled = false;
        let stopTimer = null;

        const finish = (value) => {
          if (settled) return;
          settled = true;
          if (stopTimer !== null) clearTimeout(stopTimer);
          cleanupClones();
          resolve(value);
        };

        recorder.ondataavailable = (ev) => {
          if (ev && ev.data && ev.data.size > 0) {
            chunks.push(ev.data);
          }
        };

        recorder.onerror = () => {
          finish(null);
        };

        recorder.onstop = async () => {
          try {
            if (chunks.length === 0) {
              finish(null);
              return;
            }
            const effectiveMime = recorder.mimeType || mime;
            const blob = new Blob(chunks, { type: effectiveMime });
            if (!blob || blob.size === 0) {
              finish(null);
              return;
            }
            const buf = await blob.arrayBuffer();
            const dataBase64 = arrayBufferToBase64(buf);
            if (!dataBase64) {
              finish(null);
              return;
            }
            const prefix = String(options.filenamePrefix || 'ss_clip').replace(/[^a-zA-Z0-9_-]/g, '');
            const rand = Math.random().toString(36).slice(2, 8);
            const ext = extForAudioMime(effectiveMime);
            const filename = sanitizeAnkiMediaFilename(`${prefix}_${Date.now()}_${rand}.${ext}`);
            finish({
              filename,
              dataBase64,
              mime: effectiveMime,
            });
          } catch (_blobErr) {
            finish(null);
          }
        };

        if (options.signal) {
          if (options.signal.aborted) {
            finish(null);
            return;
          }
          options.signal.addEventListener(
            'abort',
            () => {
              try {
                if (recorder.state !== 'inactive') recorder.stop();
              } catch (_e) {
                finish(null);
              }
            },
            { once: true }
          );
        }

        try {
          recorder.start();
        } catch (_startErr) {
          finish(null);
          return;
        }

        stopTimer = setTimeout(() => {
          try {
            if (recorder.state !== 'inactive') {
              recorder.stop();
            } else {
              finish(null);
            }
          } catch (_stopErr) {
            finish(null);
          }
        }, clampedMs);
      });
    } catch (_outerErr) {
      return null;
    }
  }

  /**
   * Low-level AnkiConnect v6 JSON-RPC caller (`127.0.0.1:8765`).
   * @param {string} action
   * @param {Record<string, any>} params
   * @param {{ ankiUrl?: string, fetchImpl?: typeof fetch }} [opts]
   * @returns {Promise<any>}
   */
  async function invokeAnkiConnect(action, params, opts) {
    const options = opts || {};
    const ankiUrl = options.ankiUrl || DEFAULT_ANKI_URL;
    const fetchFn = options.fetchImpl || (typeof fetch === 'function' ? fetch : null);
    if (!fetchFn) {
      throw new Error('Global fetch is unavailable for AnkiConnect.');
    }

    const resp = await fetchFn(ankiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action,
        version: 6,
        params: params || {},
      }),
    });

    if (!resp.ok) {
      throw new Error(`AnkiConnect HTTP ${resp.status}`);
    }
    const payload = await resp.json();
    if (payload && payload.error) {
      throw new Error(String(payload.error));
    }
    return payload ? payload.result : null;
  }

  /**
   * Uploads `{ filename, dataBase64 }` to Anki's `collection.media` via `storeMediaFile`
   * and returns `{ storedFilename, soundTag }` (e.g. `"[sound:ss_clip_...webm]"`).
   *
   * @param {{ filename: string, dataBase64: string, mime?: string } | null | undefined} clip
   * @param {{ ankiUrl?: string, fetchImpl?: typeof fetch }} [opts]
   * @returns {Promise<{ storedFilename: string, soundTag: string } | null>}
   */
  async function storeAnkiMediaFile(clip, opts) {
    if (!clip || !clip.dataBase64) {
      return null;
    }
    const safeFilename = sanitizeAnkiMediaFilename(clip.filename);
    const result = await invokeAnkiConnect(
      'storeMediaFile',
      {
        filename: safeFilename,
        data: clip.dataBase64,
      },
      opts
    );
    const storedFilename = sanitizeAnkiMediaFilename(
      typeof result === 'string' && result.trim() ? result.trim() : safeFilename
    );
    return {
      storedFilename,
      soundTag: `[sound:${storedFilename}]`,
    };
  }

  /**
   * Clones note `fields` and attaches `[sound:...]` to the preferred audio field
   * (`Audio`, `Sound`, `SentenceAudio`) or appends it cleanly to the primary front field.
   *
   * @param {Record<string, string>} fields
   * @param {string} soundTag
   * @param {string} [preferredAudioField]
   * @returns {Record<string, string>}
   */
  function attachAudioTagToFields(fields, soundTag, preferredAudioField) {
    const nextFields = Object.assign({}, fields || {});
    if (!soundTag) return nextFields;

    const candidates = [
      preferredAudioField,
      'Audio',
      'Sound',
      'SentenceAudio',
      'ClipAudio',
    ].filter(Boolean);

    for (const fieldName of candidates) {
      if (Object.prototype.hasOwnProperty.call(nextFields, fieldName)) {
        const existing = String(nextFields[fieldName] || '').trim();
        nextFields[fieldName] = existing ? `${existing} ${soundTag}` : soundTag;
        return nextFields;
      }
    }

    const fallbackFronts = ['Front', 'Expression', 'Sentence', 'Word'];
    for (const frontName of fallbackFronts) {
      if (Object.prototype.hasOwnProperty.call(nextFields, frontName)) {
        const existing = String(nextFields[frontName] || '').trim();
        nextFields[frontName] = existing ? `${existing}\n${soundTag}` : soundTag;
        return nextFields;
      }
    }

    const keys = Object.keys(nextFields);
    if (keys.length > 0) {
      const firstKey = keys[0];
      const existing = String(nextFields[firstKey] || '').trim();
      nextFields[firstKey] = existing ? `${existing}\n${soundTag}` : soundTag;
    }
    return nextFields;
  }

  /**
   * Pushes a Subtitle Study vocabulary / formulaic-expression card to AnkiConnect,
   * optionally capturing or storing an audio slice first via `storeMediaFile` and
   * attaching `[sound:...]` onto the note fields before calling `addNote`.
   *
   * @param {{
   *   deckName: string,
   *   modelName: string,
   *   fields: Record<string, string>,
   *   tags?: string[],
   *   allowDuplicate?: boolean,
   *   audioClip?: { filename: string, dataBase64: string, mime?: string } | null,
   *   videoEl?: HTMLVideoElement | null,
   *   audioDurationMs?: number,
   *   audioField?: string,
   *   strictAudio?: boolean
   * }} cardPayload
   * @param {{ ankiUrl?: string, fetchImpl?: typeof fetch }} [opts]
   * @returns {Promise<{ ok: boolean, noteId: number | null, soundTag: string | null, storedFilename: string | null }>}
   */
  async function pushToAnkiConnect(cardPayload, opts) {
    if (!cardPayload || !cardPayload.deckName || !cardPayload.modelName) {
      throw new Error('pushToAnkiConnect requires deckName and modelName.');
    }

    let clip = cardPayload.audioClip || null;
    if (!clip && cardPayload.videoEl) {
      clip = await captureVideoAudioSlice(
        cardPayload.videoEl,
        cardPayload.audioDurationMs || DEFAULT_CLIP_MS
      );
    }

    let mediaInfo = null;
    if (clip && clip.dataBase64) {
      try {
        mediaInfo = await storeAnkiMediaFile(clip, opts);
      } catch (mediaErr) {
        if (cardPayload.strictAudio) {
          throw mediaErr;
        }
        mediaInfo = null;
      }
    }

    const finalFields = mediaInfo
      ? attachAudioTagToFields(cardPayload.fields, mediaInfo.soundTag, cardPayload.audioField)
      : Object.assign({}, cardPayload.fields || {});

    const noteId = await invokeAnkiConnect(
      'addNote',
      {
        note: {
          deckName: cardPayload.deckName,
          modelName: cardPayload.modelName,
          fields: finalFields,
          options: {
            allowDuplicate: Boolean(cardPayload.allowDuplicate),
          },
          tags: Array.isArray(cardPayload.tags) ? cardPayload.tags : ['subtitle_study'],
        },
      },
      opts
    );

    return {
      ok: true,
      noteId,
      soundTag: mediaInfo ? mediaInfo.soundTag : null,
      storedFilename: mediaInfo ? mediaInfo.storedFilename : null,
    };
  }

  /**
   * Optional MV3 Offscreen Document listener (`ext/offscreen.js`) for recording
   * a `MediaStream` (e.g. `chrome.tabCapture` stream ID) into `{ filename, dataBase64, mime }`.
   */
  function registerOffscreenAudioHandler() {
    if (
      typeof chrome === 'undefined' ||
      !chrome.runtime ||
      !chrome.runtime.onMessage
    ) {
      return;
    }
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (!msg || msg.type !== 'SS_OFFSCREEN_RECORD_STREAM' || !msg.streamId) {
        return false;
      }
      (async () => {
        let stream = null;
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            audio: {
              mandatory: {
                chromeMediaSource: 'tab',
                chromeMediaSourceId: msg.streamId,
              },
            },
            video: false,
          });
          const fakeVideoEl = {
            mediaKeys: null,
            captureStream: () => stream,
          };
          const clip = await captureVideoAudioSlice(fakeVideoEl, msg.durationMs || DEFAULT_CLIP_MS, {
            filenamePrefix: msg.filenamePrefix || 'ss_tab',
          });
          sendResponse({ ok: Boolean(clip), clip });
        } catch (_err) {
          sendResponse({ ok: false, clip: null });
        } finally {
          if (stream) {
            for (const track of stream.getTracks()) {
              try {
                track.stop();
              } catch (_e) {
                // Ignore
              }
            }
          }
        }
      })();
      return true;
    });
  }

  const exported = {
    arrayBufferToBase64,
    pickSupportedAudioMime,
    sanitizeAnkiMediaFilename,
    captureVideoAudioSlice,
    invokeAnkiConnect,
    storeAnkiMediaFile,
    attachAudioTagToFields,
    pushToAnkiConnect,
    registerOffscreenAudioHandler,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exported;
  }
  root.SS_AUDIO_CLIP = exported;
})(typeof globalThis !== 'undefined' ? globalThis : this);
