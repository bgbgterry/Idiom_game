/**
 * js/sound.js
 * Web Audio API Arcade Synthesizer & Confetti Particle Engine
 * Zero external audio assets needed — 100% pure browser synthesis.
 */

export class SoundEffects {
  constructor() {
    this.ctx = null;
    this.muted = localStorage.getItem('idiom_game_muted') === 'true';
  }

  _ensureContext() {
    if (this.muted) return false;
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return Boolean(this.ctx);
  }

  toggleMute() {
    this.muted = !this.muted;
    localStorage.setItem('idiom_game_muted', String(this.muted));
    if (!this.muted) {
      this.playClick();
    }
    return this.muted;
  }

  playClick() {
    if (!this._ensureContext()) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(520, now);
    osc.frequency.exponentialRampToValueAtTime(780, now + 0.05);
    gain.gain.setValueAtTime(0.12, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.055);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + 0.06);
  }

  playCorrect(combo = 1) {
    if (!this._ensureContext()) return;
    const now = this.ctx.currentTime;
    // Pitch scales up with combo count for dopamine feedback!
    const pitchBoost = Math.min(combo - 1, 8) * 35;
    const notes = [523.25 + pitchBoost, 659.25 + pitchBoost, 783.99 + pitchBoost, 1046.5 + pitchBoost];

    notes.forEach((freq, idx) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = combo >= 3 ? 'sawtooth' : 'triangle';
      const startTime = now + idx * 0.055;
      osc.frequency.setValueAtTime(freq, startTime);
      gain.gain.setValueAtTime(0.14, startTime);
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.16);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(startTime);
      osc.stop(startTime + 0.17);
    });
  }

  playWrong() {
    if (!this._ensureContext()) return;
    const now = this.ctx.currentTime;
    const freqs = [240, 175];
    freqs.forEach((freq, idx) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sawtooth';
      const startTime = now + idx * 0.12;
      osc.frequency.setValueAtTime(freq, startTime);
      osc.frequency.linearRampToValueAtTime(freq - 30, startTime + 0.14);
      gain.gain.setValueAtTime(0.15, startTime);
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.16);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(startTime);
      osc.stop(startTime + 0.17);
    });
  }

  playFanfare() {
    if (!this._ensureContext()) return;
    const now = this.ctx.currentTime;
    const melody = [
      { f: 523.25, t: 0, d: 0.12 },
      { f: 659.25, t: 0.12, d: 0.12 },
      { f: 783.99, t: 0.24, d: 0.12 },
      { f: 1046.5, t: 0.36, d: 0.35 },
      { f: 783.99, t: 0.72, d: 0.12 },
      { f: 1046.5, t: 0.86, d: 0.45 },
    ];
    melody.forEach((n) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(n.f, now + n.t);
      gain.gain.setValueAtTime(0.18, now + n.t);
      gain.gain.exponentialRampToValueAtTime(0.001, now + n.t + n.d);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(now + n.t);
      osc.stop(now + n.t + n.d + 0.02);
    });
  }
}

export function launchConfetti() {
  const canvas = document.getElementById('confetti-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;

  const colors = ['#CCFF00', '#FF2E93', '#7C4DFF', '#00F0FF', '#FFB800', '#FFFFFF'];
  const particles = Array.from({ length: 110 }, () => ({
    x: canvas.width * (0.2 + Math.random() * 0.6),
    y: canvas.height * 0.35,
    vx: (Math.random() - 0.5) * 18,
    vy: -Math.random() * 16 - 6,
    size: 7 + Math.random() * 7,
    color: colors[Math.floor(Math.random() * colors.length)],
    rot: Math.random() * Math.PI * 2,
    vrot: (Math.random() - 0.5) * 0.25,
    gravity: 0.42,
  }));

  let frame = 0;
  function animate() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    let alive = false;
    for (const p of particles) {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += p.gravity;
      p.rot += p.vrot;
      if (p.y < canvas.height + 30) alive = true;

      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = 1.5;
      ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.65);
      ctx.strokeRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.65);
      ctx.restore();
    }
    frame++;
    if (alive && frame < 180) {
      requestAnimationFrame(animate);
    } else {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  }
  requestAnimationFrame(animate);
}
