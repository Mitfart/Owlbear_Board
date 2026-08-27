import OBR from "@owlbear-rodeo/sdk";
import {
  DEFAULT_WINDOW,
  EXTENSION_ID,
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

function normalizedGridValue(value: unknown, fallback: number, minimum?: number) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(minimum ?? -Infinity, Math.trunc(number)) : fallback;
}

export function normalizeBoardState(state: PersistedBoardState): PersistedBoardState {
  return {
    ...state,
    boards: state.boards.map((board) => ({
      ...board,
      items: board.items.map((item) => {
        const { occupiedCells: _legacyOccupiedCells, ...normalizedItem } = item as BoardItem & { occupiedCells?: unknown };
        return { ...normalizedItem, gridX: normalizedGridValue(normalizedItem.gridX, 0), gridY: normalizedGridValue(normalizedItem.gridY, 0), gridWidth: normalizedGridValue(normalizedItem.gridWidth, 1, 1), gridHeight: normalizedGridValue(normalizedItem.gridHeight, 1, 1) };
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
  if (!OBR.isAvailable) return fallback;
  const raw = (await OBR.player.getMetadata())[key];
  return raw && typeof raw === "object" ? (raw as T) : fallback;
}

async function writePlayerMetadata<T>(key: string, value: T) {
  if (OBR.isAvailable) await OBR.player.setMetadata({ [key]: value });
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
  const pending = sceneKey !== "no-scene" ? states["no-scene"] : undefined;
  if (pending) {
    const merged = new Map((states[sceneKey]?.boards ?? []).map((board) => [board.id, board]));
    for (const board of pending.boards) {
      if ((merged.get(board.id)?.revision ?? -1) < board.revision) merged.set(board.id, board);
    }
    states[sceneKey] = { version: 1, boards: [...merged.values()] };
    delete states["no-scene"];
    await writePrivateSceneStates(states);
  }
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

const SHARED_SCENE_DATA_NAMESPACE = `${EXTENSION_ID}/shared-scene-board`;
type SharedSceneDataRecord = { namespace: typeof SHARED_SCENE_DATA_NAMESPACE; version: 1; state: PersistedBoardState };
type SceneDataItem = { id?: string; type: string; data?: unknown; [key: string]: unknown };
type SharedRoomTransition = { sourceSceneKey: string; state: PersistedBoardState; itemIds: string[]; destinationSceneKey?: string };
let activeSharedRoom: { sceneKey: string; state: PersistedBoardState; itemIds: string[] } | undefined;
let pendingSharedRoomTransition: SharedRoomTransition | undefined;

function sharedSceneRecord(item: SceneDataItem): SharedSceneDataRecord | undefined {
  const record = item.data;
  if (!record || typeof record !== "object") return undefined;
  const candidate = record as Partial<SharedSceneDataRecord>;
  return candidate.namespace === SHARED_SCENE_DATA_NAMESPACE && candidate.version === 1 && isPersistedBoardState(candidate.state)
    ? candidate as SharedSceneDataRecord : undefined;
}

type SharedSceneDataEntry = { item: SceneDataItem; record: SharedSceneDataRecord };

async function getSharedSceneDataItems(): Promise<SharedSceneDataEntry[]> {
  if (!OBR.isAvailable || !(OBR.scene as unknown as { items?: unknown }).items) return [];
  const items = await (OBR.scene as unknown as { items: { getItems(): Promise<SceneDataItem[]> } }).items.getItems();
  return items.filter((item) => item.type === "DATA").map((item) => ({ item, record: sharedSceneRecord(item) })).filter((entry): entry is SharedSceneDataEntry => !!entry.record);
}

async function getSharedSceneDataItem(scope: BoardScope) {
  return (await getSharedSceneDataItems())
    .filter(({ record }) => record.state.boards.some((board) => board.scope === scope))
    .sort((a, b) => boardRevision(b.record.state) - boardRevision(a.record.state))[0];
}

async function getSharedSceneDataItemForBoard(board: Board) {
  return (await getSharedSceneDataItems()).find(({ record }) => record.state.boards.some((candidate) => candidate.id === board.id && candidate.scope === board.scope && candidate.visibility === board.visibility && candidate.revision === board.revision));
}

async function updateSharedSceneDataItem(existing: SharedSceneDataEntry, state: PersistedBoardState) {
  if (!existing.item.id) return;
  const data = { namespace: SHARED_SCENE_DATA_NAMESPACE, version: 1 as const, state: normalizeBoardState(state) } satisfies SharedSceneDataRecord;
  const items = (OBR.scene as unknown as { items: { updateItems(ids: string[], update: (drafts: SceneDataItem[]) => void): Promise<void> } }).items;
  await items.updateItems([existing.item.id], (drafts) => {
    const draft = drafts.find((candidate) => candidate.id === existing.item.id);
    if (draft) Object.assign(draft, { type: "DATA", data, visible: false, locked: true, disableHit: true });
  });
}

async function writeSharedSceneDataState(state: PersistedBoardState, scope: BoardScope) {
  const existing = await getSharedSceneDataItem(scope);
  const nextState = existing
    ? { version: 1 as const, boards: [...existing.record.state.boards.filter((board) => board.scope !== scope), ...state.boards] }
    : state;
  const data = { namespace: SHARED_SCENE_DATA_NAMESPACE, version: 1 as const, state: normalizeBoardState(nextState) } satisfies SharedSceneDataRecord;
  const item = {
    type: "DATA", data, visible: false, locked: true, disableHit: true,
    position: { x: 0, y: 0 }, rotation: 0, scale: { x: 1, y: 1 }, layer: "FOREGROUND",
  };
  const items = (OBR.scene as unknown as { items: { addItems(items: SceneDataItem[]): Promise<void> } }).items;
  if (existing?.item.id) await updateSharedSceneDataItem(existing, nextState);
  else await items.addItems([item]);
}

let sharedSceneMigration: Promise<PersistedBoardState | undefined> | undefined;

async function migrateLegacySharedSceneState() {
  if (sharedSceneMigration) return sharedSceneMigration;
  sharedSceneMigration = (async () => {
    if (!OBR.isAvailable || await getSharedSceneDataItem("scene")) return undefined;
    const metadata = await OBR.scene.getMetadata() ?? {};
    const raw = metadata[SHARED_SCENE_STATE_KEY];
    if (!isPersistedBoardState(raw)) return undefined;
    const state = normalizeBoardState(raw);
    await writeSharedSceneDataState(state, "scene");
    await OBR.scene.setMetadata({ [SHARED_SCENE_STATE_KEY]: undefined });
    return state;
  })();
  try {
    return await sharedSceneMigration;
  } finally {
    sharedSceneMigration = undefined;
  }
}

export async function trackActiveSharedBoard(state: PersistedBoardState, sceneKey: string) {
  if (!OBR.isAvailable || sceneKey === "no-scene") return;
  const roomBoardIds = new Set(normalizeBoardState(state).boards.filter((board) => board.scope === "room" && board.visibility === "shared").map((board) => board.id));
  const itemIds = roomBoardIds.size
    ? (await getSharedSceneDataItems()).filter(({ record }) => record.state.boards.some((board) => board.scope === "room" && board.visibility === "shared" && roomBoardIds.has(board.id))).map(({ item }) => item.id).filter((id): id is string => !!id)
    : [];
  activeSharedRoom = { sceneKey, state: normalizeBoardState(state), itemIds };
}

export function beginSharedSceneTransition() {
  if (activeSharedRoom) {
    pendingSharedRoomTransition = {
      sourceSceneKey: activeSharedRoom.sceneKey,
      state: activeSharedRoom.state,
      itemIds: [...activeSharedRoom.itemIds],
    };
  }
}

function boardRevision(state: PersistedBoardState) {
  return Math.max(...state.boards.map((board) => board.revision), -1);
}

export async function carrySharedBoardAcrossSceneTransition() {
  if (!pendingSharedRoomTransition || !OBR.isAvailable || !(await OBR.scene.isReady())) return;
  const destinationKey = await getSceneKey();
  if (destinationKey === pendingSharedRoomTransition.sourceSceneKey) {
    if (pendingSharedRoomTransition.destinationSceneKey && pendingSharedRoomTransition.itemIds.length) {
      await (OBR.scene as unknown as { items: { deleteItems(ids: string[]): Promise<unknown> } }).items.deleteItems(pendingSharedRoomTransition.itemIds);
    }
    pendingSharedRoomTransition = undefined;
    return;
  }
  const roomMetadataState = await loadSharedBoardState("room");
  const roomDataState = (await getSharedSceneDataItem("room"))?.record.state;
  const destination = roomDataState && boardRevision(roomDataState) > boardRevision(roomMetadataState) ? roomDataState : roomMetadataState;
  const state = boardRevision(pendingSharedRoomTransition.state) > boardRevision(destination)
    ? pendingSharedRoomTransition.state
    : destination;
  if (boardRevision(state) > boardRevision(roomMetadataState)) await saveSharedBoardState("room", state);
  if (state.boards.length) await writeSharedSceneDataState(state, "room");
  pendingSharedRoomTransition.destinationSceneKey = destinationKey;
}

export async function loadSharedBoardState(scope: BoardScope) {
  if (scope === "scene") {
    const existing = await getSharedSceneDataItem("scene");
    if (existing) return normalizeBoardState(existing.record.state);
    return normalizeBoardState(await migrateLegacySharedSceneState() ?? emptyState());
  }
  if (!OBR.isAvailable) return emptyState();
  const raw = (await OBR.room.getMetadata())[SHARED_ROOM_STATE_KEY];
  return isPersistedBoardState(raw) ? normalizeBoardState(raw) : emptyState();
}

export async function loadGmSharedBoardState() {
  if (!OBR.isAvailable) return emptyState();
  const metadata = await OBR.room.getMetadata();
  return isPersistedBoardState(metadata[GM_SHARED_BOARD_STATE_KEY]) ? normalizeBoardState(metadata[GM_SHARED_BOARD_STATE_KEY] as PersistedBoardState) : emptyState();
}

export async function saveGmSharedBoardState(state: PersistedBoardState) {
  if (!OBR.isAvailable) return;
  const metadata = await OBR.room.getMetadata();
  await OBR.room.setMetadata({ ...metadata, [GM_SHARED_BOARD_STATE_KEY]: normalizeBoardState(state) });
}

export async function saveSharedBoardState(scope: BoardScope, state: PersistedBoardState) {
  const normalized = normalizeBoardState(state);
  if (scope === "room") {
    if (!OBR.isAvailable) return;
    const metadata = await OBR.room.getMetadata();
    await OBR.room.setMetadata({ ...metadata, [SHARED_ROOM_STATE_KEY]: normalized });
    return;
  }
  if (!OBR.isAvailable) return;
  await migrateLegacySharedSceneState();
  await writeSharedSceneDataState(normalized, "scene");
}

export async function loadAllVisibleBoards(role: PlayerRole = "GM", playerId?: string) {
  const [privateScene, privateRoom, sharedScene, sharedRoom, gmShared] = await Promise.all([
    loadPrivateBoardState("scene"), loadPrivateBoardState("room"), loadSharedBoardState("scene"), loadSharedBoardState("room"), loadGmSharedBoardState(),
  ]);
  const sceneKey = await getSceneKey();
  const visibleGm = gmShared.boards.filter((board) => (board.scope === "room" || board.sceneKey === sceneKey) && role === "GM" && board.ownerId !== playerId);
  return { privateScene, privateRoom, sharedScene, sharedRoom, gmShared: { version: 1 as const, boards: visibleGm }, boards: [...privateScene.boards, ...privateRoom.boards, ...sharedScene.boards, ...sharedRoom.boards, ...visibleGm] };
}

async function saveBoardToMetadata(board: Board) {
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

async function deleteBoardFromMetadata(board: Board) {
  if (board.visibility === "gm-shared") return;
  if (board.visibility === "shared" && board.scope === "scene") {
    if (!OBR.isAvailable) return;
    await migrateLegacySharedSceneState();
    const existing = await getSharedSceneDataItemForBoard(board);
    if (!existing?.item.id) return;
    const remaining = existing.record.state.boards.filter((candidate) => candidate.id !== board.id);
    if (remaining.length) await updateSharedSceneDataItem(existing, { version: 1, boards: remaining });
    else await (OBR.scene as unknown as { items: { deleteItems(ids: string[]): Promise<unknown> } }).items.deleteItems([existing.item.id]);
    return;
  }
  const load = board.visibility === "shared" ? loadSharedBoardState : loadPrivateBoardState;
  const save = board.visibility === "shared" ? saveSharedBoardState : savePrivateBoardState;
  const state = await load(board.scope);
  await save(board.scope, { version: 1, boards: state.boards.filter((candidate) => candidate.id !== board.id) });
  if (board.visibility === "private") await saveGmSharedBoardState({ version: 1, boards: (await loadGmSharedBoardState()).boards.filter((candidate) => candidate.id !== board.id) });
}

async function relocateBoardInMetadata(board: Board) {
  if (board.visibility !== "private" || board.scope !== "room") return board;
  const scene = await loadPrivateBoardState("scene");
  const moved = { ...board, scope: "scene" as const, revision: board.revision + 1 };
  await savePrivateBoardState("scene", { version: 1, boards: [...scene.boards.filter((candidate) => candidate.id !== board.id), moved] });
  await deleteBoardFromMetadata(board);
  if (board.showToGM) {
    const published = (await loadGmSharedBoardState()).boards.filter((candidate) => candidate.id !== board.id);
    published.push({ ...moved, visibility: "gm-shared", sceneKey: await getSceneKey() });
    await saveGmSharedBoardState({ version: 1, boards: published });
  }
  return moved;
}

export type BoardSavingBehavior = {
  save(board: Board): Promise<Board>;
  delete(board: Board): Promise<void>;
  relocate(board: Board): Promise<Board>;
};

// The Board layer owns mutation semantics; Owlbear persistence is its replaceable adapter.
export let boardSaving: BoardSavingBehavior = {
  save: saveBoardToMetadata,
  delete: deleteBoardFromMetadata,
  relocate: relocateBoardInMetadata,
};

export function setBoardSavingBehavior(behavior: BoardSavingBehavior) {
  boardSaving = behavior;
}

export const saveBoard = (board: Board) => boardSaving.save(board);
export const deleteBoard = (board: Board) => boardSaving.delete(board);
export const movePrivateRoomBoardToScene = (board: Board) => boardSaving.relocate(board);

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
