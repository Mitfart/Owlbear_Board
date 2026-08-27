import type { Board } from "./types";

export type PlayerRole = "GM" | "PLAYER";

export function canRenameBoard(board: Board, role: PlayerRole) {
  return board.visibility !== "shared" || role === "GM";
}

export function shouldShowBoardNameControl(board: Board, role: PlayerRole) {
  return canRenameBoard(board, role);
}
