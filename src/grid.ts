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

export function firstFreeNear(board: Board, gridX: number, gridY: number, gridWidth: number, gridHeight: number) {
  if (!collides(board, gridX, gridY, gridWidth, gridHeight)) return { x: gridX, y: gridY };
  for (let radius = 1; ; radius += 1) {
    for (let y = gridY - radius; y <= gridY + radius; y += 1) {
      for (let x = gridX - radius; x <= gridX + radius; x += 1) {
        if (!collides(board, x, y, gridWidth, gridHeight)) return { x, y };
      }
    }
  }
}

export function moveAlongFreePath(board: Board, item: BoardItem, target: { x: number; y: number }) {
  const deltaX = target.x - item.gridX;
  const deltaY = target.y - item.gridY;
  const steps = Math.max(Math.abs(deltaX), Math.abs(deltaY));
  let position = { x: item.gridX, y: item.gridY };
  for (let step = 1; step <= steps; step += 1) {
    const candidate = {
      x: Math.round(item.gridX + deltaX * step / steps),
      y: Math.round(item.gridY + deltaY * step / steps),
    };
    if (candidate.x === position.x && candidate.y === position.y) continue;
    if (collides(board, candidate.x, candidate.y, item.gridWidth, item.gridHeight, item.id)) break;
    position = candidate;
  }
  return position;
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
  return {
    ...item,
    gridX,
    gridY,
    gridWidth,
    gridHeight,
    updatedAt: new Date().toISOString(),
  };
}
