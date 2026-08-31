import OBR from "@owlbear-rodeo/sdk";
import {
  BOARD_EVENT_CHANNEL, BOARD_STATE_KEY, DEFAULT_CELL_GAP, DEFAULT_CELL_SIZE,
  DEFAULT_COUNTER_MAX_COLOR, DEFAULT_COUNTER_ZERO_COLOR, DEFAULT_ITEM_BORDER_COLOR,
  DEFAULT_WINDOW, EXTENSION_ID, PLAYER_PREFERENCES_KEY, PRIVATE_ROOM_STATE_KEY,
  PRIVATE_SCENE_STATES_KEY, ROOM_BOARD_IDS_KEY, ROOM_OWNER_KEY, SCENE_KEY_METADATA,
  SHARED_SCENE_STATE_KEY,
} from "./constants";
import { canViewBoard, type PlayerRole } from "./boardPermissions";
import { createId } from "./ids";
import type { Board, BoardItem, BoardScope, PersistedBoardState, PlayerPreferences, ViewportPreference, WindowPreferences } from "./types";
export { orderPrivateBoards } from "./boardSession";

const emptyState = (): PersistedBoardState => ({ version: 1, boards: [] });
let roomBoardCache: Board[] = [];

function normalizedGridValue(value: unknown, fallback: number, minimum?: number) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(minimum ?? -Infinity, Math.trunc(number)) : fallback;
}

export function normalizeBoardState(state: PersistedBoardState): PersistedBoardState {
  return {
    ...state,
    boards: state.boards.map((board) => {
      const { createdAt: _createdAt, ...normalizedBoard } = board as Board & { createdAt?: unknown };
      return {
        ...normalizedBoard,
        allowedUserIds: normalizedBoard.visibility === "private" ? normalizedBoard.allowedUserIds ?? (normalizedBoard.ownerId ? [normalizedBoard.ownerId] : []) : undefined,
        cellSizePx: normalizedBoard.cellSizePx ?? DEFAULT_CELL_SIZE,
        cellGapPx: normalizedBoard.cellGapPx ?? DEFAULT_CELL_GAP,
        items: board.items.map((item) => {
          const { occupiedCells: _occupiedCells, createdAt: _itemCreatedAt, ...clean } = item as BoardItem & { occupiedCells?: unknown; createdAt?: unknown };
          const grid = { ...clean, gridX: normalizedGridValue(clean.gridX, 0), gridY: normalizedGridValue(clean.gridY, 0), gridWidth: normalizedGridValue(clean.gridWidth, 1, 1), gridHeight: normalizedGridValue(clean.gridHeight, 1, 1) };
          if (grid.type === "text") return { ...grid, text: grid.text ?? "", fillBlock: grid.fillBlock !== false, textVerticalAlignment: grid.textVerticalAlignment ?? "top", borderColor: grid.borderColor ?? DEFAULT_ITEM_BORDER_COLOR };
          if (grid.type === "image") return { ...grid, imageFit: grid.imageFit ?? "cover", borderColor: grid.borderColor ?? DEFAULT_ITEM_BORDER_COLOR };
          if (grid.type === "counter") return { ...grid, counterValue: grid.counterValue ?? 0, counterLabel: grid.counterLabel ?? "", counterLabelPosition: grid.counterLabelPosition ?? "top-center", counterDimAtZero: grid.counterDimAtZero !== false, counterZeroColor: grid.counterZeroColor ?? DEFAULT_COUNTER_ZERO_COLOR, counterMaxColor: grid.counterMaxColor ?? DEFAULT_COUNTER_MAX_COLOR, borderColor: grid.borderColor ?? DEFAULT_ITEM_BORDER_COLOR };
          return grid;
        }),
      };
    }),
  };
}

function isState(value: unknown): value is PersistedBoardState {
  return !!value && typeof value === "object" && (value as PersistedBoardState).version === 1 && Array.isArray((value as PersistedBoardState).boards);
}

async function playerMetadata<T>(key: string, fallback: T): Promise<T> {
  if (!OBR.isAvailable) return fallback;
  const value = (await OBR.player.getMetadata())[key];
  return value && typeof value === "object" ? value as T : fallback;
}

async function setPlayerMetadata(key: string, value: unknown) {
  if (OBR.isAvailable) await OBR.player.setMetadata({ [key]: value });
}

const emptyPreferences = (): PlayerPreferences => ({ version: 1, privateSceneOpenOrder: {}, privateRoomOpenOrder: {}, viewportByBoardId: {} });

