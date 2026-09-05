import type { Board } from "./types";

export type EditPresence = { playerId: string; playerName: string; boardId: string; itemId: string; expiresAt: number };

export function visibleEditPresence(presence: EditPresence, board: Board | undefined, viewerRole: "GM" | "PLAYER", viewerId: string, now = Date.now()) {
  if (!board || presence.expiresAt <= now || presence.boardId !== board.id) return false;
  return viewerRole === "GM" || board.visibility === "shared" || board.allowedUserIds?.includes(viewerId) === true;
}

export function activeEditPresence(presence: EditPresence | undefined, now = Date.now()) {
  return presence && presence.expiresAt > now ? presence : undefined;
}
