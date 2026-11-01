/**
 * Pure Web Audio API Synthesizer for zero-asset telephone and VoIP ringtones.
 * Works 100% offline with zero external audio assets, network requests, or codec issues.
 */
export class RingtoneSynthesizer {
  private ctx: AudioContext | null = null;
  private isPlaying = false;
  private loopTimer: any = null;
  private activeNodes: (AudioNode | OscillatorNode)[] = [];

  private getAudioContext(): AudioContext {
    if (!this.ctx || this.ctx.state === "closed") {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      this.ctx = new AudioCtx();
    }
    if (this.ctx.state === "suspended") {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  /**
   * Plays an upbeat modern melodic chime loop for incoming calls.
   * Pattern: E5 (659Hz) -> G#5 (830Hz) -> B5 (987Hz) -> pause -> repeat
   */
  playIncomingRingtone(): void {
    if (this.isPlaying) this.stop();
    this.isPlaying = true;

    const playSequence = () => {
      if (!this.isPlaying) return;
      const ctx = this.getAudioContext();
      const now = ctx.currentTime;

      // Note 1: E5
      this.scheduleNote(ctx, 659.25, now, 0.22, 0.18);
      // Note 2: G#5
      this.scheduleNote(ctx, 830.61, now + 0.24, 0.22, 0.18);
      // Note 3: B5
      this.scheduleNote(ctx, 987.77, now + 0.48, 0.35, 0.22);
      // Secondary harmonic accent: E6
      this.scheduleNote(ctx, 1318.51, now + 0.85, 0.4, 0.15);

      // Repeat loop every 2.4 seconds
      this.loopTimer = setTimeout(playSequence, 2400);
    };

    playSequence();
  }

  /**
   * Plays standard PBX dual-frequency outgoing ringback tone.
   * Pattern: 440 Hz + 480 Hz (1.8s tone, 2.2s silence).
   */
  playOutgoingRingback(): void {
    if (this.isPlaying) this.stop();
    this.isPlaying = true;

    const playRingbackPulse = () => {
      if (!this.isPlaying) return;
      const ctx = this.getAudioContext();
      const now = ctx.currentTime;
      const duration = 1.8;

      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const gain = ctx.createGain();

      osc1.type = "sine";
      osc1.frequency.setValueAtTime(440, now); // 440 Hz
      osc2.type = "sine";
      osc2.frequency.setValueAtTime(480, now); // 480 Hz

      gain.gain.setValueAtTime(0.001, now);
      gain.gain.exponentialRampToValueAtTime(0.08, now + 0.05);
      gain.gain.setValueAtTime(0.08, now + duration - 0.05);
      gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

      osc1.connect(gain);
      osc2.connect(gain);
      gain.connect(ctx.destination);

      osc1.start(now);
      osc2.start(now);
      osc1.stop(now + duration);
      osc2.stop(now + duration);

      this.activeNodes.push(osc1, osc2, gain);

      this.loopTimer = setTimeout(playRingbackPulse, 4000);
    };

    playRingbackPulse();
  }

  /**
   * Plays a crisp descending disconnect / busy tone.
   */
  playCallEndTone(): void {
    if (this.isPlaying) this.stop();

    try {
      const ctx = this.getAudioContext();
      const now = ctx.currentTime;

      // Descending beep: 480 Hz -> 360 Hz
      this.scheduleNote(ctx, 480, now, 0.14, 0.12);
      this.scheduleNote(ctx, 360, now + 0.16, 0.2, 0.12);
    } catch {}
  }

  private scheduleNote(
    ctx: AudioContext,
    freq: number,
    startTime: number,
    duration: number,
    volume = 0.15
  ): void {
    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, startTime);

      // Smooth attack and release envelope to prevent audible clicks
      gain.gain.setValueAtTime(0.0001, startTime);
      gain.gain.exponentialRampToValueAtTime(volume, startTime + 0.03);
      gain.gain.setValueAtTime(volume, startTime + duration - 0.05);
      gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(startTime);
      osc.stop(startTime + duration);

      this.activeNodes.push(osc, gain);
    } catch {}
  }

  /**
   * Immediately stops all active oscillators and loops.
   */
  stop(): void {
    this.isPlaying = false;
    if (this.loopTimer) {
      clearTimeout(this.loopTimer);
      this.loopTimer = null;
    }

    for (const node of this.activeNodes) {
      try {
        if ("stop" in node && typeof (node as any).stop === "function") {
          (node as any).stop();
        }
        node.disconnect();
      } catch {}
    }
    this.activeNodes = [];
  }
}

export const ringtoneSynth = new RingtoneSynthesizer();
