// Streaming PCM player that runs on the audio thread (not the UI / WebGL thread).
// Why: scheduling one AudioBufferSourceNode per network chunk makes the browser resample every
// chunk separately (clicks at every boundary = "crackle"), and any late chunk leaves a gap
// ("stutter"). Here all chunks go into one queue, are resampled continuously with a cubic
// interpolator whose phase carries across chunks, a jitter buffer absorbs network delays,
// and every start/stop/underrun is faded so it never clicks.
class PcmPlayer extends AudioWorkletProcessor {
  constructor({ processorOptions = {} } = {}) {
    super();
    const inRate = processorOptions.inRate || 16000;
    this.step = inRate / sampleRate;                                     // input samples per output sample
    this.prebuffer = Math.round(inRate * (processorOptions.prebufferMs ?? 160) / 1000);   // first chunk of a reply
    this.rebuffer = Math.round(inRate * (processorOptions.rebufferMs ?? 100) / 1000);     // after a network gap
    this.maxWait = Math.round(sampleRate * (processorOptions.maxWaitMs ?? 220) / 1000);   // short last phrase: do not wait forever
    this.fade = 1 / Math.max(1, Math.round(sampleRate * 0.008));        // 8 ms ramps
    this.queue = []; this.qi = 0; this.avail = 0;                         // queued Float32Array chunks
    this.need = this.prebuffer; this.waited = 0; this.playing = false;
    this.h = new Float32Array(4); this.t = 0;                              // cubic history x[-1], x0, x1, x2 and phase
    this.gain = 0; this.target = 0; this.hold = 0;                         // hold = last output while fading out
    this.reportEvery = Math.round(sampleRate * 0.04); this.sinceReport = 0; this.energy = 0; this.count = 0;
    this.port.onmessage = ({ data }) => {
      if (data.type === 'pcm') {
        const s16 = new Int16Array(data.pcm), f = new Float32Array(s16.length);
        for (let i = 0; i < s16.length; i++) f[i] = s16[i] / 32768;
        if (f.length) { this.queue.push(f); this.avail += f.length; }
      } else if (data.type === 'clear') {                                // interruption: drop everything, fade out
        this.queue = []; this.qi = 0; this.avail = 0; this.need = this.prebuffer; this.waited = 0;
        if (this.playing) { this.playing = false; this.target = 0; }
      }
    };
  }
  next() {                                                               // pop one input sample (0 if empty)
    while (this.queue.length) {
      const c = this.queue[0];
      if (this.qi < c.length) { this.avail--; return c[this.qi++]; }
      this.queue.shift(); this.qi = 0;
    }
    return 0;
  }
  begin() {                                                              // (re)start: fill history from the queue
    const first = this.next();
    this.h[0] = first; this.h[1] = first; this.h[2] = this.next(); this.h[3] = this.next();
    this.t = 0; this.playing = true; this.target = 1; this.waited = 0;
  }
  process(_inputs, outputs) {
    const out = outputs[0][0]; if (!out) return true;
    for (let i = 0; i < out.length; i++) {
      if (!this.playing) {
        if (this.avail > 0 && (this.avail >= this.need || ++this.waited >= this.maxWait)) this.begin();
      }
      let v;
      if (this.playing) {
        const [a, b, c, d] = this.h, t = this.t;                          // Catmull-Rom cubic between b and c
        v = b + 0.5 * t * (c - a + t * (2 * a - 5 * b + 4 * c - d + t * (3 * (b - c) + d - a)));
        this.t += this.step;
        while (this.t >= 1) {
          this.t -= 1;
          if (this.avail <= 0) {                                         // network gap: fade out, wait for a cushion
            this.playing = false; this.target = 0; this.need = this.rebuffer; this.waited = 0; break;
          }
          this.h[0] = this.h[1]; this.h[1] = this.h[2]; this.h[2] = this.h[3]; this.h[3] = this.next();
        }
        this.hold = v;
      } else {
        v = this.hold;                                                   // decay the last value instead of jumping to 0
      }
      if (this.gain < this.target) this.gain = Math.min(this.target, this.gain + this.fade);
      else if (this.gain > this.target) this.gain = Math.max(this.target, this.gain - this.fade);
      const y = v * this.gain; out[i] = y;
      this.energy += y * y; this.count++;
    }
    if ((this.sinceReport += out.length) >= this.reportEvery) {
      this.port.postMessage({ playing: this.playing || this.gain > 0.001, buffered: this.avail / (this.step * sampleRate), level: Math.sqrt(this.energy / Math.max(1, this.count)) });
      this.sinceReport = 0; this.energy = 0; this.count = 0;
    }
    return true;
  }
}
registerProcessor('kz-pcm-player', PcmPlayer);
