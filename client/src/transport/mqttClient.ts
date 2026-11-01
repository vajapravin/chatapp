import mqtt, { MqttClient } from "mqtt";
import { ulid } from "ulidx";
import { SignalAdapter } from "../crypto/SignalAdapter";
import { ChatItem, MessageItem, PollData, LocationData, ContactData, EventData, MediaAttachment } from "../storage/db";
import { useAuthStore } from "../store/authStore";
import { useChatStore } from "../store/chatStore";
import { callManager } from "../calls/CallManager";

export class MqttTransport {
  private client: MqttClient | null = null;
  private signalAdapter: SignalAdapter | null = null;
  private userId: string;
  private deviceId: number;
  private typingTimeouts: Map<string, any> = new Map();
  private distributedSenderKeys: Set<string> = new Set(); // groupIds where own sender key was distributed

  constructor(userId: string, deviceId: number = 1) {
    this.userId = userId;
    this.deviceId = deviceId;
  }

  async init(adapter: SignalAdapter) {
    this.signalAdapter = adapter;
    await this.signalAdapter.init();
    this.connect();
  }

  getSignalAdapter(): SignalAdapter | null {
    return this.signalAdapter;
  }

  private connect() {
    const token = useAuthStore.getState().accessToken;
    if (!token) return;

    // Use /mqtt proxy or direct port 9001
    const isHttps = typeof window !== "undefined" && window.location.protocol === "https:";
    const host = typeof window !== "undefined" ? window.location.hostname : "localhost";
    const port = typeof window !== "undefined" && window.location.port ? window.location.port : "3001";

    // In browser container behind Nginx, /mqtt is forwarded to mosquitto:9001
    // In standalone vite dev (e.g. port 5174), connect directly to port 9001
    const brokerUrl = port === "5174"
      ? `${isHttps ? "wss:" : "ws:"}//${host}:9001`
      : `${isHttps ? "wss:" : "ws:"}//${host}:${port}/mqtt`;

    const clientId = `chatapp_web_${this.userId}_${this.deviceId}_${Math.random().toString(16).substring(2, 8)}`;

    this.client = mqtt.connect(brokerUrl, {
      clientId,
      username: this.userId,
      password: token,
      clean: true,
      reconnectPeriod: 3000,
      connectTimeout: 10000,
      will: {
        topic: `p/${this.userId}`,
        payload: JSON.stringify({ user_id: this.userId, online: false, last_seen: Date.now() }),
        qos: 1,
        retain: true,
      },
    });

    this.client.on("connect", () => {
      console.info("[MQTT] Connected to Mosquitto broker as", clientId);
      this.publishPresence(true);

      // Subscribe to user mailbox and presence channels
      this.client?.subscribe(`u/${this.userId}/#`, { qos: 1 });
      this.client?.subscribe("p/#", { qos: 1 });
    });

    this.client.on("message", (topic, payload) => {
      this.handleIncomingMessage(topic, payload);
    });

    this.client.on("error", (err) => {
      console.warn("[MQTT] Connection error:", err.message);
    });

    this.client.on("close", () => {
      console.info("[MQTT] Connection closed");
    });
  }

  publishPresence(isOnline: boolean) {
    if (!this.client?.connected) return;
    const presencePayload = {
      user_id: this.userId,
      online: isOnline,
      last_seen: Date.now(),
    };
    this.client.publish(
      `p/${this.userId}`,
      JSON.stringify(presencePayload),
      { qos: 1, retain: true }
    );
  }

  sendTypingStatus(peerUserId: string, isTyping: boolean) {
    if (!this.client?.connected) return;
    const typingPayload = {
      user_id: this.userId,
      peer_id: peerUserId,
      typing: isTyping,
      timestamp: Date.now(),
    };
    this.client.publish(
      `p/${this.userId}/typing`,
      JSON.stringify(typingPayload),
      { qos: 0 }
    );
  }

