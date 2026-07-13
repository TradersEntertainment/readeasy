// Ortam sesleri: tamamı Web Audio API ile gerçek zamanlı sentezlenir.
// Hiçbir ses dosyası kullanılmaz — dolayısıyla lisans sorunu yoktur ve
// paket boyutuna tek bayt eklenmez.

export const AMBIENCES = [
  { id: "rain", name: "Yağmur", emoji: "🌧️" },
  { id: "ocean", name: "Okyanus", emoji: "🌊" },
  { id: "fire", name: "Şömine", emoji: "🔥" },
  { id: "piano", name: "Piyano", emoji: "🎹" },
  { id: "white", name: "Beyaz gürültü", emoji: "🌫️" },
  { id: "brown", name: "Derin gürültü", emoji: "🌰" },
] as const;

export type AmbienceId = (typeof AMBIENCES)[number]["id"];

type Cleanup = () => void;

class AmbienceEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private cleanup: Cleanup | null = null;
  private volume = 0.6;

  private ensure(): { ctx: AudioContext; master: GainNode } {
    if (!this.ctx) {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0;
      this.master.connect(this.ctx.destination);
    }
    void this.ctx.resume();
    return { ctx: this.ctx, master: this.master! };
  }

  setVolume(v: number) {
    this.volume = v;
    if (this.ctx && this.master && this.cleanup) {
      this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.1);
    }
  }

  play(id: AmbienceId) {
    this.teardown();
    const { ctx, master } = this.ensure();
    switch (id) {
      case "rain":
        this.cleanup = rain(ctx, master);
        break;
      case "ocean":
        this.cleanup = ocean(ctx, master);
        break;
      case "fire":
        this.cleanup = fire(ctx, master);
        break;
      case "piano":
        this.cleanup = piano(ctx, master);
        break;
      case "white":
        this.cleanup = plainNoise(ctx, master, "white");
        break;
      case "brown":
        this.cleanup = plainNoise(ctx, master, "brown");
        break;
    }
    master.gain.setTargetAtTime(this.volume, ctx.currentTime, 0.4);
  }

  stop() {
    if (this.ctx && this.master) {
      this.master.gain.setTargetAtTime(0, this.ctx.currentTime, 0.15);
    }
    this.teardown(600);
  }

  private teardown(delayMs = 0) {
    const fn = this.cleanup;
    this.cleanup = null;
    if (!fn) return;
    if (delayMs > 0) setTimeout(fn, delayMs);
    else fn();
  }
}

export const ambience = new AmbienceEngine();

// ---------- yardımcılar ----------

function noiseBuffer(
  ctx: AudioContext,
  type: "white" | "pink" | "brown",
): AudioBuffer {
  const length = ctx.sampleRate * 8;
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  if (type === "white") {
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
  } else if (type === "brown") {
    let last = 0;
    for (let i = 0; i < length; i++) {
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      data[i] = last * 3.5;
    }
  } else {
    // pink: Paul Kellet yaklaşımı
    let b0 = 0,
      b1 = 0,
      b2 = 0;
    for (let i = 0; i < length; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.997 * b0 + 0.0299 * w;
      b1 = 0.985 * b1 + 0.0563 * w;
      b2 = 0.95 * b2 + 0.115 * w;
      data[i] = (b0 + b1 + b2 + w * 0.05) * 2.2;
    }
  }
  return buffer;
}

function noiseSource(
  ctx: AudioContext,
  type: "white" | "pink" | "brown",
): AudioBufferSourceNode {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx, type);
  src.loop = true;
  src.start();
  return src;
}

// Rastgele aralıklarla tekrar eden zamanlayıcı (yağmur damlası, çıtırtı, nota).
function scheduler(fire: () => number): Cleanup {
  let alive = true;
  let timer = 0;
  const tick = () => {
    if (!alive) return;
    const next = fire();
    timer = window.setTimeout(tick, next);
  };
  tick();
  return () => {
    alive = false;
    clearTimeout(timer);
  };
}

// ---------- sesler ----------

function plainNoise(
  ctx: AudioContext,
  out: AudioNode,
  type: "white" | "brown",
): Cleanup {
  const src = noiseSource(ctx, type);
  const gain = ctx.createGain();
  gain.gain.value = type === "white" ? 0.12 : 0.45;
  src.connect(gain);
  gain.connect(out);
  return () => {
    src.stop();
    gain.disconnect();
  };
}

function rain(ctx: AudioContext, out: AudioNode): Cleanup {
  // Zemin: alçak geçiren süzgeçten geçmiş pembe gürültü
  const bed = noiseSource(ctx, "pink");
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 1100;
  const bedGain = ctx.createGain();
  bedGain.gain.value = 0.35;
  bed.connect(lp);
  lp.connect(bedGain);
  bedGain.connect(out);

  // Damlalar: kısa, tiz gürültü patlamaları
  const dropBuffer = noiseBuffer(ctx, "white");
  const stopDrops = scheduler(() => {
    const t = ctx.currentTime;
    const drop = ctx.createBufferSource();
    drop.buffer = dropBuffer;
    drop.playbackRate.value = 0.8 + Math.random() * 0.6;
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 3500 + Math.random() * 4000;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.05 + Math.random() * 0.06, t);
    env.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
    drop.connect(hp);
    hp.connect(env);
    env.connect(out);
    drop.start(t, Math.random() * 6, 0.08);
    return 30 + Math.random() * 120;
  });

  return () => {
    stopDrops();
    bed.stop();
    bedGain.disconnect();
  };
}

