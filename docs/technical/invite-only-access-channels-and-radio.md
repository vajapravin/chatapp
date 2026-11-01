# Phase 7 — Invite-only Access, Channels and Radio

Nov 1, 2026 · @Pravin Vaja

## Summary

Phase 7 turns chatapp into a private, invite-only space with Discord-style channels, Slack-style posts with code blocks, and a synced "radio" panel per channel that plays YouTube Music tracks chosen by the channel owner, optionally with help from an LLM.

It slots into the existing build brief as the new Phase 7. The old Phase 7 (hardening, `full` profile, Electron, load tests) becomes **Phase 8**. Everything here must still meet the brief's hard constraints: zero paid services by default, Python backend, Docker on the 2 GB Synology NAS, access only through Cloudflare Tunnel.

**The one constraint that shapes this phase:** YouTube's API policies forbid audio-only playback, hiding the player and background play. The radio panel therefore shows a small visible YouTube player and pauses when the tab is hidden. A true audio-only radio is possible only from your own music files (Option B in section F7.5).

## Scope, goals and non-goals

Phase 7 ships six features. Each has its own section below with requirements and acceptance checks.

| ID | Feature | Goal |
| --- | --- | --- |
| F7.1 | Invite-only access | Nobody without an admin-issued email invite can register, sign in or connect to MQTT |
| F7.2 | Dashboard | A Discord-like three-column layout with channels, posts and a radio/members panel |
| F7.3 | Channels | Any user can create a channel, becomes its owner and invites other users |
| F7.4 | Posts | Slack-style formatting with fenced code blocks, syntax highlighting and snippets |
| F7.5 | Radio panel | One synced YouTube Music broadcast per channel; only the owner controls it |
| F7.6 | Ask LLM | The owner describes a mood in plain words and gets a playable track list |

**Non-goals for Phase 7:**

- Servers/guilds, categories, custom roles, permissions per role, bots and webhooks (Discord features left out on purpose).
- Threads, scheduled posts, workflows and Slack apps.
- Video in channels, screen sharing, voice chat rooms (audio stays music-only).
- Members controlling or voting on the radio queue (see open questions).
- Downloading, caching or re-streaming YouTube audio on the server. This breaks YouTube's terms and is excluded by design.

## Roles and permissions

There are four roles: one instance-wide (admin) and three per channel. A user can be owner of some channels and a member of others.

| Action | Admin | Channel owner | Channel member | Invitee (not yet registered) |
| --- | --- | --- | --- | --- |
| Invite a new email to chatapp | Yes | No (setting can allow) | No | No |
| Revoke invites, disable users | Yes | No | No | No |
| Create a channel | Yes | Yes | Yes | No |
| Invite registered users to a channel | Own channels | Yes | No (setting can allow) | No |
| Remove members, rename or delete channel | Own channels | Yes | No | No |
| Transfer channel ownership | Own channels, or any channel if owner disabled | Yes | No | No |
| Post, react, edit/delete own posts | Yes | Yes | Yes | No |
| Delete anyone's post in channel | Own channels | Yes | No | No |
| Tune in to the radio, set own volume | Yes | Yes | Yes | No |
| Control the radio (queue, play, skip, Ask LLM) | Own channels | Yes | No | No |

**Rules:**

- The first admin is created on first boot from `ADMIN_EMAIL` in `.env`. Admins can promote other users to admin.
- Each channel has exactly one owner. An owner who leaves must transfer ownership first. If the owner is disabled, an admin must reassign it.
- Admin rights do not give access to a channel's content. An admin only sees channels they are a member of, because posts are end-to-end encrypted.

## F7.1 Invite-only access by email

Registration is closed to the public. An email address can create an account only by redeeming a valid invite issued to that exact address. The allowlist is checked at every entry point, not just at sign-up.

**Flow**

