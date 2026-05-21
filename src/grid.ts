import type { Board, BoardItem, OccupiedCell, PendingPlacement } from "./types";

export function makeRectCells(
  gridX: number,
  gridY: number,
  gridWidth: number,
  gridHeight: number,
): OccupiedCell[] {
  const cells: OccupiedCell[] = [];
  for (let y = gridY; y < gridY + gridHeight; y += 1) {
    for (let x = gridX; x < gridX + gridWidth; x += 1) {
      cells.push({ x, y });
    }
  }
  return cells;
}

export function cellKey(cell: OccupiedCell) {
  return `${cell.x}:${cell.y}`;
}

export function collides(
  board: Board,
  gridX: number,
  gridY: number,
  gridWidth: number,
  gridHeight: number,
  ignoreItemId?: string,
) {
  const occupied = new Set<string>();
  for (const item of board.items) {
    if (item.id === ignoreItemId) continue;
    for (const cell of item.occupiedCells) {
      occupied.add(cellKey(cell));
    }
  }

  return makeRectCells(gridX, gridY, gridWidth, gridHeight).some((cell) =>
    occupied.has(cellKey(cell)),
  );
}

export function boardItemAt(board: Board, gridX: number, gridY: number) {
  return board.items.find((item) =>
    item.occupiedCells.some((cell) => cell.x === gridX && cell.y === gridY),
  );
}

export function updateBoardItemPosition(
  item: BoardItem,
  gridX: number,
  gridY: number,
): BoardItem {
  return {
    ...item,
    gridX,
    gridY,
    occupiedCells: makeRectCells(gridX, gridY, item.gridWidth, item.gridHeight),
    updatedAt: new Date().toISOString(),
  };
}

export function pendingPlacementFromBounds(
  sourceItemId: string,
  snapshot: PendingPlacement["snapshot"],
  bounds: { width: number; height: number },
  cellSizePx: number,
): PendingPlacement {
  return {
    sourceItemId,
    snapshot,
    gridWidth: Math.max(1, Math.ceil(bounds.width / cellSizePx)),
    gridHeight: Math.max(1, Math.ceil(bounds.height / cellSizePx)),
  };
}
