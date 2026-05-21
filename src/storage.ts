import OBR from "@owlbear-rodeo/sdk";
import {
  DEFAULT_WINDOW,
  PLAYER_STATE_KEY,
  PLAYER_WINDOW_KEY,
  SCENE_KEY_METADATA,
} from "./constants";
import { createId } from "./ids";
import type { Board, BoardScope, PersistedKanbanState, WindowPreferences } from "./types";

type StateByContext = Record<string, PersistedKanbanState>;

const emptyState = (): PersistedKanbanState => ({ version: 1, boards: [] });

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

export async function getContextKey(scope: BoardScope) {
  if (scope === "room") {
    return `room:${OBR.room.id}`;
  }

  return `scene:${await getSceneKey()}`;
}

async function readAllStates(): Promise<StateByContext> {
  const metadata = await OBR.player.getMetadata();
  const raw = metadata[PLAYER_STATE_KEY];
  if (raw && typeof raw === "object") return raw as StateByContext;
  return {};
}

async function writeAllStates(states: StateByContext) {
  await OBR.player.setMetadata({ [PLAYER_STATE_KEY]: states });
}

export async function loadBoardState(scope: BoardScope) {
  const key = await getContextKey(scope);
  const states = await readAllStates();
  return states[key] ?? emptyState();
}

export async function saveBoardState(scope: BoardScope, state: PersistedKanbanState) {
  const key = await getContextKey(scope);
  const states = await readAllStates();
  states[key] = state;
  await writeAllStates(states);
}

export async function loadAllVisibleBoards() {
  const [sceneState, roomState] = await Promise.all([
    loadBoardState("scene"),
    loadBoardState("room"),
  ]);

  return {
    scene: sceneState,
    room: roomState,
    boards: [...sceneState.boards, ...roomState.boards],
    activeBoardId: sceneState.activeBoardId ?? roomState.activeBoardId,
  };
}

export async function saveBoard(board: Board, activeBoardId?: string) {
  const state = await loadBoardState(board.scope);
  const nextBoards = state.boards.some((candidate) => candidate.id === board.id)
    ? state.boards.map((candidate) => (candidate.id === board.id ? board : candidate))
    : [...state.boards, board];

  await saveBoardState(board.scope, {
    version: 1,
    boards: nextBoards,
    activeBoardId: activeBoardId ?? board.id,
  });
}

export async function deleteBoard(board: Board) {
  const state = await loadBoardState(board.scope);
  await saveBoardState(board.scope, {
    version: 1,
    boards: state.boards.filter((candidate) => candidate.id !== board.id),
    activeBoardId:
      state.activeBoardId === board.id ? undefined : state.activeBoardId,
  });
}

export async function saveActiveBoardId(board: Board) {
  const state = await loadBoardState(board.scope);
  await saveBoardState(board.scope, { ...state, activeBoardId: board.id });
}

export async function loadWindowPreferences(): Promise<WindowPreferences> {
  const metadata = await OBR.player.getMetadata();
  const raw = metadata[PLAYER_WINDOW_KEY];
  if (
    raw &&
    typeof raw === "object" &&
    typeof (raw as WindowPreferences).width === "number" &&
    typeof (raw as WindowPreferences).height === "number"
  ) {
    return raw as WindowPreferences;
  }

  return DEFAULT_WINDOW;
}

export async function saveWindowPreferences(preferences: WindowPreferences) {
  await OBR.player.setMetadata({ [PLAYER_WINDOW_KEY]: preferences });
}
