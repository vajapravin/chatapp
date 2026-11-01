import { ulid } from "ulidx";
import { useAuthStore } from "../store/authStore";
import { CallType, useCallStore } from "../store/callStore";
import { usePrivacyStore } from "../store/privacyStore";
import { useChatStore } from "../store/chatStore";
import { localDB } from "../storage/db";
import { getMqttTransport } from "../transport/mqttClient";
import { ringtoneSynth } from "./RingtoneSynthesizer";
import { WebRtcPeer } from "./WebRtcPeer";

const API_BASE = (import.meta as any).env?.VITE_API_BASE || "";

export interface CallSignalPayload {
  type: "call_signal";
  callId: string;
  callType: CallType;
  action:
    | "offer"
    | "answer"
    | "ice_candidate"
    | "ring"
    | "reject"
    | "busy"
    | "hangup"
    | "switch_to_video"
    | "group_join"
    | "group_leave";
  sdp?: string;
  candidate?: RTCIceCandidateInit;
  groupId?: string;
  peerName?: string;
  timestamp: number;
}

export class CallManager {
  private static instance: CallManager | null = null;
  private peers: Map<string, WebRtcPeer> = new Map();
  private pendingCandidates: Map<string, RTCIceCandidateInit[]> = new Map();
  private incomingOfferData: CallSignalPayload | null = null;
  private callTimer: any = null;
  private noAnswerTimeout: any = null;
  private iceServersCache: RTCIceServer[] | null = null;

  private constructor() {}

  public static getInstance(): CallManager {
    if (!CallManager.instance) {
      CallManager.instance = new CallManager();
    }
    return CallManager.instance;
  }