1. Admin opens **Admin › Invites**, enters one or more emails (or uploads a CSV), picks a role (user or admin) and an expiry (default 7 days, max 30).
2. `api` creates an invite with a 32-byte random token, stores only its SHA-256 hash, and emails the link `https://chatapp.vajapravin.me/invite/<token>` through the configured SMTP provider.
3. The invitee opens the link. The client calls `GET /v1/invites/<token>`, which returns only "valid" or "invalid/expired" plus the masked email (`p***@gmail.com`).
4. The invitee confirms the email. `api` sends a 6-digit OTP to that address (valid 10 minutes, 5 attempts).
5. On a correct OTP, `api` creates the account, marks the invite `accepted`, and continues into the normal key setup from Phase 2 (identity keys, prekeys, passkey enrolment offered).

**Requirements**

- Email is the account identity from this phase onwards. Normalise to lower case and trim spaces. Phone number becomes an optional profile field.
- An invite is single-use, bound to one email, and expires. Admins can resend (new token, old one revoked) or revoke.
- Invite statuses: `pending`, `accepted`, `expired`, `revoked`. The admin list shows email, role, inviter, sent, expires and status, newest first.
- **Enforcement points:** registration, sign-in OTP request, token refresh, MQTT connect (the `mosquitto-go-auth` HTTP check), and an `api` middleware on every authenticated request. A user must be `active`.
- **Disabling a user** sets `status=disabled`, revokes all refresh tokens, publishes a kick event that makes the router disconnect their MQTT sessions within 30 seconds, and removes them from channel sender-key groups (rotation in F7.3).
- Responses never reveal whether an email exists. Sign-in for an unknown or uninvited email returns the same "If this address has access, a code is on its way" message.
- Rate limits: 5 OTP requests per email per hour, 20 invite-token lookups per IP per hour, 100 invites per admin per day.
- Every invite action writes an `audit_event`.
- Email templates (invite, OTP, access removed) are plain HTML in the repo. SMTP settings stay in `.env`: any free SMTP account works.
- **Optional extra layer (free):** put Cloudflare Access (Zero Trust) in front of `chatapp.vajapravin.me` with an email allow-list policy. Off by default, because the Electron app and MQTT WebSocket need extra service-token setup. Check the free plan's current seat limit before relying on it.

**Acceptance**

- An uninvited email cannot register, cannot receive an OTP, and cannot open an MQTT connection, whatever the client sends.
- An expired, revoked or already-used invite link shows "This invite is no longer valid" and creates nothing.
- Disabling a signed-in user logs them out of every device within 30 seconds.
- Integration tests cover every enforcement point listed above.

## F7.2 Dashboard layout

The dashboard is a Discord-style three-column screen with only the parts this phase needs. Existing 1:1 and group chats from Phases 2–6 stay reachable from the same left rail.

| Region | Width (desktop) | Contents |
| --- | --- | --- |
| Left rail | 72 px | App icon, **Chats** (existing DMs/groups), **Channels**, **Admin** (admins only), avatar menu (profile, settings, sign out) |
| Sidebar | 240 px | Channel list with unread dot and mention count; "+ New channel" button; collapsed "Invites waiting" section |
| Main pane | flexible | Channel header (name, topic, member count, settings cog for owner), post feed, composer |
| Right panel | 320 px, collapsible | **Radio** card on top (player, now playing, controls or listen-only view, queue), **Members** list below with online dot and owner badge |

**Requirements**

- Responsive: under 1024 px the right panel becomes a drawer opened from a radio icon in the channel header. Under 768 px the sidebar becomes a drawer too and the main pane fills the screen.
- The radio card stays mounted while the user moves between posts in the same channel, so playback never restarts on scroll or navigation inside the channel.
- Switching to a different channel stops the radio of the old channel (one autoplaying player per page, as YouTube requires).
- Keyboard: `Ctrl+K` quick switcher for channels, `Alt+↑/↓` previous/next channel, `Esc` closes drawers.
- Dark and light themes follow the existing design tokens. Meets WCAG 2.2 AA, including focus order through the three columns.

**Acceptance**

- A new invited user lands on an empty dashboard with a "Create your first channel" prompt.
- The layout works at 1440, 1024, 768 and 390 px widths with no horizontal scroll (Playwright screenshot tests).

