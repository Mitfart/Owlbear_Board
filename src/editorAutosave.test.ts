import { describe, expect, it } from "vitest";
import { updateBoardItem } from "./editorAutosave";
import type { Board } from "./types";

describe("editor autosave updates", () => {
  it("applies an editor update to the latest board without losing another saved field", () => {
    const board: Board = {
      id: "board", name: "Board", scope: "scene", visibility: "private", revision: 2, cellSizePx: 72, cellGapPx: 2, updatedAt: "2026-01-01T00:00:00.000Z",
      items: [{ id: "item", type: "counter", gridX: 0, gridY: 0, gridWidth: 1, gridHeight: 1, counterLabel: "Initiative", counterValue: 8, updatedAt: "2026-01-01T00:00:00.000Z" }],
    };

    const updated = updateBoardItem(board, "item", (item) => ({ ...item, counterValue: 9 }));

    expect(updated.items[0]).toMatchObject({ counterLabel: "Initiative", counterValue: 9 });
  });
});
