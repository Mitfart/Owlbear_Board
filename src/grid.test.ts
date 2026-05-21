import { describe, expect, it } from "vitest";
import { collides, makeRectCells, updateBoardItemPosition } from "./grid";
import type { Board, BoardItem } from "./types";

const item = (overrides: Partial<BoardItem>): BoardItem => ({
  id: "item_1",
  sourceItemId: "source_1",
  snapshot: {
    id: "source_1",
    type: "TEXT",
    name: "Note",
    visible: true,
    locked: false,
    createdUserId: "user",
    zIndex: 0,
    lastModified: "",
    lastModifiedUserId: "",
    position: { x: 0, y: 0 },
    rotation: 0,
    scale: { x: 1, y: 1 },
    metadata: {},
    layer: "TEXT",
  },
  gridX: 1,
  gridY: 1,
  gridWidth: 2,
  gridHeight: 2,
  occupiedCells: makeRectCells(1, 1, 2, 2),
  createdAt: "",
  updatedAt: "",
  ...overrides,
});

const board = (items: BoardItem[]): Board => ({
  id: "board_1",
  name: "Board",
  scope: "scene",
  cellSizePx: 72,
  items,
  createdAt: "",
  updatedAt: "",
});

describe("grid occupancy", () => {
  it("creates rectangular occupied cells", () => {
    expect(makeRectCells(2, 3, 2, 2)).toEqual([
      { x: 2, y: 3 },
      { x: 3, y: 3 },
      { x: 2, y: 4 },
      { x: 3, y: 4 },
    ]);
  });

  it("detects overlapping placements", () => {
    const state = board([item({})]);
    expect(collides(state, 2, 2, 1, 1)).toBe(true);
    expect(collides(state, 4, 4, 1, 1)).toBe(false);
  });

  it("ignores the moving item during collision checks", () => {
    const state = board([item({})]);
    expect(collides(state, 1, 1, 2, 2, "item_1")).toBe(false);
  });

  it("recomputes occupied cells when moving an item", () => {
    const moved = updateBoardItemPosition(item({}), 5, 6);
    expect(moved.gridX).toBe(5);
    expect(moved.gridY).toBe(6);
    expect(moved.occupiedCells).toEqual(makeRectCells(5, 6, 2, 2));
  });
});