## F7.3 Channels and channel invites

Any active user can create a channel and becomes its owner. Channels are private: only invited members can see them, and their posts are end-to-end encrypted with the same Sender Keys mechanism as Phase 3 groups.

**Create and manage**

- Create: name (1–48 characters, lower case, digits and hyphens, unique per owner), optional topic (≤ 160 characters), optional icon (emoji or uploaded image, encrypted like other media).
- Owner settings: rename, edit topic and icon, set radio on/off for the channel, "members can invite" toggle (default off), transfer ownership, archive (read-only) and delete (removes channel and all posts after a typed confirmation).
- Limit: 500 members per channel and 50 channels owned per user (configurable).

**Invite registered users**

- The owner picks users from a searchable list of active chatapp users (name and email). Inviting someone not yet registered is not possible here: only an admin can bring a new email into chatapp (F7.1).
- The invitee sees the invite under **Invites waiting** in the sidebar and gets a Web Push notification. They can accept or decline. Pending channel invites expire after 14 days.
- On accept, the client joins the channel's sender-key group and posts a system message "\<name> joined".

**Membership changes and encryption**

- Removing or banning a member rotates the channel's sender key so the removed user cannot read new posts. Leaving does the same.
- **History on join:** by default a new member sees posts from their join time onward, which is the honest default for end-to-end encryption. An owner can turn on **History handover**: when a member joins, the owner's client (when online) re-encrypts the last N posts (default 200, max 1,000) for the new member. The server never decrypts anything.
- Posts are stored on the server as ciphertext so that a member's new linked device can fetch history it holds keys for. Retention is configurable per channel (default: keep forever, options 30, 90, 365 days).

**Acceptance**

- A user who is not a member gets 404 on every channel endpoint and cannot subscribe to the channel's MQTT topics.
- After a member is removed, a test client holding their old keys cannot decrypt any post sent after removal.
- Ownership transfer works in both directions and the new owner immediately gets radio controls.

## F7.4 Posting with Slack-style formatting and code

Members post rich text that follows Slack's markup, with first-class code: inline code, fenced blocks with a language hint and syntax highlighting, and long code as a collapsible snippet. All parsing and rendering happens on the client, because the server only sees ciphertext.

**Supported markup**

| You type | Renders as |
| --- | --- |
| `*bold*` | bold |
| `_italic_` | italic |
| `~strike~` | strikethrough |
| `` `code` `` | inline code |
| ```` ```python ```` … ```` ``` ```` | code block, Python highlighting |
| `> quote` | block quote |
| `- item` or `1. item` | bulleted or numbered list |
| `@name`, `@channel` | mention (notifies), channel-wide mention (owner only) |
| a URL | link; preview card optional (below) |

**Code blocks**

- Highlighting with Shiki (or Prism) in a Web Worker, loaded lazily. At least 30 languages including Python, TypeScript, JavaScript, Go, Rust, Java, C/C++, C#, SQL, Bash, YAML, JSON, Dockerfile, HTML, CSS, Markdown and diff. No language tag → auto-detect, falling back to plain text.
- Each block shows the language label, line numbers (toggle), a **Copy** button and a wrap/no-wrap toggle.
- Blocks over 20 lines collapse to 12 lines with "Show all N lines".
- **Snippets:** text over 4,000 characters, or a pasted code file, becomes a snippet attachment: a titled, highlighted file card, stored as an encrypted media blob (Phase 4 pipeline), downloadable with its original extension.

**Composer and posts**

