import type { Board } from "./types";

export type PlayerRole = "GM" | "PLAYER";

export function canViewBoard(board: Board, role: PlayerRole, playerId?: string) {
  return role === "GM" || board.visibility === "shared" || (board.allowedUserIds ?? [board.ownerId]).includes(playerId);
}

export function canRenameBoard(board: Board, role: PlayerRole) {
  return board.visibility !== "shared" || role === "GM";
}

export function canEditBoard(board: Board, role: PlayerRole, playerId?: string) {
  return canViewBoard(board, role, playerId);
}
