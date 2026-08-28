import type { Board } from "./types";

export type PlayerRole = "GM" | "PLAYER";

export function canRenameBoard(board: Board, role: PlayerRole) {
  return board.visibility !== "shared" || role === "GM";
}

export function canEditBoard(board: Board, role: PlayerRole, playerId?: string) {
  return role === "GM" || board.visibility !== "private" || board.ownerId === playerId;
}
