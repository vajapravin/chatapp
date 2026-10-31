# Phase 3: Groups and Rich Messaging

Phase 3 implements zero-knowledge end-to-end encrypted group messaging using the canonical Signal Sender Key protocol alongside WhatsApp Web-grade rich messaging features.

---

## 1. Architecture Overview

```
                      ┌───────────────────────────────────────────────┐
                      │              FastAPI Backend                  │
                      │  - /v1/groups: CRUD, Roles, Invites (<=1024)  │
                      │  - Alembic migrations: groups, group_members  │
                      └──────────────────────┬────────────────────────┘
                                             │
                                             ▼
                      ┌───────────────────────────────────────────────┐
                      │             Mosquitto MQTT Broker             │
                      │  - Outbound Topic: out/{user_id}/{device_id}  │
                      │  - Member Inboxes: u/{member_id}/1/inbox      │
                      └──────────────────────┬────────────────────────┘
                                             │
                                             ▼
                      ┌───────────────────────────────────────────────┐
                      │                 Router Daemon                 │
                      │  - Validates group membership                 │
                      │  - Persists envelope with group_id            │
                      │  - Fans out ciphertext to all active members  │
                      │  - Zero-knowledge: ciphertext remains opaque  │
                      └──────────────────────┬────────────────────────┘
                                             │
                ┌────────────────────────────┴────────────────────────────┐
                ▼                                                         ▼
┌───────────────────────────────┐                         ┌───────────────────────────────┐
│     Client A (Group Admin)    │                         │    Client B (Group Member)    │
│  - Signal Pairwise DR Session │ ◄── SK Distribution ──► │  - Signal Pairwise DR Session │
│  - Sender Key Ratchet State   │                         │  - Sender Key Ratchet State   │
│  - AES-256-GCM + HMAC-SHA256  │ ── Group Ciphertext ──► │  - Decrypts with A's SenderKey│
│  - Rich Composer (Polls/Loc)  │                         │  - Live Voting, Pins, Views   │
└───────────────────────────────┘                         └───────────────────────────────┘
```

---

## 2. Signal Sender Key Protocol

Pairwise Double Ratchet scales with $O(N)$ encryptions per group message where $N$ is the number of group members. For groups up to 1,024 members, Phase 3 implements Signal's Sender Key protocol:

1. **Sender Key State**:
   - Each group member maintains an independent sender key chain: `(chainKey: 32 bytes, signingKey: 32 bytes, iteration: number)`.
2. **Distribution**:
   - Sender key state is created once per group and distributed pairwise to each existing member over their established pairwise Signal Double Ratchet session using envelope `type: 5` (`SENDER_KEY_DISTRIBUTION`).
3. **Group Message Encryption ($O(1)$)**:
   - For each outgoing message:
     $$\text{MessageKey} = \text{HMAC-SHA256}(\text{ChainKey}, \text{"MessageKey"})$$
     $$\text{NextChainKey} = \text{HMAC-SHA256}(\text{ChainKey}, \text{"ChainKey"})$$
   - Plaintext is encrypted with **AES-256-GCM** using `MessageKey` and a 12-byte random IV.
   - The ciphertext and IV are signed with `HMAC-SHA256(signingKey, IV || ciphertext)`.
4. **Group Fan-Out & Zero-Knowledge**:
   - The sender publishes a single ciphertext envelope with `group_id` to `out/{sender_id}/1`.
   - The router verifies sender membership in the group and fans out the identical opaque ciphertext to all active group members' inboxes (`u/{member_id}/1/inbox`).
   - The server never possesses any group keys, sender keys, or plaintext data.

---

## 3. Rich Messaging Capabilities

| Feature | Protocol Format | Description |
|---|---|---|
| **Interactive Polls** | `messageType: "poll"` | Questions, single/multiple-choice options, live voting tallies broadcast to group or 1:1. |
| **Location Sharing** | `messageType: "location"` | Latitude, longitude, location name, address, with interactive map deep-links. |
| **Contact Cards** | `messageType: "contact"` | Name, phone number, organization sharing. |
| **Event Scheduling** | `messageType: "event"` | Title, date, time, location, description for meetings and announcements. |
| **Pinned Messages** | `pin: { msgId, isPinned }` | Persistent banner docked under header; toggled by group members or 1:1 peers. |
| **Starred Messages** | Local IndexedDB flag `isStarred` | Mark favorite messages for quick discovery. |
| **Disappearing Messages**| `disappearingMode` (24h / 7d / 90d) | Configurable per-chat/group countdown timer; automated eviction via background cleaner. |
| **View-Once Media/Messages**| `viewOnce: true` | Single-open ephemeral messages with click-to-reveal modal and immediate destruction. |
| **Forwarding Limits** | `forwardCount` | Counter tracking forwards; displays "Forwarded many times" tag when $> 5$. |

---

## 4. REST API Endpoints

- `POST /v1/groups`: Create group (max 1,024 members), returns group metadata and invite token.
- `GET /v1/groups`: List all groups current user belongs to.
- `GET /v1/groups/{id}`: Detailed view of group, members, roles, and disappearing timer.
- `PATCH /v1/groups/{id}`: Update group name, description, avatar, or disappearing mode (admins only).
- `POST /v1/groups/{id}/members`: Add members (admins only).
- `DELETE /v1/groups/{id}/members/{user_id}`: Remove member (admin) or leave group (self).
- `PATCH /v1/groups/{id}/members/{user_id}/role`: Promote or demote member to admin (admin only).
- `GET /v1/groups/invite/{token}`: Public preview of group metadata prior to joining.
- `POST /v1/groups/invite/{token}/join`: Join group using invite link.

---

## 5. Verification & Test Suite

- **Unit & Integration Tests (`pytest api/tests`)**:
  - `api/tests/test_groups_api.py`: Validates group creation, admin permissions, member caps (1,024), invite tokens, and join flows.
  - All 10 backend tests passing: `10 passed in 12.82s`.
- **Automated 3-Party E2E Test (`node client/scripts/test_phase3_groups_rich.mjs`)**:
  - Registers 3 users: Alice, Bob, Charlie.
  - Alice creates group "Alpha Squad" with Bob and Charlie.
  - Alice distributes Signal Sender Key via pairwise Double Ratchet (type 5).
  - Alice encrypts and broadcasts group messages via `GroupCipher` and MQTT router fan-out.
  - Verifies interactive poll creation, live option voting from Bob, and vote tally decryption by Alice.
  - Verifies location sharing, contact cards, event scheduling, view-once ephemeral reveal, and pinned messages.
  - Verifies group administration: admin promotion, non-admin 403 Forbidden enforcement, and new member joining via invite token.
  - **Result: 100% Passed**.
