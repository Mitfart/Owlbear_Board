export type BoardScope = "scene" | "room";

export type OccupiedCell = {
  x: number;
  y: number;
};

export type BoardItem = {
  id: string;
  type: "text" | "image";
  text?: string;
  imageUrl?: string;
  borderColor?: string;
  gridX: number;
  gridY: number;
  gridWidth: number;
  gridHeight: number;
  occupiedCells: OccupiedCell[];
  createdAt: string;
  updatedAt: string;
};

export type Board = {
  id: string;
  name: string;
  scope: BoardScope;
  cellSizePx: number;
  cellGapPx: number;
  items: BoardItem[];
  createdAt: string;
  updatedAt: string;
};

export type PersistedKanbanState = {
  version: 1;
  boards: Board[];
  activeBoardId?: string;
};

export type WindowPreferences = {
  width: number;
  height: number;
};
