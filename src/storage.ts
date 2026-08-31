import OBR, { buildShape } from "@owlbear-rodeo/sdk";
import {
  BOARD_EVENT_CHANNEL, BOARD_STATE_KEY, DEFAULT_CELL_GAP, DEFAULT_CELL_SIZE,
  DEFAULT_COUNTER_MAX_COLOR, DEFAULT_COUNTER_ZERO_COLOR, DEFAULT_ITEM_BORDER_COLOR,
  DEFAULT_WINDOW, PLAYER_PREFERENCES_KEY, PRIVATE_ROOM_STATE_KEY, PRIVATE_SCENE_STATES_KEY,
  ROOM_BOARD_IDS_KEY, ROOM_BOARD_STATE_KEY, ROOM_OWNER_KEY, SCENE_KEY_METADATA,
  SHARED_ROOM_STATE_KEY, SHARED_SCENE_STATE_KEY,
} from "./constants";
import { canDeleteBoard, canViewBoard, type PlayerRole } from "./boardPermissions";
import { createId } from "./ids";
import type { Board, BoardItem, BoardScope, PersistedBoardState, PlayerPreferences, ViewportPreference, WindowPreferences } from "./types";
export { orderPrivateBoards } from "./boardSession";

const emptyState = (): PersistedBoardState => ({ version: 1, boards: [] });
const emptyPreferences = (): PlayerPreferences => ({ version: 1, privateSceneOpenOrder: {}, privateRoomOpenOrder: {}, viewportByBoardId: {} });

function normalizedGridValue(value: unknown, fallback: number, minimum?: number) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(minimum ?? -Infinity, Math.trunc(number)) : fallback;
}