export async function getSceneKey() {
  if (!OBR.isAvailable) return "demo";
  if (!await OBR.scene.isReady()) return "no-scene";
  const metadata = await OBR.scene.getMetadata();
  const existing = metadata[SCENE_KEY_METADATA];
  if (typeof existing === "string") return existing;
  const sceneKey = createId("scene");
  await OBR.scene.setMetadata({ [SCENE_KEY_METADATA]: sceneKey });
  return sceneKey;
}

async function loadSceneBoardState(): Promise<PersistedBoardState> {
  if (!OBR.isAvailable || !await OBR.scene.isReady()) return emptyState();
  const metadata = await OBR.scene.getMetadata();
  const current = metadata[BOARD_STATE_KEY];
  // Keep existing shared scene boards when upgrading from the prior layout.
  const legacy = metadata[SHARED_SCENE_STATE_KEY];
  const state = isState(current) ? current : isState(legacy) ? legacy : emptyState();
  const normalized = normalizeBoardState(state);
  roomBoardCache = mergeNewest(roomBoardCache, normalized.boards.filter((board) => board.scope === "room"));
  return normalized;
}

async function saveSceneBoardState(state: PersistedBoardState) {
  if (!OBR.isAvailable) return;
  const normalized = normalizeBoardState(state);
  roomBoardCache = normalized.boards.filter((board) => board.scope === "room");
  await OBR.scene.setMetadata({ [BOARD_STATE_KEY]: normalized });
}

function mergeNewest(first: Board[], second: Board[]) {
  const merged = new Map(first.map((board) => [board.id, board]));
  for (const board of second) {
    const current = merged.get(board.id);
    if (!current || current.updatedAt < board.updatedAt) merged.set(board.id, board);
  }
  return [...merged.values()];
}

async function setRoomBoardActive(boardId: string, active: boolean) {
  const current = await playerMetadata<string[]>(ROOM_BOARD_IDS_KEY, []);
  await setPlayerMetadata(ROOM_BOARD_IDS_KEY, active ? [...new Set([...current, boardId])] : current.filter((id) => id !== boardId));
}

export async function carryRoomBoardsToCurrentScene() {
  if (!roomBoardCache.length || !OBR.isAvailable || !await OBR.scene.isReady()) return;
  const current = await loadSceneBoardState();
  const nonRoom = current.boards.filter((board) => board.scope !== "room");
  const rooms = mergeNewest(current.boards.filter((board) => board.scope === "room"), roomBoardCache);
  roomBoardCache = rooms;
  await saveSceneBoardState({ version: 1, boards: [...nonRoom, ...rooms] });
}

export async function loadPrivateBoardState(scope: BoardScope) {
  const state = await loadSceneBoardState();
  return { version: 1 as const, boards: state.boards.filter((board) => board.scope === scope && board.visibility === "private") };
}

export async function savePrivateBoardState(scope: BoardScope, state: PersistedBoardState) {
  const current = await loadSceneBoardState();
  const retained = current.boards.filter((board) => !(board.scope === scope && board.visibility === "private"));
  await saveSceneBoardState({ version: 1, boards: [...retained, ...state.boards.filter((board) => board.scope === scope && board.visibility === "private")] });
}

export async function loadSharedBoardState(scope: BoardScope) {
  const state = await loadSceneBoardState();
  return { version: 1 as const, boards: state.boards.filter((board) => board.scope === scope && board.visibility === "shared") };
}

export async function saveSharedBoardState(scope: BoardScope, state: PersistedBoardState) {
  const current = await loadSceneBoardState();
  const retained = current.boards.filter((board) => !(board.scope === scope && board.visibility === "shared"));
  await saveSceneBoardState({ version: 1, boards: [...retained, ...state.boards.filter((board) => board.scope === scope && board.visibility === "shared")] });
}

export async function loadAllVisibleBoards(role: PlayerRole = "GM", playerId?: string) {
  const state = await loadSceneBoardState();
  const boards = state.boards.filter((board) => canViewBoard(board, role, playerId));
  const by = (scope: BoardScope, visibility: Board["visibility"]) => ({ version: 1 as const, boards: boards.filter((board) => board.scope === scope && board.visibility === visibility) });
  const privateScene = by("scene", "private");
  const privateRoom = by("room", "private");
  const sharedScene = by("scene", "shared");
  const sharedRoom = by("room", "shared");
  return { privateScene, privateRoom, sharedScene, sharedRoom, boards };
}

async function saveBoardToScene(board: Board) {
  const state = await loadSceneBoardState();
  const saved = { ...board, revision: board.revision + 1 };
  await saveSceneBoardState({ version: 1, boards: [...state.boards.filter((candidate) => candidate.id !== board.id), saved] });
  if (saved.scope === "room") await setRoomBoardActive(saved.id, true);
  return saved;
}

