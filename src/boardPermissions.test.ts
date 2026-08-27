import { describe, expect, it } from "vitest";
import { canRenameBoard, shouldShowBoardNameControl } from "./boardPermissions";
import type { Board } from "./types";

const board = (visibility: Board["visibility"]): Board => ({
  id: "board",
  name: "Shared Board",
  scope: "room",
  visibility,
  revision: 0,
  cellSizePx: 72,
  cellGapPx: 2,
  items: [],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
});

describe("Shared Board rename permissions", () => {
  it("allows GMs and rejects players", () => {
    const shared = board("shared");
    expect(canRenameBoard(shared, "GM")).toBe(true);
    expect(canRenameBoard(shared, "PLAYER")).toBe(false);
  });

  it("shows the name control only to users allowed to rename", () => {
    const shared = board("shared");
    expect(shouldShowBoardNameControl(shared, "GM")).toBe(true);
    expect(shouldShowBoardNameControl(shared, "PLAYER")).toBe(false);
    expect(shouldShowBoardNameControl(board("private"), "PLAYER")).toBe(true);
  });
});
