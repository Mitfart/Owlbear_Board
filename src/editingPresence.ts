import type { Board } from "./types";
import { canViewBoard, type PlayerRole } from "./boardPermissions";

export type EditPresence = { playerId: string; playerName: string; boardId: string; itemId: string; expiresAt: number };

export function shouldBroadcastEditPresence(_board: Board) { return true; }

export function visibleEditPresence(presence: EditPresence, board: Board | undefined, viewerRole: PlayerRole, viewerId: string, now = Date.now()) {
  if (!board || presence.expiresAt <= now || presence.boardId !== board.id) return false;
  return canViewBoard(board, viewerRole, viewerId);
}

export function activeEditPresence(presence: EditPresence | undefined, now = Date.now()) {
  return presence && presence.expiresAt > now ? presence : undefined;
}
