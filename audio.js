// audio.js - all sounds are generated with the Web Audio API (no audio files needed)
const SFX = (() => {
  let ac = null;          // AudioContext (created on first user action)
  let master = null;      // master volume
  let noiseBuf = null;    // shared white-noise buffer
  let engine = null;      // engine nodes
  let wind = null;        // wind / nitro rush nodes
  let rain = null;        // rain nodes
  let muted = false;
  let nitroWas = false;
  let lastCoin = 0;
  let combo = 0;
  const VOLUME = 0.8;

  try { muted = localStorage.getItem('endlessDriveMuted') === '1'; } catch (e) {}

  // ---------- setup ----------
  function init() {
    if (ac) {
      if (ac.state === 'suspended') ac.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ac = new AC();

    // master gain -> compressor (avoids clipping) -> speakers
    master = ac.createGain();
    master.gain.value = muted ? 0 : VOLUME;
    const comp = ac.createDynamicsCompressor();
    master.connect(comp);
    comp.connect(ac.destination);

    // 2 seconds of white noise, reused by everything noisy
    noiseBuf = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

    buildEngine();
    wind = buildLoop('bandpass', 700, 0.8);
    rain = buildLoop('highpass', 2500, 0.7);
  }

  function buildEngine() {
    const o1 = ac.createOscillator();
    const o2 = ac.createOscillator();
    const mix2 = ac.createGain();
    const filter = ac.createBiquadFilter();
    const gain = ac.createGain();

    o1.type = 'sawtooth';
    o2.type = 'square';
    mix2.gain.value = 0.5;
    filter.type = 'lowpass';
    filter.frequency.value = 400;
    gain.gain.value = 0;

    o1.connect(filter);
    o2.connect(mix2);
    mix2.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    o1.start();
    o2.start();
    engine = { o1, o2, filter, gain };
  }

  function buildLoop(filterType, freq, q) {
    const src = ac.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    const filter = ac.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.value = freq;
    filter.Q.value = q;
    const gain = ac.createGain();
    gain.gain.value = 0;
    src.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    src.start();
    return { filter, gain };
  }

  // ---------- helpers ----------
  function tone(freq, delay, dur, type, vol, slideTo) {
    const t = ac.currentTime + delay;
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  function noise(type, dur, vol, f0, f1) {
    const t = ac.currentTime;
    const s = ac.createBufferSource();
    s.buffer = noiseBuf;
    const f = ac.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f);
    f.connect(g);
    g.connect(master);
    s.start(t);
    s.stop(t + dur + 0.05);
  }

  const ready = () => ac && ac.state !== 'closed';

  // ---------- engine / ambience (called every frame) ----------
  function start() {
    init();
    if (!ready()) return;
    const t = ac.currentTime;
    // little "ignition rev" at the start
    engine.o1.frequency.cancelScheduledValues(t);
    engine.o1.frequency.setValueAtTime(40, t);
    engine.o1.frequency.exponentialRampToValueAtTime(90, t + 0.6);
    engine.o2.frequency.cancelScheduledValues(t);
    engine.o2.frequency.setValueAtTime(60, t);
    engine.o2.frequency.exponentialRampToValueAtTime(135, t + 0.6);
    engine.gain.gain.cancelScheduledValues(t);
    engine.gain.gain.setValueAtTime(0.0001, t);
    engine.gain.gain.exponentialRampToValueAtTime(0.18, t + 0.3);
    nitroWas = false;
    combo = 0;
  }

  function engineUpdate(speed, boost) {
    if (!ready()) return;
    const t = ac.currentTime;
    const r = Math.max(0, Math.min(1, (speed * boost - 250) / 650)); // 0..1
    const f = 55 + r * 130;
    engine.o1.frequency.setTargetAtTime(f, t, 0.1);
    engine.o2.frequency.setTargetAtTime(f * 1.505, t, 0.1);
    engine.filter.frequency.setTargetAtTime(350 + r * 1500, t, 0.1);
    engine.gain.gain.setTargetAtTime(0.17 + r * 0.08, t, 0.1);
    // wind rush grows with speed and gets louder with nitro
    const rush = r * 0.09 + (boost > 1.1 ? (boost - 1) * 0.35 : 0);
    wind.gain.gain.setTargetAtTime(rush, t, 0.1);
    wind.filter.frequency.setTargetAtTime(500 + r * 1500, t, 0.1);
  }

  function rainUpdate(level) {
    if (!ready()) return;
    rain.gain.gain.setTargetAtTime(level * 0.1, ac.currentTime, 0.4);
  }

  function stopLoops() {
    if (!ready()) return;
    const t = ac.currentTime;
    engine.gain.gain.cancelScheduledValues(t);
    engine.gain.gain.setTargetAtTime(0, t, 0.15);
    wind.gain.gain.setTargetAtTime(0, t, 0.15);
    rain.gain.gain.setTargetAtTime(0, t, 0.3);
  }

  // ---------- one-shot effects ----------
  function setNitro(on) {
    if (!ready()) return;
    if (on && !nitroWas) {
      noise('bandpass', 0.6, 0.35, 300, 3500);   // rising whoosh
      tone(90, 0, 0.5, 'sawtooth', 0.15, 220);   // power-up growl
    }
    nitroWas = on;
  }

  function coin() {
    if (!ready()) return;
    const now = ac.currentTime;
    combo = now - lastCoin < 1 ? Math.min(combo + 1, 8) : 0;  // pitch rises on a coin streak
    lastCoin = now;
    const m = Math.pow(2, (combo * 2) / 12);
    tone(988 * m, 0, 0.08, 'square', 0.1);
    tone(1319 * m, 0.07, 0.18, 'square', 0.1);
  }

  function fuel() {
    if (!ready()) return;
    tone(523, 0, 0.12, 'triangle', 0.25);
    tone(659, 0.09, 0.12, 'triangle', 0.25);
    tone(784, 0.18, 0.25, 'triangle', 0.25);
  }

  function whoosh() {
    if (!ready()) return;
    noise('bandpass', 0.28, 0.22, 600, 2600);
  }

  function lowFuel() {
    if (!ready()) return;
    tone(880, 0, 0.09, 'square', 0.07);
    tone(880, 0.16, 0.09, 'square', 0.07);
  }

  function chime() {
    if (!ready()) return;
    tone(660, 0, 0.35, 'sine', 0.15);
    tone(990, 0.12, 0.5, 'sine', 0.12);
  }

  function crash() {
    if (!ready()) return;
    stopLoops();
    noise('lowpass', 0.8, 0.9, 4000, 80);        // crunch
    tone(130, 0, 0.6, 'sine', 0.7, 35);          // thump
    tone(240, 0, 0.25, 'sawtooth', 0.2, 60);     // metal
  }

  function sputter() {
    if (!ready()) return;
    stopLoops();
    tone(160, 0, 0.7, 'sawtooth', 0.22, 35);
    for (let i = 0; i < 4; i++) tone(110 - i * 12, 0.15 + i * 0.18, 0.08, 'square', 0.12);
  }

  // ---------- mute ----------
  function toggleMute() {
    muted = !muted;
    try { localStorage.setItem('endlessDriveMuted', muted ? '1' : '0'); } catch (e) {}
    if (ready()) master.gain.setTargetAtTime(muted ? 0 : VOLUME, ac.currentTime, 0.05);
    return muted;
  }

  // pause all sound when the tab is hidden
  document.addEventListener('visibilitychange', () => {
    if (!ac) return;
    if (document.hidden) ac.suspend();
    else ac.resume();
  });

  return {
    init, start, engine: engineUpdate, rain: rainUpdate, setNitro,
    coin, fuel, whoosh, lowFuel, chime, crash, sputter,
    toggleMute, isMuted: () => muted, state: () => (ac ? ac.state : 'none')
  };
})();