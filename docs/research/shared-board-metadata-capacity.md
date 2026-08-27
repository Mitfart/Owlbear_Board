# Shared-board metadata capacity

**Decision:** Keep the small room/scene metadata records only as indexes or pointers. Do **not** try to split a room board across more room-metadata keys: the 16 KiB budget is for the complete room metadata object, shared by every extension. For durable, arbitrarily sized shared room boards, use an application backend; use Owlbear metadata as a versioned locator. If hosting a backend is out of scope, enforce a byte budget and reject saves before the platform rejects them.

## Decision constraints (2026-08-19)

**Conclusion: neither candidate is viable under the stated requirements.** The official SDK exposes Owlbear-hosted metadata, assets, scene items, and ephemeral broadcast, but no hosted general-purpose extension database, key-value store, or arbitrary-file persistence API ([SDK API surface](https://github.com/owlbear-rodeo/sdk/tree/main/src/api), [assets API](https://github.com/owlbear-rodeo/sdk/blob/main/src/api/AssetsApi.ts)). Thus there is no official Owlbear-hosted external board service that can be selected as both unkeyed and unlimited. Room, scene, and player metadata are Owlbear-hosted and need no application API key, but each complete metadata object is capped at **16 KiB** ([official metadata guide](https://docs.owlbear.rodeo/extensions/reference/metadata/)); they are not an unlimited alternative.

Scene-item shards also fail the no-size-limit requirement. An item is a real scene item with its own metadata ([item type](https://github.com/owlbear-rodeo/sdk/blob/main/src/types/items/Item.ts)); creating a shard therefore creates a real scene object through the scene-items API ([create/update API](https://github.com/owlbear-rodeo/sdk/blob/main/src/api/scene/SceneItemsApi.ts)). It may be configured not to render where the item type permits, but it remains a scene object: it participates in scene lifecycle, permissions, deletion, and item-change traffic. The official metadata guide documents the 16 KiB room/scene/player limits, but does **not** publish a per-item-metadata quota or a maximum item count. That absence is not unlimited capacity and provides no safe shard count; item records, scene performance, and platform-enforced limits are practical bounds. Do not adopt shards as an unlimited persistence tier without a published limit and an explicit product limit.

For required freshness, use the official subscriptions rather than assuming persistence implies live updates: [`OBR.room.onMetadataChange`](https://github.com/owlbear-rodeo/sdk/blob/main/src/api/RoomApi.ts) for room metadata, [`OBR.scene.onMetadataChange`](https://github.com/owlbear-rodeo/sdk/blob/main/src/api/scene/SceneApi.ts) for scene metadata, [`OBR.scene.onSceneChange`](https://github.com/owlbear-rodeo/sdk/blob/main/src/api/scene/SceneApi.ts) for scene switches, and the scene-items change subscription in [`SceneItemsApi`](https://github.com/owlbear-rodeo/sdk/blob/main/src/api/scene/SceneItemsApi.ts) for shard creation, updates, and deletion. Reload the authoritative record on each applicable event; broadcast is only an ephemeral hint ([broadcast API](https://github.com/owlbear-rodeo/sdk/blob/main/src/api/BroadcastApi.ts)).

All storage has practical limits: documented byte quotas for metadata, unpublished but finite platform/resource limits for scene items, and service-side quotas, payload, retention, and operational limits for any external service. If the requirements relax, an application-operated service with a metadata locator is the scalable option; otherwise retain bounded metadata and reject oversized saves.

## Verified platform facts

| Store / API | Scope and limit | Consequence |
| --- | --- | --- |
| `OBR.room` metadata | One room-wide metadata object, shared by extensions; **16 KiB total**. It persists with the room. [Metadata guide](https://docs.owlbear.rodeo/extensions/reference/metadata/) | The current shared-room state competes with `ROOM_OWNER_KEY`, GM-shared state, and every other extension. Extra keys do not add capacity. |
| `OBR.scene` metadata | One metadata object for each scene; **16 KiB total** and shared by extensions. It persists with that scene, not across scene changes. [Metadata guide](https://docs.owlbear.rodeo/extensions/reference/metadata/) | This is correctly scoped for the shared scene board (ADR 0001), but is not capacity escape hatch and cannot implement a room board. |
| `OBR.player` metadata | Per-player metadata, **16 KiB total**. [Metadata guide](https://docs.owlbear.rodeo/extensions/reference/metadata/) | Suitable only for private state/preferences; duplicating the shared board here neither shares nor reliably persists a canonical board. |
| Scene-item metadata | Metadata can be attached to a scene item, rather than the scene metadata object. The item API creates/updates the full item metadata. [Scene item SDK source](https://github.com/owlbear-rodeo/sdk/blob/main/src/api/scene/SceneItemsApi.ts), [item type](https://github.com/owlbear-rodeo/sdk/blob/main/src/types/items/Item.ts) | A possible sharding substrate, but it creates real scene objects and ties room-board data to a scene. Confirm the current per-item metadata limit with Owlbear before selecting it; the metadata guide does not make it a documented general-purpose database. |
| First-party storage/files | SDK API surface exposes room, scene, player metadata, assets, scene items and broadcast; it has no generic extension key-value store, database, or arbitrary-file upload/download API. [SDK source tree](https://github.com/owlbear-rodeo/sdk/tree/main/src/api), [Assets API source](https://github.com/owlbear-rodeo/sdk/blob/main/src/api/AssetsApi.ts) | Asset/image APIs are not a board-state store. There is no official Owlbear backend to move this payload into. |
| Metadata change events | `OBR.room.onMetadataChange` subscribes to changes; `setMetadata` is an async partial update. [Room API source](https://github.com/owlbear-rodeo/sdk/blob/main/src/api/RoomApi.ts) Scene has the analogous API. | Polling in ADR 0003 is a product choice, not an SDK requirement. It remains last-write-wins unless the application adds revision/conflict handling. |
| Broadcast | `OBR.broadcast.sendMessage` and `onMessage` deliver messages to `REMOTE`, `LOCAL`, or `ALL`; the API provides no persistence or replay. [Broadcast API source](https://github.com/owlbear-rodeo/sdk/blob/main/src/api/BroadcastApi.ts) | Useful as a best-effort “state changed” hint, never as the canonical board or as a recovery mechanism. |

The SDK's metadata type is deliberately an untyped key/value record, so it does not provide schema validation, compare-and-swap, transactions, quotas, or merge semantics. [Metadata type](https://github.com/owlbear-rodeo/sdk/blob/main/src/types/Metadata.ts) This matches ADR 0002's current last-write-wins model.

## Repository assessment and size estimate

`src/storage.ts` writes the entire `PersistedBoardState` to one of `SHARED_ROOM_STATE_KEY` or `SHARED_SCENE_STATE_KEY`; room storage also holds `GM_SHARED_BOARD_STATE_KEY`. It reads the complete metadata object and writes `{ ...metadata, key: state }`. `src/types.ts` keeps verbose property names, UUID-like IDs, two ISO timestamps per item, and unbounded Markdown/image URLs. Therefore there is no fixed item count or safe maximum.

No representative persisted room state is checked into this repository, so an actual current payload cannot be measured. A compact `JSON.stringify` estimate using the fields emitted by `App.tsx`, a UUID-style board/item id, ISO timestamps, and one shared room board is:

| One item form | State size with one item | Approximate items in 16,384 bytes* |
| --- | ---: | ---: |
| Text: `"Saved text"` | 582 B | 52 |
| Counter: default fields | 630 B | 45 |
| Image: 100-character URL | 627 B | 45 |

\*Before the metadata-key overhead, `GM_SHARED_BOARD_STATE_KEY`, owner data, and other extensions. Markdown and image URLs increase byte-for-byte (UTF-8), so long notes can exhaust the budget with far fewer items. Measure `new TextEncoder().encode(JSON.stringify(state)).byteLength` against the **whole metadata object**, with headroom, not just this extension key.

## Viable variants

| Variant | Fit / migration | Benefits | Costs and constraints |
| --- | --- | --- | --- |
| 1. Budgeted metadata (short-term) | Keep v1 records. On load accept current data; on save measure the complete metadata object and show a non-destructive “too large” error. Reserve headroom for other extensions. | Smallest change; preserves all existing boards and ADR 0001 scopes. | Hard ceiling remains; no reliable way to reserve capacity from other extensions; still last-write-wins. Do not use compression as the primary fix: it cannot guarantee capacity and makes interoperability/debugging worse. |
| 2. External board service + metadata locator (**recommended**) | Add a v2 metadata record such as `{version:2, boardId, revision}`. On first v2-capable write, copy v1 state to the service, verify it, then replace the metadata payload with the locator. Old clients must be prevented from overwriting v2, or retain v1 read-only during a staged release. | Durable size controlled by the application; server can provide revisions, item-level updates, auth, backups, and WebSocket/SSE real-time sync. A locator is safely below 16 KiB. | Owlbear provides no hosted backend: operate one and define retention/export/deletion. Do not treat room/player IDs supplied by the client as authentication; authenticate/authorize the service and make room membership/access policy explicit. Network failure/offline behavior and migration rollback must be designed. |
| 3. Scene-item shards | Store a versioned board manifest plus chunks/items as extension-owned hidden scene items. Migrate by writing shards, reading/validating them, then writing the manifest; retain v1 until verification. | Uses Owlbear persistence and may distribute data across item records; scene item change APIs can give live updates. | Poor fit for a room board: data follows a scene. It pollutes scene/history/object counts, has permissions/visibility and deletion risks, and is not an officially documented database. Confirm item metadata quota and practical item-count limits with Owlbear first. |
| 4. Native scene metadata for scene boards only | Leave existing shared-scene storage as-is; optionally enforce the same byte guard. No room-board migration. | Correct lifecycle, already selected by ADR 0001, and no new infrastructure. | Same 16 KiB ceiling; it does not address the reported shared-room capacity issue. |
| 5. Broadcast-assisted refresh (adjunct only) | After any persisted write, broadcast `{boardId, revision}`; receivers reload authoritative metadata/service state. Existing clients can ignore it. | Reduces polling latency and does not change persistence format. | Broadcast is ephemeral and cannot fix quota, persistence, concurrent writes, or reconnect recovery. Use only with variants 1–4. |

## Recommendation and compatibility plan

Choose variant 2 if boards are expected to exceed the quota. Keep metadata as the source of *location and current revision*, not board contents. On startup: (1) read v2 locator if present; (2) otherwise read the existing v1 `PersistedBoardState`; (3) only migrate after the service copy is readable and checksum/revision-verified. Preserve the v1 data until all supported extension versions understand v2, then remove it in a separate, recoverable cleanup. A v1 client must detect v2 rather than treating it as an empty board and overwriting it.

For immediate protection, implement variant 1 first and use the SDK metadata-change subscription (or broadcast hint) to trigger reloads. Neither changes the documented last-write-wins behavior; add server-side conditional revision writes if simultaneous edit loss is unacceptable.

## Scene transition and assets feasibility

**Scope:** Owlbear Board is locked to SDK **3.1.0**. The findings below use that version's public, official SDK source; the source does not document any additional host-side ordering guarantees.

### Scene transition

**No.** The SDK has no scene-switch/preflight event, no scene-list/current-scene ID API, and no callback carrying `{ oldScene, newScene }`. `OBR.scene.onReadyChange` is the closest signal: it subscribes to the host's scene-readiness event and invokes `callback(data.ready)`. A `false` can indicate that the active scene is unavailable during a transition and `true` that a scene is usable again, but it is **not** a “will switch” notification, carries no scene data, and the API does not guarantee its ordering relative to the switch. At `true`, read only the then-active scene through `OBR.scene`; preserve any old-scene data before readiness is lost. [Scene API source](https://github.com/owlbear-rodeo/sdk/blob/v3.1.0/src/api/scene/SceneApi.ts)

The complete relevant subscription surface is:

| Subscription | Callback payload | Public timing/meaning | Transition usefulness |
| --- | --- | --- | --- |
| `OBR.scene.onReadyChange` | `boolean` (`data.ready`) | Delivered when the host emits a scene-ready change; no pre/post-switch or ordering contract. | Availability boundary only; no old/new scene. |
| `OBR.scene.onMetadataChange` | complete `Metadata` (`data.metadata`) | Delivered when the host emits metadata change for the active scene. | Does not identify a transition or either scene. |
| `OBR.scene.items.onChange` | `Item[]` (`data.items`) | Delivered when the host emits a persistent-item change for the active scene. | No scene ID or old/new item diff. |
| `OBR.scene.local.onChange` | `Item[]` (`data.items`) | Delivered for local (non-persistent) items in the active scene. | Same limitation; not a store. |
| `OBR.scene.grid.onChange` | `Grid` (`data.grid`) | Delivered when the active scene's grid changes. | Not a transition signal. |
| `OBR.scene.fog.onChange` | `Fog` (`data.fog`) | Delivered when the active scene's fog changes. | Not a transition signal. |
| `OBR.room.onMetadataChange` | complete `Metadata` (`data.metadata`) | Delivered when room metadata changes. | Room state survives a scene switch, but the event contains no scene data. |
| `OBR.room.onPermissionsChange` | `Permission[]` (`data.permissions`) | Delivered when room permissions change. | Not a transition signal. |

Sources: [scene API](https://github.com/owlbear-rodeo/sdk/blob/v3.1.0/src/api/scene/SceneApi.ts), [persistent scene items](https://github.com/owlbear-rodeo/sdk/blob/v3.1.0/src/api/scene/SceneItemsApi.ts), [local scene items](https://github.com/owlbear-rodeo/sdk/blob/v3.1.0/src/api/scene/SceneLocalApi.ts), [grid](https://github.com/owlbear-rodeo/sdk/blob/v3.1.0/src/api/scene/SceneGridApi.ts), [fog](https://github.com/owlbear-rodeo/sdk/blob/v3.1.0/src/api/scene/SceneFogApi.ts), and [room API](https://github.com/owlbear-rodeo/sdk/blob/v3.1.0/src/api/RoomApi.ts).

`OBR.scene.items.getItems`, `updateItems`, and `deleteItems` accept only an item filter/items or item IDs—never a scene ID—so they operate on the active scene only. `OBR.assets.downloadScenes` can return a **user-selected** `SceneDownload` containing `items`, but it has no scene ID and no mutation/delete operation; it is an asset chooser/import path, not non-active-scene administration. Thus an extension cannot directly read, update, or delete items in a non-active scene. [Scene items API](https://github.com/owlbear-rodeo/sdk/blob/v3.1.0/src/api/scene/SceneItemsApi.ts), [assets API](https://github.com/owlbear-rodeo/sdk/blob/v3.1.0/src/api/AssetsApi.ts), [asset types](https://github.com/owlbear-rodeo/sdk/blob/v3.1.0/src/types/Assets.ts).

### Assets

**No supported JSON store.** `OBR.assets` only exposes `uploadImages(ImageUpload[])`, `uploadScenes(SceneUpload[])`, and user-selection `downloadImages`/`downloadScenes`; it has no arbitrary-blob/key API, asset enumeration, lookup by ID, update, delete, or room association. An image upload does take a `File | Blob`, but the supported contract is an `ImageUpload` with image content and rendering fields—not arbitrary JSON. Supplying a JSON Blob would be unsupported, and there is no programmatic way to retrieve it later without the user selecting it through the download flow. [Assets API](https://github.com/owlbear-rodeo/sdk/blob/v3.1.0/src/api/AssetsApi.ts), [asset types](https://github.com/owlbear-rodeo/sdk/blob/v3.1.0/src/types/Assets.ts), [image content](https://github.com/owlbear-rodeo/sdk/blob/v3.1.0/src/types/items/ImageContent.ts).

Therefore assets cannot provide a persistent shared room-board store: they lack room scoping, an addressable canonical record, automatic reads/live-change events, and supported arbitrary-JSON persistence. Continue to use bounded room metadata for a small room board or an application backend plus a room-metadata locator for larger durable data.

## Sources

- [Owlbear Rodeo Extension Metadata guide](https://docs.owlbear.rodeo/extensions/reference/metadata/)
- [Official Owlbear Rodeo SDK repository](https://github.com/owlbear-rodeo/sdk)
- [Room API source](https://github.com/owlbear-rodeo/sdk/blob/main/src/api/RoomApi.ts)
- [Broadcast API source](https://github.com/owlbear-rodeo/sdk/blob/main/src/api/BroadcastApi.ts)
- [Scene API source](https://github.com/owlbear-rodeo/sdk/blob/main/src/api/scene/SceneApi.ts)
- [Scene items API source](https://github.com/owlbear-rodeo/sdk/blob/main/src/api/scene/SceneItemsApi.ts)
- [Metadata type source](https://github.com/owlbear-rodeo/sdk/blob/main/src/types/Metadata.ts)
