import type { Board, BoardItem } from "./types";

export function updateBoardItem(board: Board, itemId: string, update: (item: BoardItem) => BoardItem): Board {
  return { ...board, items: board.items.map((item) => item.id === itemId ? update(item) : item) };
}
