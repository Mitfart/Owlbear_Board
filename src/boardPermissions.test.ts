import { describe, expect, it } from "vitest";
import { canDeleteBoard, canEditBoard, canRenameBoard, canViewBoard } from "./boardPermissions";
import type { Board } from "./types";

const board = (visibility: Board["visibility"], allowedUserIds?: string[]): Board => ({
  id: "board", name: "Board", scope: "room", visibility, ownerId: "owner", allowedUserIds, revision: 0,
  cellSizePx: 72, cellGapPx: 2, items: [], updatedAt: "2026-01-01T00:00:00.000Z",
});

describe("Board sharing permissions", () => {
  it("uses the allowed-user list for private board viewing and editing", () => {
    const privateBoard = board("private", ["owner", "guest"]);
    expect(canViewBoard(privateBoard, "PLAYER", "guest")).toBe(true);
    expect(canEditBoard(privateBoard, "PLAYER", "guest")).toBe(true);
    expect(canViewBoard(privateBoard, "PLAYER", "other")).toBe(false);
  });

  it("allows GMs to manage every board", () => {
    expect(canEditBoard(board("private", []), "GM")).toBe(true);
    expect(canEditBoard(board("shared"), "GM")).toBe(true);
  });

  it("allows only owners and GMs to delete", () => {
    const privateBoard = board("private", ["owner", "guest"]);
    expect(canDeleteBoard(privateBoard, "PLAYER", "owner")).toBe(true);
    expect(canDeleteBoard(privateBoard, "PLAYER", "guest")).toBe(false);
    expect(canDeleteBoard(privateBoard, "GM", "gm")).toBe(true);
  });

  it("allows only GMs to rename shared boards", () => {
    expect(canRenameBoard(board("shared"), "GM")).toBe(true);
    expect(canRenameBoard(board("shared"), "PLAYER")).toBe(false);
  });
});
