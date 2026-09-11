import { EXTENSION_ID } from "./constants";
import { firstFreeNear } from "./grid";
import type { Board, BoardItem } from "./types";

const CLIPBOARD_STORAGE_KEY = `${EXTENSION_ID}/clipboard`;

function cloneItem(item: BoardItem): BoardItem {
  return JSON.parse(JSON.stringify(item)) as BoardItem;
}

function isClipboardItem(value: unknown): value is BoardItem {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<BoardItem>;
  const isOptionalString = (candidate: unknown) => candidate === undefined || typeof candidate === "string";
  const isOptionalBoolean = (candidate: unknown) => candidate === undefined || typeof candidate === "boolean";
  const isOptionalInteger = (candidate: unknown) => candidate === undefined || typeof candidate === "number" && Number.isInteger(candidate);
  const isOptionalPositiveNumber = (candidate: unknown) => candidate === undefined || typeof candidate === "number" && Number.isFinite(candidate) && candidate > 0;
  const { gridX, gridY, gridWidth, gridHeight } = item;
  if (typeof item.id !== "string" || typeof item.updatedAt !== "string"
    || typeof gridX !== "number" || !Number.isInteger(gridX)
    || typeof gridY !== "number" || !Number.isInteger(gridY)
    || typeof gridWidth !== "number" || !Number.isInteger(gridWidth) || gridWidth < 1
    || typeof gridHeight !== "number" || !Number.isInteger(gridHeight) || gridHeight < 1
    || !isOptionalString(item.borderColor)) return false;
  if (item.type === "text") return isOptionalString(item.text) && isOptionalPositiveNumber(item.textBaselineWidth)
    && isOptionalPositiveNumber(item.fontSize) && isOptionalString(item.textColor) && isOptionalBoolean(item.fillBlock)
    && (item.textVerticalAlignment === undefined || ["top", "center", "bottom"].includes(item.textVerticalAlignment));
  if (item.type === "image") return isOptionalString(item.imageUrl)
    && (item.imageFit === undefined || item.imageFit === "cover" || item.imageFit === "contain");
  if (item.type !== "counter") return false;
  const positions = ["top-left", "top-center", "top-right", "bottom-left", "bottom-center", "bottom-right"];
  const valueValid = isOptionalInteger(item.counterValue) && isOptionalInteger(item.counterMin) && isOptionalInteger(item.counterMax)
    && (item.counterMin === undefined || item.counterMax === undefined || item.counterMin <= item.counterMax)
    && (item.counterValue === undefined || item.counterMin === undefined || item.counterValue >= item.counterMin)
    && (item.counterValue === undefined || item.counterMax === undefined || item.counterValue <= item.counterMax);
  return valueValid && isOptionalString(item.counterLabel)
    && (item.counterLabelPosition === undefined || positions.includes(item.counterLabelPosition))
    && isOptionalBoolean(item.counterMinColorEnabled) && isOptionalString(item.counterMinColor)
    && isOptionalBoolean(item.counterMaxColorEnabled) && isOptionalString(item.counterMaxColor)
    && isOptionalBoolean(item.counterDimAtZero);
}

export function saveClipboard(item: BoardItem) {
  try {
    localStorage.setItem(CLIPBOARD_STORAGE_KEY, JSON.stringify(cloneItem(item)));
    return true;
  } catch {
    return false;
  }
}

export function loadClipboard(): BoardItem | undefined {
  try {
    const raw = localStorage.getItem(CLIPBOARD_STORAGE_KEY);
    if (!raw) return undefined;
    const item: unknown = JSON.parse(raw);
    return isClipboardItem(item) ? cloneItem(item) : undefined;
  } catch {
    return undefined;
  }
}

export function createPastedBoardItem(item: BoardItem, position: { x: number; y: number }, id: string, updatedAt: string): BoardItem {
  return { ...cloneItem(item), id, gridX: position.x, gridY: position.y, updatedAt };
}

export function preparePastedBoardItem(board: Board, item: BoardItem, target: { x: number; y: number }, id: string, updatedAt: string) {
  return createPastedBoardItem(item, firstFreeNear(board, target.x, target.y, item.gridWidth, item.gridHeight), id, updatedAt);
}

export function centeredPasteTarget(item: Pick<BoardItem, "gridWidth" | "gridHeight">, target: { x: number; y: number }) {
  return { x: target.x - Math.floor(item.gridWidth / 2), y: target.y - Math.floor(item.gridHeight / 2) };
}

export function canHandleBoardShortcut(event: Pick<KeyboardEvent, "target">, editorOpen: boolean) {
  const target = event.target;
  return !editorOpen && !(target instanceof Element && !!target.closest("input, textarea, select, [contenteditable='true']"));
}

export function boardClipboardCommand(event: Pick<KeyboardEvent, "ctrlKey" | "metaKey" | "code">) {
  if (!event.ctrlKey && !event.metaKey) return undefined;
  if (event.code === "KeyC") return "copy";
  if (event.code === "KeyV") return "paste";
  return undefined;
}