function ocean(ctx: AudioContext, out: AudioNode): Cleanup {
  const bed = noiseSource(ctx, "pink");
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 500;

  // Dalga kabarması: süzgeç frekansını ve sesi çok yavaş bir LFO sürer
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 0.07;
  const lfoToFilter = ctx.createGain();
  lfoToFilter.gain.value = 350;
  lfo.connect(lfoToFilter);
  lfoToFilter.connect(lp.frequency);

  const swell = ctx.createGain();
  swell.gain.value = 0.4;
  const lfoToGain = ctx.createGain();
  lfoToGain.gain.value = 0.22;
  lfo.connect(lfoToGain);
  lfoToGain.connect(swell.gain);
  lfo.start();

  bed.connect(lp);
  lp.connect(swell);
  swell.connect(out);

  return () => {
    bed.stop();
    lfo.stop();
    swell.disconnect();
    lfoToFilter.disconnect();
    lfoToGain.disconnect();
  };
}

function fire(ctx: AudioContext, out: AudioNode): Cleanup {
  const bed = noiseSource(ctx, "brown");
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 450;
  const bedGain = ctx.createGain();
  bedGain.gain.value = 0.5;
  bed.connect(lp);
  lp.connect(bedGain);
  bedGain.connect(out);

  // Çıtırtılar
  const crackBuffer = noiseBuffer(ctx, "white");
  const stopCracks = scheduler(() => {
    const t = ctx.currentTime;
    const crack = ctx.createBufferSource();
    crack.buffer = crackBuffer;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 1800 + Math.random() * 2500;
    bp.Q.value = 1.5;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.08 + Math.random() * 0.12, t);
    env.gain.exponentialRampToValueAtTime(0.0001, t + 0.03 + Math.random() * 0.05);
    crack.connect(bp);
    bp.connect(env);
    env.connect(out);
    crack.start(t, Math.random() * 6, 0.1);
    return 60 + Math.random() * 350;
  });

  return () => {
    stopCracks();
    bed.stop();
    bedGain.disconnect();
  };
}

// Üretken piyano: majör pentatonik gamdan rastgele, yumuşak notalar.
// Pentatonik gamda hiçbir nota birbiriyle çatışmadığı için sonuç her zaman
// huzurlu duyulur.
const SCALE = [130.81, 196.0, 261.63, 293.66, 329.63, 392.0, 440.0, 523.25, 587.33, 659.25];

function piano(ctx: AudioContext, out: AudioNode): Cleanup {
  // Alan hissi için basit bir geri beslemeli gecikme
  const delay = ctx.createDelay(1);
  delay.delayTime.value = 0.42;
  const feedback = ctx.createGain();
  feedback.gain.value = 0.32;
  const damp = ctx.createBiquadFilter();
  damp.type = "lowpass";
  damp.frequency.value = 1800;
  const wet = ctx.createGain();
  wet.gain.value = 0.5;
  delay.connect(damp);
  damp.connect(feedback);
  feedback.connect(delay);
  delay.connect(wet);
  wet.connect(out);

  const bus = ctx.createGain();
  bus.gain.value = 0.9;
  bus.connect(out);
  bus.connect(delay);

  const oscillators: OscillatorNode[] = [];
  const playNote = (freq: number, time: number, velocity: number) => {
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, time);
    env.gain.linearRampToValueAtTime(velocity, time + 0.025);
    env.gain.exponentialRampToValueAtTime(0.0001, time + 4.5);
    const fundamental = ctx.createOscillator();
    fundamental.type = "sine";
    fundamental.frequency.value = freq;
    const harmonic = ctx.createOscillator();
    harmonic.type = "sine";
    harmonic.frequency.value = freq * 2;
    const harmonicGain = ctx.createGain();
    harmonicGain.gain.value = 0.22;
    fundamental.connect(env);
    harmonic.connect(harmonicGain);
    harmonicGain.connect(env);
    env.connect(bus);
    fundamental.start(time);
    harmonic.start(time);
    fundamental.stop(time + 5);
    harmonic.stop(time + 5);
    oscillators.push(fundamental, harmonic);
    if (oscillators.length > 24) oscillators.splice(0, oscillators.length - 24);
  };

  const stopNotes = scheduler(() => {
    const t = ctx.currentTime + 0.05;
    const idx = Math.floor(Math.random() * SCALE.length);
    playNote(SCALE[idx], t, 0.16 + Math.random() * 0.12);
    // Ara sıra uyumlu bir ikinci nota
    if (Math.random() < 0.35) {
      const second = Math.min(SCALE.length - 1, idx + 2);
      playNote(SCALE[second], t + 0.1 + Math.random() * 0.25, 0.1);
    }
    return 1300 + Math.random() * 2800;
  });

  return () => {
    stopNotes();
    for (const osc of oscillators) {
      try {
        osc.stop();
      } catch {
        // zaten durmuş olabilir
      }
    }
    bus.disconnect();
    wet.disconnect();
    feedback.disconnect();
  };
}
