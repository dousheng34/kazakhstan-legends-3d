import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { AgentSession } from './voice-session.js';

globalThis.requestAnimationFrame = () => 1;
globalThis.cancelAnimationFrame = () => {};
class Node {
  constructor() { this.gain = { value: 1 }; this.port = { close() {} }; }
  connect() {} disconnect() { this.disconnected = true; }
  getByteTimeDomainData(a) { a.fill(128); }
  start(t) { this.startTime = t; } stop() { this.stopped = true; }
}
function context() {
  return { currentTime: 0, sampleRate: 48000, destination: {}, resume: async () => {},
    audioWorklet: { addModule: async () => {} },
    createGain: () => new Node(), createAnalyser: () => new Node(), createMediaStreamSource: () => new Node(), createBufferSource: () => new Node(),
    createBuffer: (_, n, rate) => ({ duration: n / rate, getChannelData: () => new Float32Array(n) }) };
}
class Socket {
  static all = [];
  constructor() { this.readyState = 0; this.bufferedAmount = 0; this.sent = []; Socket.all.push(this); }
  open() { this.readyState = 1; this.onopen?.(); }
  message(event) { this.onmessage?.({ data: JSON.stringify(event) }); }
  send(data) { this.sent.push(JSON.parse(data)); }
  close() { this.readyState = 3; this.closed = true; }
}
globalThis.WebSocket = Socket;
globalThis.AudioWorkletNode = Node;
const settle = () => new Promise(resolve => setImmediate(resolve));
function session(options = {}) { return new AgentSession({ agentId: 'test', audioContext: context, override: {}, ...options }); }
const metadata = { type: 'conversation_initiation_metadata', conversation_initiation_metadata_event: { agent_output_audio_format: 'pcm_16000', user_input_audio_format: 'pcm_16000' } };
async function ready(s, mic = false) { const promise = s.start(mic); await settle(); const ws = s.ws; ws.open(); ws.message(metadata); await promise; return ws; }
const audio = (id) => ({ type: 'audio', audio_event: { event_id: id, audio_base_64: Buffer.alloc(1280).toString('base64') } });

test('typed sessions never request a microphone; immediate pong and cleanup', async () => {
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices: { getUserMedia() { throw new Error('must not call'); } } } });
  const s = session(); const ws = await ready(s);
  ws.message({ type: 'ping', ping_event: { event_id: 4, ping_ms: 10000 } });
  assert.deepEqual(ws.sent.at(-1), { type: 'pong', event_id: 4 });
  s.sendUserMessage('test'); assert.equal(ws.sent.at(-1).text, 'test');
  await s.endSession(); await s.endSession(); assert.ok(ws.closed); assert.ok(s.analyser.disconnected);
  assert.throws(() => s.sendUserMessage('late'), /not connected/);
});
test('cancel while permission is pending stops late microphone tracks', async () => {
  let resolveMic, stops = 0;
  navigator.mediaDevices.getUserMedia = () => new Promise(resolve => { resolveMic = resolve; });
  const s = session(), promise = s.start(true); await settle();
  await s.endSession(); resolveMic({ getTracks: () => [{ stop() { stops++; } }] });
  await assert.rejects(promise, { name: 'AbortError' }); assert.equal(stops, 1); assert.equal(s.ws, undefined);
});
test('cancel during websocket handshake settles start without resurrecting', async () => {
  const s = session(); const promise = s.start(false); await settle();
  await s.endSession(); await assert.rejects(promise, { name: 'AbortError' }); assert.ok(s.ws.closed);
});
test('connection timeout cleans all allocated nodes', async () => {
  const s = session({ connectTimeoutMs: 8 }); await assert.rejects(s.start(false), /timed out/);
  assert.ok(s.closed); assert.ok(s.ws.closed); assert.ok(s.out.disconnected);
});
test('interruption discards queued and late audio, keeps newer response', async () => {
  const s = session(); const ws = await ready(s);
  ws.message(audio(8)); assert.equal(s.sources.size, 1); const source = [...s.sources][0];
  ws.message({ type: 'interruption', interruption_event: { event_id: 8 } });
  assert.ok(source.stopped); assert.equal(s.sources.size, 0);
  ws.message(audio(8)); assert.equal(s.sources.size, 0);
  ws.message(audio(9)); assert.equal(s.sources.size, 1); await s.endSession();
});
test('remote disconnect stops microphone and releases worklet graph', async () => {
  let stops = 0, disconnected = 0; const track = { stop() { stops++; } };
  navigator.mediaDevices.getUserMedia = async () => ({ getTracks: () => [track], getAudioTracks: () => [track] });
  const s = session({ onDisconnect() { disconnected++; } }); const ws = await ready(s, true);
  ws.onclose(); assert.ok(s.closed); assert.equal(stops, 1); assert.equal(disconnected, 1); assert.ok(s.mute.disconnected);
});
test('network backpressure fails rather than queuing stale microphone audio', async () => {
  let failed = false; const track = { stop() {} };
  navigator.mediaDevices.getUserMedia = async () => ({ getTracks: () => [track], getAudioTracks: () => [track] });
  const s = session({ onError() { failed = true; } }); const ws = await ready(s, true);
  ws.bufferedAmount = 40000; s.node.port.onmessage({ data: { pcm: new ArrayBuffer(1280), level: 0.1 } });
  assert.ok(failed); assert.ok(s.closed);
});
test('unsupported server audio fails without leaking microphone', async () => {
  const s = session(); const p = s.start(false); await settle(); s.ws.open();
  s.ws.message({ type: 'conversation_initiation_metadata', conversation_initiation_metadata_event: { agent_output_audio_format: 'mp3_44100' } });
  await assert.rejects(p, /PCM/); assert.ok(s.closed);
});
for (const rate of [44100, 48000]) test(`worklet ${rate} Hz to 16 kHz: continuous phase and 40 ms frames`, () => {
  let Processor; const packets = [];
  const sandbox = { sampleRate: rate, AudioWorkletProcessor: class { constructor() { this.port = { postMessage: packet => packets.push(packet) }; } }, registerProcessor: (_, p) => { Processor = p; } };
  vm.runInNewContext(readFileSync(new URL('./pcm-capture-worklet.js', import.meta.url), 'utf8'), sandbox);
  const capture = new Processor({ processorOptions: { targetRate: 16000, frameMs: 40 } });
  for (let offset = 0; offset < rate; offset += 128) capture.process([[new Float32Array(Math.min(128, rate - offset)).fill(0.5)]]);
  assert.equal(packets.length, 25); assert.equal(packets[0].pcm.byteLength, 1280);
  for (const packet of packets) { assert.ok(Math.abs(packet.level - 0.5) < 0.0001); assert.ok([...new Int16Array(packet.pcm)].every(n => Math.abs(n - 16384) <= 1)); }
});

test('latency: typed request and transcript are measured once, interruption cancels measurement', async () => {
  const seen = [];
  const s = session({ onLatency: x => seen.push(x) }); const ws = await ready(s);
  s.sendUserMessage('a'); ws.message(audio(1)); ws.message(audio(2));
  assert.equal(seen.length, 1); assert.equal(seen[0].kind, 'text→audio'); assert.ok(seen[0].ms >= 0);
  ws.message({ type: 'user_transcript', user_transcription_event: { user_transcript: 'x' } }); ws.message(audio(3));
  assert.equal(seen.length, 2); assert.equal(seen[1].kind, 'transcript→audio');
  s.sendUserMessage('b'); ws.message({ type: 'interruption', interruption_event: { event_id: 3 } }); ws.message(audio(4));
  assert.equal(seen.length, 2); await s.endSession();
});
