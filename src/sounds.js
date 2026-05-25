function generateWav(samples, sampleRate = 44100) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const write = (offset, str) => { for(let i=0;i<str.length;i++) view.setUint8(offset+i, str.charCodeAt(i)); };
  write(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  write(8, "WAVE");
  write(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, "data");
  view.setUint32(40, samples.length * 2, true);
  for(let i=0;i<samples.length;i++) {
    view.setInt16(44 + i*2, Math.max(-32768, Math.min(32767, samples[i] * 32767)), true);
  }
  const bytes = new Uint8Array(buffer);
  let bin = "";
  for(let i=0;i<bytes.length;i++) bin += String.fromCharCode(bytes[i]);
  return "data:audio/wav;base64," + btoa(bin);
}

const SR = 44100;
const TARGET_PEAK = 0.7;

function normalize(s) {
  let peak = 0;
  for(let i=0;i<s.length;i++) { const v = Math.abs(s[i]); if(v>peak) peak=v; }
  if(peak > 0) for(let i=0;i<s.length;i++) s[i] = s[i] / peak * TARGET_PEAK;
  return s;
}

function makeMoveSound() {
  const n = Math.floor(SR * 0.12);
  const s = new Float32Array(n);
  for(let i=0;i<n;i++) {
    const t = i/SR;
    const freq = 520 * Math.exp(-8*t);
    s[i] = 0.4 * Math.sin(2*Math.PI*freq*t) * Math.exp(-20*t);
  }
  return generateWav(normalize(s));
}

function makeCaptureSound() {
  const n = Math.floor(SR * 0.18);
  const s = new Float32Array(n);
  for(let i=0;i<n;i++) {
    const t = i/SR;
    const freq = 280 * Math.exp(-6*t);
    const noise = (Math.random()*2-1) * 0.3;
    s[i] = (0.5 * Math.sin(2*Math.PI*freq*t) + noise) * Math.exp(-15*t);
  }
  return generateWav(normalize(s));
}

function makeCheckSound() {
  const n = Math.floor(SR * 0.25);
  const s = new Float32Array(n);
  for(let i=0;i<n;i++) {
    const t = i/SR;
    const v1 = t < 0.1 ? 0.25 * Math.sign(Math.sin(2*Math.PI*880*t)) * Math.exp(-20*(t)) : 0;
    const v2 = t > 0.13 && t < 0.23 ? 0.25 * Math.sign(Math.sin(2*Math.PI*880*(t-0.13))) * Math.exp(-20*(t-0.13)) : 0;
    s[i] = v1 + v2;
  }
  return generateWav(normalize(s));
}

function makeWinSound() {
  const notes = [523, 659, 784, 1047];
  const n = Math.floor(SR * 0.9);
  const s = new Float32Array(n);
  notes.forEach((freq, idx) => {
    const start = Math.floor(SR * idx * 0.13);
    const len = Math.floor(SR * 0.28);
    for(let i=0;i<len && start+i<n;i++) {
      const t = i/SR;
      s[start+i] += 0.3 * Math.sin(2*Math.PI*freq*t) * Math.exp(-5*t);
    }
  });
  return generateWav(normalize(s));
}

export const SOUND_MOVE    = makeMoveSound();
export const SOUND_CAPTURE = makeCaptureSound();
export const SOUND_CHECK   = makeCheckSound();
export const SOUND_WIN     = makeWinSound();
