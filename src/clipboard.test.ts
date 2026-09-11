import { beforeEach, describe, expect, it } from "vitest";
import { boardClipboardCommand, canHandleBoardShortcut, createPastedBoardItem, loadClipboard, preparePastedBoardItem, saveClipboard } from "./clipboard";
import type { Board, BoardItem } from "./types";

const counter: BoardItem = {
  id: "source-counter",
  type: "counter",
  counterLabel: "Initiative",
  counterLabelPosition: "bottom-right",
  counterValue: 17,
  counterMin: -5,
  counterMax: 30,
  counterMinColorEnabled: true,
  counterMinColor: "#123456",
  counterMaxColorEnabled: true,
  counterMaxColor: "#654321",
  counterDimAtZero: false,
  borderColor: "#abcdef",
  gridX: 2,
  gridY: 3,
  gridWidth: 4,
  gridHeight: 5,
  updatedAt: "2026-09-11T00:00:00.000Z",
};

const board = (items: BoardItem[]): Board => ({ id: "board", name: "Board", scope: "scene", visibility: "private", revision: 0, cellSizePx: 72, cellGapPx: 2, items, updatedAt: "2026-09-11T00:00:00.000Z" });

describe("Clipboard", () => {
  beforeEach(() => localStorage.clear());

  it("persists a complete independent Board Item snapshot locally", () => {
    saveClipboard(counter);
    counter.counterValue = 1;

    expect(loadClipboard()).toEqual({ ...counter, counterValue: 17 });
  });

  it("creates an independent paste with a fresh identity at its requested grid location", () => {
    const pasted = createPastedBoardItem(counter, { x: -4, y: 9 }, "new-item", "2026-09-11T01:00:00.000Z");

    expect(pasted).toEqual({ ...counter, id: "new-item", gridX: -4, gridY: 9, updatedAt: "2026-09-11T01:00:00.000Z" });
    expect(pasted).not.toBe(counter);
  });

  it("leaves Board shortcuts to editors and editable controls", () => {
    const input = document.createElement("input");

    expect(canHandleBoardShortcut({ target: document.body }, false)).toBe(true);
    expect(canHandleBoardShortcut({ target: document.body }, true)).toBe(false);
    expect(canHandleBoardShortcut({ target: input }, false)).toBe(false);
  });

  it("recognizes copy and paste by physical key when the keyboard layout is not Latin", () => {
    expect(boardClipboardCommand({ ctrlKey: true, metaKey: false, code: "KeyC" })).toBe("copy");
    expect(boardClipboardCommand({ ctrlKey: false, metaKey: true, code: "KeyV" })).toBe("paste");
  });

  it("rejects malformed locally persisted Clipboard data", () => {
    localStorage.setItem("com.owlbear-board.grid/clipboard", JSON.stringify({ ...counter, gridWidth: 0 }));

    expect(loadClipboard()).toBeUndefined();
  });

  it("keeps the Clipboard while preparing a collision-safe paste candidate", () => {
    saveClipboard(counter);
    const pasted = preparePastedBoardItem(board([{ ...counter, id: "occupied", gridX: 2, gridY: 3, gridWidth: 1, gridHeight: 1 }]), loadClipboard()!, { x: 2, y: 3 }, "pasted", "2026-09-11T01:00:00.000Z");

    expect(pasted).toMatchObject({ id: "pasted", gridX: 3, gridY: 2 });
    expect(loadClipboard()).toEqual(counter);
  });
});
