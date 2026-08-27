export type BoardScope = "scene" | "room";
export type BoardVisibility = "private" | "shared" | "gm-shared";
export type BoardItemType = "text" | "image" | "counter";

export type OccupiedCell = {
  x: number;
  y: number;
};

export type BoardItem = {
  id: string;
  type: BoardItemType;
  text?: string;
  textBaselineWidth?: number;
  textBaselineHeight?: number;
  fillBlock?: boolean;
  textVerticalAlignment?: "top" | "center" | "bottom";
  imageUrl?: string;
  borderColor?: string;
  imageFit?: "cover" | "contain";
  counterLabel?: string;
  counterLabelPosition?: "top-left" | "top-center" | "top-right" | "bottom-left" | "bottom-center" | "bottom-right";
  counterValue?: number;
  counterMax?: number;
  counterZeroColorEnabled?: boolean;
  counterZeroColor?: string;
  counterMaxColorEnabled?: boolean;
  counterMaxColor?: string;
  counterDimAtZero?: boolean;
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
  ownerName?: string;
  showToGM?: boolean;
  sceneKey?: string;
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
  textAlignment?: 0 | 1 | 2 | 3;
};

export type WindowPreferences = {
  width: number;
  height: number;
};
