import type { Board, BoardScope, PlayerPreferences } from "./types";

export type ExistingBoardPickerRow = {
  kind: "board";
  board: Board;
};

export type SharedBoardPlaceholderPickerRow = {
  kind: "shared-placeholder";
  scope: BoardScope;
  label: string;
};

export type BoardPickerRow = ExistingBoardPickerRow | SharedBoardPlaceholderPickerRow;

export function sharedBoardLabel(scope: BoardScope) {
  return `Shared ${scope === "scene" ? "Scene" : "Room"} Board`;
}

export function orderPrivateBoards(
  boards: Board[],
  scope: BoardScope,
  preferences: PlayerPreferences,
  sceneKey: string,
) {
  const key = scope === "scene" ? sceneKey : "room";
  const order = scope === "scene" ? preferences.privateSceneOpenOrder[key] ?? [] : preferences.privateRoomOpenOrder[key] ?? [];
  const rank = new Map(order.map((id, index) => [id, index]));
  return [...boards].sort(
    (a, b) =>
      (rank.get(a.id) ?? 9999) - (rank.get(b.id) ?? 9999) ||
      b.updatedAt.localeCompare(a.updatedAt) ||
      a.name.localeCompare(b.name),
  );
}

export function buildBoardPickerRows(input: {
  privateSceneBoards: Board[];
  privateRoomBoards: Board[];
  sharedSceneBoards: Board[];
  sharedRoomBoards: Board[];
  preferences: PlayerPreferences;
  sceneKey: string;
}): BoardPickerRow[] {
  const privateScene = orderPrivateBoards(input.privateSceneBoards, "scene", input.preferences, input.sceneKey);
  const privateRoom = orderPrivateBoards(input.privateRoomBoards, "room", input.preferences, input.sceneKey);
  const sharedScene = input.sharedSceneBoards[0];
  const sharedRoom = input.sharedRoomBoards[0];

  return [
    ...privateScene.map((board) => ({ kind: "board" as const, board })),
    ...privateRoom.map((board) => ({ kind: "board" as const, board })),
    sharedScene ? { kind: "board", board: sharedScene } : { kind: "shared-placeholder", scope: "scene", label: sharedBoardLabel("scene") },
    sharedRoom ? { kind: "board", board: sharedRoom } : { kind: "shared-placeholder", scope: "room", label: sharedBoardLabel("room") },
  ];
}
