import mqtt, { MqttClient } from "mqtt";
import { ulid } from "ulidx";
import { SignalAdapter } from "../crypto/SignalAdapter";
import { ChatItem, MessageItem } from "../storage/db";
import { useAuthStore } from "../store/authStore";
import { useChatStore } from "../store/chatStore";

export class MqttTransport {
  private client: MqttClient | null = null;
  private signalAdapter: SignalAdapter | null = null;
  private userId: string;
  private deviceId: number;
  private typingTimeouts: Map<string, any> = new Map();

  constructor(userId: string, deviceId: number = 1) {
    this.userId = userId;
    this.deviceId = deviceId;
  }

  async init(adapter: SignalAdapter) {
    this.signalAdapter = adapter;
    await this.signalAdapter.init();
    this.connect();
  }

  private connect() {
    const token = useAuthStore.getState().accessToken;
    if (!token) return;

    // Use /mqtt proxy or direct port 9001
    const isHttps = typeof window !== "undefined" && window.location.protocol === "https:";
    const host = typeof window !== "undefined" ? window.location.hostname : "localhost";
    const port = typeof window !== "undefined" && window.location.port ? window.location.port : "3000";
    
    // In browser container behind Nginx, /mqtt is forwarded to mosquitto:9001
    // In standalone vite dev, connect directly to port 9001
    const brokerUrl = port === "3000"
      ? `${isHttps ? "wss:" : "ws:"}//${host}:${port}/mqtt`
      : `${isHttps ? "wss:" : "ws:"}//${host}:9001`;

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
      console.log("[MQTT] Connected to broker successfully");

      // Subscribe to user inbox & acks
      this.client?.subscribe(`u/${this.userId}/${this.deviceId}/#`, { qos: 1 });
      // Subscribe to global presence
      this.client?.subscribe("p/#", { qos: 1 });

      // Publish online presence
      this.publishPresence(true);
    });

    this.client.on("message", (topic, payload) => {
      this.handleIncomingMessage(topic, payload);
    });

    this.client.on("error", (err) => {
      console.warn("[MQTT] Connection error:", err.message);
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
        if (data.status === "server_ack" && data.envelope_id) {
          useChatStore.getState().updateMessageStatusByEnvelopeId(data.envelope_id, "sent");
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

        // RECEIPT envelope
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

        // MESSAGE envelope
        if (envelope.type === 1 && this.signalAdapter) {
          const encryptedPayload = JSON.parse(atob(envelope.ciphertext));
          const decryptedJson = await this.signalAdapter.decrypt(
            envelope.sender_user,
            envelope.sender_device || 1,
            encryptedPayload
          );
          const innerMsg = JSON.parse(decryptedJson);

          const senderId = envelope.sender_user;
          const store = useChatStore.getState();

          // Handle reaction
          if (innerMsg.reaction) {
            const { msgId, emoji } = innerMsg.reaction;
            const chatMsgs = store.messages[senderId] || [];
            const target = chatMsgs.find((m) => m.id === msgId);
            if (target) {
              const reactions = { ...(target.reactions || {}), [senderId]: emoji };
              await store.updateMessage(senderId, msgId, { reactions });
            }
            return;
          }

          // Handle message edit
          if (innerMsg.edit) {
            const { msgId, newText } = innerMsg.edit;
            await store.updateMessage(senderId, msgId, {
              text: newText,
              isEdited: true,
              editedAt: Date.now(),
            });
            return;
          }

          // Handle message delete for everyone
          if (innerMsg.delete) {
            const { msgId } = innerMsg.delete;
            await store.updateMessage(senderId, msgId, {
              text: "This message was deleted",
              isDeleted: true,
            });
            return;
          }

          // Standard incoming message
          const newMsg: MessageItem = {
            id: innerMsg.id || ulid(),
            envelopeId: envelope.id,
            chatId: senderId,
            senderId,
            senderDeviceId: envelope.sender_device || 1,
            recipientId: this.userId,
            recipientDeviceId: this.deviceId,
            text: innerMsg.text,
            timestamp: innerMsg.timestamp || Date.now(),
            status: "delivered",
            replyTo: innerMsg.replyTo,
          };

          await store.addMessage(newMsg);

          // Update or create chat in left sidebar
          const existingChat = store.chats.find((c) => c.id === senderId);
          const isActive = store.activeChatId === senderId;

          const updatedChat: ChatItem = {
            id: senderId,
            peerUserId: senderId,
            peerDisplayName: existingChat?.peerDisplayName || innerMsg.senderDisplayName || senderId,
            peerPhoneNumber: existingChat?.peerPhoneNumber || innerMsg.senderPhone || "",
            peerAvatarUrl: existingChat?.peerAvatarUrl,
            lastMessageText: innerMsg.text,
            lastMessageTimestamp: newMsg.timestamp,
            unreadCount: isActive ? 0 : (existingChat?.unreadCount || 0) + 1,
          };
          await store.addOrUpdateChat(updatedChat);

          // Send delivered receipt back
          this.sendReceipt(senderId, envelope.sender_device || 1, envelope.id, newMsg.id, "delivered");

          // If active chat is open, immediately send read receipt too
          if (isActive) {
            this.sendReceipt(senderId, envelope.sender_device || 1, envelope.id, newMsg.id, "read");
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

  async sendMessage(
    recipient: { id: string; phoneNumber: string; displayName?: string },
    text: string,
    replyTo?: { id: string; text: string; senderId: string }
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
      replyTo,
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
      replyTo,
    };

    const store = useChatStore.getState();
    await store.addMessage(newMsg);

    const existingChat = store.chats.find((c) => c.id === recipient.id);
    const updatedChat: ChatItem = {
      id: recipient.id,
      peerUserId: recipient.id,
      peerDisplayName: recipient.displayName || existingChat?.peerDisplayName,
      peerPhoneNumber: recipient.phoneNumber || existingChat?.peerPhoneNumber || "",
      lastMessageText: text,
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
            store.updateMessage(recipient.id, msgId, { status: "sent" });
          }
        }
      );
    }

    return newMsg;
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

    // Update locally
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
      // Delete for me only
      await store.updateMessage(recipientUserId, messageId, {
        text: "You deleted this message",
        isDeleted: true,
      });
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
