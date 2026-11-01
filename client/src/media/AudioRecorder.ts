export interface AudioRecordingResult {
  audioBlob: Blob;
  duration: number;
  waveform: number[]; // 32 normalized levels 0-100
}

export class AudioRecorder {
  private mediaRecorder: MediaRecorder | null = null;
  private audioStream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private recordedChunks: Blob[] = [];
  private startTime = 0;
  private durationSeconds = 0;
  private timerInterval: any = null;
  private waveformSamples: number[] = [];
  private animFrameId: any = null;

  async start(
    onProgress?: (duration: number, currentWaveform: number[]) => void
  ): Promise<void> {
    this.recordedChunks = [];
    this.waveformSamples = [];
    this.durationSeconds = 0;

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    this.audioStream = stream;

    // Determine supported mime type
    let mimeType = "audio/webm;codecs=opus";
    if (!MediaRecorder.isTypeSupported(mimeType)) {
      if (MediaRecorder.isTypeSupported("audio/ogg;codecs=opus")) {
        mimeType = "audio/ogg;codecs=opus";
      } else if (MediaRecorder.isTypeSupported("audio/mp4")) {
        mimeType = "audio/mp4";
      } else {
        mimeType = "";
      }
    }

    const options: MediaRecorderOptions = mimeType ? { mimeType } : {};
    this.mediaRecorder = new MediaRecorder(stream, options);

    this.mediaRecorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        this.recordedChunks.push(event.data);
      }
    };

    // Setup AudioContext for live waveform
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioCtx) {
        this.audioContext = new AudioCtx();
        const source = this.audioContext.createMediaStreamSource(stream);
        this.analyser = this.audioContext.createAnalyser();
        this.analyser.fftSize = 64;
        source.connect(this.analyser);
      }
    } catch {
      // AudioContext optional fallback
    }

    this.startTime = Date.now();
    this.mediaRecorder.start(100);

    // Track duration and live waveform samples
    const sampleWaveform = () => {
      if (!this.analyser) {
        if (onProgress) onProgress(this.durationSeconds, this.waveformSamples);
        return;
      }
      const dataArray = new Uint8Array(this.analyser.frequencyBinCount);
      this.analyser.getByteFrequencyData(dataArray);

      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) {
        sum += dataArray[i];
      }
      const avg = sum / dataArray.length;
      const normalized = Math.min(100, Math.round((avg / 255) * 100));

      if (this.waveformSamples.length >= 32) {
        this.waveformSamples.shift();
      }
      this.waveformSamples.push(normalized);

      if (onProgress) {
        onProgress(this.durationSeconds, [...this.waveformSamples]);
      }
    };

    this.timerInterval = setInterval(() => {
      this.durationSeconds = Math.round((Date.now() - this.startTime) / 1000);
      sampleWaveform();
    }, 200);
  }

  isRecording(): boolean {
    return this.mediaRecorder?.state === "recording";
  }

  async stop(): Promise<AudioRecordingResult> {
    return new Promise((resolve, reject) => {
      if (!this.mediaRecorder) {
        reject(new Error("No active recording session"));
        return;
      }

      this.cleanupTimers();

      this.mediaRecorder.onstop = () => {
        const mimeType = this.mediaRecorder?.mimeType || "audio/webm";
        const audioBlob = new Blob(this.recordedChunks, { type: mimeType });
        const finalDuration = Math.max(1, this.durationSeconds);

        // Ensure 32 bars in waveform
        const finalWaveform = [...this.waveformSamples];
        while (finalWaveform.length < 32) {
          finalWaveform.push(Math.floor(Math.random() * 20) + 10);
        }

        this.cleanupStreams();
        resolve({
          audioBlob,
          duration: finalDuration,
          waveform: finalWaveform.slice(0, 32),
        });
      };

      this.mediaRecorder.stop();
    });
  }

  cancel(): void {
    this.cleanupTimers();
    if (this.mediaRecorder && this.mediaRecorder.state !== "inactive") {
      this.mediaRecorder.stop();
    }
    this.cleanupStreams();
    this.recordedChunks = [];
  }

  private cleanupTimers(): void {
    if (this.timerInterval) clearInterval(this.timerInterval);
    if (this.animFrameId) cancelAnimationFrame(this.animFrameId);
    this.timerInterval = null;
    this.animFrameId = null;
  }

  private cleanupStreams(): void {
    if (this.audioStream) {
      this.audioStream.getTracks().forEach((track) => track.stop());
      this.audioStream = null;
    }
    if (this.audioContext && this.audioContext.state !== "closed") {
      this.audioContext.close().catch(() => {});
      this.audioContext = null;
    }
  }
}
