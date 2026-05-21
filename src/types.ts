import type { Item } from "@owlbear-rodeo/sdk";

export type BoardScope = "scene" | "room";

export type OccupiedCell = {
  x: number;
  y: number;
};

export type BoardItem = {
  id: string;
  sourceItemId: string;
  snapshot: Item;
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

export type PendingPlacement = {
  sourceItemId: string;
  snapshot: Item;
  gridWidth: number;
  gridHeight: number;
};
