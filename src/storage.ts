import OBR from "@owlbear-rodeo/sdk";
import {
  DEFAULT_WINDOW,
  PLAYER_PREFERENCES_KEY,
  PRIVATE_ROOM_STATE_KEY,
  PRIVATE_SCENE_STATES_KEY,
  ROOM_OWNER_KEY,
  SCENE_KEY_METADATA,
  SHARED_ROOM_STATE_KEY,
  SHARED_SCENE_STATE_KEY,
  GM_SHARED_BOARD_STATE_KEY,
} from "./constants";
import { createId } from "./ids";
import type { Board, BoardItem, BoardScope, PlayerPreferences, PersistedBoardState, ViewportPreference, WindowPreferences } from "./types";
import type { PlayerRole } from "./boardPermissions";
export { orderPrivateBoards } from "./boardSession";

type PrivateSceneStates = Record<string, PersistedBoardState>;

const emptyState = (): PersistedBoardState => ({ version: 1, boards: [] });

export function normalizeBoardState(state: PersistedBoardState): PersistedBoardState {
  return {
    ...state,
    boards: state.boards.map((board) => ({
      ...board,
      items: board.items.map((item) => {
        const { occupiedCells: _legacyOccupiedCells, ...normalizedItem } = item as BoardItem & { occupiedCells?: unknown };
        return normalizedItem;
      }),
    })),
  };
}

const emptyPreferences = (): PlayerPreferences => ({
  version: 1,
  privateSceneOpenOrder: {},
  privateRoomOpenOrder: {},
  viewportByBoardId: {},
});

function canUseLocalStorage() {
  return typeof localStorage !== "undefined";
}

function localKey(key: string) {
  return `${key}:guest:${OBR.isAvailable ? OBR.room.id : "demo"}`;
}

