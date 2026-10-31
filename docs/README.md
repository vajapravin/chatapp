# Technical Documentation (`docs/`)

This directory serves as the centralized technical specification and design reference for the `chatapp` project.

---

## Document Index

| Document | Purpose & Summary |
|---|---|
| [**BRIEF.md**](file:///Users/pravinmacm4/Documents/aml/chatapp/docs/BRIEF.md) | Comprehensive engineering brief covering system requirements, architectural constraints, target hardware specs (Synology DS425+ NAS), memory budget, and the phased implementation roadmap. |
| [**ARCHITECTURE.md**](file:///Users/pravinmacm4/Documents/aml/chatapp/docs/ARCHITECTURE.md) | High-level system architecture, service communication boundaries, network topologies, and memory limit tables. |
| [**API.md**](file:///Users/pravinmacm4/Documents/aml/chatapp/docs/API.md) | Complete REST API reference and Mosquitto MQTT hook reference, covering authentication, Signal Protocol key distribution, user lookup/search, presence, and Web Push subscriptions. |
| [**PHASE_1_FOUNDATION.md**](file:///Users/pravinmacm4/Documents/aml/chatapp/docs/PHASE_1_FOUNDATION.md) | Technical specification, architectural decisions, and verification results for Phase 1 (Core multi-container stack, authentication, database, Mosquitto ACLs). |
| [**PHASE_2_E2EE_MESSAGING.md**](file:///Users/pravinmacm4/Documents/aml/chatapp/docs/PHASE_2_E2EE_MESSAGING.md) | Technical specification for Signal Protocol E2EE messaging, X3DH key distribution, Double Ratchet mechanics, asynchronous router pipeline, presence, and WhatsApp Web UI verification. |
| [**technical/antigravity-chat-app-prompt.md**](file:///Users/pravinmacm4/Documents/aml/chatapp/docs/technical/antigravity-chat-app-prompt.md) | The original architectural requirements prompt and guidelines for `chatapp`. |

---

## Architectural Principles

1. **Zero-Knowledge Privacy**: Plaintext messages, media, and private keys never touch or transit the server. The server exclusively routes opaque ciphertext envelopes.
2. **Zero Paid Services by Default**: The entire core stack runs on self-hosted containers (Postgres, Redis, NATS, Mosquitto) without requiring paid third-party subscriptions.
3. **Strict Memory Budget**: Designed specifically for a Synology DS425+ NAS target (2 GB physical RAM), capping combined active RAM under **1.4 GB** (measured active: **~290 MiB**).