- Composer with a formatting toolbar (bold, italic, strike, code, code block, quote, list, link), live preview toggle, `Enter` to send, `Shift+Enter` for a new line, `Ctrl+Shift+C` to wrap the selection in a code block. Inside an open \`\`\` block, `Enter` adds a new line instead of sending.
- Attach images, files and voice notes using the Phase 4 encrypted pipeline. Paste an image from the clipboard.
- Reactions, edit (15 min, shows "edited"), delete, pin (up to 10 per channel), reply-quote and copy link to post.
- Link previews are off by default. If turned on, the sender's client fetches the preview and sends it inside the encrypted post. The server never fetches URLs.
- Rendering is strict: no raw HTML, links get `rel="noopener noreferrer"`, and the sanitiser is covered by XSS tests.
- Unread tracking per channel, "New posts" divider, and jump to first unread.

**Acceptance**

- A post containing each markup row above renders exactly as listed, in light and dark themes.
- A 300-line Python block pasted into the composer renders highlighted, collapsed, and copies back byte for byte.
- An XSS test corpus (OWASP cheat-sheet payloads) renders as inert text.

## F7.5 Radio panel

Each channel has one radio: the owner builds a queue of YouTube Music tracks, and every member who tunes in hears the same track at the same position, within 1.5 seconds. The server owns the playback clock. Each listener's browser plays the track through its own embedded YouTube player, so no audio ever passes through the NAS.

&#91;embedded content: radio architecture · control, clock and media paths\]

Only owner commands reach the radio service; listeners get the clock over MQTT and pull the media straight from YouTube.

**Option A (default): synced YouTube embed.** Track search uses `ytmusicapi`, with the YouTube Data API as a fallback. Playback uses the official YouTube IFrame Player API. This is what the rest of this section specifies.

**Option B (future, true audio-only):** stream your own music files from the NAS through Icecast, with a Navidrome-style library. This has no YouTube limits, but it means a different content source and an extra container. It is listed in open questions, not built in Phase 7.

**What the owner can do** (the radio card shows these only to the owner)

- Go **On air** or **Off air**. Off air hides the player for everyone and stops the clock.
- Search YouTube Music (songs, then videos), preview a result, add it to the queue, and play next or play now.
- Paste a YouTube or YouTube Music track or playlist URL to import it (playlist import is up to 200 items).
- Reorder by drag and drop, remove, clear, shuffle, repeat (off / one / all).
- Play, pause, skip, previous, and seek on the progress bar.
- **Ask LLM** (F7.6) to fill or replace the queue.
- **Auto-DJ** toggle: when the queue falls below 3 tracks, top it up with similar songs from YouTube Music's own radio for the last track (`ytmusicapi.get_watch_playlist(radio=True)`), with no LLM call needed.
- Save the current queue as a named playlist on the channel and load saved playlists later.

**What members can do**

- **Tune in** (a click is needed, because browsers block autoplay with sound until the user interacts) and **Tune out**.
- Set their own volume or mute. This is local only and never changes anyone else's playback.
- See now playing (title, artist, artwork, progress), the up-next queue read-only, who added each track, and the listener count with avatars.

**Sync model**

- The `radio` service keeps one authoritative state per channel: `status`, `track`, `started_at` (server time when position 0 would have played), `paused_at`, `queue_version`.
- Every change is published as a retained MQTT message on `ch/<channel_id>/radio/state`. Late joiners get the current state the moment they subscribe.
- Each client estimates its clock offset from 3 calls to `GET /v1/time` (NTP-style, keeping the lowest round-trip sample). It computes `position = server_now − started_at` and calls `seekTo` when it drifts more than 1.5 seconds.
- The service advances the queue itself when a track's duration has elapsed (duration comes from search metadata or `videos.list`). The radio keeps playing when the owner closes their tab, like a real station. If nobody is tuned in for 30 minutes, the service pauses it.
- If a player reports an error (embedding disabled or video unavailable), the client posts it to `POST /v1/channels/<id>/radio/report`. On the first valid report, the service skips the track and marks it unplayable in a cache.

**YouTube compliance (hard requirements)**

- The embedded player stays visible at a minimum of 200 × 200 px, with no overlays on its controls and no hiding with CSS. The card shows it as a square "artwork" tile with track details beside it.
- No background play: when the tab is hidden or minimised (`visibilitychange`), the client pauses locally. On return, it resyncs to the live position.
- Only one auto-playing player per page. The radio player is the only one, and opening a YouTube link in a post shows a thumbnail, not a second autoplaying player.
- Never download, extract or re-stream audio. Show a "Uses YouTube API Services" notice with links to YouTube's terms and Google's privacy policy, and add it to chatapp's own privacy page.
- Do not override the player's referrer: keep the `Referer` header and `origin` parameter set to `https://chatapp.vajapravin.me`.

