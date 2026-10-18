// Streaming area-average resampling: phase carries across render quanta.
class PcmCapture extends AudioWorkletProcessor {
  constructor({ processorOptions = {} } = {}) {
    super();
    const target = processorOptions.targetRate || 16000;
    this.ratio = sampleRate / target;
    this.frameSize = Math.max(1, Math.round(target * (processorOptions.frameMs || 40) / 1000));
    this.frame = new Int16Array(this.frameSize); this.cursor = 0;
    this.weight = 0; this.sum = 0; this.energy = 0;
  }
  process(inputs) {
    const input = inputs[0]?.[0]; if (!input) return true;
    for (const value of input) {
      let remaining = 1;
      while (remaining > 1e-9) {
        const take = Math.min(remaining, this.ratio - this.weight);
        this.sum += value * take; this.weight += take; remaining -= take;
        if (this.weight >= this.ratio - 1e-9) {
          const sample = Math.max(-1, Math.min(1, this.sum / this.ratio));
          this.frame[this.cursor++] = Math.round(sample * (sample < 0 ? 32768 : 32767));
          this.energy += sample * sample; this.weight = 0; this.sum = 0;
          if (this.cursor === this.frameSize) {
            const pcm = this.frame.buffer;
            this.port.postMessage({ pcm, level: Math.sqrt(this.energy / this.frameSize) }, [pcm]);
            this.frame = new Int16Array(this.frameSize); this.cursor = 0; this.energy = 0;
          }
        }
      }
    }
    return true;
  }
}
registerProcessor('kz-pcm-capture', PcmCapture);
