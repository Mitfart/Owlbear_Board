import type { Board } from "./types";
import { canViewBoard, type PlayerRole } from "./boardPermissions";

export type EditPresence = { playerId: string; playerName: string; boardId: string; itemId: string; expiresAt: number };

// Owlbear broadcasts are delivered room-wide. Never put a private board's ID or
// editor identity on that transport, because a client without access still
// receives the payload before it can apply local visibility checks.
export function shouldBroadcastEditPresence(board: Board) { return board.visibility === "shared"; }

export function visibleEditPresence(presence: EditPresence, board: Board | undefined, viewerRole: PlayerRole, viewerId: string, now = Date.now()) {
  if (!board || presence.expiresAt <= now || presence.boardId !== board.id) return false;
  return canViewBoard(board, viewerRole, viewerId);
}

export function activeEditPresence(presence: EditPresence | undefined, now = Date.now()) {
  return presence && presence.expiresAt > now ? presence : undefined;
}