**Acceptance**

- Three listeners on different networks hear the same track within 1.5 s of each other (measured by logging `getCurrentTime()` against server time) for 30 minutes.
- A member's controls never change shared state: every radio-control endpoint returns 403 for a non-owner, and so does any MQTT publish to the radio topic.
- Closing the owner's tab does not stop the radio, and the next track starts on time.
- An unplayable track is skipped within 5 s for all listeners.

## F7.6 Ask LLM for music

The owner types what they want in plain words ("chill lo-fi for a late coding session, no vocals, about an hour"). The LLM turns it into search queries, the server resolves those to real, playable YouTube Music tracks, and the owner approves the list before anything reaches the queue. The LLM never invents video IDs: every track comes from a real search result.

**Flow**

1. The owner opens **Ask LLM** in the radio card and types a request (≤ 500 characters). Chips offer quick moods: Focus, Chill, Party, Workout, Retro, Bollywood, Instrumental.
2. `api` calls the LLM gateway with the system prompt below and the request. The current queue's last 10 track titles go along as context so it can "continue the vibe".
3. The LLM returns JSON that is validated against a Pydantic schema; one retry on invalid output.
4. The `radio` service runs each search query through `ytmusicapi.search(filter="songs")`, takes the top 5 per query, drops duplicates, anything in `exclude`, tracks shorter than 60 s or longer than 15 min, and known-unplayable IDs, then trims to the target duration.
5. The owner sees a preview list with title, artist, artwork, duration and total time, and can untick items, then choose **Add to queue**, **Play next** or **Replace queue**.
6. The prompt, the LLM JSON and the chosen track IDs are saved in `llm_requests` for history and "Ask again".

**LLM output schema**

```json
{
  "interpretation": "Mellow instrumental lo-fi and chillhop, ~60 min",
  "search_queries": ["lofi hip hop instrumental", "chillhop study beats", "jazzhop piano"],
  "seed_artists": ["Nujabes", "J Dilla"],
  "target_minutes": 60,
  "exclude": ["vocals", "live"],
  "language": null
}
```

**System prompt (stored in `radio/prompts/ask_music.v1.txt`, versioned)**

```text
You are a music curator for a small private radio channel.
Turn the user's request into YouTube Music search queries.
Return ONLY JSON matching the schema. 3-8 search_queries, each 2-6 words,
mixing genre, mood and era words. Use seed_artists only if they clearly fit.
Never output video IDs, URLs or song lyrics. If the request is not about music,
return {"error": "not_music"}.
```

**Providers (free by default, behind LiteLLM)**

| `LLM_PROVIDER` | Cost | Note |
| --- | --- | --- |
| `gemini` (default) | Free tier on Flash / Flash-Lite models, rate-limited | Free-tier prompts may be used by Google to improve its products; only the music request is ever sent |
| `groq`, `openrouter` | Free tiers on selected open models | Swap with one env var |
| `ollama` | Free, local | Needs a RAM upgrade on the NAS; disabled on 2 GB |
| `anthropic`, `openai` | Paid | Opt-in only |
| `none` | Free | Hides the Ask LLM button; Auto-DJ still works |

**Requirements**

- Owner-only: members never see the Ask LLM button, and the endpoint returns 403 for them.
- Rate limit: 10 requests per owner per 10 minutes, 100 per instance per day (configurable). Show a friendly message on provider 429s and fall back to Auto-DJ seeds.
- No chat content, post text or member names are ever sent to the LLM.
- Target: preview list shown within 10 s p95.

**Acceptance**

- 20 varied test prompts (including Hindi and Gujarati requests and one non-music prompt) each return valid JSON. Music prompts yield at least 10 playable tracks; the non-music prompt is refused politely.
- With `LLM_PROVIDER=none` the feature hides cleanly and nothing else breaks.

