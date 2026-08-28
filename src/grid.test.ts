import { describe, expect, it } from "vitest";
import { boardItemAt, boardItemCells, collides, makeRectCells, updateBoardItemPosition, updateBoardItemRect } from "./grid";
import type { Board, BoardItem } from "./types";

const item = (overrides: Partial<BoardItem>): BoardItem => ({
  id: "item_1",
  type: "text",
  text: "Note",
  gridX: 1,
  gridY: 1,
  gridWidth: 2,
  gridHeight: 2,
  updatedAt: "",
  ...overrides,
});

const board = (items: BoardItem[]): Board => ({
  id: "board_1",
  name: "Board",
  scope: "scene",
  visibility: "private",
  revision: 0,
  cellSizePx: 72,
  cellGapPx: 0,
  items,
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

  it("derives occupancy from bounds after moving an item", () => {
    const moved = updateBoardItemPosition(item({}), 5, 6);
    expect(boardItemCells(moved)).toEqual(makeRectCells(5, 6, 2, 2));
    expect("occupiedCells" in moved).toBe(false);
  });

  it("derives occupancy from bounds after resizing an item", () => {
    const resized = updateBoardItemRect(item({}), 1, 1, 4, 3);
    expect(boardItemCells(resized)).toEqual(makeRectCells(1, 1, 4, 3));
    expect("occupiedCells" in resized).toBe(false);
  });

  it("uses bounds for selection", () => {
    const candidate = item({ gridX: 5, gridY: 6, gridWidth: 2, gridHeight: 2 });
    expect(boardItemAt(board([candidate]), 6, 7)).toBe(candidate);
  });
});
