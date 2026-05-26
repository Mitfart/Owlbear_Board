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
A text or image element placed on a board at a grid position. A board item occupies one or more grid cells and is independent from Owlbear scene objects.
_Avoid_: Kanban item, card, token, note

**Text Board Item**:
A board item whose content is Markdown text rendered for display.
_Avoid_: Card, note, rich text item

**Image Board Item**:
A board item whose content is an image.
_Avoid_: Token, scene object

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
A board visible and editable by all users in the Owlbear room, including the GM and players. There is at most one shared scene board per scene and one shared room board per room. Any user may create a shared board when it does not already exist, and any user may add, change, move, resize, or delete content on it.
_Avoid_: Public board, global board

**Board Owner**:
The user associated with board ownership. Private boards are owned by their creator, while shared boards are owned by the Owlbear room owner when known; ownership is informational and does not limit who can edit shared boards.
_Avoid_: Admin, moderator

## Example dialogue

**GM**: I want a board for tonight's dungeon notes.

**Developer**: Should that be a private scene board, shared scene board, private room board, or shared room board?

**GM**: A shared room board, so everyone can edit it while I change scenes.