  /**
   * Fetches ephemeral ICE servers (STUN/TURN) from backend.
   */
  public async getIceServers(): Promise<RTCIceServer[]> {
    if (this.iceServersCache) return this.iceServersCache;

    const token = useAuthStore.getState().accessToken;
    try {
      const res = await fetch(`${API_BASE}/v1/calls/ice`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (res.ok) {
        const data = await res.json();
        if (data.ice_servers && Array.isArray(data.ice_servers)) {
          this.iceServersCache = data.ice_servers;
          return this.iceServersCache!;
        }
      }
    } catch (err) {
      console.warn("Failed to fetch ICE servers, using fallback public STUN:", err);
    }

    return [
      { urls: "stun:stun.cloudflare.com:3478" },
      { urls: "stun:stun.l.google.com:19302" },
    ];
  }

  /**
   * Acquires local media stream with optimal audio constraints (AEC, AGC, NS).
   */
  public async getLocalMedia(callType: CallType): Promise<MediaStream> {
    const isLowData = useCallStore.getState().isLowDataMode;
    const videoConstraints: MediaTrackConstraints | boolean =
      callType === "video"
        ? isLowData
          ? { width: 320, height: 240, frameRate: 15 }
          : { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: 30 }
        : false;

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: videoConstraints,
      });
    } catch (err) {
      console.warn("Failed to acquire media with enhanced constraints, falling back to basic constraints:", err);
      stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: videoConstraints,
      });
    }

    useCallStore.getState().setLocalStream(stream);
    return stream;
  }

  /**
   * Initiates an outgoing 1:1 or Group WebRTC call.
   */
  public async startCall(
    peerId: string,
    peerDisplayName?: string,
    callType: CallType = "voice",
    groupId?: string
  ): Promise<void> {
    const currentCallState = useCallStore.getState().callState;
    if (currentCallState !== "idle") {
      console.warn("Cannot start call: another call is active");
      return;
    }

    const callId = ulid();
    const isGroup = !!groupId;

    useCallStore.getState().setCallActive({
      callId,
      peerId,
      peerDisplayName,
      callType,
      isGroup,
      groupId,
      isCaller: true,
      callState: "calling",
    });

    ringtoneSynth.playOutgoingRingback();

    try {
      const localStream = await this.getLocalMedia(callType);
      const iceServers = await this.getIceServers();

      const peer = new WebRtcPeer(peerId, iceServers, {
        onTrack: (remoteStream) => {
          useCallStore.getState().setRemoteStream(peerId, remoteStream);
        },
        onIceCandidate: (candidate) => {
          this.sendSignal(peerId, {
            type: "call_signal",
            callId,
            callType,
            action: "ice_candidate",
            candidate: candidate.toJSON(),
            groupId,
            timestamp: Date.now(),
          });
        },
        onConnectionState: (state) => {
          if (state === "connected") {
            this.handleCallConnected();
          } else if (state === "failed" || state === "closed") {
            this.endCall(false);
          }
        },
        onNetworkQuality: (quality) => {
          useCallStore.getState().setNetworkQuality(quality);
        },
      });

      peer.addStream(localStream);
      this.peers.set(peerId, peer);

      const offer = await peer.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: callType === "video",
      });

      // Send Signal-encrypted offer over MQTT
      await this.sendSignal(peerId, {
        type: "call_signal",
        callId,
        callType,
        action: "offer",
        sdp: offer.sdp,
        groupId,
        peerName: useAuthStore.getState().user?.display_name || undefined,
        timestamp: Date.now(),
      });

      // 30-second timeout if no answer
      this.noAnswerTimeout = setTimeout(() => {
        if (useCallStore.getState().callState === "calling") {
          this.endCall(true, "missed");
        }
      }, 30000);
    } catch (err) {
      console.error("Failed to start call:", err);
      this.endCall(false, "rejected");
    }
  }

  /**
   * Accepts an incoming call.
   */
  public async acceptCall(): Promise<void> {
    ringtoneSynth.stop();
    if (this.noAnswerTimeout) {
      clearTimeout(this.noAnswerTimeout);
      this.noAnswerTimeout = null;
    }

    const { callId, peerId, callType, groupId } = useCallStore.getState();
    if (!callId || !peerId || !this.incomingOfferData) {
      console.warn("No active incoming call to accept");
      return;
    }

    useCallStore.getState().setCallState("connecting");

    try {
      const localStream = await this.getLocalMedia(callType);
      const iceServers = await this.getIceServers();

      const peer = new WebRtcPeer(peerId, iceServers, {
        onTrack: (remoteStream) => {
          useCallStore.getState().setRemoteStream(peerId, remoteStream);
        },
        onIceCandidate: (candidate) => {
          this.sendSignal(peerId, {
            type: "call_signal",
            callId,
            callType,
            action: "ice_candidate",
            candidate: candidate.toJSON(),
            groupId: groupId || undefined,
            timestamp: Date.now(),
          });
        },
        onConnectionState: (state) => {
          if (state === "connected") {
            this.handleCallConnected();
          } else if (state === "failed" || state === "closed") {
            this.endCall(false);
          }
        },
        onNetworkQuality: (quality) => {
          useCallStore.getState().setNetworkQuality(quality);
        },
      });

      peer.addStream(localStream);
      this.peers.set(peerId, peer);

      // Set remote offer SDP
      await peer.setRemoteDescription({
        type: "offer",
        sdp: this.incomingOfferData.sdp!,
      });

      // Drain queued ICE candidates
      const queued = this.pendingCandidates.get(peerId) || [];
      for (const cand of queued) {
        await peer.addIceCandidate(cand);
      }
      this.pendingCandidates.delete(peerId);

      const answer = await peer.createAnswer();

      await this.sendSignal(peerId, {
        type: "call_signal",
        callId,
        callType,
        action: "answer",
        sdp: answer.sdp,
        groupId: groupId || undefined,
        timestamp: Date.now(),
      });
    } catch (err) {
      console.error("Failed to accept call:", err);
      this.endCall(false, "rejected");
    }
  }

  /**
   * Rejects an incoming call.
   */
  public async rejectCall(): Promise<void> {
    ringtoneSynth.stop();
    if (this.noAnswerTimeout) {
      clearTimeout(this.noAnswerTimeout);
      this.noAnswerTimeout = null;
    }

    const { callId, peerId, callType, groupId } = useCallStore.getState();
    if (peerId && callId) {
      await this.sendSignal(peerId, {
        type: "call_signal",
        callId,
        callType,
        action: "reject",
        groupId: groupId || undefined,
        timestamp: Date.now(),
      });

      await useCallStore.getState().addCallLog({
        id: ulid(),
        peerId,
        direction: "incoming",
        callType,
        status: "rejected",
        startTime: Date.now(),
        durationSeconds: 0,
      });
    }

    this.cleanup();
  }

  /**
   * Terminates the ongoing call and logs call record.
   */
  public async endCall(notifyPeer = true, explicitStatus?: "completed" | "missed" | "rejected" | "busy"): Promise<void> {
    const { callId, peerId, peerDisplayName, peerPhoneNumber, callType, callDuration, callState, isCaller, groupId } =
      useCallStore.getState();

    ringtoneSynth.stop();
    ringtoneSynth.playCallEndTone();

    if (this.noAnswerTimeout) {
      clearTimeout(this.noAnswerTimeout);
      this.noAnswerTimeout = null;
    }

    if (notifyPeer && peerId && callId) {
      this.sendSignal(peerId, {
        type: "call_signal",
        callId,
        callType,
        action: "hangup",
        groupId: groupId || undefined,
        timestamp: Date.now(),
      }).catch(() => {});
    }

    // Determine status for call log
    let finalStatus: "completed" | "missed" | "rejected" | "busy" = explicitStatus || "completed";
    if (!explicitStatus) {
      if (callState === "calling" || callState === "ringing") {
        finalStatus = isCaller ? "completed" : "missed";
      }
    }

    if (peerId) {
      useCallStore.getState().addCallLog({
        id: ulid(),
        peerId,
        peerDisplayName: peerDisplayName || undefined,
        peerPhoneNumber: peerPhoneNumber || undefined,
        direction: isCaller ? "outgoing" : "incoming",
        callType,
        status: finalStatus,
        startTime: Date.now() - callDuration * 1000,
        durationSeconds: callDuration,
      }).catch(() => {});
    }

    this.cleanup();
  }

  /**
   * Handles incoming decrypted CALL_SIGNAL payload from MQTT envelope.
   */
  public async handleSignal(senderId: string, signal: CallSignalPayload): Promise<void> {
    const currentCallState = useCallStore.getState().callState;
    const currentCallId = useCallStore.getState().callId;

    switch (signal.action) {
      case "offer": {
        // Check Silence Unknown Callers privacy setting
        const privacy = usePrivacyStore.getState().privacySettings;
        if (privacy.silence_unknown_callers) {
          const chats = useChatStore.getState().chats;
          const isKnown = chats.some((c) => c.peerUserId === senderId || c.id === senderId);
          if (!isKnown) {
            localDB.saveCallLog({
              id: ulid(),
              peerId: senderId,
              peerDisplayName: signal.peerName || "Unknown Caller",
              direction: "incoming",
              callType: signal.callType,
              status: "missed",
              startTime: Date.now(),
              durationSeconds: 0,
            });
            this.sendSignal(senderId, {
              type: "call_signal",
              callId: signal.callId,
              callType: signal.callType,
              action: "busy",
              groupId: signal.groupId,
              timestamp: Date.now(),
            });
            return;
          }
        }

        // If busy on another call
        if (currentCallState !== "idle" && currentCallId !== signal.callId) {
          this.sendSignal(senderId, {
            type: "call_signal",
            callId: signal.callId,
            callType: signal.callType,
            action: "busy",
            groupId: signal.groupId,
            timestamp: Date.now(),
          });
          return;
        }

        this.incomingOfferData = signal;
        useCallStore.getState().setCallActive({
          callId: signal.callId,
          peerId: senderId,
          peerDisplayName: signal.peerName,
          callType: signal.callType,
          isGroup: !!signal.groupId,
          groupId: signal.groupId,
          isCaller: false,
          callState: "ringing",
        });

        ringtoneSynth.playIncomingRingtone();

        // Send ring acknowledgement
        this.sendSignal(senderId, {
          type: "call_signal",
          callId: signal.callId,
          callType: signal.callType,
          action: "ring",
          groupId: signal.groupId,
          timestamp: Date.now(),
        });

        // 30s timeout if user doesn't answer
        this.noAnswerTimeout = setTimeout(() => {
          if (useCallStore.getState().callState === "ringing") {
            this.endCall(false, "missed");
          }
        }, 30000);
        break;
      }

      case "ring": {
        // Callee confirmed ringing
        if (currentCallState === "calling") {
          // Handled by outgoing ringback
        }
        break;
      }

      case "answer": {
        if (this.noAnswerTimeout) {
          clearTimeout(this.noAnswerTimeout);
          this.noAnswerTimeout = null;
        }

        const peer = this.peers.get(senderId);
        if (peer && signal.sdp) {
          ringtoneSynth.stop();
          await peer.setRemoteDescription({ type: "answer", sdp: signal.sdp });
          this.handleCallConnected();

          // Drain queued ICE candidates
          const queued = this.pendingCandidates.get(senderId) || [];
          for (const cand of queued) {
            await peer.addIceCandidate(cand);
          }
          this.pendingCandidates.delete(senderId);
        }
        break;
      }

      case "ice_candidate": {
        if (signal.candidate) {
          const peer = this.peers.get(senderId);
          if (peer && peer.pc.remoteDescription) {
            await peer.addIceCandidate(signal.candidate);
          } else {
            const list = this.pendingCandidates.get(senderId) || [];
            list.push(signal.candidate);
            this.pendingCandidates.set(senderId, list);
          }
        }
        break;
      }

      case "reject": {
        this.endCall(false, "rejected");
        break;
      }

      case "busy": {
        this.endCall(false, "busy");
        break;
      }

      case "hangup": {
        this.endCall(false, "completed");
        break;
      }
    }
  }

  private handleCallConnected(): void {
    ringtoneSynth.stop();
    useCallStore.getState().setCallState("connected");

    if (!this.callTimer) {
      let duration = 0;
      this.callTimer = setInterval(() => {
        duration += 1;
        useCallStore.getState().setCallDuration(duration);
      }, 1000);
    }
  }

  /**
   * Screen sharing toggle using getDisplayMedia with dynamic track replacement.
   */
  public async toggleScreenShare(): Promise<boolean> {
    const isSharing = useCallStore.getState().isScreenSharing;
    const localStream = useCallStore.getState().localStream;
    if (!localStream) return false;

    if (isSharing) {
      // Revert to camera video track
      const cameraStream = await navigator.mediaDevices.getUserMedia({ video: true });
      const newVideoTrack = cameraStream.getVideoTracks()[0];

      this.replaceVideoTrackInPeers(newVideoTrack);
      useCallStore.getState().setScreenSharing(false);
      return false;
    } else {
      try {
        const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
        const screenTrack = screenStream.getVideoTracks()[0];

        screenTrack.onended = () => {
          this.toggleScreenShare();
        };

        this.replaceVideoTrackInPeers(screenTrack);
        useCallStore.getState().setScreenSharing(true);
        return true;
      } catch (err) {
        console.warn("Screen share cancelled or failed:", err);
        return false;
      }
    }
  }

  private replaceVideoTrackInPeers(newTrack: MediaStreamTrack): void {
    const localStream = useCallStore.getState().localStream;
    if (localStream) {
      const oldVideo = localStream.getVideoTracks()[0];
      if (oldVideo) {
        localStream.removeTrack(oldVideo);
        oldVideo.stop();
      }
      localStream.addTrack(newTrack);
    }

    this.peers.forEach((peer) => {
      const senders = peer.pc.getSenders();
      const videoSender = senders.find((s) => s.track && s.track.kind === "video");
      if (videoSender) {
        videoSender.replaceTrack(newTrack);
      }
    });
  }

  /**
   * Speaker audio output switching.
   */
  public async setAudioOutputDevice(element?: HTMLAudioElement | HTMLVideoElement | null, deviceId?: string): Promise<void> {
    if (deviceId !== undefined) {
      useCallStore.getState().setSelectedAudioDevice(deviceId);
    }
    if (element && deviceId && "setSinkId" in element && typeof (element as any).setSinkId === "function") {
      try {
        await (element as any).setSinkId(deviceId);
      } catch (err) {
        console.warn("Failed to set audio sink ID:", err);
      }
    }
  }

  private async sendSignal(recipientId: string, signalData: CallSignalPayload): Promise<void> {
    const transport = getMqttTransport();
    if (transport) {
      await transport.sendCallSignal(recipientId, signalData, signalData.groupId);
    }
  }

  private cleanup(): void {
    if (this.callTimer) {
      clearInterval(this.callTimer);
      this.callTimer = null;
    }
    if (this.noAnswerTimeout) {
      clearTimeout(this.noAnswerTimeout);
      this.noAnswerTimeout = null;
    }

    this.peers.forEach((peer) => peer.destroy());
    this.peers.clear();
    this.pendingCandidates.clear();
    this.incomingOfferData = null;

    useCallStore.getState().resetCall();
  }
}

export const callManager = CallManager.getInstance();