  private async handleIncomingMessage(topic: string, rawPayload: Buffer | Uint8Array) {
    try {
      const text = new TextDecoder().decode(rawPayload);
      const data = JSON.parse(text);

      // 1. Server Acknowledgment
      if (topic === `u/${this.userId}/${this.deviceId}/ack`) {
        if (data.status === "server_ack" && data.id) {
          useChatStore.getState().updateMessageStatusByEnvelopeId(data.id, "sent");
        }
        return;
      }

      // 2. Presence & Typing topics
      if (topic.startsWith("p/")) {
        if (topic.endsWith("/typing")) {
          const { user_id, typing } = data;
          if (user_id !== this.userId) {
            useChatStore.getState().setPeerTyping(user_id, !!typing);
            if (typing) {
              if (this.typingTimeouts.has(user_id)) {
                clearTimeout(this.typingTimeouts.get(user_id));
              }
              const timeout = setTimeout(() => {
                useChatStore.getState().setPeerTyping(user_id, false);
              }, 4000);
              this.typingTimeouts.set(user_id, timeout);
            }
          }
        } else {
          // p/{userId}
          const { user_id, online, last_seen } = data;
          if (user_id && user_id !== this.userId) {
            useChatStore.getState().setPresence(user_id, !!online, last_seen);
          }
        }
        return;
      }

      // 3. User Inbox Envelope
      if (topic === `u/${this.userId}/${this.deviceId}/inbox`) {
        const envelope = data;

        // A. SENDER_KEY_DISTRIBUTION (type 5)
        if (envelope.type === 5 && this.signalAdapter) {
          try {
            const encryptedPayload = JSON.parse(atob(envelope.ciphertext));
            const decryptedJson = await this.signalAdapter.decrypt(
              envelope.sender_user,
              envelope.sender_device || 1,
              encryptedPayload
            );
            const parsed = JSON.parse(decryptedJson);
            if (parsed.type === "sender_key_distribution" && parsed.data) {
              await this.signalAdapter.processSenderKeyDistribution(parsed.data);
              console.info(`[MQTT] Processed SenderKeyDistribution for group ${parsed.data.groupId} from ${envelope.sender_user}`);
            }
          } catch (err) {
            console.warn("[MQTT] Failed to process sender key distribution:", err);
          }
          return;
        }

        // B. RECEIPT envelope (type 2)
        if (envelope.type === 2) {
          const status = envelope.receipt_status === "read" ? "read" : "delivered";
          if (envelope.envelope_id) {
            useChatStore.getState().updateMessageStatusByEnvelopeId(envelope.envelope_id, status);
          }
          if (envelope.message_id) {
            useChatStore.getState().updateMessageStatusById(
              envelope.sender_user,
              envelope.message_id,
              status
            );
          }
          return;
        }

        // C. MESSAGE envelope (type 1) or CALL_SIGNAL envelope (type 4)
        if ((envelope.type === 1 || envelope.type === 4) && this.signalAdapter) {
          const senderId = envelope.sender_user;
          const isGroup = !!envelope.group_id;
          const chatId = isGroup ? envelope.group_id : senderId;
          const store = useChatStore.getState();

          let decryptedJson: string;
          if (isGroup) {
            // Decrypt with Signal Sender Key
            decryptedJson = await this.signalAdapter.decryptGroupMessage(
              chatId,
              senderId,
              envelope.ciphertext
            );
          } else {
            // Decrypt pairwise Double Ratchet
            const encryptedPayload = JSON.parse(atob(envelope.ciphertext));
            decryptedJson = await this.signalAdapter.decrypt(
              senderId,
              envelope.sender_device || 1,
              encryptedPayload
            );
          }

          const innerMsg = JSON.parse(decryptedJson);

          // Handle WebRTC Call Signaling (type 4 or action payload)
          if (envelope.type === 4 || innerMsg.type === "call_signal") {
            await callManager.handleSignal(senderId, innerMsg);
            return;
          }

          // Handle reaction
          if (innerMsg.reaction) {
            const { msgId, emoji } = innerMsg.reaction;
            const chatMsgs = store.messages[chatId] || [];
            const target = chatMsgs.find((m) => m.id === msgId);
            if (target) {
              const reactions = { ...(target.reactions || {}), [senderId]: emoji };
              await store.updateMessage(chatId, msgId, { reactions });
            }
            return;
          }

          // Handle message edit
          if (innerMsg.edit) {
            const { msgId, newText } = innerMsg.edit;
            await store.updateMessage(chatId, msgId, {
              text: newText,
              isEdited: true,
              editedAt: Date.now(),
            });
            return;
          }

          // Handle message delete for everyone
          if (innerMsg.delete) {
            const { msgId } = innerMsg.delete;
            await store.updateMessage(chatId, msgId, {
              text: "This message was deleted",
              isDeleted: true,
            });
            return;
          }

          // Handle poll vote update
          if (innerMsg.pollVote) {
            const { pollId, optionId, voterId } = innerMsg.pollVote;
            await store.votePoll(chatId, pollId, optionId, voterId || senderId);
            return;
          }

          // Handle pin update
          if (innerMsg.pin) {
            const { msgId, isPinned } = innerMsg.pin;
            await store.updateMessage(chatId, msgId, { isPinned });
            return;
          }

          // Standard / Rich incoming message
          const newMsg: MessageItem = {
            id: innerMsg.id || ulid(),
            envelopeId: envelope.id,
            chatId,
            groupId: envelope.group_id,
            senderId,
            senderDeviceId: envelope.sender_device || 1,
            recipientId: this.userId,
            recipientDeviceId: this.deviceId,
            text: innerMsg.text || "",
            timestamp: innerMsg.timestamp || Date.now(),
            status: "delivered",
            replyTo: innerMsg.replyTo,
            messageType: innerMsg.messageType || "text",
            media: innerMsg.media,
            poll: innerMsg.poll,
            location: innerMsg.location,
            contact: innerMsg.contact,
            event: innerMsg.event,
            mentions: innerMsg.mentions,
            isPinned: innerMsg.isPinned,
            viewOnce: innerMsg.viewOnce,
            viewed: false,
            forwardCount: innerMsg.forwardCount || 0,
            disappearingAfter: innerMsg.disappearingAfter,
          };

          await store.addMessage(newMsg);

          // Update or create chat in left sidebar
          const existingChat = store.chats.find((c) => c.id === chatId);
          const isActive = store.activeChatId === chatId;

          let displaySummary = newMsg.text;
          if (newMsg.messageType === "poll") displaySummary = `📊 Poll: ${newMsg.poll?.question}`;
          if (newMsg.messageType === "location") displaySummary = "📍 Location";
          if (newMsg.messageType === "contact") displaySummary = `👤 Contact: ${newMsg.contact?.name}`;
          if (newMsg.messageType === "event") displaySummary = `📅 Event: ${newMsg.event?.title}`;
          if (newMsg.messageType === "image") displaySummary = "📷 Photo" + (newMsg.text ? `: ${newMsg.text}` : "");
          if (newMsg.messageType === "video") displaySummary = "🎥 Video" + (newMsg.text ? `: ${newMsg.text}` : "");
          if (newMsg.messageType === "audio") displaySummary = "🎤 Voice message";
          if (newMsg.messageType === "document") displaySummary = `📄 ${newMsg.media?.fileName || "Document"}`;
          if (newMsg.messageType === "sticker") displaySummary = "Sticker";
          if (newMsg.messageType === "gif") displaySummary = "GIF";
          if (newMsg.viewOnce) displaySummary = "🔒 View-once message";

          const updatedChat: ChatItem = {
            id: chatId,
            peerUserId: isGroup ? (existingChat?.peerUserId || chatId) : senderId,
            peerDisplayName: existingChat?.peerDisplayName || innerMsg.groupName || innerMsg.senderDisplayName || senderId,
            peerPhoneNumber: existingChat?.peerPhoneNumber || innerMsg.senderPhone || "",
            peerAvatarUrl: existingChat?.peerAvatarUrl,
            lastMessageText: displaySummary,
            lastMessageTimestamp: newMsg.timestamp,
            unreadCount: isActive ? 0 : (existingChat?.unreadCount || 0) + 1,
            isGroup,
            disappearingMode: innerMsg.disappearingAfter || existingChat?.disappearingMode,
          };
          await store.addOrUpdateChat(updatedChat);

          // For 1:1, send delivered receipt back
          if (!isGroup) {
            this.sendReceipt(senderId, envelope.sender_device || 1, envelope.id, newMsg.id, "delivered");
            if (isActive) {
              this.sendReceipt(senderId, envelope.sender_device || 1, envelope.id, newMsg.id, "read");
            }
          }
        }
      }
    } catch (e) {
      console.warn("[MQTT] Error processing message:", e);
    }
  }

