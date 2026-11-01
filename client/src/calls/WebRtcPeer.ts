export interface NetworkStats {
  rttMs: number;
  packetLossPercent: number;
  jitterMs: number;
  bytesReceived: number;
  bytesSent: number;
}

export interface WebRtcPeerCallbacks {
  onTrack: (stream: MediaStream) => void;
  onIceCandidate: (candidate: RTCIceCandidate) => void;
  onConnectionState: (state: RTCPeerConnectionState) => void;
  onNetworkQuality?: (quality: "good" | "poor" | "critical", stats: NetworkStats) => void;
}

export class WebRtcPeer {
  public pc: RTCPeerConnection;
  public peerId: string;
  private callbacks: WebRtcPeerCallbacks;
  private statsInterval: any = null;
  private lastPacketsLost = 0;
  private lastPacketsReceived = 0;
  private remoteStream: MediaStream = new MediaStream();

  constructor(
    peerId: string,
    iceServers: RTCIceServer[],
    callbacks: WebRtcPeerCallbacks
  ) {
    this.peerId = peerId;
    this.callbacks = callbacks;

    this.pc = new RTCPeerConnection({
      iceServers: iceServers.length > 0 ? iceServers : [{ urls: "stun:stun.cloudflare.com:3478" }],
      iceCandidatePoolSize: 2,
      bundlePolicy: "max-bundle",
    });

    this.setupListeners();
    this.startStatsMonitoring();
  }

