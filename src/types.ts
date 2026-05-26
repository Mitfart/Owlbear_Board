export type BoardScope = "scene" | "room";
export type BoardVisibility = "private" | "shared";
export type BoardItemType = "text" | "image";

export type OccupiedCell = {
  x: number;
  y: number;
};

export type BoardItem = {
  id: string;
  type: BoardItemType;
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
  visibility: BoardVisibility;
  ownerId?: string;
  revision: number;
  cellSizePx: number;
  cellGapPx: number;
  items: BoardItem[];
  createdAt: string;
  updatedAt: string;
};

export type PersistedBoardState = {
  version: 1;
  boards: Board[];
};

export type ViewportPreference = {
  pan: { x: number; y: number };
  zoom: number;
};

export type PlayerPreferences = {
  version: 1;
  privateSceneOpenOrder: Record<string, string[]>;
  privateRoomOpenOrder: Record<string, string[]>;
  viewportByBoardId: Record<string, ViewportPreference>;
  previewDismissed?: boolean;
};

export type WindowPreferences = {
  width: number;
  height: number;
};
