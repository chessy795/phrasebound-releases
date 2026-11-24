// MV3 Offscreen Document Worker (permissive clean-room pattern):
// Handles offscreen MediaStream audio slice capture and canvas frame cropping when needed.
(() => {
  'use strict';
  if (globalThis.SS_AUDIO_CLIP && typeof globalThis.SS_AUDIO_CLIP.registerOffscreenAudioHandler === 'function') {
    globalThis.SS_AUDIO_CLIP.registerOffscreenAudioHandler();
  }
})();