  private setupListeners(): void {
    this.pc.ontrack = (event) => {
      if (event.streams && event.streams[0]) {
        this.callbacks.onTrack(event.streams[0]);
      } else {
        if (event.track) {
          this.remoteStream.addTrack(event.track);
        }
        this.callbacks.onTrack(this.remoteStream);
      }
    };

    this.pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.callbacks.onIceCandidate(event.candidate);
      }
    };

    this.pc.onconnectionstatechange = () => {
      this.callbacks.onConnectionState(this.pc.connectionState);
      if (
        this.pc.connectionState === "closed" ||
        this.pc.connectionState === "failed"
      ) {
        this.stopStatsMonitoring();
      }
    };
  }

  /**
   * Modifies SDP to ensure Opus DTX and In-band Forward Error Correction (FEC) are active
   * strictly on the Opus codec payload type without corrupting other format lines.
   */
  public static mungeOpusSdp(sdp: string): string {
    if (!sdp) return sdp;

    // Identify Opus payload type from a=rtpmap:<pt> opus/48000
    const match = sdp.match(/a=rtpmap:(\d+)\s+opus\/48000/i);
    if (!match) return sdp;
    const opusPt = match[1];

    const fmtpRegex = new RegExp(`(a=fmtp:${opusPt}\\s+)([^\\r\\n]*)`, "i");
    if (fmtpRegex.test(sdp)) {
      return sdp.replace(fmtpRegex, (_, prefix, params) => {
        const parts = params
          .split(";")
          .map((p: string) => p.trim())
          .filter(Boolean);

        const hasFec = parts.some((p: string) => p.startsWith("useinbandfec="));
        const hasDtx = parts.some((p: string) => p.startsWith("usedtx="));

        if (!hasFec) parts.push("useinbandfec=1");
        if (!hasDtx) parts.push("usedtx=1");

        return `${prefix}${parts.join(";")}`;
      });
    } else {
      // If no existing fmtp line for opus, insert right after the rtpmap line
      return sdp.replace(
        new RegExp(`(a=rtpmap:${opusPt}\\s+opus\\/48000[^\\r\\n]*\\r?\\n)`, "i"),
        `$1a=fmtp:${opusPt} useinbandfec=1;usedtx=1\r\n`
      );
    }
  }

  /**
   * Adds all active media tracks from the local stream to this peer connection.
   */
  public addStream(stream: MediaStream): void {
    stream.getTracks().forEach((track) => {
      this.pc.addTrack(track, stream);
    });
  }

  /**
   * Creates an SDP offer with audio/video and Opus optimization.
   */
  public async createOffer(options?: RTCOfferOptions): Promise<RTCSessionDescriptionInit> {
    const offer = await this.pc.createOffer({
      offerToReceiveAudio: true,
      offerToReceiveVideo: false,
      ...options,
    });
    const mungedSdp = WebRtcPeer.mungeOpusSdp(offer.sdp || "");
    const finalOffer: RTCSessionDescriptionInit = {
      type: "offer",
      sdp: mungedSdp,
    };
    await this.pc.setLocalDescription(finalOffer);
    return finalOffer;
  }

  /**
   * Creates an SDP answer with audio/video and Opus optimization.
   */
  public async createAnswer(): Promise<RTCSessionDescriptionInit> {
    const answer = await this.pc.createAnswer();
    const mungedSdp = WebRtcPeer.mungeOpusSdp(answer.sdp || "");
    const finalAnswer: RTCSessionDescriptionInit = {
      type: "answer",
      sdp: mungedSdp,
    };
    await this.pc.setLocalDescription(finalAnswer);
    return finalAnswer;
  }

  /**
   * Sets remote session description.
   */
  public async setRemoteDescription(desc: RTCSessionDescriptionInit): Promise<void> {
    const munged = {
      type: desc.type,
      sdp: WebRtcPeer.mungeOpusSdp(desc.sdp || ""),
    };
    await this.pc.setRemoteDescription(new RTCSessionDescription(munged));
  }

  /**
   * Adds an ICE candidate received from remote peer.
   */
  public async addIceCandidate(candidate: RTCIceCandidateInit): Promise<void> {
    try {
      if (!candidate) return;
      await this.pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (err) {
      console.warn("Failed to add ICE candidate:", err);
    }
  }

  /**
   * Polls RTCPeerConnection.getStats() every 2 seconds to adaptively assess network quality.
   */
  private startStatsMonitoring(): void {
    this.statsInterval = setInterval(async () => {
      if (this.pc.connectionState !== "connected") return;

      try {
        const stats = await this.pc.getStats();
        let rttMs = 0;
        let jitterMs = 0;
        let packetsLostNow = 0;
        let packetsReceivedNow = 0;
        let bytesReceived = 0;
        let bytesSent = 0;

        stats.forEach((report) => {
          if (report.type === "candidate-pair" && report.state === "succeeded") {
            rttMs = Math.round((report.currentRoundTripTime || 0) * 1000);
          } else if (report.type === "inbound-rtp") {
            jitterMs = Math.round((report.jitter || 0) * 1000);
            packetsLostNow += report.packetsLost || 0;
            packetsReceivedNow += report.packetsReceived || 0;
            bytesReceived += report.bytesReceived || 0;
          } else if (report.type === "outbound-rtp") {
            bytesSent += report.bytesSent || 0;
          }
        });

        // Compute delta packet loss %
        const deltaPackets = packetsReceivedNow - this.lastPacketsReceived;
        const deltaLost = packetsLostNow - this.lastPacketsLost;
        this.lastPacketsReceived = packetsReceivedNow;
        this.lastPacketsLost = packetsLostNow;

        let packetLossPercent = 0;
        if (deltaPackets + deltaLost > 0) {
          packetLossPercent = Math.round((deltaLost / (deltaPackets + deltaLost)) * 100);
        }

        let quality: "good" | "poor" | "critical" = "good";
        if (packetLossPercent > 15 || rttMs > 350) {
          quality = "critical";
        } else if (packetLossPercent > 5 || rttMs > 180) {
          quality = "poor";
        }

        const networkStats: NetworkStats = {
          rttMs,
          packetLossPercent,
          jitterMs,
          bytesReceived,
          bytesSent,
        };

        if (this.callbacks.onNetworkQuality) {
          this.callbacks.onNetworkQuality(quality, networkStats);
        }
      } catch {}
    }, 2000);
  }

  private stopStatsMonitoring(): void {
    if (this.statsInterval) {
      clearInterval(this.statsInterval);
      this.statsInterval = null;
    }
  }

  /**
   * Cleans up peer connection and stats polling.
   */
  public destroy(): void {
    this.stopStatsMonitoring();
    try {
      this.pc.close();
    } catch {}
  }
}
