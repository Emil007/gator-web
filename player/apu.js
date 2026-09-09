/**
 * Minimal DMG APU → Web Audio.
 * Square1/2, wave, noise + master control. Enough for HAL pinball SFX/music.
 */

const DUTY = [
  [0, 0, 0, 0, 0, 0, 0, 1],
  [1, 0, 0, 0, 0, 0, 0, 1],
  [1, 0, 0, 0, 0, 1, 1, 1],
  [0, 1, 1, 1, 1, 1, 1, 0],
];

const CAP = 0x15; // max |sample| scale

function chSquare() {
  return {
    enabled: false,
    dac: false,
    sweepPeriod: 0,
    sweepNeg: false,
    sweepShift: 0,
    sweepTimer: 0,
    sweepEnable: false,
    shadow: 0,
    duty: 0,
    length: 0,
    lengthEnable: false,
    volume: 0,
    envVol: 0,
    envPeriod: 0,
    envTimer: 0,
    envAdd: false,
    freq: 0,
    timer: 0,
    dutyPos: 0,
    left: false,
    right: false,
  };
}

function chWave() {
  return {
    enabled: false,
    dac: false,
    length: 0,
    lengthEnable: false,
    volumeCode: 0,
    freq: 0,
    timer: 0,
    pos: 0,
    left: false,
    right: false,
  };
}

function chNoise() {
  return {
    enabled: false,
    dac: false,
    length: 0,
    lengthEnable: false,
    volume: 0,
    envVol: 0,
    envPeriod: 0,
    envTimer: 0,
    envAdd: false,
    clockShift: 0,
    width7: false,
    divisorCode: 0,
    timer: 0,
    lfsr: 0x7fff,
    left: false,
    right: false,
  };
}

