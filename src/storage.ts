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
} from "./constants";
import { createId } from "./ids";
import type { Board, BoardScope, PlayerPreferences, PersistedBoardState, ViewportPreference, WindowPreferences } from "./types";

type PrivateSceneStates = Record<string, PersistedBoardState>;

const emptyState = (): PersistedBoardState => ({ version: 1, boards: [] });
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
  if (!OBR.isAvailable) {
    writeLocal(key, value);
    return;
  }
  await OBR.player.setMetadata({ [key]: value });
}

async function readPrivateSceneStates() {
  return readPlayerMetadata<PrivateSceneStates>(PRIVATE_SCENE_STATES_KEY, {});
}

async function writePrivateSceneStates(states: PrivateSceneStates) {
  await writePlayerMetadata(PRIVATE_SCENE_STATES_KEY, states);
}

export async function loadPrivateBoardState(scope: BoardScope) {
  if (scope === "room") return readPlayerMetadata<PersistedBoardState>(PRIVATE_ROOM_STATE_KEY, emptyState());
  const sceneKey = await getSceneKey();
  const states = await readPrivateSceneStates();
  return states[sceneKey] ?? emptyState();
}

export async function savePrivateBoardState(scope: BoardScope, state: PersistedBoardState) {
  if (scope === "room") {
    await writePlayerMetadata(PRIVATE_ROOM_STATE_KEY, state);
    return;
  }
  const sceneKey = await getSceneKey();
  const states = await readPrivateSceneStates();
  states[sceneKey] = state;
  await writePrivateSceneStates(states);
}

function isPersistedBoardState(value: unknown): value is PersistedBoardState {
  return !!value && typeof value === "object" && (value as PersistedBoardState).version === 1 && Array.isArray((value as PersistedBoardState).boards);
}

export async function loadSharedBoardState(scope: BoardScope) {
  if (!OBR.isAvailable) return readLocal(scope === "room" ? SHARED_ROOM_STATE_KEY : SHARED_SCENE_STATE_KEY, emptyState());
  const metadata = scope === "room" ? await OBR.room.getMetadata() : await OBR.scene.getMetadata();
  const raw = metadata[scope === "room" ? SHARED_ROOM_STATE_KEY : SHARED_SCENE_STATE_KEY];
  return isPersistedBoardState(raw) ? raw : emptyState();
}

export async function saveSharedBoardState(scope: BoardScope, state: PersistedBoardState) {
  if (!OBR.isAvailable) {
    writeLocal(scope === "room" ? SHARED_ROOM_STATE_KEY : SHARED_SCENE_STATE_KEY, state);
    return;
  }
  if (scope === "room") await OBR.room.setMetadata({ [SHARED_ROOM_STATE_KEY]: state });
  else await OBR.scene.setMetadata({ [SHARED_SCENE_STATE_KEY]: state });
}

export async function loadAllVisibleBoards() {
  const [privateScene, privateRoom, sharedScene, sharedRoom] = await Promise.all([
    loadPrivateBoardState("scene"),
    loadPrivateBoardState("room"),
    loadSharedBoardState("scene"),
    loadSharedBoardState("room"),
  ]);
  return { privateScene, privateRoom, sharedScene, sharedRoom, boards: [...privateScene.boards, ...privateRoom.boards, ...sharedScene.boards, ...sharedRoom.boards] };
}

export async function saveBoard(board: Board) {
  const load = board.visibility === "shared" ? loadSharedBoardState : loadPrivateBoardState;
  const save = board.visibility === "shared" ? saveSharedBoardState : savePrivateBoardState;
  const state = await load(board.scope);
  const nextBoard = { ...board, revision: board.revision + 1 };
  const boards = state.boards.some((candidate) => candidate.id === board.id)
    ? state.boards.map((candidate) => (candidate.id === board.id ? nextBoard : candidate))
    : [...state.boards, nextBoard];
  await save(board.scope, { version: 1, boards });
  return nextBoard;
}

export async function deleteBoard(board: Board) {
  const load = board.visibility === "shared" ? loadSharedBoardState : loadPrivateBoardState;
  const save = board.visibility === "shared" ? saveSharedBoardState : savePrivateBoardState;
  const state = await load(board.scope);
  await save(board.scope, { version: 1, boards: state.boards.filter((candidate) => candidate.id !== board.id) });
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

export function orderPrivateBoards(boards: Board[], scope: BoardScope, preferences: PlayerPreferences, sceneKey: string) {
  const key = scope === "scene" ? sceneKey : "room";
  const order = scope === "scene" ? preferences.privateSceneOpenOrder[key] ?? [] : preferences.privateRoomOpenOrder[key] ?? [];
  const rank = new Map(order.map((id, index) => [id, index]));
  return [...boards].sort((a, b) => (rank.get(a.id) ?? 9999) - (rank.get(b.id) ?? 9999) || b.updatedAt.localeCompare(a.updatedAt) || a.name.localeCompare(b.name));
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