function readLocal<T>(key: string, fallback: T): T {
  if (!canUseLocalStorage()) return fallback;
  try {
    const raw = localStorage.getItem(localKey(key));
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeLocal<T>(key: string, value: T) {
  if (!canUseLocalStorage()) return;
  localStorage.setItem(localKey(key), JSON.stringify(value));
}

export async function getSceneKey() {
  if (!OBR.isAvailable) return "demo";
  const ready = await OBR.scene.isReady();
  if (!ready) return "no-scene";

  const metadata = await OBR.scene.getMetadata();
  const current = metadata[SCENE_KEY_METADATA];
  if (typeof current === "string") return current;

  const sceneKey = createId("scene");
  await OBR.scene.setMetadata({ ...metadata, [SCENE_KEY_METADATA]: sceneKey });
  return sceneKey;
}

async function readPlayerMetadata<T>(key: string, fallback: T): Promise<T> {
  if (!OBR.isAvailable) return readLocal(key, fallback);
  const metadata = await OBR.player.getMetadata();
  const raw = metadata[key];
  return raw && typeof raw === "object" ? (raw as T) : readLocal(key, fallback);
}

async function writePlayerMetadata<T>(key: string, value: T) {
  writeLocal(key, value);
  if (!OBR.isAvailable) return;
  await OBR.player.setMetadata({ [key]: value });
}

async function readPrivateSceneStates() {
  return readPlayerMetadata<PrivateSceneStates>(PRIVATE_SCENE_STATES_KEY, {});
}

async function writePrivateSceneStates(states: PrivateSceneStates) {
  await writePlayerMetadata(PRIVATE_SCENE_STATES_KEY, states);
}

export async function loadPrivateBoardState(scope: BoardScope) {
  if (scope === "room") return normalizeBoardState(await readPlayerMetadata<PersistedBoardState>(PRIVATE_ROOM_STATE_KEY, emptyState()));
  const sceneKey = await getSceneKey();
  const states = await readPrivateSceneStates();
  return normalizeBoardState(states[sceneKey] ?? emptyState());
}

export async function savePrivateBoardState(scope: BoardScope, state: PersistedBoardState) {
  if (scope === "room") {
    await writePlayerMetadata(PRIVATE_ROOM_STATE_KEY, normalizeBoardState(state));
    return;
  }
  const sceneKey = await getSceneKey();
  const states = await readPrivateSceneStates();
  states[sceneKey] = normalizeBoardState(state);
  await writePrivateSceneStates(states);
}

function isPersistedBoardState(value: unknown): value is PersistedBoardState {
  return !!value && typeof value === "object" && (value as PersistedBoardState).version === 1 && Array.isArray((value as PersistedBoardState).boards);
}

export async function loadSharedBoardState(scope: BoardScope) {
  if (!OBR.isAvailable) return normalizeBoardState(readLocal(scope === "room" ? SHARED_ROOM_STATE_KEY : SHARED_SCENE_STATE_KEY, emptyState()));
  const metadata = scope === "room" ? await OBR.room.getMetadata() : await OBR.scene.getMetadata();
  const raw = metadata[scope === "room" ? SHARED_ROOM_STATE_KEY : SHARED_SCENE_STATE_KEY];
  return isPersistedBoardState(raw) ? normalizeBoardState(raw) : emptyState();
}

export async function loadGmSharedBoardState() {
  if (!OBR.isAvailable) return readLocal(GM_SHARED_BOARD_STATE_KEY, emptyState());
  const metadata = await OBR.room.getMetadata();
  return isPersistedBoardState(metadata[GM_SHARED_BOARD_STATE_KEY]) ? normalizeBoardState(metadata[GM_SHARED_BOARD_STATE_KEY] as PersistedBoardState) : emptyState();
}

export async function saveGmSharedBoardState(state: PersistedBoardState) {
  if (!OBR.isAvailable) { writeLocal(GM_SHARED_BOARD_STATE_KEY, normalizeBoardState(state)); return; }
  const metadata = await OBR.room.getMetadata();
  await OBR.room.setMetadata({ ...metadata, [GM_SHARED_BOARD_STATE_KEY]: normalizeBoardState(state) });
}

export async function saveSharedBoardState(scope: BoardScope, state: PersistedBoardState) {
  if (!OBR.isAvailable) {
    writeLocal(scope === "room" ? SHARED_ROOM_STATE_KEY : SHARED_SCENE_STATE_KEY, normalizeBoardState(state));
    return;
  }
  if (scope === "room") await OBR.room.setMetadata({ [SHARED_ROOM_STATE_KEY]: normalizeBoardState(state) });
  else {
    const metadata = await OBR.scene.getMetadata();
    await OBR.scene.setMetadata({ ...metadata, [SHARED_SCENE_STATE_KEY]: normalizeBoardState(state) });
  }
}

export async function loadAllVisibleBoards(role: PlayerRole = "GM", playerId?: string) {
  const [privateScene, privateRoom, sharedScene, sharedRoom, gmShared] = await Promise.all([
    loadPrivateBoardState("scene"), loadPrivateBoardState("room"), loadSharedBoardState("scene"), loadSharedBoardState("room"), loadGmSharedBoardState(),
  ]);
  const sceneKey = await getSceneKey();
  const visibleGm = gmShared.boards.filter((board) => (board.scope === "room" || board.sceneKey === sceneKey) && role === "GM" && board.ownerId !== playerId);
  return { privateScene, privateRoom, sharedScene, sharedRoom, gmShared: { version: 1 as const, boards: visibleGm }, boards: [...privateScene.boards, ...privateRoom.boards, ...sharedScene.boards, ...sharedRoom.boards, ...visibleGm] };
}

export async function saveBoard(board: Board) {
  if (board.visibility === "gm-shared") return board;
  const load = board.visibility === "shared" ? loadSharedBoardState : loadPrivateBoardState;
  const save = board.visibility === "shared" ? saveSharedBoardState : savePrivateBoardState;
  const state = await load(board.scope);
  const nextBoard = { ...board, revision: board.revision + 1 };
  if (nextBoard.visibility === "private") {
    const published = (await loadGmSharedBoardState()).boards.filter((candidate) => candidate.id !== nextBoard.id);
    if (nextBoard.showToGM) published.push({ ...nextBoard, visibility: "gm-shared", sceneKey: nextBoard.scope === "scene" ? await getSceneKey() : undefined });
    await saveGmSharedBoardState({ version: 1, boards: published });
  }
  const boards = state.boards.some((candidate) => candidate.id === board.id)
    ? state.boards.map((candidate) => (candidate.id === board.id ? nextBoard : candidate))
    : [...state.boards, nextBoard];
  await save(board.scope, { version: 1, boards });
  return nextBoard;
}

export async function deleteBoard(board: Board) {
  if (board.visibility === "gm-shared") return;
  const load = board.visibility === "shared" ? loadSharedBoardState : loadPrivateBoardState;
  const save = board.visibility === "shared" ? saveSharedBoardState : savePrivateBoardState;
  const state = await load(board.scope);
  await save(board.scope, { version: 1, boards: state.boards.filter((candidate) => candidate.id !== board.id) });
  if (board.visibility === "private") await saveGmSharedBoardState({ version: 1, boards: (await loadGmSharedBoardState()).boards.filter((candidate) => candidate.id !== board.id) });
}

export async function movePrivateRoomBoardToScene(board: Board) {
  if (board.visibility !== "private" || board.scope !== "room") return board;
  const scene = await loadPrivateBoardState("scene");
  const moved = { ...board, scope: "scene" as const, revision: board.revision + 1 };
  await savePrivateBoardState("scene", { version: 1, boards: [...scene.boards.filter((candidate) => candidate.id !== board.id), moved] });
  await deleteBoard(board);
  if (board.showToGM) {
    const published = (await loadGmSharedBoardState()).boards.filter((candidate) => candidate.id !== board.id);
    published.push({ ...moved, visibility: "gm-shared", sceneKey: await getSceneKey() });
    await saveGmSharedBoardState({ version: 1, boards: published });
  }
  return moved;
}

export async function loadPreferences() {
  return readPlayerMetadata<PlayerPreferences>(PLAYER_PREFERENCES_KEY, emptyPreferences());
}

export async function savePreferences(preferences: PlayerPreferences) {
  await writePlayerMetadata(PLAYER_PREFERENCES_KEY, preferences);
}

export async function saveViewport(boardId: string, viewport: ViewportPreference) {
  const preferences = await loadPreferences();
  await savePreferences({ ...preferences, viewportByBoardId: { ...preferences.viewportByBoardId, [boardId]: viewport } });
}

export async function markPrivateBoardOpened(board: Board) {
  if (board.visibility !== "private") return;
  const sceneKey = board.scope === "scene" ? await getSceneKey() : "room";
  const preferences = await loadPreferences();
  const source = board.scope === "scene" ? preferences.privateSceneOpenOrder : preferences.privateRoomOpenOrder;
  const current = source[sceneKey] ?? [];
  const next = [board.id, ...current.filter((id) => id !== board.id)];
  await savePreferences({ ...preferences, [board.scope === "scene" ? "privateSceneOpenOrder" : "privateRoomOpenOrder"]: { ...source, [sceneKey]: next } });
}

export async function getPlayerId() {
  if (!OBR.isAvailable) return "demo-player";
  return OBR.player.getId();
}

export async function getPlayerName() {
  if (!OBR.isAvailable) return "Demo Player";
  return OBR.player.getName();
}

export async function getRoomOwnerId() {
  if (!OBR.isAvailable) return undefined;
  const metadata = await OBR.room.getMetadata();
  const owner = metadata[ROOM_OWNER_KEY];
  return typeof owner === "string" ? owner : undefined;
}

export async function loadWindowPreferences(): Promise<WindowPreferences> {
  const preferences = await readPlayerMetadata<WindowPreferences>(`${PLAYER_PREFERENCES_KEY}/window`, DEFAULT_WINDOW);
  return typeof preferences.width === "number" && typeof preferences.height === "number" ? preferences : DEFAULT_WINDOW;
}

export async function saveWindowPreferences(preferences: WindowPreferences) {
  await writePlayerMetadata(`${PLAYER_PREFERENCES_KEY}/window`, preferences);
}
