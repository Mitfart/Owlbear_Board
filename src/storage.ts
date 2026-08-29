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

const SHARED_SCENE_DATA_NAMESPACE = `${EXTENSION_ID}/shared-scene-board`;
type SharedSceneDataRecord = { namespace: typeof SHARED_SCENE_DATA_NAMESPACE; version: 1; scope: BoardScope; state: PersistedBoardState };
type SceneDataItem = { id?: string; type: string; data?: unknown; metadata?: Record<string, unknown>; [key: string]: unknown };
type SharedRoomTransition = { sourceSceneKey: string; state: PersistedBoardState; itemIds: string[]; destinationSceneKey?: string };
let activeSharedRoom: { sceneKey: string; state: PersistedBoardState; itemIds: string[] } | undefined;
let pendingSharedRoomTransitions: SharedRoomTransition[] = [];

function sharedSceneRecord(item: SceneDataItem): SharedSceneDataRecord | undefined {
  const record = item.metadata?.[SHARED_SCENE_DATA_NAMESPACE] ?? item.data;
  if (!record || typeof record !== "object") return undefined;
  const candidate = record as Partial<SharedSceneDataRecord>;
  if (candidate.namespace !== SHARED_SCENE_DATA_NAMESPACE || candidate.version !== 1 || !isPersistedBoardState(candidate.state)) return undefined;
  const scope = candidate.scope ?? candidate.state.boards[0]?.scope;
  const boards = candidate.state.boards;
  return (scope === "scene" || scope === "room") && boards.every((board) => board.scope === scope && board.visibility === "shared")
    ? { ...candidate, scope } as SharedSceneDataRecord : undefined;
}

type SharedSceneDataEntry = { item: SceneDataItem; record: SharedSceneDataRecord };

async function getSharedSceneDataItems(): Promise<SharedSceneDataEntry[]> {
  if (!OBR.isAvailable || !(OBR.scene as unknown as { items?: unknown }).items) return [];
  try {
    const items = await (OBR.scene as unknown as { items: { getItems(): Promise<SceneDataItem[]> } }).items.getItems();
    return items.map((item) => ({ item, record: sharedSceneRecord(item) })).filter((entry): entry is SharedSceneDataEntry => !!entry.record);
  } catch {
    return [];
  }
}

async function getSharedSceneDataItem(scope: BoardScope) {
  return (await getSharedSceneDataItems())
    .filter(({ record }) => record.scope === scope)
    .sort((a, b) => boardRevision(b.record.state) - boardRevision(a.record.state))[0];
}

async function getSharedSceneDataItemForBoard(board: Board) {
  return (await getSharedSceneDataItems()).find(({ record }) => record.state.boards.some((candidate) => candidate.id === board.id && candidate.scope === board.scope && candidate.visibility === board.visibility && candidate.revision === board.revision));
}

async function updateSharedSceneDataItem(existing: SharedSceneDataEntry, state: PersistedBoardState) {
  if (!existing.item.id) return;
  const data = { namespace: SHARED_SCENE_DATA_NAMESPACE, version: 1 as const, scope: existing.record.scope, state: compactBoardState(state) } satisfies SharedSceneDataRecord;
  const items = (OBR.scene as unknown as { items: { updateItems(ids: string[], update: (drafts: SceneDataItem[]) => void): Promise<void> } }).items;
  await items.updateItems([existing.item.id], (drafts) => {
    const draft = drafts.find((candidate) => candidate.id === existing.item.id);
    if (draft) Object.assign(draft, draft.type === "DATA" ? { data } : { metadata: { ...draft.metadata, [SHARED_SCENE_DATA_NAMESPACE]: data } }, { visible: false, locked: true, disableHit: true });
  });
}

async function writeSharedSceneDataState(state: PersistedBoardState, scope: BoardScope) {
  const existing = await getSharedSceneDataItem(scope);
  const nextState = { version: 1 as const, boards: state.boards.filter((board) => board.scope === scope) };
  const data = { namespace: SHARED_SCENE_DATA_NAMESPACE, version: 1 as const, scope, state: compactBoardState(nextState) } satisfies SharedSceneDataRecord;
  const playerId = await getPlayerId();
  const item = {
    id: createId("shared_scene_data"), type: "LABEL", name: "Owlbear Board data", createdUserId: playerId, lastModifiedUserId: playerId, lastModified: new Date().toISOString(), metadata: { [SHARED_SCENE_DATA_NAMESPACE]: data }, zIndex: Date.now(), visible: false, locked: true, disableHit: true,
    position: { x: 0, y: 0 }, rotation: 0, scale: { x: 1, y: 1 }, layer: "TEXT", text: { richText: [{ type: "paragraph", children: [{ text: "" }] }], plainText: "", style: { padding: 8, fontFamily: "Roboto", fontSize: 16, fontWeight: 400, textAlign: "CENTER", textAlignVertical: "MIDDLE", fillColor: "white", fillOpacity: 1, strokeColor: "white", strokeOpacity: 1, strokeWidth: 0, lineHeight: 1.5 }, type: "PLAIN", width: "AUTO", height: "AUTO" }, style: { backgroundColor: "#3D4051", backgroundOpacity: 1, cornerRadius: 8, pointerDirection: "DOWN", pointerWidth: 4, pointerHeight: 4 },
  };
  const items = (OBR.scene as unknown as { items: { addItems(items: SceneDataItem[]): Promise<void> } }).items;
  if (existing?.item.id) await updateSharedSceneDataItem(existing, nextState);
  else await items.addItems([item]);
}

