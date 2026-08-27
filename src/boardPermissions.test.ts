import { describe, expect, it } from "vitest";
import { canEditBoard, canRenameBoard, canViewGmSharedBoard, shouldShowBoardNameControl } from "./boardPermissions";
import type { Board } from "./types";

const board = (visibility: Board["visibility"], ownerId?: string): Board => ({
  id: "board", name: "Board", scope: "room", visibility, ownerId, revision: 0,
  cellSizePx: 72, cellGapPx: 2, items: [], createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
});

describe("Board sharing permissions", () => {
  it("allows owners to edit and GMs to view, but not mutate, GM-shared boards", () => {
    expect(canEditBoard(board("private", "owner"), "PLAYER", "owner")).toBe(true);
    expect(canEditBoard(board("private", "owner"), "PLAYER", "other")).toBe(false);
    expect(canEditBoard(board("gm-shared", "owner"), "GM")).toBe(false);
    expect(canViewGmSharedBoard(board("gm-shared", "owner"), "GM")).toBe(true);
    expect(canViewGmSharedBoard(board("gm-shared", "owner"), "PLAYER", "other")).toBe(false);
  });

  it("keeps shared-board rename behavior", () => {
    expect(canRenameBoard(board("shared"), "GM")).toBe(true);
    expect(canRenameBoard(board("shared"), "PLAYER")).toBe(false);
  });

  it("shows the name control only to users allowed to rename", () => {
    expect(shouldShowBoardNameControl(board("shared"), "GM")).toBe(true);
    expect(shouldShowBoardNameControl(board("shared"), "PLAYER")).toBe(false);
    expect(shouldShowBoardNameControl(board("private"), "PLAYER")).toBe(true);
    expect(shouldShowBoardNameControl(board("gm-shared"), "GM")).toBe(false);
  });
});
