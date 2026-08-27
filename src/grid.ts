import type { Board, BoardItem } from "./types";

export function makeRectCells(
  gridX: number,
  gridY: number,
  gridWidth: number,
  gridHeight: number,
): { x: number; y: number }[] {
  const cells: { x: number; y: number }[] = [];
  for (let y = gridY; y < gridY + gridHeight; y += 1) {
    for (let x = gridX; x < gridX + gridWidth; x += 1) {
      cells.push({ x, y });
    }
  }
  return cells;
}

export function cellKey(cell: { x: number; y: number }) {
  return `${cell.x}:${cell.y}`;
}

export function boardItemCells(item: BoardItem) {
  return makeRectCells(item.gridX, item.gridY, item.gridWidth, item.gridHeight);
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
    for (const cell of boardItemCells(item)) {
      occupied.add(cellKey(cell));
    }
  }

  return makeRectCells(gridX, gridY, gridWidth, gridHeight).some((cell) =>
    occupied.has(cellKey(cell)),
  );
}

export function boardItemAt(board: Board, gridX: number, gridY: number) {
  return board.items.find((item) =>
    boardItemCells(item).some((cell) => cell.x === gridX && cell.y === gridY),
  );
}

function removeDerivedOccupancy(item: BoardItem) {
  const { occupiedCells: _legacyOccupiedCells, ...withoutDerivedOccupancy } = item as BoardItem & { occupiedCells?: unknown };
  return withoutDerivedOccupancy;
}

export function updateBoardItemPosition(
  item: BoardItem,
  gridX: number,
  gridY: number,
): BoardItem {
  const withoutDerivedOccupancy = removeDerivedOccupancy(item);
  return {
    ...withoutDerivedOccupancy,
    gridX,
    gridY,
    updatedAt: new Date().toISOString(),
  };
}

export function updateBoardItemRect(
  item: BoardItem,
  gridX: number,
  gridY: number,
  gridWidth: number,
  gridHeight: number,
): BoardItem {
  const withoutDerivedOccupancy = removeDerivedOccupancy(item);
  return {
    ...withoutDerivedOccupancy,
    gridX,
    gridY,
    gridWidth,
    gridHeight,
    updatedAt: new Date().toISOString(),
  };
}
