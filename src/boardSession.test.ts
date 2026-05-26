import { describe, expect, it } from "vitest";
import { buildBoardPickerRows, buildBoardSession, chooseActiveBoard, orderPrivateBoards, previewVisible, resolveViewport } from "./boardSession";
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
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...overrides,
});

const privateBoard = (id: string, scope: BoardScope, updatedAt: string, name = id) =>
  board({ id, name, scope, visibility: "private", updatedAt });

const sharedBoard = (id: string, scope: BoardScope) =>
  board({ id, name: `Shared ${scope}`, scope, visibility: "shared" as BoardVisibility });

describe("Board Session", () => {
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

  it("preserves the current Active Board when it still exists", () => {
    const first = privateBoard("first", "scene", "2026-01-01T00:00:00.000Z");
    const current = privateBoard("current", "room", "2026-01-01T00:00:00.000Z");
    const rows = [first, current].map((candidate) => ({ kind: "board" as const, board: candidate }));

    expect(chooseActiveBoard(rows, "current")?.id).toBe("current");
  });

  it("chooses the first existing Board when the current Active Board is unavailable", () => {
    const first = privateBoard("first", "scene", "2026-01-01T00:00:00.000Z");
    const rows = [
      { kind: "shared-placeholder" as const, scope: "scene" as const, label: "Shared Scene Board" },
      { kind: "board" as const, board: first },
    ];

    expect(chooseActiveBoard(rows, "missing")?.id).toBe("first");
  });

  it("shows preview only when no real Board exists and preview is not dismissed", () => {
    const placeholderRows = [{ kind: "shared-placeholder" as const, scope: "scene" as const, label: "Shared Scene Board" }];
    const boardRows = [{ kind: "board" as const, board: privateBoard("first", "scene", "2026-01-01T00:00:00.000Z") }];

    expect(previewVisible(placeholderRows, undefined, false)).toBe(true);
    expect(previewVisible(placeholderRows, undefined, true)).toBe(false);
    expect(previewVisible(boardRows, boardRows[0].board, false)).toBe(false);
  });

  it("resolves viewport for the Active Board from preferences", () => {
    const active = privateBoard("active", "scene", "2026-01-01T00:00:00.000Z");

    expect(
      resolveViewport(
        active,
        preferences({ viewportByBoardId: { active: { pan: { x: 10, y: 20 }, zoom: 1.25 } } }),
      ),
    ).toEqual({ pan: { x: 10, y: 20 }, zoom: 1.25 });
  });

  it("builds a Board Session model", () => {
    const active = privateBoard("active", "scene", "2026-01-01T00:00:00.000Z");

    const session = buildBoardSession({
      privateSceneBoards: [active],
      privateRoomBoards: [],
      sharedSceneBoards: [],
      sharedRoomBoards: [],
      preferences: preferences({ viewportByBoardId: { active: { pan: { x: 1, y: 2 }, zoom: 0.75 } } }),
      sceneKey: "scene_a",
      currentBoardId: "active",
    });

    expect(session.activeBoard?.id).toBe("active");
    expect(session.previewVisible).toBe(false);
    expect(session.viewport).toEqual({ pan: { x: 1, y: 2 }, zoom: 0.75 });
  });
});
