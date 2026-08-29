import OBR from "@owlbear-rodeo/sdk";
import {
  DEFAULT_CELL_GAP,
  DEFAULT_CELL_SIZE,
  DEFAULT_COUNTER_MAX_COLOR,
  DEFAULT_COUNTER_ZERO_COLOR,
  DEFAULT_ITEM_BORDER_COLOR,
  DEFAULT_WINDOW,
  EXTENSION_ID,
  PLAYER_PREFERENCES_KEY,
  PRIVATE_ROOM_STATE_KEY,
  PRIVATE_SCENE_STATES_KEY,
  ROOM_OWNER_KEY,
  SCENE_KEY_METADATA,
  BOARD_EVENT_CHANNEL,
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
    boards: state.boards.map((board) => {
      const normalizedBoard = { ...board };
      delete (normalizedBoard as Board & { createdAt?: unknown }).createdAt;
      return {
        ...normalizedBoard,
        cellSizePx: normalizedBoard.cellSizePx ?? DEFAULT_CELL_SIZE,
        cellGapPx: normalizedBoard.cellGapPx ?? DEFAULT_CELL_GAP,
        items: board.items.map((item) => {
          const { occupiedCells: _legacyOccupiedCells, createdAt: _createdAt, ...normalizedItem } = item as BoardItem & { occupiedCells?: unknown; createdAt?: unknown };
          const grid = { ...normalizedItem, gridX: normalizedGridValue(normalizedItem.gridX, 0), gridY: normalizedGridValue(normalizedItem.gridY, 0), gridWidth: normalizedGridValue(normalizedItem.gridWidth, 1, 1), gridHeight: normalizedGridValue(normalizedItem.gridHeight, 1, 1) };
          if (grid.type === "text") return { ...grid, text: grid.text ?? "", fillBlock: grid.fillBlock !== false, textVerticalAlignment: grid.textVerticalAlignment ?? "top", borderColor: grid.borderColor ?? DEFAULT_ITEM_BORDER_COLOR };
          if (grid.type === "image") return { ...grid, imageFit: grid.imageFit ?? "cover", borderColor: grid.borderColor ?? DEFAULT_ITEM_BORDER_COLOR };
          if (grid.type === "counter") return { ...grid, counterValue: grid.counterValue ?? 0, counterLabel: grid.counterLabel ?? "", counterLabelPosition: grid.counterLabelPosition ?? "top-center", counterDimAtZero: grid.counterDimAtZero !== false, counterZeroColor: grid.counterZeroColor ?? DEFAULT_COUNTER_ZERO_COLOR, counterMaxColor: grid.counterMaxColor ?? DEFAULT_COUNTER_MAX_COLOR, borderColor: grid.borderColor ?? DEFAULT_ITEM_BORDER_COLOR };
          return grid;
        }),
      };
    }),
  };
}

function compactBoardState(state: PersistedBoardState): PersistedBoardState {
  const normalized = normalizeBoardState(state);
  return {
    ...normalized,
    boards: normalized.boards.map((board) => {
      const { cellSizePx, cellGapPx, ...compactBoard } = board;
      const storedBoard = compactBoard as Omit<Board, "cellSizePx" | "cellGapPx"> & Partial<Pick<Board, "cellSizePx" | "cellGapPx">>;
      if (cellSizePx !== DEFAULT_CELL_SIZE) storedBoard.cellSizePx = cellSizePx;
      if (cellGapPx !== DEFAULT_CELL_GAP) storedBoard.cellGapPx = cellGapPx;
      storedBoard.items = board.items.map((item) => {
        const compact = { ...item };
        if (compact.borderColor === DEFAULT_ITEM_BORDER_COLOR) delete compact.borderColor;
        if (compact.type === "text") { if (compact.text === "") delete compact.text; if (compact.fillBlock) delete compact.fillBlock; if (compact.textVerticalAlignment === "top") delete compact.textVerticalAlignment; }
        if (compact.type === "image" && compact.imageFit === "cover") delete compact.imageFit;
        if (compact.type === "counter") { if (compact.counterValue === 0) delete compact.counterValue; if (compact.counterLabel === "") delete compact.counterLabel; if (compact.counterLabelPosition === "top-center") delete compact.counterLabelPosition; if (compact.counterDimAtZero) delete compact.counterDimAtZero; if (!compact.counterZeroColorEnabled) delete compact.counterZeroColorEnabled; if (!compact.counterMaxColorEnabled) delete compact.counterMaxColorEnabled; if (compact.counterZeroColor === DEFAULT_COUNTER_ZERO_COLOR) delete compact.counterZeroColor; if (compact.counterMaxColor === DEFAULT_COUNTER_MAX_COLOR) delete compact.counterMaxColor; }
        return compact;
      });
      return storedBoard as Board;
    }),
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
  return raw && typeof raw === "object" ? raw as T : fallback;
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
    await writePlayerMetadata(PRIVATE_ROOM_STATE_KEY, compactBoardState(state));
    return;
  }
  const sceneKey = await getSceneKey();
  const states = await readPrivateSceneStates();
  states[sceneKey] = compactBoardState(state);
  await writePrivateSceneStates(states);
}