export function normalizeBoardState(state: PersistedBoardState): PersistedBoardState {
  return {
    ...state,
    boards: state.boards.map((board) => {
      const { createdAt: _createdAt, ...cleanBoard } = board as Board & { createdAt?: unknown };
      return {
        ...cleanBoard,
        allowedUserIds: cleanBoard.visibility === "private" ? cleanBoard.allowedUserIds ?? (cleanBoard.ownerId ? [cleanBoard.ownerId] : []) : undefined,
        cellSizePx: cleanBoard.cellSizePx ?? DEFAULT_CELL_SIZE,
        cellGapPx: cleanBoard.cellGapPx ?? DEFAULT_CELL_GAP,
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

function isBoard(value: unknown): value is Board { return !!value && typeof value === "object" && typeof (value as Board).id === "string" && Array.isArray((value as Board).items); }

function isState(value: unknown): value is PersistedBoardState {
  return !!value && typeof value === "object" && (value as PersistedBoardState).version === 1 && Array.isArray((value as PersistedBoardState).boards);
}

function mergeNewest(first: Board[], second: Board[]) {
  const merged = new Map(first.map((board) => [board.id, board]));
  for (const board of second) {
    const current = merged.get(board.id);
    if (!current || current.updatedAt < board.updatedAt) merged.set(board.id, board);
  }
  return [...merged.values()];
}

async function playerMetadata<T>(key: string, fallback: T): Promise<T> {
  if (!OBR.isAvailable) return fallback;
  const value = (await OBR.player.getMetadata())[key];
  return value && typeof value === "object" ? value as T : fallback;
}
async function setPlayerMetadata(key: string, value: unknown) {
  if (OBR.isAvailable) await OBR.player.setMetadata({ [key]: value });
}

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

async function sceneBoardItems() {
  if (!OBR.isAvailable || !await OBR.scene.isReady()) return [];
  return (await OBR.scene.items.getItems()).filter((item) => isBoard(item.metadata[BOARD_STATE_KEY]));
}
async function loadSceneBoardState(): Promise<PersistedBoardState> {
  if (!OBR.isAvailable || !await OBR.scene.isReady()) return emptyState();
  const items = await sceneBoardItems();
  if (items.length) return normalizeBoardState({ version: 1, boards: items.map((item) => item.metadata[BOARD_STATE_KEY] as Board) });
  const metadata = await OBR.scene.getMetadata();
  const current = metadata[BOARD_STATE_KEY];
  return normalizeBoardState(isState(current) ? current : isState(metadata[SHARED_SCENE_STATE_KEY]) ? metadata[SHARED_SCENE_STATE_KEY] : emptyState());
}
async function saveSceneBoardState(state: PersistedBoardState) {
  if (!OBR.isAvailable || !await OBR.scene.isReady()) return;
  const boards = normalizeBoardState(state).boards;
  const items = await sceneBoardItems();
  const itemByBoardId = new Map(items.map((item) => [(item.metadata[BOARD_STATE_KEY] as Board).id, item]));
  const add = boards.filter((board) => !itemByBoardId.has(board.id)).map((board) => buildShape().name("Owl-Boards data").metadata({ [BOARD_STATE_KEY]: board }).locked(true).visible(false).disableHit(true).layer("CONTROL").width(1).height(1).shapeType("RECTANGLE").build());
  if (add.length) await OBR.scene.items.addItems(add);
  await OBR.scene.items.updateItems(items.filter((item) => boards.some((board) => board.id === (item.metadata[BOARD_STATE_KEY] as Board).id)), (drafts) => { for (const item of drafts) { const board = boards.find((candidate) => candidate.id === (item.metadata[BOARD_STATE_KEY] as Board).id); if (board) item.metadata[BOARD_STATE_KEY] = board; } });
  const remove = items.filter((item) => !boards.some((board) => board.id === (item.metadata[BOARD_STATE_KEY] as Board).id)).map((item) => item.id);
  if (remove.length) await OBR.scene.items.deleteItems(remove);
}

async function loadRoomBoardState(): Promise<PersistedBoardState> {
  if (!OBR.isAvailable) return emptyState();
  const metadata = await OBR.room.getMetadata();
  const current = metadata[ROOM_BOARD_STATE_KEY];
  return normalizeBoardState(isState(current) ? current : isState(metadata[SHARED_ROOM_STATE_KEY]) ? metadata[SHARED_ROOM_STATE_KEY] : emptyState());
}
async function saveRoomBoardState(state: PersistedBoardState) {
  if (OBR.isAvailable) await OBR.room.setMetadata({ [ROOM_BOARD_STATE_KEY]: normalizeBoardState(state) });
}

async function setRoomBoardActive(boardId: string, active: boolean) {
  const current = await playerMetadata<string[]>(ROOM_BOARD_IDS_KEY, []);
  await setPlayerMetadata(ROOM_BOARD_IDS_KEY, active ? [...new Set([...current, boardId])] : current.filter((id) => id !== boardId));
}

export async function carryRoomBoardsToCurrentScene() {
  if (!OBR.isAvailable || !await OBR.scene.isReady()) return;
  const [scene, room] = await Promise.all([loadSceneBoardState(), loadRoomBoardState()]);
  const roomById = new Map(room.boards.map((board) => [board.id, board]));
  const currentRoom = scene.boards.filter((board) => board.scope === "room");
  const newestRoom = mergeNewest(room.boards, currentRoom.filter((board) => roomById.has(board.id)));
  if (JSON.stringify(newestRoom) !== JSON.stringify(room.boards)) await saveRoomBoardState({ version: 1, boards: newestRoom });
  await saveSceneBoardState({ version: 1, boards: [...scene.boards.filter((board) => board.scope !== "room"), ...newestRoom] });
}

async function loadBoards(scope: BoardScope, visibility: Board["visibility"]) {
  const state = scope === "room" ? await loadRoomBoardState() : await loadSceneBoardState();
  return { version: 1 as const, boards: state.boards.filter((board) => board.scope === scope && board.visibility === visibility) };
}
export async function loadPrivateBoardState(scope: BoardScope) { return loadBoards(scope, "private"); }
export async function loadSharedBoardState(scope: BoardScope) { return loadBoards(scope, "shared"); }

async function replaceBoards(scope: BoardScope, visibility: Board["visibility"], state: PersistedBoardState) {
  const load = scope === "room" ? loadRoomBoardState : loadSceneBoardState;
  const save = scope === "room" ? saveRoomBoardState : saveSceneBoardState;
  const current = await load();
  await save({ version: 1, boards: [...current.boards.filter((board) => !(board.scope === scope && board.visibility === visibility)), ...state.boards.filter((board) => board.scope === scope && board.visibility === visibility)] });
  if (scope === "room") await carryRoomBoardsToCurrentScene();
}
export async function savePrivateBoardState(scope: BoardScope, state: PersistedBoardState) { await replaceBoards(scope, "private", state); }
export async function saveSharedBoardState(scope: BoardScope, state: PersistedBoardState) { await replaceBoards(scope, "shared", state); }

export async function loadAllVisibleBoards(role: PlayerRole = "GM", playerId?: string) {
  const [scene, room] = await Promise.all([loadSceneBoardState(), loadRoomBoardState()]);
  const boards = [...scene.boards.filter((board) => board.scope !== "room"), ...room.boards].filter((board) => canViewBoard(board, role, playerId));
  const by = (scope: BoardScope, visibility: Board["visibility"]) => ({ version: 1 as const, boards: boards.filter((board) => board.scope === scope && board.visibility === visibility) });
  return { privateScene: by("scene", "private"), privateRoom: by("room", "private"), sharedScene: by("scene", "shared"), sharedRoom: by("room", "shared"), boards };
}

async function saveBoardToMetadata(board: Board) {
  const load = board.scope === "room" ? loadRoomBoardState : loadSceneBoardState;
  const save = board.scope === "room" ? saveRoomBoardState : saveSceneBoardState;
  const current = await load();
  const saved = { ...board, revision: board.revision + 1 };
  await save({ version: 1, boards: [...current.boards.filter((candidate) => candidate.id !== board.id), saved] });
  if (saved.scope === "room") { await setRoomBoardActive(saved.id, true); await carryRoomBoardsToCurrentScene(); }
  return saved;
}

async function deleteBoardFromMetadata(board: Board) {
  const load = board.scope === "room" ? loadRoomBoardState : loadSceneBoardState;
  const save = board.scope === "room" ? saveRoomBoardState : saveSceneBoardState;
  const current = await load();
  await save({ version: 1, boards: current.boards.filter((candidate) => candidate.id !== board.id) });
  if (board.scope === "room") { await setRoomBoardActive(board.id, false); await carryRoomBoardsToCurrentScene(); }
}

async function relocateBoardInMetadata(board: Board) {
  if (board.visibility !== "private" || board.scope !== "room") return board;
  const room = await loadRoomBoardState();
  await saveRoomBoardState({ version: 1, boards: room.boards.filter((candidate) => candidate.id !== board.id) });
  await setRoomBoardActive(board.id, false);
  return saveBoardToMetadata({ ...board, scope: "scene", updatedAt: new Date().toISOString() });
}

export type BoardSavingBehavior = { save(board: Board): Promise<Board>; delete(board: Board): Promise<void>; relocate(board: Board): Promise<Board>; };
export let boardSaving: BoardSavingBehavior = { save: saveBoardToMetadata, delete: deleteBoardFromMetadata, relocate: relocateBoardInMetadata };
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
  const [role, playerId] = OBR.isAvailable ? await Promise.all([OBR.player.getRole(), OBR.player.getId()]) : ["GM" as const, "demo-player"];
  if (!canDeleteBoard(board, role, playerId)) throw new Error("Only the board creator or a GM can delete this board.");
  await boardSaving.delete(board);
  await broadcastBoardChange("delete", board.id);
}
export async function movePrivateRoomBoardToScene(board: Board) {
  const moved = await boardSaving.relocate(board);
  await broadcastBoardChange("save", moved.id);
  return moved;
}

export async function clearSceneBoardData() {
  const scene = await loadSceneBoardState();
  await saveSceneBoardState({ version: 1, boards: scene.boards.filter((board) => board.scope === "room") });
}
export async function clearRoomBoardData() {
  await saveRoomBoardState(emptyState());
  await setPlayerMetadata(ROOM_BOARD_IDS_KEY, []);
  await carryRoomBoardsToCurrentScene();
}
export async function clearAllBoardData() {
  if (!OBR.isAvailable) return;
  await Promise.all([saveSceneBoardState(emptyState()), saveRoomBoardState(emptyState())]);
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
