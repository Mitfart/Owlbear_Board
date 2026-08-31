export const EXTENSION_ID = "com.owlbear-board.grid";
export const PLAYER_PREFERENCES_KEY = `${EXTENSION_ID}/preferences`;
export const ROOM_BOARD_IDS_KEY = `${EXTENSION_ID}/room-board-ids`;
export const BOARD_STATE_KEY = `${EXTENSION_ID}/board-state`;
// Read only for one-release migration from the previous storage layout.
export const PRIVATE_SCENE_STATES_KEY = `${EXTENSION_ID}/private-scene-states`;
export const PRIVATE_ROOM_STATE_KEY = `${EXTENSION_ID}/private-room-state`;
export const SHARED_SCENE_STATE_KEY = `${EXTENSION_ID}/shared-scene-state`;
export const SHARED_ROOM_STATE_KEY = `${EXTENSION_ID}/shared-room-state`;
export const ROOM_OWNER_KEY = `${EXTENSION_ID}/room-owner`;
export const SCENE_KEY_METADATA = `${EXTENSION_ID}/scene-key`;
export const BOARD_EVENT_CHANNEL = `${EXTENSION_ID}/board-change`;

export const DEFAULT_CELL_SIZE = 72;
export const MIN_CELL_SIZE = 32;
export const MAX_CELL_SIZE = 160;
export const DEFAULT_CELL_GAP = 2;
export const DEFAULT_ITEM_BORDER_COLOR = "#bb99ff";
export const DEFAULT_COUNTER_ZERO_COLOR = "#ff6b8a";
export const DEFAULT_COUNTER_MAX_COLOR = "#ffd166";
export const MIN_CELL_GAP = 0;
export const MAX_CELL_GAP = 32;
export const DEFAULT_WINDOW = { width: 960, height: 720 };
