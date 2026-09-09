# Owlbear palette persistence investigation

Date: 2026-09-09

## Evidence from the reported diagnostics

Immediately after saving, `OBR.player.getMetadata()` returned the extension's
`com.owlbear-board.grid/preferences` value, including
`colorPaletteFormat: 2` and `colorPalette`.  After reloading the same room with
the same player ID, it returned `{}`.  The palette is therefore written by the
current code, but the storage scope does not survive the reload.

## Owlbear storage semantics

- [Player API](https://docs.owlbear.rodeo/extensions/apis/player/) documents
  `OBR.player.setMetadata()` as a partial update of the *current player's*
  metadata.  The [Player reference](https://docs.owlbear.rodeo/extensions/reference/player/)
  defines a player as connected to a room.  Neither page guarantees local or
  reload persistence.
- The [Metadata reference](https://docs.owlbear.rodeo/extensions/reference/metadata/)
  says player metadata shares custom data associated with the player.  It also
  distinguishes item metadata, which is stored on scene items.
- Owlbear explicitly documents that [each custom tool's metadata is persisted
  in local storage](https://docs.owlbear.rodeo/extensions/tutorial-custom-tool/create-a-tool/).
  Its [colour-picker tutorial](https://docs.owlbear.rodeo/extensions/tutorial-custom-tool/implement-the-color-picker/)
  uses `OBR.tool.setMetadata()` for a user-selected colour.  The
  [Tool API](https://docs.owlbear.rodeo/extensions/apis/tool/) documents the
  corresponding read/update methods.
- Item metadata is saved with the scene and synced to everyone in the room,
  according to the [official initiative-tracker tutorial](https://docs.owlbear.rodeo/extensions/tutorial-initiative-tracker/implement-the-context-menu-item/).
  It is not an appropriate scope for a personal palette.
- [Room metadata](https://docs.owlbear.rodeo/extensions/apis/room/) is
  room-shared extension storage, limited to 16 KB, so it is likewise unsuitable
  for a personal palette.

## Initial code finding

The initial implementation stored preferences through
`OBR.player.setMetadata({ "com.owlbear-board.grid/preferences": value })`.
That matches the diagnostic result: the palette was saved in a current-player
record, which disappeared on reload.

## Current decision

The palette is stored in a dedicated hidden Scene Data Item, rather than player
or tool metadata. It survives reloads but is shared within, and scoped to, the
active scene. The Debug view reports its byte usage against the 1 MB Scene Data
Item limit; a GM can clear this palette data without clearing Board records.