export function createApu() {
  const nr = new Uint8Array(0x30); // FF10-FF3F
  const wave = new Uint8Array(16);
  const sq1 = chSquare();
  const sq2 = chSquare();
  const wav = chWave();
  const noi = chNoise();

  let master = true;
  let frameSeq = 0;
  let frameTimer = 0; // T-cycles toward 8192 (512 Hz)
  let vinL = 0;
  let vinR = 0;
  let volL = 0;
  let volR = 0;

  let audioCtx = null;
  let scriptNode = null;
  let sampleBudget = 0; // T-cycles of audio owed to the device
  const CPU = 4194304;

  function noisePeriod() {
    const div = [8, 16, 32, 48, 64, 80, 96, 112][noi.divisorCode & 7];
    return div << noi.clockShift;
  }

  function squareFreqTimer(freq) {
    return (2048 - (freq & 0x7ff)) * 4;
  }

  function waveFreqTimer(freq) {
    return (2048 - (freq & 0x7ff)) * 2;
  }

  function triggerSquare(ch, withSweep) {
    ch.enabled = ch.dac;
    ch.envVol = ch.volume;
    ch.envTimer = ch.envPeriod || 8;
    ch.timer = squareFreqTimer(ch.freq);
    ch.dutyPos = 0;
    if (ch.length === 0) ch.length = 64;
    if (withSweep) {
      ch.shadow = ch.freq;
      ch.sweepTimer = ch.sweepPeriod || 8;
      ch.sweepEnable = ch.sweepPeriod > 0 || ch.sweepShift > 0;
      if (ch.sweepShift > 0) {
        const s = sweepCalc(ch);
        if (s > 0x7ff) ch.enabled = false;
      }
    }
  }

  function sweepCalc(ch) {
    let f = ch.shadow >> ch.sweepShift;
    if (ch.sweepNeg) f = ch.shadow - f;
    else f = ch.shadow + f;
    return f;
  }

  function triggerWave() {
    wav.enabled = wav.dac;
    wav.timer = waveFreqTimer(wav.freq);
    wav.pos = 0;
    if (wav.length === 0) wav.length = 256;
  }

  function triggerNoise() {
    noi.enabled = noi.dac;
    noi.envVol = noi.volume;
    noi.envTimer = noi.envPeriod || 8;
    noi.timer = noisePeriod();
    noi.lfsr = 0x7fff;
    if (noi.length === 0) noi.length = 64;
  }

  function clockLength() {
    const tick = (ch, max) => {
      if (ch.lengthEnable && ch.length > 0) {
        ch.length--;
        if (ch.length === 0) ch.enabled = false;
      }
    };
    tick(sq1, 64);
    tick(sq2, 64);
    if (wav.lengthEnable && wav.length > 0) {
      wav.length--;
      if (wav.length === 0) wav.enabled = false;
    }
    tick(noi, 64);
  }

  function clockEnv(ch) {
    if (!ch.envPeriod) return;
    if (ch.envTimer > 0) ch.envTimer--;
    if (ch.envTimer === 0) {
      ch.envTimer = ch.envPeriod;
      if (ch.envAdd && ch.envVol < 15) ch.envVol++;
      else if (!ch.envAdd && ch.envVol > 0) ch.envVol--;
    }
  }

  function clockSweep() {
    if (!sq1.sweepEnable || !sq1.enabled) return;
    if (sq1.sweepTimer > 0) sq1.sweepTimer--;
    if (sq1.sweepTimer === 0) {
      sq1.sweepTimer = sq1.sweepPeriod || 8;
      if (sq1.sweepPeriod > 0) {
        const f = sweepCalc(sq1);
        if (f > 0x7ff) sq1.enabled = false;
        else if (sq1.sweepShift > 0) {
          sq1.shadow = f;
          sq1.freq = f;
          const f2 = sweepCalc(sq1);
          if (f2 > 0x7ff) sq1.enabled = false;
        }
      }
    }
  }

  function stepFrameSequencer() {
    // 512 Hz steps; length on 0,2,4,6; sweep on 2,6; env on 7
    switch (frameSeq) {
      case 0:
      case 2:
      case 4:
      case 6:
        clockLength();
        if (frameSeq === 2 || frameSeq === 6) clockSweep();
        break;
      case 7:
        clockEnv(sq1);
        clockEnv(sq2);
        clockEnv(noi);
        break;
    }
    frameSeq = (frameSeq + 1) & 7;
  }

  function stepChannels(t) {
    // square
    for (const ch of [sq1, sq2]) {
      if (!ch.enabled) continue;
      ch.timer -= t;
      while (ch.timer <= 0) {
        ch.timer += squareFreqTimer(ch.freq);
        ch.dutyPos = (ch.dutyPos + 1) & 7;
      }
    }
    if (wav.enabled) {
      wav.timer -= t;
      while (wav.timer <= 0) {
        wav.timer += waveFreqTimer(wav.freq);
        wav.pos = (wav.pos + 1) & 31;
      }
    }
    if (noi.enabled) {
      noi.timer -= t;
      while (noi.timer <= 0) {
        noi.timer += Math.max(8, noisePeriod());
        const lo = noi.lfsr & 1;
        const hi = (noi.lfsr >> 1) & 1;
        const xor = lo ^ hi;
        noi.lfsr = (noi.lfsr >> 1) | (xor << 14);
        if (noi.width7) {
          noi.lfsr &= ~(1 << 6);
          noi.lfsr |= xor << 6;
        }
      }
    }
  }

  function sampleSquare(ch) {
    if (!ch.enabled || !ch.dac) return 0;
    return DUTY[ch.duty][ch.dutyPos] ? ch.envVol : 0;
  }

  function sampleWave() {
    if (!wav.enabled || !wav.dac) return 0;
    const shift = [4, 0, 1, 2][wav.volumeCode & 3];
    if (shift === 4) return 0;
    const byte = wave[wav.pos >> 1];
    const nibble = wav.pos & 1 ? byte & 0xf : byte >> 4;
    return nibble >> shift;
  }

  function sampleNoise() {
    if (!noi.enabled || !noi.dac) return 0;
    return noi.lfsr & 1 ? 0 : noi.envVol;
  }

  function mixSample() {
    if (!master) return [0, 0];
    let l = 0,
      r = 0;
    const s1 = sampleSquare(sq1);
    const s2 = sampleSquare(sq2);
    const sw = sampleWave();
    const sn = sampleNoise();
    if (sq1.left) l += s1;
    if (sq1.right) r += s1;
    if (sq2.left) l += s2;
    if (sq2.right) r += s2;
    if (wav.left) l += sw;
    if (wav.right) r += sw;
    if (noi.left) l += sn;
    if (noi.right) r += sn;
    // NR50 volumes 0-7 → scale; DAC outputs roughly -1..1 style after bias
    const vl = (volL + 1) / 8;
    const vr = (volR + 1) / 8;
    return [(l / CAP) * vl, (r / CAP) * vr];
  }

  /** Advance APU by T-cycles (same clock as CPU). */
  function advance(tCycles) {
    if (!master) {
      sampleBudget += tCycles;
      return;
    }
    let left = tCycles;
    while (left > 0) {
      const toFrame = 8192 - frameTimer;
      const step = Math.min(left, toFrame);
      stepChannels(step);
      frameTimer += step;
      left -= step;
      sampleBudget += step;
      if (frameTimer >= 8192) {
        frameTimer -= 8192;
        stepFrameSequencer();
      }
    }
  }

  function write(addr, val) {
    val &= 0xff;
    if (addr < 0xff10 || addr > 0xff3f) return false;
    const i = addr - 0xff10;

    // NR52 master power
    if (addr === 0xff26) {
      const on = !!(val & 0x80);
      if (!on && master) {
        for (let a = 0xff10; a <= 0xff25; a++) write(a, 0);
        sq1.enabled = sq2.enabled = wav.enabled = noi.enabled = false;
      }
      master = on;
      nr[i] = val & 0x80; // only bit 7 writable; low bits read-only status
      return true;
    }

    if (!master && addr !== 0xff26) {
      // wave RAM still writable when off on DMG? usually allowed for FF30-3F
      if (addr < 0xff30) return true;
    }

    nr[i] = val;

    switch (addr) {
      case 0xff10:
        sq1.sweepPeriod = (val >> 4) & 7;
        sq1.sweepNeg = !!(val & 0x08);
        sq1.sweepShift = val & 7;
        break;
      case 0xff11:
        sq1.duty = (val >> 6) & 3;
        sq1.length = 64 - (val & 0x3f);
        break;
      case 0xff12:
        sq1.volume = (val >> 4) & 0xf;
        sq1.envAdd = !!(val & 0x08);
        sq1.envPeriod = val & 7;
        sq1.dac = (val & 0xf8) !== 0;
        if (!sq1.dac) sq1.enabled = false;
        break;
      case 0xff13:
        sq1.freq = (sq1.freq & 0x700) | val;
        break;
      case 0xff14:
        sq1.freq = (sq1.freq & 0xff) | ((val & 7) << 8);
        sq1.lengthEnable = !!(val & 0x40);
        if (val & 0x80) triggerSquare(sq1, true);
        break;

      case 0xff16:
        sq2.duty = (val >> 6) & 3;
        sq2.length = 64 - (val & 0x3f);
        break;
      case 0xff17:
        sq2.volume = (val >> 4) & 0xf;
        sq2.envAdd = !!(val & 0x08);
        sq2.envPeriod = val & 7;
        sq2.dac = (val & 0xf8) !== 0;
        if (!sq2.dac) sq2.enabled = false;
        break;
      case 0xff18:
        sq2.freq = (sq2.freq & 0x700) | val;
        break;
      case 0xff19:
        sq2.freq = (sq2.freq & 0xff) | ((val & 7) << 8);
        sq2.lengthEnable = !!(val & 0x40);
        if (val & 0x80) triggerSquare(sq2, false);
        break;

      case 0xff1a:
        wav.dac = !!(val & 0x80);
        if (!wav.dac) wav.enabled = false;
        break;
      case 0xff1b:
        wav.length = 256 - val;
        break;
      case 0xff1c:
        wav.volumeCode = (val >> 5) & 3;
        break;
      case 0xff1d:
        wav.freq = (wav.freq & 0x700) | val;
        break;
      case 0xff1e:
        wav.freq = (wav.freq & 0xff) | ((val & 7) << 8);
        wav.lengthEnable = !!(val & 0x40);
        if (val & 0x80) triggerWave();
        break;

      case 0xff20:
        noi.length = 64 - (val & 0x3f);
        break;
      case 0xff21:
        noi.volume = (val >> 4) & 0xf;
        noi.envAdd = !!(val & 0x08);
        noi.envPeriod = val & 7;
        noi.dac = (val & 0xf8) !== 0;
        if (!noi.dac) noi.enabled = false;
        break;
      case 0xff22:
        noi.clockShift = (val >> 4) & 0xf;
        noi.width7 = !!(val & 0x08);
        noi.divisorCode = val & 7;
        break;
      case 0xff23:
        noi.lengthEnable = !!(val & 0x40);
        if (val & 0x80) triggerNoise();
        break;

      case 0xff24:
        vinR = (val >> 7) & 1;
        volR = (val >> 4) & 7;
        vinL = (val >> 3) & 1;
        volL = val & 7;
        break;
      case 0xff25: {
        const bit = (n) => !!(val & n);
        sq1.right = bit(0x01);
        sq2.right = bit(0x02);
        wav.right = bit(0x04);
        noi.right = bit(0x08);
        sq1.left = bit(0x10);
        sq2.left = bit(0x20);
        wav.left = bit(0x40);
        noi.left = bit(0x80);
        break;
      }
      default:
        if (addr >= 0xff30 && addr <= 0xff3f) {
          wave[addr - 0xff30] = val;
        }
        break;
    }
    return true;
  }

  function read(addr) {
    if (addr < 0xff10 || addr > 0xff3f) return null;
    if (addr >= 0xff30 && addr <= 0xff3f) return wave[addr - 0xff30];
    if (addr === 0xff26) {
      let v = master ? 0x80 : 0;
      v |= 0x70;
      if (sq1.enabled) v |= 1;
      if (sq2.enabled) v |= 2;
      if (wav.enabled) v |= 4;
      if (noi.enabled) v |= 8;
      return v;
    }
    // or masks for write-only bits — return stored with typical masks
    const masks = {
      0xff10: 0xff,
      0xff11: 0xc0,
      0xff12: 0xff,
      0xff13: 0x00,
      0xff14: 0x40,
      0xff15: 0xff,
      0xff16: 0xc0,
      0xff17: 0xff,
      0xff18: 0x00,
      0xff19: 0x40,
      0xff1a: 0x80,
      0xff1b: 0xff,
      0xff1c: 0x60,
      0xff1d: 0x00,
      0xff1e: 0x40,
      0xff1f: 0xff,
      0xff20: 0xff,
      0xff21: 0xff,
      0xff22: 0xff,
      0xff23: 0x40,
      0xff24: 0xff,
      0xff25: 0xff,
    };
    const stored = nr[addr - 0xff10];
    const mask = masks[addr];
    if (mask === undefined) return 0xff;
    return stored | (~mask & 0xff);
  }

  function fillOutput(left, right) {
    const rate = audioCtx ? audioCtx.sampleRate : 48000;
    const tPerSample = CPU / rate;
    for (let i = 0; i < left.length; i++) {
      // consume budget; if underrun, still mix current state
      const need = tPerSample;
      if (sampleBudget > 0) {
        const use = Math.min(sampleBudget, need);
        sampleBudget -= use;
      }
      const [l, r] = mixSample();
      left[i] = l * 0.35;
      right[i] = r * 0.35;
    }
  }

  async function resume() {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 48000 });
      scriptNode = audioCtx.createScriptProcessor(2048, 0, 2);
      scriptNode.onaudioprocess = (ev) => {
        fillOutput(ev.outputBuffer.getChannelData(0), ev.outputBuffer.getChannelData(1));
      };
      const gain = audioCtx.createGain();
      gain.gain.value = 1;
      scriptNode.connect(gain);
      gain.connect(audioCtx.destination);
    }
    if (audioCtx.state === "suspended") await audioCtx.resume();
  }

  function suspend() {
    audioCtx?.suspend?.();
  }

  // power-on defaults roughly
  nr[0x16] = 0xf1; // NR52-ish handled separately
  master = true;
  volL = 7;
  volR = 7;
  sq1.left = sq2.left = wav.left = noi.left = true;
  sq1.right = sq2.right = wav.right = noi.right = true;

  return { write, read, advance, resume, suspend, nr };
}
