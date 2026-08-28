import { describe, expect, it } from "vitest";
import { canEditBoard, canRenameBoard } from "./boardPermissions";
import type { Board } from "./types";

const board = (visibility: Board["visibility"], ownerId?: string): Board => ({
  id: "board", name: "Board", scope: "room", visibility, ownerId, revision: 0,
  cellSizePx: 72, cellGapPx: 2, items: [], updatedAt: "2026-01-01T00:00:00.000Z",
});

describe("Board sharing permissions", () => {
  it("allows only the private owner to edit", () => {
    expect(canEditBoard(board("private", "owner"), "PLAYER", "owner")).toBe(true);
    expect(canEditBoard(board("private", "owner"), "PLAYER", "other")).toBe(false);
    expect(canEditBoard(board("private"), "PLAYER", "anyone")).toBe(false);
  });

  it("allows GMs to manage every board", () => {
    for (const visibility of ["private", "shared"] as const) expect(canEditBoard(board(visibility, "owner"), "GM")).toBe(true);
  });

  it("allows only GMs to rename shared boards", () => {
    expect(canRenameBoard(board("shared"), "GM")).toBe(true);
    expect(canRenameBoard(board("shared"), "PLAYER")).toBe(false);
    expect(canRenameBoard(board("private"), "PLAYER")).toBe(true);
  });
});
