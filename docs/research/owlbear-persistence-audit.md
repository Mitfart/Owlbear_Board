# Owlbear persistence audit

Reviewed 2026-08-29 against the official Owlbear Rodeo SDK documentation.

## Findings

- Scene and room `setMetadata` accept partial updates and merge the supplied keys with existing metadata. This is the supported shared extension-data API.
- Player `setMetadata` has the same partial-update behavior and is appropriate for private board state.
- Scene items are real typed scene objects. The application previously attempted unsupported `DATA` then fragile hidden `LABEL` items; this produced the reported validation failures and item-change refresh races.
- Room metadata is intended for small extension data and is capped at 16 KiB. Boards must remain within that platform limit; the app now relies on Owlbear's documented error if a board exceeds it.

## Result

Shared scene boards now use `com.owlbear-board.grid/shared-scene-state` scene metadata; shared room boards use `com.owlbear-board.grid/shared-room-state` room metadata. This also preserves the legacy metadata records visible in the supplied diagnostics.

## Sources

- https://docs.owlbear.rodeo/extensions/apis/scene/
- https://docs.owlbear.rodeo/extensions/apis/room/
- https://docs.owlbear.rodeo/extensions/apis/player/
- https://docs.owlbear.rodeo/extensions/reference/metadata/
- https://docs.owlbear.rodeo/extensions/reference/items/item/
