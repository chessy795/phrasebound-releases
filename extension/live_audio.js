globalThis.SS_LivePcmEncoder = class LivePcmEncoder {
  constructor(sampleRate, maxSeconds, emit) {
    this.inputRate = sampleRate;
    this.emit = emit;
    this.rate = Math.min(16000, sampleRate);
    this.phase = 0; this.sum = 0; this.count = 0;
    this.samples = new Int16Array(this.rate * (maxSeconds === 4 ? 4 : 5));
    this.used = this.offset = this.quiet = 0;
    this.speech = false;
    this.noiseRms = 0.00015;
  }
  flush() {
    const wav = new ArrayBuffer(44 + this.used * 2);
    const h = new DataView(wav);
    function label(at,value) { for (const ch of value) h.setUint8(at++,ch.charCodeAt(0)); }
    label(0,'RIFF'); h.setUint32(4,wav.byteLength-8,true); label(8,'WAVE');
    label(12,'fmt '); h.setUint32(16,16,true); h.setUint16(20,1,true); h.setUint16(22,1,true);
    h.setUint32(24,this.rate,true); h.setUint32(28,this.rate*2,true);
    h.setUint16(32,2,true); h.setUint16(34,16,true);label(36,'data'); h.setUint32(40,this.used*2,true);
    new Int16Array(wav,44).set(this.samples.subarray(0,this.used));
    this.emit({wav,start:this.offset/this.rate,duration:this.used/this.rate,speech:this.speech});
    this.offset+=this.used; this.used=0;this.quiet=0;this.speech=false;
  }
  process(input) {
    if (!input?.length) return true;
    let energy=0;
    for (const value of input) energy+=value*value;
    const rms = Math.sqrt(energy / input.length);
    // Follow the quiet background across device levels. Keep the old ceiling for loud streams.
    const threshold = Math.max(0.0004, Math.min(0.004, this.noiseRms * 3));
    const quiet = rms < threshold;
    const seconds = input.length / this.inputRate;
    const timeConstant = rms < this.noiseRms ? 0.15 : 3;
    this.noiseRms += (Math.min(rms, 0.004) - this.noiseRms) * (1 - Math.exp(-seconds / timeConstant));
    for (const value of input) {
      this.sum += value;
      this.count++;
      this.phase += this.rate;
      if (this.phase < this.inputRate) continue;
      this.phase -= this.inputRate;
      const mono = this.sum / this.count;
      this.sum = 0; this.count = 0;
      this.samples[this.used++]=Math.round(Math.max(-1,Math.min(1,mono))*32767);
      this.quiet=quiet ? this.quiet+1 : 0;
      if (!quiet) this.speech=true;
      if (this.used===this.samples.length || (this.used>=this.rate*1.5 && this.quiet>=this.rate*0.26)) this.flush();
    }
    return true;
  }
};
globalThis.SS_LIVE_WORKLET = '(' + function (Encoder) {
  class LiveAudio extends AudioWorkletProcessor {
    constructor(options) {
      super();
      this.encoder = new Encoder(sampleRate, options?.processorOptions?.maxSeconds,
        data => this.port.postMessage(data,[data.wav]));
    }
    process(inputs) { return this.encoder.process(inputs[0]?.[0]); }
    flush() { this.encoder.flush(); }
  }
  registerProcessor('phrasebound-live-audio',LiveAudio);
}.toString() + ')(' + globalThis.SS_LivePcmEncoder.toString() + ')';
// Adjacent buffered phrases can share one recognition pass when the model falls behind.
globalThis.SS_takeLiveAudio = function (queue) {
  const first = queue.shift();
  const chunks = [first];
  let duration = first.duration;
  while (queue.length && duration + queue[0].duration <= 15 &&
      Math.abs(queue[0].start - first.start - duration) < 0.00004) {
    const next = queue.shift();
    chunks.push(next);
    duration += next.duration;
  }
  if (chunks.length === 1) return first;
  return {start:first.start, duration, wav:SS_joinLivePcm(first.wav, chunks.map(item=>new Uint8Array(item.wav,44))), speech:true};
};

globalThis.SS_joinLivePcm = function (headerSource, parts) {
  const bytes = parts.reduce((n, part) => n + part.byteLength, 0);
  const wav = new ArrayBuffer(44 + bytes);
  const result = new Uint8Array(wav);
  result.set(new Uint8Array(headerSource, 0, 44));
  const header = new DataView(wav);
  header.setUint32(4, 36 + bytes, true);
  header.setUint32(40, bytes, true);
  let offset = 44;
  for (const data of parts) {
    result.set(data, offset);
    offset += data.length;
  }
  return wav;
};


// Only the most recent minute is held in memory for replay during this capture.
globalThis.SS_LiveReplayBuffer = class {
  constructor() { this.packets = []; }
  add(packet) {
    const prev = this.packets.at(-1);
    if (prev && Math.abs(prev.start + prev.duration - packet.start) > 0.00004) this.packets = [];
    this.packets.push(packet);
    const cutoff = packet.start + packet.duration - 60;
    while (this.packets.length && this.packets[0].start < cutoff) this.packets.shift();
  }
  excerpt(start, end) {
    if (!this.packets.length || start < this.packets[0].start || end <= start) return null;
    const pieces = [];
    for (const packet of this.packets) {
      const a = Math.max(0, Math.round((start-packet.start)*16000));
      const b = Math.min((packet.wav.byteLength-44)/2, Math.round((end-packet.start)*16000));
      if (b > a) pieces.push(new Int16Array(packet.wav,44 + a*2,b-a));
    }
    if (!pieces.length) return null;
    const out = new Float32Array(pieces.reduce((n,x)=>n+x.length,0));
    let i=0;
    for (const piece of pieces) for (const value of piece) out[i++]=value/32768;
    return out;
  }
};
