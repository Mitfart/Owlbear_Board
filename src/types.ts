export type BoardScope = "scene" | "room";
export type BoardVisibility = "private" | "shared";
export type BoardItemType = "text" | "image" | "counter";

export type BoardItem = {
  id: string;
  type: BoardItemType;
  text?: string;
  textBaselineWidth?: number;
  fontSize?: number;
  textColor?: string;
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
  updatedAt: string;
};

export type Board = {
  id: string;
  name: string;
  scope: BoardScope;
  visibility: BoardVisibility;
  ownerId?: string;
  ownerName?: string;
  /** UI-only access control. GMs always have access. */
  allowedUserIds?: string[];
  revision: number;
  cellSizePx: number;
  cellGapPx: number;
  items: BoardItem[];
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
  /** Legacy palette data. It is ignored when loading preferences. */
  customColors?: string[];
  /** Editable palette slots: "-" uses the Owlbear default at that index; hex values are custom colors. */
  colorPalette?: string[];
  /** Identifies the slot-based color palette format. Unmarked palettes are treated as legacy data. */
  colorPaletteFormat?: 2;
};

export type WindowPreferences = {
  width: number;
  height: number;
};