function isPersistedBoardState(value: unknown): value is PersistedBoardState {
  return !!value && typeof value === "object" && (value as PersistedBoardState).version === 1 && Array.isArray((value as PersistedBoardState).boards);
}

export async function carrySharedBoardAcrossSceneTransition() {}

export async function loadSharedBoardState(scope: BoardScope) {
  if (!OBR.isAvailable) return emptyState();
  const metadata = scope === "scene" ? await OBR.scene.getMetadata() : await OBR.room.getMetadata();
  const state = metadata[scope === "scene" ? `${EXTENSION_ID}/shared-scene-state` : `${EXTENSION_ID}/shared-room-state`];
  return isPersistedBoardState(state) ? normalizeBoardState({ ...state, boards: state.boards.filter((board) => board.scope === scope && board.visibility === "shared") }) : emptyState();
}

export async function saveSharedBoardState(scope: BoardScope, state: PersistedBoardState) {
  if (!OBR.isAvailable) return;
  const next = compactBoardState({ version: 1, boards: normalizeBoardState(state).boards.filter((board) => board.scope === scope && board.visibility === "shared") });
  if (scope === "scene") await OBR.scene.setMetadata({ [`${EXTENSION_ID}/shared-scene-state`]: next });
  else await OBR.room.setMetadata({ [`${EXTENSION_ID}/shared-room-state`]: next });
}

export async function loadAllVisibleBoards(role: PlayerRole = "GM", _playerId?: string) {
  const [privateScene, privateRoom, sharedScene, sharedRoom, sceneKey] = await Promise.all([
    loadPrivateBoardState("scene"), loadPrivateBoardState("room"), loadSharedBoardState("scene"), loadSharedBoardState("room"), getSceneKey(),
  ]);
  const privateBoards = [...privateScene.boards, ...privateRoom.boards];
  if (role === "GM" && OBR.isAvailable) {
    const players = await (OBR as unknown as { party?: { getPlayers(): Promise<Array<{ id: string; name: string; role: PlayerRole; metadata: Record<string, unknown> }>> } }).party?.getPlayers() ?? [];
    const allPrivate = players.flatMap((player) => {
      const room = player.metadata[PRIVATE_ROOM_STATE_KEY];
      const scenes = player.metadata[PRIVATE_SCENE_STATES_KEY];
      const states = [isPersistedBoardState(room) ? room : emptyState(), scenes && typeof scenes === "object" && isPersistedBoardState((scenes as PrivateSceneStates)[sceneKey]) ? (scenes as PrivateSceneStates)[sceneKey] : emptyState()];
      return states.flatMap((state) => normalizeBoardState(state).boards.map((board) => ({ ...board, ownerId: board.ownerId ?? player.id, ownerName: `${board.ownerName ?? player.name}${player.role === "GM" ? " (GM)" : ""}` })));
    });
    return { privateScene, privateRoom, sharedScene, sharedRoom, boards: [...privateBoards, ...allPrivate.filter((board) => board.ownerId !== _playerId), ...sharedScene.boards, ...sharedRoom.boards] };
  }
  return { privateScene, privateRoom, sharedScene, sharedRoom, boards: [...privateBoards, ...sharedScene.boards, ...sharedRoom.boards] };
}

async function saveBoardToMetadata(board: Board) {
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

async function deleteBoardFromMetadata(board: Board) {
  if (board.visibility === "shared") {
    const state = await loadSharedBoardState(board.scope);
    await saveSharedBoardState(board.scope, { version: 1, boards: state.boards.filter((candidate) => candidate.id !== board.id) });
    return;
  }
  const state = await loadPrivateBoardState(board.scope);
  await savePrivateBoardState(board.scope, { version: 1, boards: state.boards.filter((candidate) => candidate.id !== board.id) });
}

async function relocateBoardInMetadata(board: Board) {
  if (board.visibility !== "private" || board.scope !== "room") return board;
  const scene = await loadPrivateBoardState("scene");
  const moved = { ...board, scope: "scene" as const, revision: board.revision + 1 };
  await savePrivateBoardState("scene", { version: 1, boards: [...scene.boards.filter((candidate) => candidate.id !== board.id), moved] });
  await deleteBoardFromMetadata(board);
  return moved;
}

export async function clearSceneBoardData() {
  const sceneKey = await getSceneKey();
  const states = await readPrivateSceneStates();
  delete states[sceneKey];
  await writePrivateSceneStates(states);
  const preferences = await loadPreferences();
  const { [sceneKey]: _cleared, ...privateSceneOpenOrder } = preferences.privateSceneOpenOrder;
  await savePreferences({ ...preferences, privateSceneOpenOrder });
  await saveSharedBoardState("scene", emptyState());
}

export async function clearRoomBoardData() {
  await savePrivateBoardState("room", emptyState());
  await saveSharedBoardState("room", emptyState());
  const preferences = await loadPreferences();
  await savePreferences({ ...preferences, privateRoomOpenOrder: {} });
}

export async function clearAllBoardData() {
  await clearSceneBoardData();
  await clearRoomBoardData();
  await writePrivateSceneStates({});
  await writePlayerMetadata(PRIVATE_ROOM_STATE_KEY, emptyState());
  await savePreferences(emptyPreferences());
  await saveWindowPreferences(DEFAULT_WINDOW);
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
