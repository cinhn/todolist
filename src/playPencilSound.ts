/**
 * Short “pencil on paper” scribble using Web Audio (filtered noise bursts).
 * primeTaskDoneAudio() should run from a user gesture (e.g. checkbox click) so the context can start.
 */

let audioCtx: AudioContext | null = null;

function getContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!audioCtx) {
    const Ctx = window.AudioContext ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return null;
    try {
      audioCtx = new Ctx();
    } catch {
      return null;
    }
  }
  return audioCtx;
}

export function primeTaskDoneAudio(): void {
  const ctx = getContext();
  if (ctx?.state === "suspended") {
    void ctx.resume();
  }
}

function noiseBuffer(ctx: AudioContext, durationSec: number): AudioBuffer {
  const n = Math.max(1, Math.floor(ctx.sampleRate * durationSec));
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < n; i++) {
    const w = Math.random() * 2 - 1;
    last = (last + w * 0.12) * 0.93;
    d[i] = Math.max(-1, Math.min(1, last * 4));
  }
  return buf;
}

export function playPencilDoneSound(): void {
  const ctx = getContext();
  if (!ctx) return;
  if (ctx.state === "suspended") {
    void ctx.resume();
  }

  const t0 = ctx.currentTime + 0.001;
  const master = ctx.createGain();
  master.gain.value = 0.55;
  master.connect(ctx.destination);

  const strokes = 7;
  for (let s = 0; s < strokes; s++) {
    const start = t0 + s * 0.024 + Math.random() * 0.014;
    const len = 0.038 + Math.random() * 0.032;

    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(ctx, len);

    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.setValueAtTime(2200 + s * 350 + Math.random() * 900, start);
    bp.Q.setValueAtTime(1.1, start);

    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.setValueAtTime(900, start);
    hp.Q.setValueAtTime(0.7, start);

    const g = ctx.createGain();
    g.gain.setValueAtTime(0, start);
    g.gain.linearRampToValueAtTime(0.14 + Math.random() * 0.06, start + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0008, start + len);

    src.connect(bp);
    bp.connect(hp);
    hp.connect(g);
    g.connect(master);

    src.start(start);
    src.stop(start + len + 0.03);
  }

  window.setTimeout(() => {
    try {
      master.disconnect();
    } catch {
      /* ignore */
    }
  }, 600);
}