  sendReceipt(
    recipientUserId: string,
    recipientDeviceId: number,
    envelopeId: string,
    messageId: string,
    status: "delivered" | "read"
  ) {
    if (!this.client?.connected) return;

    const receiptEnvelope = {
      id: ulid(),
      version: 1,
      sender_user: this.userId,
      sender_device: this.deviceId,
      recipient_user: recipientUserId,
      recipient_device: recipientDeviceId,
      type: 2, // RECEIPT
      receipt_status: status,
      envelope_id: envelopeId,
      message_id: messageId,
      timestamp: Date.now(),
    };

    this.client.publish(
      `out/${this.userId}/${this.deviceId}`,
      JSON.stringify(receiptEnvelope),
      { qos: 1 }
    );
  }

  // 1:1 Message Sender
  async sendMessage(
    recipient: { id: string; phoneNumber: string; displayName?: string },
    text: string,
    richData?: {
      messageType?: MessageItem["messageType"];
      media?: MediaAttachment;
      poll?: PollData;
      location?: LocationData;
      contact?: ContactData;
      event?: EventData;
      viewOnce?: boolean;
      forwardCount?: number;
      disappearingAfter?: number;
      replyTo?: { id: string; text: string; senderId: string };
    }
  ): Promise<MessageItem> {
    if (!this.signalAdapter) {
      throw new Error("SignalAdapter not initialized");
    }

    const msgId = ulid();
    const envelopeId = ulid();
    const now = Date.now();

    const innerPayload = {
      id: msgId,
      text,
      replyTo: richData?.replyTo,
      messageType: richData?.messageType || "text",
      media: richData?.media,
      poll: richData?.poll,
      location: richData?.location,
      contact: richData?.contact,
      event: richData?.event,
      viewOnce: richData?.viewOnce,
      forwardCount: richData?.forwardCount || 0,
      disappearingAfter: richData?.disappearingAfter,
      timestamp: now,
      senderPhone: useAuthStore.getState().user?.phone_number,
      senderDisplayName: useAuthStore.getState().user?.display_name,
    };

    const plaintextJson = JSON.stringify(innerPayload);
    const encrypted = await this.signalAdapter.encrypt(recipient.id, 1, plaintextJson);

    const envelope = {
      id: envelopeId,
      version: 1,
      sender_user: this.userId,
      sender_device: this.deviceId,
      recipient_user: recipient.id,
      recipient_device: 1,
      type: 1,
      ciphertext: btoa(JSON.stringify(encrypted)),
      timestamp: now,
    };

    const newMsg: MessageItem = {
      id: msgId,
      envelopeId,
      chatId: recipient.id,
      senderId: this.userId,
      senderDeviceId: this.deviceId,
      recipientId: recipient.id,
      recipientDeviceId: 1,
      text,
      timestamp: now,
      status: "pending",
      replyTo: richData?.replyTo,
      messageType: richData?.messageType || "text",
      media: richData?.media,
      poll: richData?.poll,
      location: richData?.location,
      contact: richData?.contact,
      event: richData?.event,
      viewOnce: richData?.viewOnce,
      viewed: false,
      forwardCount: richData?.forwardCount || 0,
      disappearingAfter: richData?.disappearingAfter,
    };

    const store = useChatStore.getState();
    await store.addMessage(newMsg);

    let displaySummary = text;
    if (newMsg.messageType === "poll") displaySummary = `📊 Poll: ${newMsg.poll?.question}`;
    if (newMsg.messageType === "location") displaySummary = "📍 Location";
    if (newMsg.messageType === "contact") displaySummary = `👤 Contact: ${newMsg.contact?.name}`;
    if (newMsg.messageType === "event") displaySummary = `📅 Event: ${newMsg.event?.title}`;
    if (newMsg.messageType === "image") displaySummary = "📷 Photo" + (newMsg.text ? `: ${newMsg.text}` : "");
    if (newMsg.messageType === "video") displaySummary = "🎥 Video" + (newMsg.text ? `: ${newMsg.text}` : "");
    if (newMsg.messageType === "audio") displaySummary = "🎤 Voice message";
    if (newMsg.messageType === "document") displaySummary = `📄 ${newMsg.media?.fileName || "Document"}`;
    if (newMsg.messageType === "sticker") displaySummary = "Sticker";
    if (newMsg.messageType === "gif") displaySummary = "GIF";
    if (newMsg.viewOnce) displaySummary = "🔒 View-once message";

    const existingChat = store.chats.find((c) => c.id === recipient.id);
    const updatedChat: ChatItem = {
      id: recipient.id,
      peerUserId: recipient.id,
      peerDisplayName: recipient.displayName || existingChat?.peerDisplayName,
      peerPhoneNumber: recipient.phoneNumber || existingChat?.peerPhoneNumber || "",
      lastMessageText: displaySummary,
      lastMessageTimestamp: now,
      unreadCount: 0,
      disappearingMode: richData?.disappearingAfter || existingChat?.disappearingMode,
    };
    await store.addOrUpdateChat(updatedChat);

    if (this.client?.connected) {
      this.client.publish(
        `out/${this.userId}/${this.deviceId}`,
        JSON.stringify(envelope),
        { qos: 1 },
        (err) => {
          if (!err) {
            store.updateMessage(recipient.id, msgId, { status: "sent" });
          }
        }
      );
    }

    return newMsg;
  }

