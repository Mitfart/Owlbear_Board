# Owlbear Board

Owlbear Board defines grid-based workspaces used inside Owlbear Rodeo for tabletop play preparation and session support.

## Language

**Board**:
A grid-based workspace inside Owlbear Rodeo where users arrange text and image items for tabletop play. Private board names are unique within the same scope.
_Avoid_: Kanban, project

**Infinite Board**:
A board with no fixed edges where board items may be placed at positive or negative grid coordinates.
_Avoid_: Canvas, finite grid

**Scene Board**:
A board tied to a single Owlbear scene. It is relevant only while that scene is active.
_Avoid_: Sceen board, project board

**Board Item**:
An element placed on a board at a grid position. A board item occupies one or more grid cells and is independent from Owlbear scene objects.
_Avoid_: Kanban item, card, token, note

**Counter Board Item**:
A Board Item that displays and changes a numeric value.
_Avoid_: Token counter, tracker

**Counter Value**:
The non-negative whole number displayed by a Counter Board Item.
_Avoid_: Count, actual number

**Counter Maximum**:
The optional upper bound on a Counter Value.
_Avoid_: Max value, limit

**Text Board Item**:
A board item whose content is Markdown text rendered for display.
_Avoid_: Card, note, rich text item, node

**Text Formatting**:
Markdown-compatible emphasis choices that control the presentation of selected text in a Text Board Item.
_Avoid_: Rich text, node style

**Text Block**:
A rendered Markdown unit within a Text Board Item, such as a heading, paragraph, list item, quote, or code block. A Text Block has its own horizontal alignment.
_Avoid_: Row, node, line

**Text Board Item Vertical Alignment**:
The vertical placement of all Markdown content within a Text Board Item: top, center, or bottom.
_Avoid_: Text block alignment, vertical text alignment

**Text Board Item Baseline Size**:
The natural grid dimensions calculated from a Text Board Item’s current Markdown whenever its text is saved. It determines the unscaled Markdown size within the item, not the item bounds.
_Avoid_: Default size, original size

**Fill Block**:
The default Text Board Item presentation where Markdown scales with the item width relative to its Text Board Item Baseline Size while overflow remains scrollable. Item bounds change only when the user resizes them. When disabled, the item keeps the existing presentation.
_Avoid_: Auto-size, stretch

**Image Board Item**:
A board item whose content is an image.
_Avoid_: Token, scene object

**Image Fit**:
The presentation choice that either crops an Image Board Item to fill its bounds or contains it entirely within them.
_Avoid_: Resize mode, stretch

**Selected Board Item**:
The board item currently targeted for movement, resizing, or item actions.
_Avoid_: Focused item

**Focused Board Item**:
The board item currently targeted for editing its content.
_Avoid_: Selected item

**Active Board**:
The single board currently displayed and editable in the board surface.
_Avoid_: Visible board, current project

**Board Session**:
The per-user working state used to render the extension for the current Owlbear room and active scene. It includes the board picker rows, the active board when one is available, and whether the preview board should be shown.
_Avoid_: App state, storage state

**Board Open Order**:
A per-user ordering of boards by most recent activation. The first available board in the order becomes active automatically, and preview boards are never included.
_Avoid_: Last active scene, global recent board

**Room Board**:
A board tied to the Owlbear room. It remains relevant across scene changes in that room.
_Avoid_: Global board, project board

**Private Board**:
A board visible and editable only by the user who created it.
_Avoid_: Own board, personal project

**Shared Board**:
A board visible and editable by all users in the Owlbear room, including GMs and players. There is at most one shared scene board per scene and one shared room board per room. Any user may create one and edit its content; only GMs may rename it.
_Avoid_: Public board, global board

**GM-shared Board**:
A board visible to its player owner and every GM in the Owlbear room. The player may change it while GMs may view it.
_Avoid_: Private shared board, player-GM board

**Board Owner**:
The user associated with board ownership. Private and GM-shared boards are owned by their creator, while shared boards are owned by the Owlbear room owner when known; ownership is informational and does not limit content editing where that is allowed.
_Avoid_: Admin, moderator

## Example dialogue

**GM**: I want a board for tonight's dungeon notes.

**Developer**: Should that be a private scene board, shared scene board, private room board, or shared room board?

**GM**: A shared room board, so everyone can edit it while I change scenes.
