/**
 * Procedural Web Audio synthesizer for crisp zero-asset sound effects.
 */
class SoundEngine {
  constructor() {
    this.ctx = null;
    this.muted = false;
  }

  _ensureCtx() {
    if (this.muted) return null;
    if (!this.ctx && typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext)) {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  toggleMute() {
    this.muted = !this.muted;
    return !this.muted;
  }

  tone(freq, dur = 0.12, type = 'sine', gain = 0.12, slideTo = null) {
    const ctx = this._ensureCtx();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), now + dur);
    g.gain.setValueAtTime(gain, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + dur);
    osc.connect(g).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + dur);
  }

  play(kind) {
    switch (kind) {
      case 'tank_fire':
        this.tone(190, 0.14, 'sawtooth', 0.14, 55);
        break;
      case 'ricochet':
        this.tone(920, 0.08, 'triangle', 0.08, 1340);
        break;
      case 'explosion':
        this.tone(120, 0.34, 'sawtooth', 0.2, 32);
        break;
      case 'powerup':
        this.tone(520, 0.1, 'sine', 0.1, 880);
        break;
      case 'clack':
        this.tone(640, 0.05, 'triangle', 0.11, 220);
        break;
      case 'goal':
        this.tone(440, 0.22, 'square', 0.12, 660);
        break;
      case 'sonar':
        this.tone(1180, 0.28, 'sine', 0.1, 980);
        break;
      case 'laser':
        this.tone(980, 0.12, 'sawtooth', 0.1, 220);
        break;
      case 'slash':
        this.tone(420, 0.11, 'triangle', 0.12, 120);
        break;
      default:
        this.tone(520, 0.06, 'sine', 0.06, 620);
    }
  }
}

export const SFX = new SoundEngine();
