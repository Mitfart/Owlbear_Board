import { describe, expect, it } from "vitest";
import { canEditBoard, canRenameBoard } from "./boardPermissions";
import type { Board } from "./types";

const board = (visibility: Board["visibility"], ownerId?: string): Board => ({
  id: "board", name: "Board", scope: "room", visibility, ownerId, revision: 0,
  cellSizePx: 72, cellGapPx: 2, items: [], createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
});

describe("Board sharing permissions", () => {
  it("allows only the private owner to edit", () => {
    expect(canEditBoard(board("private", "owner"), "PLAYER", "owner")).toBe(true);
    expect(canEditBoard(board("private", "owner"), "PLAYER", "other")).toBe(false);
    expect(canEditBoard(board("private"), "PLAYER", "anyone")).toBe(false);
  });

  it("keeps every GM-shared mutation path read-only for GMs", () => {
    for (const mutation of ["board editing", "item editing", "movement", "resizing", "deletion", "counter changes"]) {
      expect(canEditBoard(board("gm-shared", "owner"), "GM"), mutation).toBe(false);
    }
  });

  it("allows only GMs to rename shared boards", () => {
    expect(canRenameBoard(board("shared"), "GM")).toBe(true);
    expect(canRenameBoard(board("shared"), "PLAYER")).toBe(false);
    expect(canRenameBoard(board("private"), "PLAYER")).toBe(true);
    expect(canRenameBoard(board("gm-shared"), "GM")).toBe(false);
  });
});
