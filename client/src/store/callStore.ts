import { create } from "zustand";
import { CallLogItem, localDB } from "../storage/db";

export type CallState =
  | "idle"
  | "calling"
  | "ringing"
  | "connecting"
  | "connected"
  | "ended";

export type CallType = "voice" | "video";

interface CallStoreState {
  callState: CallState;
  callType: CallType;
  callId: string | null;
  peerId: string | null;
  peerDisplayName: string | null;
  peerPhoneNumber: string | null;
  isGroup: boolean;
  groupId: string | null;
  isCaller: boolean;

  // Media & Hardware State
  isMuted: boolean;
  isVideoOff: boolean;
  isScreenSharing: boolean;
  isLowDataMode: boolean;
  networkQuality: "good" | "poor" | "critical";
  callDuration: number;

  // Streams
  localStream: MediaStream | null;
  remoteStreams: Record<string, MediaStream>;

  // Call History
  callLogs: CallLogItem[];

  // Actions
  setCallActive: (params: {
    callId: string;
    peerId: string;
    peerDisplayName?: string;
    peerPhoneNumber?: string;
    callType: CallType;
    isGroup?: boolean;
    groupId?: string;
    isCaller: boolean;
    callState: CallState;
  }) => void;
  setCallState: (callState: CallState) => void;
  setLocalStream: (stream: MediaStream | null) => void;
  setRemoteStream: (peerId: string, stream: MediaStream) => void;
  removeRemoteStream: (peerId: string) => void;
  toggleMute: () => boolean;
  toggleVideo: () => boolean;
  setScreenSharing: (isSharing: boolean) => void;
  toggleLowDataMode: () => boolean;
  setNetworkQuality: (quality: "good" | "poor" | "critical") => void;
  setCallDuration: (duration: number) => void;
  resetCall: () => void;
  loadCallLogs: () => Promise<void>;
  addCallLog: (item: CallLogItem) => Promise<void>;
}

export const useCallStore = create<CallStoreState>((set, get) => ({
  callState: "idle",
  callType: "voice",
  callId: null,
  peerId: null,
  peerDisplayName: null,
  peerPhoneNumber: null,
  isGroup: false,
  groupId: null,
  isCaller: false,

  isMuted: false,
  isVideoOff: false,
  isScreenSharing: false,
  isLowDataMode: false,
  networkQuality: "good",
  callDuration: 0,

  localStream: null,
  remoteStreams: {},
  callLogs: [],

  setCallActive: (params) =>
    set({
      callId: params.callId,
      peerId: params.peerId,
      peerDisplayName: params.peerDisplayName || params.peerPhoneNumber || params.peerId,
      peerPhoneNumber: params.peerPhoneNumber || null,
      callType: params.callType,
      isGroup: !!params.isGroup,
      groupId: params.groupId || null,
      isCaller: params.isCaller,
      callState: params.callState,
      callDuration: 0,
      isMuted: false,
      isVideoOff: params.callType === "voice",
      isScreenSharing: false,
      isLowDataMode: false,
      networkQuality: "good",
      remoteStreams: {},
    }),

  setCallState: (callState) => set({ callState }),

  setLocalStream: (stream) => set({ localStream: stream }),

  setRemoteStream: (peerId, stream) =>
    set((state) => ({
      remoteStreams: {
        ...state.remoteStreams,
        [peerId]: stream,
      },
    })),

  removeRemoteStream: (peerId) =>
    set((state) => {
      const updated = { ...state.remoteStreams };
      delete updated[peerId];
      return { remoteStreams: updated };
    }),

  toggleMute: () => {
    const next = !get().isMuted;
    const stream = get().localStream;
    if (stream) {
      stream.getAudioTracks().forEach((track) => {
        track.enabled = !next;
      });
    }
    set({ isMuted: next });
    return next;
  },

  toggleVideo: () => {
    const next = !get().isVideoOff;
    const stream = get().localStream;
    if (stream) {
      stream.getVideoTracks().forEach((track) => {
        track.enabled = !next;
      });
    }
    set({ isVideoOff: next });
    return next;
  },

  setScreenSharing: (isScreenSharing) => set({ isScreenSharing }),

  toggleLowDataMode: () => {
    const next = !get().isLowDataMode;
    set({ isLowDataMode: next });
    return next;
  },

  setNetworkQuality: (networkQuality) => set({ networkQuality }),

  setCallDuration: (callDuration) => set({ callDuration }),

  resetCall: () => {
    const local = get().localStream;
    if (local) {
      local.getTracks().forEach((track) => track.stop());
    }
    Object.values(get().remoteStreams).forEach((remote) => {
      remote.getTracks().forEach((track) => track.stop());
    });

    set({
      callState: "idle",
      callId: null,
      peerId: null,
      peerDisplayName: null,
      peerPhoneNumber: null,
      isGroup: false,
      groupId: null,
      isCaller: false,
      isMuted: false,
      isVideoOff: false,
      isScreenSharing: false,
      isLowDataMode: false,
      networkQuality: "good",
      callDuration: 0,
      localStream: null,
      remoteStreams: {},
    });
  },

  loadCallLogs: async () => {
    const logs = await localDB.getCallLogs();
    set({ callLogs: logs });
  },

  addCallLog: async (item) => {
    await localDB.saveCallLog(item);
    set((state) => ({
      callLogs: [item, ...state.callLogs],
    }));
  },
}));