## Platform constraints and compliance

Five external facts set the limits of this phase. Each one has a design answer already written into the sections above.

| Constraint | What it means | Design answer |
| --- | --- | --- |
| [YouTube developer policies](https://developers.google.com/youtube/terms/developer-policies-guide) forbid background play, separating audio from video, and blocking standard player features | A pure "radio, no video" experience is not allowed with YouTube content | Visible 200 × 200 px player tile; pause when the tab is hidden; Option B (own files) for true audio-only |
| [Required minimum functionality](https://developers.google.com/youtube/terms/required-minimum-functionality): embedded players must be at least 200 × 200 px, autoplay only once more than half the player is visible, and at most one autoplaying player per page | Player size and autoplay rules are fixed | Radio is the single player; "Tune in" click starts playback |
| [YouTube Data API quota](https://developers.google.com/youtube/v3/determine_quota_cost): default 10,000 units a day, and `search.list` allows only about 100 searches a day | Official search alone runs out fast | `ytmusicapi` for search (unofficial, MIT-licensed), Data API only as fallback; cache results 24 h; playlist import uses cheap `playlistItems.list` calls |
| [`ytmusicapi`](https://github.com/sigma67/ytmusicapi) emulates the YouTube Music web client and is not an official API | It can break when YouTube changes its web client, and its terms status is grey | Pin the version, wrap it behind a `MusicSearch` interface, health-check daily, fall back to the Data API |
| Gemini free tier: available for eligible models, rate-limited, and content may be used to improve Google's products ([guide](https://yingtu.ai/en/blog/google-gemini-api-free-tier-limits-2026)) | Free but not private | Send only the music request; provider swappable with one env var |

**Fit with the rest of the brief**

- **End-to-end encryption boundary:** channel posts, attachments and snippets stay end-to-end encrypted. The radio is **not**: track IDs, queue, playback state and Ask LLM prompts are stored and processed by the server in plain text. The radio card shows a small "Radio activity is not end-to-end encrypted" note on first use.
- **NAS memory:** the only new container is `radio` (Python, ≤ 128 MB). LLM and search run as outbound HTTPS calls. The `core` profile must stay ≤ 1.4 GB with Phase 7 enabled.
- **Cloudflare Tunnel:** everything in Phase 7 is HTTPS or WebSocket, so it works through the tunnel. YouTube media streams straight from Google to each listener's browser.
- **Costs:** none by default. YouTube Data API key and Gemini key are free; SMTP is any free account.

## Data model, REST API and MQTT topics

Phase 7 adds ten Postgres tables (and changes the users table), one new service (`radio`) and about 30 endpoints. All tables carry the owning `user_id` or `channel_id` as a leading key, in line with the brief's sharding rule.

**Tables**

| Table | Key fields | Notes |
| --- | --- | --- |
| `invites` | id, email, token\_hash, role, invited\_by, status, expires\_at, accepted\_at | Unique pending invite per email |
| `users` (changed) | + status (active/disabled), + role (user/admin), email unique, phone nullable | Migration from Phase 1 identity |
| `channels` | id, owner\_id, name, topic, icon\_ref, radio\_enabled, members\_can\_invite, history\_handover, retention\_days, archived\_at |  |
| `channel_members` | channel\_id, user\_id, role (owner/member), joined\_at, last\_read\_post\_id | Unique (channel\_id, user\_id) |
| `channel_invites` | id, channel\_id, invitee\_id, invited\_by, status, expires\_at |  |
| `channel_posts` | id (ULID), channel\_id, sender\_user, sender\_device, key\_epoch, ciphertext, created\_at, edited\_at, deleted\_at | Ciphertext only; partitioned by month |
| `radio_state` | channel\_id, status, track\_id, started\_at, paused\_at, repeat\_mode, shuffle, queue\_version | One row per channel |
| `radio_queue` | id, channel\_id, position, video\_id, title, artist, duration\_ms, thumb\_url, added\_by, source (search/url/llm/autodj/playlist) |  |
| `radio_playlists`, `llm_requests`, `track_cache` | saved queues; prompt + JSON + chosen IDs; metadata + playable flag (24 h TTL) |  |

**REST endpoints (all under `/v1`, OpenAPI documented)**

| Area | Endpoints |
| --- | --- |
| Invites (admin) | `POST /admin/invites` (bulk), `GET /admin/invites`, `POST /admin/invites/{id}:resend`, `DELETE /admin/invites/{id}`, `PATCH /admin/users/{id}` (disable, role) |
| Invite redemption | `GET /invites/{token}`, `POST /invites/{token}/otp`, `POST /invites/{token}/accept` |
| Channels | `POST /channels`, `GET /channels`, `GET/PATCH/DELETE /channels/{id}`, `POST /channels/{id}:transfer` |
| Members | `GET /channels/{id}/members`, `POST /channels/{id}/invites`, `POST /channel-invites/{id}:accept`, `:decline`, `DELETE /channels/{id}/members/{user_id}` |
| Posts | `GET /channels/{id}/posts?before=&limit=`, `POST /channels/{id}/posts` (ciphertext), `PATCH/DELETE /channels/{id}/posts/{post_id}`, `POST /channels/{id}/pins` |
| Radio (owner) | `POST /channels/{id}/radio:onair`, `:offair`, `:play`, `:pause`, `:skip`, `:previous`, `:seek`, `PUT /channels/{id}/radio/queue` (with `queue_version`), `POST /channels/{id}/radio/queue/items`, `POST /channels/{id}/radio/import` |
| Radio (anyone in channel) | `GET /channels/{id}/radio`, `POST /channels/{id}/radio/report`, `GET /music/search?q=` (owner only) |
| Ask LLM (owner) | `POST /channels/{id}/radio/ask`, `GET /channels/{id}/radio/ask/history` |
| Clock | `GET /time` (server time in ms, for sync) |

Queue writes use optimistic concurrency: a stale `queue_version` returns 409 with the current queue.

**MQTT topics (added to the broker ACL)**

| Topic | Publisher | Subscribers | Retained |
| --- | --- | --- | --- |
| `ch/{channel_id}/posts` | router (after validating membership) | channel members | No |
| `ch/{channel_id}/radio/state` | `radio` service only | channel members | Yes |
| `ch/{channel_id}/radio/queue` | `radio` service only | channel members | Yes |
| `ch/{channel_id}/presence` | presence service | channel members | No |
| `ch/{channel_id}/listeners` | `radio` service (count + avatars, every 10 s) | channel members | Yes |
| `sys/{user_id}/kick` | `api` | that user's devices | No |

Clients never publish to any `ch/…/radio/*` topic. The broker ACL rejects it, so radio control goes only through the owner-checked REST endpoints.

## Non-functional requirements, testing and gate

Phase 7 is done when the targets below are met on the NAS itself, not just on a developer machine.

| Area | Target |
| --- | --- |
| Radio sync | Listeners within 1.5 s of each other, p95, over a 30-minute session |
| Radio control latency | Owner action to all listeners' players ≤ 1 s p95 |
| Track change | Next track starts ≤ 2 s after the previous one ends |
| Ask LLM | Preview list ≤ 10 s p95 |
| Post delivery | Post visible to online members ≤ 500 ms p95 |
| Channel open | Last 50 posts decrypted and rendered ≤ 1 s for a channel with 10,000 posts |
| Memory | `radio` ≤ 128 MB; whole `core` profile ≤ 1.4 GB with 20 listeners on air |
| Quota | YouTube Data API usage ≤ 50 % of daily quota under normal use (counter on `/metrics`) |
| Security | No endpoint or topic lets a non-member read channel data or a non-owner change radio state |
| Accessibility | WCAG 2.2 AA; radio controls fully keyboard-operable and labelled for screen readers |

**Tests**

- **Unit:** invite token lifecycle, permission matrix (one test per row of the roles table), queue reordering with versions, clock-offset maths, LLM JSON validation, markup parser and sanitiser.
- **Integration (testcontainers):** invite → OTP → account → MQTT connect; disabled user kicked; sender-key rotation on removal; radio state retained and replayed to late joiners; auto-advance with the owner offline.
- **End-to-end (Playwright, 3 browser contexts):** admin invites two users; user A creates a channel and invites B; both post text and a Python code block; A goes on air, B tunes in, positions stay within 1.5 s for 2 minutes; B's attempts to skip fail; A asks the LLM (mocked provider) and replaces the queue.
- **Contract:** `MusicSearch` and `LLMProvider` run against recorded fixtures in CI; a nightly job runs them live and opens an issue on failure.

**Gate to Phase 8**

- All acceptance checks in F7.1–F7.6 pass.
- A 7-day trial with at least 5 invited users, 3 channels and daily radio use shows no unauthorised access, no sync complaint over 2 s, and no YouTube embed errors other than genuinely unavailable videos.

## Open questions and Antigravity prompt

Five decisions are still open. The defaults in brackets are what this document specifies if nothing changes.

- [ ] Should members be able to **request** tracks (owner approves) or vote to skip? \[No: owner-only control\]
- [ ] Should channel owners be able to invite brand-new emails, or only admins? \[Admins only\]
- [ ] Is the visible-player, pause-when-hidden behaviour acceptable, or should Option B (own music files via Icecast) be planned for Phase 8? \[Option A now, decide after the 7-day trial\]
- [ ] Default for History handover on new channels: off or on? \[Off\]
- [ ] Should the Ask LLM button be available to members as "suggest only", with the owner approving the result? \[No\]

**Sample prompt for Antigravity (paste after adding this document to `docs/PHASE7.md`)**

```text
Read docs/BRIEF.md and docs/PHASE7.md. Phase 7 in PHASE7.md replaces the old
Phase 7 in the brief; rename the old one to Phase 8 in BRIEF.md.

Before coding, reply with:
1. The file tree changes for Phase 7 (new radio service, migrations, client features).
2. The Alembic migration plan, including moving account identity from phone to email.
3. Any requirement you think conflicts with the brief or with YouTube's API policies.
Wait for my "go".

After "go", build in this order, running tests after each step:
F7.1 invite-only access -> F7.2 dashboard -> F7.3 channels -> F7.4 posts ->
F7.5 radio (ytmusicapi search, IFrame player, server clock, MQTT retained state) ->
F7.6 Ask LLM (LiteLLM, LLM_PROVIDER=gemini default, mock provider in tests).

Rules: keep the core profile under 1.4 GB, add mem_limit 128m to the radio container,
never download or proxy YouTube audio, keep the YouTube player visible at >= 200x200,
pause on visibilitychange, and enforce owner-only radio control in both the REST layer
and the Mosquitto ACL. Finish with the Playwright 3-user test from PHASE7.md passing,
the list of new .env keys (ADMIN_EMAIL, SMTP_*, YOUTUBE_API_KEY, LLM_PROVIDER,
GEMINI_API_KEY) and deployment steps for the NAS.
```

## Sources

- [Complying with YouTube's Developer Policies](https://developers.google.com/youtube/terms/developer-policies-guide) — background play, audio separation, player modification
- [YouTube API Services — Required Minimum Functionality](https://developers.google.com/youtube/terms/required-minimum-functionality) — 200 × 200 px player, autoplay rules, Referer
- [YouTube Data API — Quota costs](https://developers.google.com/youtube/v3/determine_quota_cost) — 10,000 units a day, `search.list` limits
- [ytmusicapi on GitHub](https://github.com/sigma67/ytmusicapi) and [PyPI](https://pypi.org/project/ytmusicapi/) — unofficial YouTube Music client
- [Gemini API free tier limits](https://yingtu.ai/en/blog/google-gemini-api-free-tier-limits-2026) — free models, data-use note
- Build brief: `antigravity-chat-app-prompt.md` (Phases 1–7, now 1–8)