async function deleteBoardFromScene(board: Board) {
  const state = await loadSceneBoardState();
  await saveSceneBoardState({ version: 1, boards: state.boards.filter((candidate) => candidate.id !== board.id) });
  if (board.scope === "room") await setRoomBoardActive(board.id, false);
}

async function relocateBoardInScene(board: Board) {
  if (board.visibility !== "private" || board.scope !== "room") return board;
  await deleteBoardFromScene(board);
  return saveBoardToScene({ ...board, scope: "scene", revision: board.revision, updatedAt: new Date().toISOString() });
}

export type BoardSavingBehavior = {
  save(board: Board): Promise<Board>;
  delete(board: Board): Promise<void>;
  relocate(board: Board): Promise<Board>;
};

export let boardSaving: BoardSavingBehavior = { save: saveBoardToScene, delete: deleteBoardFromScene, relocate: relocateBoardInScene };
export function setBoardSavingBehavior(behavior: BoardSavingBehavior) { boardSaving = behavior; }

async function broadcastBoardChange(action: "save" | "delete", boardId: string) {
  if (OBR.isAvailable) await OBR.broadcast.sendMessage(BOARD_EVENT_CHANNEL, { action, boardId }, { destination: "REMOTE" });
}

export async function saveBoard(board: Board) {
  const saved = await boardSaving.save(board);
  await broadcastBoardChange("save", saved.id);
  return saved;
}
export async function deleteBoard(board: Board) {
  await boardSaving.delete(board);
  await broadcastBoardChange("delete", board.id);
}
export async function movePrivateRoomBoardToScene(board: Board) {
  const moved = await boardSaving.relocate(board);
  await broadcastBoardChange("save", moved.id);
  return moved;
}

export async function clearSceneBoardData() {
  const state = await loadSceneBoardState();
  await saveSceneBoardState({ version: 1, boards: state.boards.filter((board) => board.scope === "room") });
}
export async function clearRoomBoardData() {
  const state = await loadSceneBoardState();
  await saveSceneBoardState({ version: 1, boards: state.boards.filter((board) => board.scope !== "room") });
  await setPlayerMetadata(ROOM_BOARD_IDS_KEY, []);
}
export async function clearAllBoardData() {
  roomBoardCache = [];
  if (!OBR.isAvailable) return;
  await OBR.scene.setMetadata({ [BOARD_STATE_KEY]: emptyState(), [SHARED_SCENE_STATE_KEY]: emptyState() });
  await setPlayerMetadata(PRIVATE_SCENE_STATES_KEY, {});
  await setPlayerMetadata(PRIVATE_ROOM_STATE_KEY, emptyState());
  await setPlayerMetadata(ROOM_BOARD_IDS_KEY, []);
  await savePreferences(emptyPreferences());
  await saveWindowPreferences(DEFAULT_WINDOW);
}

export async function loadPreferences() { return playerMetadata<PlayerPreferences>(PLAYER_PREFERENCES_KEY, emptyPreferences()); }
export async function savePreferences(preferences: PlayerPreferences) { await setPlayerMetadata(PLAYER_PREFERENCES_KEY, preferences); }
export async function saveViewport(boardId: string, viewport: ViewportPreference) {
  const preferences = await loadPreferences();
  await savePreferences({ ...preferences, viewportByBoardId: { ...preferences.viewportByBoardId, [boardId]: viewport } });
}
export async function markPrivateBoardOpened(board: Board) {
  if (board.visibility !== "private") return;
  const preferences = await loadPreferences();
  const field = board.scope === "scene" ? "privateSceneOpenOrder" : "privateRoomOpenOrder";
  const key = board.scope === "scene" ? await getSceneKey() : "room";
  const order = preferences[field][key] ?? [];
  await savePreferences({ ...preferences, [field]: { ...preferences[field], [key]: [board.id, ...order.filter((id) => id !== board.id)] } });
}
export async function getPlayerId() { return OBR.isAvailable ? OBR.player.getId() : "demo-player"; }
export async function getPlayerName() { return OBR.isAvailable ? OBR.player.getName() : "Demo Player"; }
export async function getRoomOwnerId() {
  if (!OBR.isAvailable) return undefined;
  const owner = (await OBR.room.getMetadata())[ROOM_OWNER_KEY];
  return typeof owner === "string" ? owner : undefined;
}
export async function loadWindowPreferences(): Promise<WindowPreferences> {
  const preferences = await playerMetadata<WindowPreferences>(`${PLAYER_PREFERENCES_KEY}/window`, DEFAULT_WINDOW);
  return typeof preferences.width === "number" && typeof preferences.height === "number" ? preferences : DEFAULT_WINDOW;
}
export async function saveWindowPreferences(preferences: WindowPreferences) { await setPlayerMetadata(`${PLAYER_PREFERENCES_KEY}/window`, preferences); }
