// Public-agent transport. Never put provider API keys in this module.
export const PCM_FRAME_MS = 40;
const encode = (bytes) => { let s = ''; for (const b of bytes) s += String.fromCharCode(b); return btoa(s); };
const aborted = () => Object.assign(new Error('Session cancelled'), { name: 'AbortError' });
export class AgentSession {
  constructor(options) {
    this.o = options; this.sources = new Set(); this.playHead = 0;
    this.outRate = 16000; this.inRate = 16000; this.micLevel = 0;
    this.closed = false; this.mode = 'listening'; this.interruptedId = -1;
  }
  async start(withMic) {
    try {
      this.ctx = this.o.audioContext();
      await this.ctx.resume();
      if (this.closed) throw aborted();
      this.out = this.ctx.createGain(); this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 512; this.out.connect(this.analyser); this.analyser.connect(this.ctx.destination);
      this.buf = new Uint8Array(this.analyser.fftSize);
      if (withMic) {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('Microphone requires HTTPS and browser permission');
        const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
        if (this.closed) { stream.getTracks().forEach(t => t.stop()); throw aborted(); }
        this.stream = stream;
        stream.getAudioTracks().forEach(t => { t.onended = () => this.fail(new Error('Microphone disconnected')); });
      }
      await new Promise((resolve, reject) => {
        this.cancelStart = reject;
        const ws = this.ws = new WebSocket(`wss://api.elevenlabs.io/v1/convai/conversation?agent_id=${encodeURIComponent(this.o.agentId)}`);
        this.connectTimer = setTimeout(() => { reject(new Error('Voice connection timed out')); this.endSession(); }, this.o.connectTimeoutMs ?? 15000);
        ws.onopen = () => {
          if (this.closed) return;
          ws.send(JSON.stringify({ type: 'conversation_initiation_client_data', conversation_config_override: this.o.override }));
        };
        ws.onmessage = ({ data }) => {
          if (this.closed) return;
          try {
            const event = JSON.parse(data);
            if (event.type === 'conversation_initiation_metadata') {
              const md = event.conversation_initiation_metadata_event || {};
              const input = /^pcm_(\d+)$/.exec(md.user_input_audio_format || '');
              const output = /^pcm_(\d+)$/.exec(md.agent_output_audio_format || '');
              if (!output || (withMic && !input)) throw new Error('Agent must use PCM audio');
              this.outRate = Number(output[1]); this.inRate = input ? Number(input[1]) : 16000;
              if (![this.inRate, this.outRate].every(rate => rate >= 8000 && rate <= 48000)) throw new Error('Unsupported PCM sample rate');
              clearTimeout(this.connectTimer); this.cancelStart = null; resolve();
            }
            this.handle(event);
          } catch (error) { reject(error); this.fail(error); }
        };
        ws.onerror = () => { const error = new Error('Voice network connection failed'); reject(error); this.fail(error); };
        ws.onclose = () => { reject(new Error('Voice connection closed')); this.finish(); };
      });
      if (this.closed) throw aborted();
      if (withMic) await this.startMic();
      if (this.closed) throw aborted();
      this.tick();
    } catch (error) { await this.endSession(); throw error; }
  }
  async startMic() {
    // One worklet message per 40 ms, not one message per 128 input samples.
    // Resampling and PCM conversion stay off the UI / WebGL thread.
    await this.ctx.audioWorklet.addModule(new URL('./pcm-capture-worklet.js', import.meta.url));
    if (this.closed) throw aborted();
    this.micSrc = this.ctx.createMediaStreamSource(this.stream);
    this.node = new AudioWorkletNode(this.ctx, 'kz-pcm-capture', { processorOptions: { targetRate: this.inRate, frameMs: PCM_FRAME_MS } });
    this.mute = this.ctx.createGain(); this.mute.gain.value = 0;
    this.micSrc.connect(this.node); this.node.connect(this.mute); this.mute.connect(this.ctx.destination);
    this.node.onprocessorerror = () => this.fail(new Error('Microphone audio processor failed'));
    this.node.port.onmessage = ({ data }) => {
      if (this.closed || this.ws?.readyState !== 1) return;
      this.micLevel = data.level;
      // Do not queue seconds of old microphone audio on a congested connection.
      if (this.ws.bufferedAmount > 32768) { this.fail(new Error('Voice network is too slow; reconnect')); return; }
      try { this.ws.send(JSON.stringify({ user_audio_chunk: encode(new Uint8Array(data.pcm)) })); }
      catch (error) { this.fail(error); }
    };
  }
  handle(event) {
    if (this.closed) return;
    switch (event.type) {
      case 'audio': {
        const audio = event.audio_event || {};
        if (Number.isFinite(audio.event_id) && audio.event_id <= this.interruptedId) return;
        if (audio.audio_base_64) this.play(audio.audio_base_64);
        break;
      }
      case 'agent_response': this.o.onMessage?.({ source: 'ai', message: event.agent_response_event?.agent_response }); break;
      case 'user_transcript': this.o.onMessage?.({ source: 'user', message: event.user_transcription_event?.user_transcript }); break;
      case 'interruption':
        if (Number.isFinite(event.interruption_event?.event_id)) this.interruptedId = Math.max(this.interruptedId, event.interruption_event.event_id);
        this.stopAudio(); this.o.onInterruption?.(); break;
      case 'ping': this.ws?.readyState === 1 && this.ws.send(JSON.stringify({ type: 'pong', event_id: event.ping_event?.event_id })); break;
      case 'error': this.fail(new Error('Voice service returned an error')); break;
    }
  }
  play(base64) {
    if (this.closed) return;
    const raw = atob(base64);
    if (raw.length % 2) throw new Error('Invalid PCM audio');
    if (!raw.length) return;
    const bytes = Uint8Array.from(raw, c => c.charCodeAt(0)); const view = new DataView(bytes.buffer);
    const buffer = this.ctx.createBuffer(1, bytes.length / 2, this.outRate); const samples = buffer.getChannelData(0);
    for (let i = 0; i < samples.length; i++) samples[i] = view.getInt16(i * 2, true) / 32768;
    // Preserve contiguous streaming playback; only the first chunk gets a jitter cushion.
    const start = Math.max(this.ctx.currentTime + 0.025, this.playHead);
    if (start - this.ctx.currentTime + buffer.duration > 45 || this.sources.size >= 1024) { this.fail(new Error('Voice playback queue overflow')); return; }
    const source = this.ctx.createBufferSource(); source.buffer = buffer; source.connect(this.out);
    source.onended = () => { this.sources.delete(source); source.disconnect(); };
    this.sources.add(source); source.start(start); this.playHead = start + buffer.duration;
  }
  stopAudio() {
    for (const source of this.sources) { source.onended = null; try { source.stop(); source.disconnect(); } catch {} }
    this.sources.clear(); this.playHead = 0;
  }
  tick() {
    if (this.closed) return;
    const mode = this.playHead > this.ctx.currentTime + 0.01 ? 'speaking' : 'listening';
    if (mode !== this.mode) { this.mode = mode; this.o.onModeChange?.({ mode }); }
    this.raf = requestAnimationFrame(() => this.tick());
  }
  getOutputVolume() {
    if (this.closed || !this.analyser) return 0;
    this.analyser.getByteTimeDomainData(this.buf); let sum = 0;
    for (const sample of this.buf) sum += ((sample - 128) / 128) ** 2;
    return Math.sqrt(sum / this.buf.length);
  }
  getInputVolume() { return this.micLevel; }
  sendUserMessage(text) {
    if (this.closed || this.ws?.readyState !== 1) throw new Error('Voice session is not connected');
    this.ws.send(JSON.stringify({ type: 'user_message', text }));
  }
  fail(error) { if (this.closed) return; this.o.onError?.(error); this.finish(); }
  finish() { if (this.closed) return; this.endSession(); this.o.onDisconnect?.(); }
  async endSession() {
    if (this.closed) return;
    this.closed = true; clearTimeout(this.connectTimer); cancelAnimationFrame(this.raf);
    this.cancelStart?.(aborted()); this.cancelStart = null; this.stopAudio();
    if (this.node) { this.node.port.onmessage = null; this.node.onprocessorerror = null; this.node.port.close(); }
    for (const node of [this.node, this.micSrc, this.mute, this.out, this.analyser]) { try { node?.disconnect(); } catch {} }
    this.stream?.getTracks().forEach(t => { t.onended = null; t.stop(); }); this.micLevel = 0;
    if (this.ws) { this.ws.onopen = this.ws.onmessage = this.ws.onerror = this.ws.onclose = null; try { this.ws.close(); } catch {} }
  }
}