  // Group Message Sender (Signal Sender Keys)
  async sendGroupMessage(
    group: ChatItem,
    text: string,
    richData?: {
      messageType?: MessageItem["messageType"];
      media?: MediaAttachment;
      poll?: PollData;
      location?: LocationData;
      contact?: ContactData;
      event?: EventData;
      viewOnce?: boolean;
      forwardCount?: number;
      disappearingAfter?: number;
      replyTo?: { id: string; text: string; senderId: string };
    }
  ): Promise<MessageItem> {
    if (!this.signalAdapter) {
      throw new Error("SignalAdapter not initialized");
    }

    // 1. Ensure own SenderKey is distributed to all group members
    if (!this.distributedSenderKeys.has(group.id)) {
      const token = useAuthStore.getState().accessToken;
      const res = await fetch(`/v1/groups/${group.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const groupDetails = await res.json();
        const memberIds = groupDetails.members.map((m: any) => m.user_id);

        await this.signalAdapter.distributeSenderKeyToGroup(
          group.id,
          memberIds,
          async (targetUserId, pairwisePayload) => {
            const distEnvelope = {
              id: ulid(),
              version: 1,
              sender_user: this.userId,
              sender_device: this.deviceId,
              recipient_user: targetUserId,
              recipient_device: 1,
              type: 5, // SENDER_KEY_DISTRIBUTION
              ciphertext: btoa(JSON.stringify(pairwisePayload)),
              timestamp: Date.now(),
            };
            this.client?.publish(`out/${this.userId}/${this.deviceId}`, JSON.stringify(distEnvelope), { qos: 1 });
          }
        );
        this.distributedSenderKeys.add(group.id);
      }
    }

    const msgId = ulid();
    const envelopeId = ulid();
    const now = Date.now();

    const innerPayload = {
      id: msgId,
      text,
      replyTo: richData?.replyTo,
      messageType: richData?.messageType || "text",
      media: richData?.media,
      poll: richData?.poll,
      location: richData?.location,
      contact: richData?.contact,
      event: richData?.event,
      viewOnce: richData?.viewOnce,
      forwardCount: richData?.forwardCount || 0,
      disappearingAfter: richData?.disappearingAfter || group.disappearingMode,
      timestamp: now,
      groupName: group.peerDisplayName,
      senderPhone: useAuthStore.getState().user?.phone_number,
      senderDisplayName: useAuthStore.getState().user?.display_name,
    };

    // Encrypt once with Sender Key
    const groupCiphertext = await this.signalAdapter.encryptGroupMessage(
      group.id,
      JSON.stringify(innerPayload)
    );

    const envelope = {
      id: envelopeId,
      version: 1,
      sender_user: this.userId,
      sender_device: this.deviceId,
      recipient_user: group.id,
      recipient_device: 1,
      group_id: group.id,
      type: 1,
      ciphertext: groupCiphertext,
      timestamp: now,
    };

    const newMsg: MessageItem = {
      id: msgId,
      envelopeId,
      chatId: group.id,
      groupId: group.id,
      senderId: this.userId,
      senderDeviceId: this.deviceId,
      recipientId: group.id,
      recipientDeviceId: 1,
      text,
      timestamp: now,
      status: "pending",
      replyTo: richData?.replyTo,
      messageType: richData?.messageType || "text",
      media: richData?.media,
      poll: richData?.poll,
      location: richData?.location,
      contact: richData?.contact,
      event: richData?.event,
      viewOnce: richData?.viewOnce,
      viewed: false,
      forwardCount: richData?.forwardCount || 0,
      disappearingAfter: richData?.disappearingAfter || group.disappearingMode,
    };

    const store = useChatStore.getState();
    await store.addMessage(newMsg);

    let displaySummary = text;
    if (newMsg.messageType === "poll") displaySummary = `📊 Poll: ${newMsg.poll?.question}`;
    if (newMsg.messageType === "location") displaySummary = "📍 Location";
    if (newMsg.messageType === "contact") displaySummary = `👤 Contact: ${newMsg.contact?.name}`;
    if (newMsg.messageType === "event") displaySummary = `📅 Event: ${newMsg.event?.title}`;
    if (newMsg.messageType === "image") displaySummary = "📷 Photo" + (newMsg.text ? `: ${newMsg.text}` : "");
    if (newMsg.messageType === "video") displaySummary = "🎥 Video" + (newMsg.text ? `: ${newMsg.text}` : "");
    if (newMsg.messageType === "audio") displaySummary = "🎤 Voice message";
    if (newMsg.messageType === "document") displaySummary = `📄 ${newMsg.media?.fileName || "Document"}`;
    if (newMsg.messageType === "sticker") displaySummary = "Sticker";
    if (newMsg.messageType === "gif") displaySummary = "GIF";
    if (newMsg.viewOnce) displaySummary = "🔒 View-once message";

    const updatedChat: ChatItem = {
      ...group,
      lastMessageText: displaySummary,
      lastMessageTimestamp: now,
      unreadCount: 0,
    };
    await store.addOrUpdateChat(updatedChat);

    if (this.client?.connected) {
      this.client.publish(
        `out/${this.userId}/${this.deviceId}`,
        JSON.stringify(envelope),
        { qos: 1 },
        (err) => {
          if (!err) {
            store.updateMessage(group.id, msgId, { status: "sent" });
          }
        }
      );
    }

    return newMsg;
  }

  async sendPollVote(
    chat: ChatItem,
    pollMessageId: string,
    optionId: string
  ): Promise<void> {
    const store = useChatStore.getState();
    await store.votePoll(chat.id, pollMessageId, optionId, this.userId);

    const votePayload = {
      pollVote: {
        pollId: pollMessageId,
        optionId,
        voterId: this.userId,
      },
      timestamp: Date.now(),
    };

    if (chat.isGroup) {
      const ciphertext = await this.signalAdapter!.encryptGroupMessage(chat.id, JSON.stringify(votePayload));
      const envelope = {
        id: ulid(),
        version: 1,
        sender_user: this.userId,
        sender_device: this.deviceId,
        recipient_user: chat.id,
        recipient_device: 1,
        group_id: chat.id,
        type: 1,
        ciphertext,
        timestamp: Date.now(),
      };
      this.client?.publish(`out/${this.userId}/${this.deviceId}`, JSON.stringify(envelope), { qos: 1 });
    } else {
      const encrypted = await this.signalAdapter!.encrypt(chat.id, 1, JSON.stringify(votePayload));
      const envelope = {
        id: ulid(),
        version: 1,
        sender_user: this.userId,
        sender_device: this.deviceId,
        recipient_user: chat.id,
        recipient_device: 1,
        type: 1,
        ciphertext: btoa(JSON.stringify(encrypted)),
        timestamp: Date.now(),
      };
      this.client?.publish(`out/${this.userId}/${this.deviceId}`, JSON.stringify(envelope), { qos: 1 });
    }
  }

  async sendPinUpdate(
    chat: ChatItem,
    messageId: string,
    isPinned: boolean
  ): Promise<void> {
    const store = useChatStore.getState();
    await store.togglePinMessage(chat.id, messageId);

    const pinPayload = {
      pin: { msgId: messageId, isPinned },
      timestamp: Date.now(),
    };

    if (chat.isGroup) {
      const ciphertext = await this.signalAdapter!.encryptGroupMessage(chat.id, JSON.stringify(pinPayload));
      const envelope = {
        id: ulid(),
        version: 1,
        sender_user: this.userId,
        sender_device: this.deviceId,
        recipient_user: chat.id,
        recipient_device: 1,
        group_id: chat.id,
        type: 1,
        ciphertext,
        timestamp: Date.now(),
      };
      this.client?.publish(`out/${this.userId}/${this.deviceId}`, JSON.stringify(envelope), { qos: 1 });
    } else {
      const encrypted = await this.signalAdapter!.encrypt(chat.id, 1, JSON.stringify(pinPayload));
      const envelope = {
        id: ulid(),
        version: 1,
        sender_user: this.userId,
        sender_device: this.deviceId,
        recipient_user: chat.id,
        recipient_device: 1,
        type: 1,
        ciphertext: btoa(JSON.stringify(encrypted)),
        timestamp: Date.now(),
      };
      this.client?.publish(`out/${this.userId}/${this.deviceId}`, JSON.stringify(envelope), { qos: 1 });
    }
  }

  async sendReaction(
    recipientUserId: string,
    messageId: string,
    emoji: string
  ): Promise<void> {
    if (!this.signalAdapter || !this.client?.connected) return;

    const innerPayload = {
      reaction: { msgId: messageId, emoji },
      timestamp: Date.now(),
    };

    const encrypted = await this.signalAdapter.encrypt(
      recipientUserId,
      1,
      JSON.stringify(innerPayload)
    );

    const envelope = {
      id: ulid(),
      version: 1,
      sender_user: this.userId,
      sender_device: this.deviceId,
      recipient_user: recipientUserId,
      recipient_device: 1,
      type: 1,
      ciphertext: btoa(JSON.stringify(encrypted)),
      timestamp: Date.now(),
    };

    this.client.publish(
      `out/${this.userId}/${this.deviceId}`,
      JSON.stringify(envelope),
      { qos: 1 }
    );

    // Update locally
    const store = useChatStore.getState();
    const chatMsgs = store.messages[recipientUserId] || [];
    const target = chatMsgs.find((m) => m.id === messageId);
    if (target) {
      const reactions = { ...(target.reactions || {}), [this.userId]: emoji };
      await store.updateMessage(recipientUserId, messageId, { reactions });
    }
  }

  async sendEditMessage(
    recipientUserId: string,
    messageId: string,
    newText: string
  ): Promise<void> {
    if (!this.signalAdapter || !this.client?.connected) return;

    const innerPayload = {
      edit: { msgId: messageId, newText },
      timestamp: Date.now(),
    };

    const encrypted = await this.signalAdapter.encrypt(
      recipientUserId,
      1,
      JSON.stringify(innerPayload)
    );

    const envelope = {
      id: ulid(),
      version: 1,
      sender_user: this.userId,
      sender_device: this.deviceId,
      recipient_user: recipientUserId,
      recipient_device: 1,
      type: 1,
      ciphertext: btoa(JSON.stringify(encrypted)),
      timestamp: Date.now(),
    };

    this.client.publish(
      `out/${this.userId}/${this.deviceId}`,
      JSON.stringify(envelope),
      { qos: 1 }
    );

    const store = useChatStore.getState();
    await store.updateMessage(recipientUserId, messageId, {
      text: newText,
      isEdited: true,
      editedAt: Date.now(),
    });
  }

  async sendDeleteMessage(
    recipientUserId: string,
    messageId: string,
    forEveryone: boolean
  ): Promise<void> {
    const store = useChatStore.getState();
    if (forEveryone) {
      if (this.signalAdapter && this.client?.connected) {
        const innerPayload = {
          delete: { msgId: messageId, type: "everyone" },
          timestamp: Date.now(),
        };

        const encrypted = await this.signalAdapter.encrypt(
          recipientUserId,
          1,
          JSON.stringify(innerPayload)
        );

        const envelope = {
          id: ulid(),
          version: 1,
          sender_user: this.userId,
          sender_device: this.deviceId,
          recipient_user: recipientUserId,
          recipient_device: 1,
          type: 1,
          ciphertext: btoa(JSON.stringify(encrypted)),
          timestamp: Date.now(),
        };

        this.client.publish(
          `out/${this.userId}/${this.deviceId}`,
          JSON.stringify(envelope),
          { qos: 1 }
        );
      }

      await store.updateMessage(recipientUserId, messageId, {
        text: "You deleted this message",
        isDeleted: true,
      });
    } else {
      await store.updateMessage(recipientUserId, messageId, {
        text: "You deleted this message",
        isDeleted: true,
      });
    }
  }

  async sendCallSignal(
    recipientId: string,
    signalData: any,
    groupId?: string
  ): Promise<void> {
    if (!this.signalAdapter || !this.client?.connected) {
      console.warn("Cannot send call signal: transport not ready");
      return;
    }

    const jsonStr = JSON.stringify(signalData);

    if (groupId) {
      const ciphertext = await this.signalAdapter.encryptGroupMessage(groupId, jsonStr);
      const envelope = {
        id: ulid(),
        version: 1,
        sender_user: this.userId,
        sender_device: this.deviceId,
        recipient_user: groupId,
        recipient_device: 1,
        group_id: groupId,
        type: 4, // CALL_SIGNAL
        ciphertext,
        timestamp: Date.now(),
      };
      this.client.publish(
        `out/${this.userId}/${this.deviceId}`,
        JSON.stringify(envelope),
        { qos: 1 }
      );
    } else {
      const encrypted = await this.signalAdapter.encrypt(recipientId, 1, jsonStr);
      const envelope = {
        id: ulid(),
        version: 1,
        sender_user: this.userId,
        sender_device: this.deviceId,
        recipient_user: recipientId,
        recipient_device: 1,
        type: 4, // CALL_SIGNAL
        ciphertext: btoa(JSON.stringify(encrypted)),
        timestamp: Date.now(),
      };
      this.client.publish(
        `out/${this.userId}/${this.deviceId}`,
        JSON.stringify(envelope),
        { qos: 1 }
      );
    }
  }

  disconnect() {
    this.publishPresence(false);
    this.client?.end();
    this.client = null;
  }
}

export let transportInstance: MqttTransport | null = null;

export function getMqttTransport(): MqttTransport | null {
  return transportInstance;
}

export async function initMqttTransport(userId: string, deviceId: number = 1): Promise<MqttTransport> {
  if (transportInstance) {
    transportInstance.disconnect();
  }
  const adapter = new SignalAdapter(userId, deviceId);
  const transport = new MqttTransport(userId, deviceId);
  await transport.init(adapter);
  transportInstance = transport;
  return transport;
}
