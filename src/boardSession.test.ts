import { describe, expect, it } from "vitest";
import { buildBoardPickerRows, groupPlayerBoards, orderPrivateBoards } from "./boardSession";
import type { Board, BoardScope, BoardVisibility, PlayerPreferences } from "./types";

const preferences = (overrides: Partial<PlayerPreferences> = {}): PlayerPreferences => ({
  version: 1,
  privateSceneOpenOrder: {},
  privateRoomOpenOrder: {},
  viewportByBoardId: {},
  ...overrides,
});

const board = (overrides: Partial<Board> = {}): Board => ({
  id: "board_1",
  name: "Board",
  scope: "scene",
  visibility: "private",
  revision: 0,
  cellSizePx: 72,
  cellGapPx: 2,
  items: [],
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...overrides,
});

const privateBoard = (id: string, scope: BoardScope, updatedAt: string, name = id) =>
  board({ id, name, scope, visibility: "private", updatedAt });

const sharedBoard = (id: string, scope: BoardScope) =>
  board({ id, name: `Shared ${scope}`, scope, visibility: "shared" as BoardVisibility });

describe("Board picker", () => {
  it("groups GM-shared boards by player name", () => {
    expect(groupPlayerBoards([
      board({ id: "b", ownerName: "Zoe", name: "Alpha", visibility: "gm-shared" }),
      board({ id: "a", ownerName: "Ada", name: "Bravo", visibility: "gm-shared" }),
    ])).toMatchObject([{ playerName: "Ada", boards: [{ id: "a" }] }, { playerName: "Zoe", boards: [{ id: "b" }] }]);
  });
  it("keeps same-name players in separate GM-shared groups", () => {
    const boards = [
      board({ id: "one", ownerId: "player-1", ownerName: "Alex", visibility: "gm-shared" }),
      board({ id: "two", ownerId: "player-2", ownerName: "Alex", visibility: "gm-shared" }),
    ];

    expect(groupPlayerBoards(boards)).toMatchObject([
      { playerName: "Alex", boards: [{ id: "one" }] },
      { playerName: "Alex", boards: [{ id: "two" }] },
    ]);
  });

  it("orders Private Boards by Board Open Order before recency", () => {
    const old = privateBoard("old", "scene", "2026-01-01T00:00:00.000Z");
    const recent = privateBoard("recent", "scene", "2026-01-02T00:00:00.000Z");

    expect(
      orderPrivateBoards([recent, old], "scene", preferences({ privateSceneOpenOrder: { scene_a: ["old"] } }), "scene_a").map(
        (candidate) => candidate.id,
      ),
    ).toEqual(["old", "recent"]);
  });

  it("builds picker rows with Private Boards first and Shared Board placeholders", () => {
    const rows = buildBoardPickerRows({
      privateSceneBoards: [privateBoard("scene_private", "scene", "2026-01-01T00:00:00.000Z")],
      privateRoomBoards: [privateBoard("room_private", "room", "2026-01-01T00:00:00.000Z")],
      sharedSceneBoards: [],
      sharedRoomBoards: [],
      preferences: preferences(),
      sceneKey: "scene_a",
    });

    expect(rows).toMatchObject([
      { kind: "board", board: { id: "scene_private" } },
      { kind: "board", board: { id: "room_private" } },
      { kind: "shared-placeholder", scope: "scene", label: "Shared Scene Board" },
      { kind: "shared-placeholder", scope: "room", label: "Shared Room Board" },
    ]);
  });

  it("uses existing Shared Boards instead of placeholders", () => {
    const rows = buildBoardPickerRows({
      privateSceneBoards: [],
      privateRoomBoards: [],
      sharedSceneBoards: [sharedBoard("shared_scene", "scene")],
      sharedRoomBoards: [sharedBoard("shared_room", "room")],
      preferences: preferences(),
      sceneKey: "scene_a",
    });

    expect(rows).toMatchObject([
      { kind: "board", board: { id: "shared_scene" } },
      { kind: "board", board: { id: "shared_room" } },
    ]);
  });

});
