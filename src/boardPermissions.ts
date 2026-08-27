import type { Board } from "./types";

export type PlayerRole = "GM" | "PLAYER";

export function canRenameBoard(board: Board, role: PlayerRole) {
  return board.visibility !== "shared" && board.visibility !== "gm-shared" || role === "GM" && board.visibility === "shared";
}

export function canEditBoard(board: Board, role: PlayerRole, playerId?: string) {
  if (board.visibility === "gm-shared") return false;
  return board.visibility !== "private" || board.ownerId === playerId;
}

export function shouldShowBoardNameControl(board: Board, role: PlayerRole) {
  return canRenameBoard(board, role);
}