export async function trackActiveSharedBoard(state: PersistedBoardState, sceneKey: string) {
  if (!OBR.isAvailable || sceneKey === "no-scene") return;
  const itemIds = normalizeBoardState(state).boards.some((board) => board.scope === "room" && board.visibility === "shared")
    ? (await getSharedSceneDataItems()).filter(({ record }) => record.scope === "room").map(({ item }) => item.id).filter((id): id is string => !!id)
    : [];
  activeSharedRoom = { sceneKey, state: normalizeBoardState(state), itemIds };
}

export function beginSharedSceneTransition() {
  const active = activeSharedRoom;
  if (!active) return;
  pendingSharedRoomTransitions = [
    ...pendingSharedRoomTransitions.filter((transition) => transition.sourceSceneKey !== active.sceneKey),
    { sourceSceneKey: active.sceneKey, state: active.state, itemIds: [...active.itemIds] },
  ];
}

function boardRevision(state: PersistedBoardState) {
  return Math.max(...state.boards.map((board) => board.revision), -1);
}

export async function carrySharedBoardAcrossSceneTransition() {
  if (!pendingSharedRoomTransitions.length || !OBR.isAvailable || !(await OBR.scene.isReady())) return;
  const destinationKey = await getSceneKey();
  const transition = pendingSharedRoomTransitions[pendingSharedRoomTransitions.length - 1];
  if (destinationKey === transition.sourceSceneKey) {
    if (transition.destinationSceneKey && transition.itemIds.length) {
      await (OBR.scene as unknown as { items: { deleteItems(ids: string[]): Promise<unknown> } }).items.deleteItems(transition.itemIds);
    }
    pendingSharedRoomTransitions = pendingSharedRoomTransitions.filter((candidate) => candidate !== transition);
    return;
  }
  const destination = await loadSharedBoardState("room");
  const state = boardRevision(transition.state) >= boardRevision(destination) ? transition.state : destination;
  await saveSharedBoardState("room", state);
  transition.destinationSceneKey = destinationKey;
  const returning = pendingSharedRoomTransitions.find((candidate) => candidate.sourceSceneKey === destinationKey && candidate !== transition);
  if (returning?.destinationSceneKey && returning.itemIds.length) {
    await (OBR.scene as unknown as { items: { deleteItems(ids: string[]): Promise<unknown> } }).items.deleteItems(returning.itemIds);
    pendingSharedRoomTransitions = pendingSharedRoomTransitions.filter((candidate) => candidate !== returning);
  }
}

export async function loadSharedBoardState(scope: BoardScope) {
  if (!OBR.isAvailable) return emptyState();
  const existing = await getSharedSceneDataItem(scope);
  return existing ? normalizeBoardState(existing.record.state) : emptyState();
}

export async function saveSharedBoardState(scope: BoardScope, state: PersistedBoardState) {
  if (!OBR.isAvailable) return;
  await writeSharedSceneDataState(normalizeBoardState(state), scope);
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
    if (!OBR.isAvailable) return;
    const existing = await getSharedSceneDataItemForBoard(board);
    if (!existing?.item.id) return;
    const remaining = existing.record.state.boards.filter((candidate) => candidate.id !== board.id);
    if (remaining.length) await updateSharedSceneDataItem(existing, { version: 1, boards: remaining });
    else await (OBR.scene as unknown as { items: { deleteItems(ids: string[]): Promise<unknown> } }).items.deleteItems([existing.item.id]);
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
  if (OBR.isAvailable) {
    const items = (await getSharedSceneDataItems()).filter(({ record }) => record.scope === "scene").map(({ item }) => item.id).filter((id): id is string => !!id);
    if (items.length) await (OBR.scene as unknown as { items: { deleteItems(ids: string[]): Promise<unknown> } }).items.deleteItems(items);
  }
}

export async function clearRoomBoardData() {
  await savePrivateBoardState("room", emptyState());
  if (OBR.isAvailable) {
    const items = (await getSharedSceneDataItems()).filter(({ record }) => record.scope === "room").map(({ item }) => item.id).filter((id): id is string => !!id);
    if (items.length) await (OBR.scene as unknown as { items: { deleteItems(ids: string[]): Promise<unknown> } }).items.deleteItems(items);
  }
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
