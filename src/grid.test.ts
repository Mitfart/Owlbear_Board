import { describe, expect, it } from "vitest";
import { collides, makeRectCells, updateBoardItemPosition, updateBoardItemRect } from "./grid";
import type { Board, BoardItem } from "./types";

const item = (overrides: Partial<BoardItem>): BoardItem => ({
  id: "item_1",
  type: "text",
  text: "Note",
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
  cellGapPx: 0,
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

  it("recomputes occupied cells when resizing an item", () => {
    const resized = updateBoardItemRect(item({}), 1, 1, 4, 3);
    expect(resized.gridWidth).toBe(4);
    expect(resized.gridHeight).toBe(3);
    expect(resized.occupiedCells).toEqual(makeRectCells(1, 1, 4, 3));
  });
});
