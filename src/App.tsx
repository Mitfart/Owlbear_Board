import OBR from "@owlbear-rodeo/sdk";
import type { Theme } from "@owlbear-rodeo/sdk";
import {
  Grip,
  ImagePlus,
  Maximize2,
  Minus,
  Plus,
  RefreshCw,
  Settings,
  Trash2,
  Type,
} from "lucide-react";
import type { CSSProperties } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_CELL_SIZE,
  DEFAULT_WINDOW,
  MAX_CELL_SIZE,
  MIN_CELL_SIZE,
} from "./constants";
import { boardItemAt, collides, makeRectCells, updateBoardItemPosition, updateBoardItemRect } from "./grid";
import { createId, nowIso } from "./ids";
import { resizeAction } from "./owlbear";
import { autoImageSize, autoTextSize, clampNumber, parseItemSize } from "./sizing";
import {
  deleteBoard,
  loadAllVisibleBoards,
  loadWindowPreferences,
  saveActiveBoardId,
  saveBoard,
  saveWindowPreferences,
} from "./storage";
import type { Board, BoardItem, BoardScope } from "./types";

type DragState = {
  itemId: string;
  offsetX: number;
  offsetY: number;
};

type ResizeItemState = {
  itemId: string;
  gridX: number;
  gridY: number;
  gridWidth: number;
  gridHeight: number;
};

type LegacyBoardItem = Partial<BoardItem> & {
  sourceItemId?: string;
  snapshot?: {
    type?: string;
    name?: string;
    image?: { url?: string };
    text?: { plainText?: string };
  };
};

const DEFAULT_ZOOM = 0.6;
const MIN_ZOOM = 0.35;
const MAX_ZOOM = 2;
const DEFAULT_PAN = { x: 260, y: 180 };
const SAMPLE_IMAGE =
  "https://images.unsplash.com/photo-1549880338-65ddcdfd017b?auto=format&fit=crop&w=900&q=80";
const AUTO_SIZE = "auto";
const DEFAULT_ITEM_BORDER_COLOR = "#bb99ff";
const FALLBACK_THEME: Theme = {
  mode: "DARK",
  primary: {
    main: "#bb99ff",
    light: "#d2bdff",
    dark: "#826bb2",
    contrastText: "#ffffff",
  },
  secondary: {
    main: "#03dac6",
    light: "#66fff8",
    dark: "#00a896",
    contrastText: "#ffffff",
  },
  background: {
    default: "#1e2231",
    paper: "#2c3042",
  },
  text: {
    primary: "#ffffff",
    secondary: "#ffffff",
    disabled: "#ffffff",
  },
};

function createItemBase(gridX: number, gridY: number, gridWidth: number, gridHeight: number) {
  const timestamp = nowIso();
  return {
    id: createId("kanban_item"),
    gridX,
    gridY,
    gridWidth,
    gridHeight,
    occupiedCells: makeRectCells(gridX, gridY, gridWidth, gridHeight),
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function sampleItems(): BoardItem[] {
  return [
    {
      ...createItemBase(0, 0, 3, 1),
      type: "text",
      text: "Opening clue",
      borderColor: DEFAULT_ITEM_BORDER_COLOR,
    },
    {
      ...createItemBase(3, 0, 2, 2),
      type: "image",
      imageUrl: SAMPLE_IMAGE,
      text: "Mountain pass",
      borderColor: DEFAULT_ITEM_BORDER_COLOR,
    },
    {
      ...createItemBase(0, 2, 2, 1),
      type: "text",
      text: "NPC reaction",
      borderColor: DEFAULT_ITEM_BORDER_COLOR,
    },
  ];
}

function migrateItem(item: LegacyBoardItem): BoardItem {
  if (item.type === "text" || item.type === "image") {
    return {
      ...(item as BoardItem),
      occupiedCells:
        item.occupiedCells ??
        makeRectCells(item.gridX ?? 0, item.gridY ?? 0, item.gridWidth ?? 1, item.gridHeight ?? 1),
      borderColor: item.borderColor ?? DEFAULT_ITEM_BORDER_COLOR,
    };
  }

  const snapshot = item.snapshot;
  const timestamp = nowIso();
  const gridX = item.gridX ?? 0;
  const gridY = item.gridY ?? 0;
  const gridWidth = item.gridWidth ?? 1;
  const gridHeight = item.gridHeight ?? 1;
  const imageUrl = snapshot?.image?.url;
  const text = snapshot?.text?.plainText?.trim() || snapshot?.name || snapshot?.type || "Kanban item";

  return {
    id: item.id ?? createId("kanban_item"),
    type: imageUrl ? "image" : "text",
    text,
    imageUrl,
    borderColor: item.borderColor ?? DEFAULT_ITEM_BORDER_COLOR,
    gridX,
    gridY,
    gridWidth,
    gridHeight,
    occupiedCells: makeRectCells(gridX, gridY, gridWidth, gridHeight),
    createdAt: item.createdAt ?? timestamp,
    updatedAt: timestamp,
  };
}

function migrateBoard(board: Board): Board {
  return {
    ...board,
    items: (board.items as LegacyBoardItem[]).map(migrateItem),
  };
}

function createBoard(scope: BoardScope, withSamples = false): Board {
  const timestamp = nowIso();
  return {
    id: createId("board"),
    name: scope === "scene" ? "Scene Board" : "Room Board",
    scope,
    cellSizePx: DEFAULT_CELL_SIZE,
    items: withSamples ? sampleItems() : [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export default function App() {
  const [ready, setReady] = useState(!OBR.isAvailable);
  const [boards, setBoards] = useState<Board[]>([]);
  const [activeBoardId, setActiveBoardId] = useState<string>();
  const [pan, setPan] = useState(DEFAULT_PAN);
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);
  const [windowSize, setWindowSize] = useState(DEFAULT_WINDOW);
  const [boardPanelOpen, setBoardPanelOpen] = useState(false);
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [addItemType, setAddItemType] = useState<BoardItem["type"]>("text");
  const [textDraft, setTextDraft] = useState("New note");
  const [imageDraft, setImageDraft] = useState("");
  const [borderColorDraft, setBorderColorDraft] = useState(DEFAULT_ITEM_BORDER_COLOR);
  const [itemWidth, setItemWidth] = useState(AUTO_SIZE);
  const [itemHeight, setItemHeight] = useState(AUTO_SIZE);
  const [imagePreviewSize, setImagePreviewSize] = useState<{ width: number; height: number }>();
  const [contextItem, setContextItem] = useState<{ item: BoardItem; x: number; y: number }>();
  const [dragState, setDragState] = useState<DragState>();
  const [resizeItemState, setResizeItemState] = useState<ResizeItemState>();
  const [panning, setPanning] = useState<{ x: number; y: number }>();
  const [, setTheme] = useState(FALLBACK_THEME);
  const gridRef = useRef<HTMLDivElement>(null);

  const activeBoard = useMemo(
    () => boards.find((board) => board.id === activeBoardId) ?? boards[0],
    [activeBoardId, boards],
  );
  const themeVars = useMemo(
    () =>
      ({
        "--bg": "#1e2231",
        "--surface": "#202435",
        "--panel": "#25293c",
        "--panel-soft": "#1c2030",
        "--panel-raised": "#2c3042",
        "--border": "rgba(187, 153, 255, 0.14)",
        "--border-strong": "rgba(187, 153, 255, 0.28)",
        "--text": "#ffffff",
        "--muted": "#ffffff",
        "--muted-2": "#ffffff",
        "--accent": "#bb99ff",
        "--accent-strong": "#d2bdff",
        "--accent-dark": "#826bb2",
        "--accent-soft": "rgba(187, 153, 255, 0.16)",
        "--danger": "#ff6b8a",
        "--shadow": "rgba(4, 6, 14, 0.42)",
      }) as CSSProperties,
    [],
  );

  const persistBoard = useCallback(async (board: Board) => {
    setBoards((current) =>
      current.some((candidate) => candidate.id === board.id)
        ? current.map((candidate) => (candidate.id === board.id ? board : candidate))
        : [...current, board],
    );
    if (OBR.isAvailable) await saveBoard(board, board.id);
  }, []);

  const refresh = useCallback(async () => {
    if (!OBR.isAvailable) {
      const demo = createBoard("scene", true);
      setBoards([demo]);
      setActiveBoardId(demo.id);
      return;
    }

    const [visibleBoards, preferences] = await Promise.all([
      loadAllVisibleBoards(),
      loadWindowPreferences(),
    ]);
    const createdInitialBoard = visibleBoards.boards.length === 0;
    const nextBoards = createdInitialBoard
      ? [createBoard("scene", true)]
      : visibleBoards.boards.map(migrateBoard);

    setBoards(nextBoards);
    setActiveBoardId(visibleBoards.activeBoardId ?? nextBoards[0]?.id);
    setWindowSize(preferences);
    await resizeAction(preferences.width, preferences.height);

    if (createdInitialBoard) await saveBoard(nextBoards[0], nextBoards[0].id);
    else {
      await Promise.all(
        nextBoards.map((board) =>
          saveBoard(board, visibleBoards.activeBoardId ?? nextBoards[0]?.id),
        ),
      );
    }
  }, []);

  useEffect(() => {
    if (!OBR.isAvailable) {
      void refresh();
      return;
    }

    OBR.onReady(() => {
      setReady(true);
      void refresh();
      void OBR.theme.getTheme().then(setTheme);
    });
  }, [refresh]);

  useEffect(() => {
    if (!OBR.isAvailable || !ready) return;
    return OBR.theme.onChange(setTheme);
  }, [ready]);

  async function addBoard(scope: BoardScope) {
    const board = createBoard(scope);
    await persistBoard(board);
    setActiveBoardId(board.id);
  }

  async function removeActiveBoard() {
    if (!activeBoard) return;
    const nextBoards = boards.filter((board) => board.id !== activeBoard.id);
    setBoards(nextBoards);
    setActiveBoardId(nextBoards[0]?.id);
    if (OBR.isAvailable) await deleteBoard(activeBoard);
  }

  async function updateActiveBoard(update: Partial<Board>) {
    if (!activeBoard) return;
    await persistBoard({ ...activeBoard, ...update, updatedAt: nowIso() });
  }

  async function chooseBoard(id: string) {
    setActiveBoardId(id);
    const board = boards.find((candidate) => candidate.id === id);
    if (board && OBR.isAvailable) await saveActiveBoardId(board);
    setBoardPanelOpen(false);
  }

  function pointerToGrid(clientX: number, clientY: number) {
    const rect = gridRef.current?.getBoundingClientRect();
    if (!rect || !activeBoard) return { x: 0, y: 0 };
    const cell = activeBoard.cellSizePx * zoom;
    return {
      x: Math.floor((clientX - rect.left - pan.x) / cell),
      y: Math.floor((clientY - rect.top - pan.y) / cell),
    };
  }

  function firstFreePosition(gridWidth: number, gridHeight: number) {
    if (!activeBoard) return { x: 0, y: 0 };
    for (let y = 0; y < 60; y += 1) {
      for (let x = 0; x < 60; x += 1) {
        if (!collides(activeBoard, x, y, gridWidth, gridHeight)) return { x, y };
      }
    }
    return { x: 0, y: 0 };
  }

  function resolveItemSize(type: BoardItem["type"], imageSize?: { width: number; height: number }) {
    const widthDraft = parseItemSize(itemWidth);
    const heightDraft = parseItemSize(itemHeight);
    const preferredWidth = widthDraft === AUTO_SIZE ? undefined : widthDraft;
    const preferredHeight = heightDraft === AUTO_SIZE ? undefined : heightDraft;
    const autoSize =
      type === "image"
        ? autoImageSize(
            imageSize?.width ?? imagePreviewSize?.width,
            imageSize?.height ?? imagePreviewSize?.height,
            preferredWidth,
            preferredHeight,
            activeBoard?.cellSizePx,
          )
        : autoTextSize(textDraft, preferredWidth);

    return {
      width: preferredWidth ?? autoSize.width,
      height: preferredHeight ?? autoSize.height,
    };
  }

  function resetAddItemFields() {
    setTextDraft("New note");
    setImageDraft("");
    setBorderColorDraft(DEFAULT_ITEM_BORDER_COLOR);
    setItemWidth(AUTO_SIZE);
    setItemHeight(AUTO_SIZE);
    setImagePreviewSize(undefined);
  }

  async function addKanbanItem(type: BoardItem["type"], source?: string, imageSize?: { width: number; height: number }) {
    if (!activeBoard) return;
    const size = resolveItemSize(type, imageSize);
    const gridWidth = clampNumber(size.width, 1, 24);
    const gridHeight = clampNumber(size.height, 1, 24);
    const position = firstFreePosition(gridWidth, gridHeight);
    const timestamp = nowIso();
    const item: BoardItem = {
      ...createItemBase(position.x, position.y, gridWidth, gridHeight),
      type,
      text: type === "text" ? textDraft.trim() || "New note" : "Image",
      imageUrl: type === "image" ? source?.trim() || imageDraft.trim() : undefined,
      borderColor: borderColorDraft,
      updatedAt: timestamp,
    };

    if (type === "image" && !item.imageUrl) return;

    await persistBoard({
      ...activeBoard,
      items: [...activeBoard.items, item],
      updatedAt: timestamp,
    });
    resetAddItemFields();
    setAddModalOpen(false);
  }

  async function pickOwlbearImage() {
    if (!OBR.isAvailable) return;
    const images = await OBR.assets.downloadImages(false, undefined, "PROP");
    const image = images[0]?.image;
    if (!image?.url) return;
    setImageDraft(image.url);
    await addKanbanItem("image", image.url, { width: image.width, height: image.height });
  }

  async function updateItemRect(
    itemId: string,
    gridX: number,
    gridY: number,
    gridWidth: number,
    gridHeight: number,
  ) {
    if (!activeBoard) return;
    const item = activeBoard.items.find((candidate) => candidate.id === itemId);
    if (!item) return;
    if (collides(activeBoard, gridX, gridY, gridWidth, gridHeight, item.id)) return;

    await persistBoard({
      ...activeBoard,
      items: activeBoard.items.map((candidate) =>
        candidate.id === item.id
          ? gridWidth === candidate.gridWidth && gridHeight === candidate.gridHeight
            ? updateBoardItemPosition(candidate, gridX, gridY)
            : updateBoardItemRect(candidate, gridX, gridY, gridWidth, gridHeight)
          : candidate,
      ),
      updatedAt: nowIso(),
    });
  }

  async function moveItem(itemId: string, clientX: number, clientY: number) {
    if (!activeBoard) return;
    const item = activeBoard.items.find((candidate) => candidate.id === itemId);
    if (!item) return;
    const grid = pointerToGrid(clientX, clientY);
    await updateItemRect(itemId, grid.x, grid.y, item.gridWidth, item.gridHeight);
  }

  async function deleteItem(itemId: string) {
    if (!activeBoard) return;
    await persistBoard({
      ...activeBoard,
      items: activeBoard.items.filter((item) => item.id !== itemId),
      updatedAt: nowIso(),
    });
    setContextItem(undefined);
  }

  async function updateItemBorderColor(itemId: string, borderColor: string) {
    if (!activeBoard) return;
    await persistBoard({
      ...activeBoard,
      items: activeBoard.items.map((item) =>
        item.id === itemId ? { ...item, borderColor, updatedAt: nowIso() } : item,
      ),
      updatedAt: nowIso(),
    });
    setContextItem((current) =>
      current?.item.id === itemId
        ? { ...current, item: { ...current.item, borderColor } }
        : current,
    );
  }

  async function resizeWindow(width: number, height: number) {
    const next = {
      width: Math.max(520, Math.round(width)),
      height: Math.max(420, Math.round(height)),
    };
    setWindowSize(next);
    if (!OBR.isAvailable) return;
    await saveWindowPreferences(next);
    await resizeAction(next.width, next.height);
  }

  function handleGridPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 && event.button !== 1) return;
    if (event.button === 1) event.preventDefault();
    setContextItem(undefined);

    if (event.button === 1) {
      setPanning({ x: event.clientX - pan.x, y: event.clientY - pan.y });
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }

    const grid = pointerToGrid(event.clientX, event.clientY);
    const item = activeBoard ? boardItemAt(activeBoard, grid.x, grid.y) : undefined;
    if (item) {
      const rect = gridRef.current?.getBoundingClientRect();
      const cell = (activeBoard?.cellSizePx ?? DEFAULT_CELL_SIZE) * zoom;
      setDragState({
        itemId: item.id,
        offsetX: event.clientX - ((rect?.left ?? 0) + pan.x + item.gridX * cell),
        offsetY: event.clientY - ((rect?.top ?? 0) + pan.y + item.gridY * cell),
      });
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }

    setPanning({ x: event.clientX - pan.x, y: event.clientY - pan.y });
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handleGridPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (resizeItemState && activeBoard) {
      const grid = pointerToGrid(event.clientX, event.clientY);
      const gridWidth = Math.max(1, grid.x - resizeItemState.gridX + 1);
      const gridHeight = Math.max(1, grid.y - resizeItemState.gridY + 1);
      if (!collides(activeBoard, resizeItemState.gridX, resizeItemState.gridY, gridWidth, gridHeight, resizeItemState.itemId)) {
        setResizeItemState({ ...resizeItemState, gridWidth, gridHeight });
      }
      return;
    }

    if (dragState && activeBoard) {
      const item = activeBoard.items.find((candidate) => candidate.id === dragState.itemId);
      if (!item) return;
      const grid = pointerToGrid(event.clientX - dragState.offsetX, event.clientY - dragState.offsetY);
      if (!collides(activeBoard, grid.x, grid.y, item.gridWidth, item.gridHeight, item.id)) {
        setBoards((current) =>
          current.map((board) =>
            board.id === activeBoard.id
              ? {
                  ...board,
                  items: board.items.map((candidate) =>
                    candidate.id === item.id ? updateBoardItemPosition(candidate, grid.x, grid.y) : candidate,
                  ),
                }
              : board,
          ),
        );
      }
      return;
    }

    if (panning) setPan({ x: event.clientX - panning.x, y: event.clientY - panning.y });
  }

  async function handleGridPointerUp(event: React.PointerEvent<HTMLDivElement>) {
    if (resizeItemState) {
      await updateItemRect(
        resizeItemState.itemId,
        resizeItemState.gridX,
        resizeItemState.gridY,
        resizeItemState.gridWidth,
        resizeItemState.gridHeight,
      );
    }

    if (dragState) {
      await moveItem(
        dragState.itemId,
        event.clientX - dragState.offsetX,
        event.clientY - dragState.offsetY,
      );
    }

    setDragState(undefined);
    setResizeItemState(undefined);
    setPanning(undefined);
  }

  function startItemResize(event: React.PointerEvent<HTMLElement>, item: BoardItem) {
    event.preventDefault();
    event.stopPropagation();
    setContextItem(undefined);
    setResizeItemState({
      itemId: item.id,
      gridX: item.gridX,
      gridY: item.gridY,
      gridWidth: item.gridWidth,
      gridHeight: item.gridHeight,
    });
    gridRef.current?.setPointerCapture(event.pointerId);
  }

  function handleWheel(event: React.WheelEvent<HTMLDivElement>) {
    event.preventDefault();
    setZoom((value) => clampNumber(value + (event.deltaY < 0 ? 0.05 : -0.05), MIN_ZOOM, MAX_ZOOM));
  }

  function resetView() {
    setPan(DEFAULT_PAN);
    setZoom(DEFAULT_ZOOM);
  }

  function startResize(event: React.PointerEvent<HTMLElement>) {
    const startX = event.clientX;
    const startY = event.clientY;
    const start = { ...windowSize };
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);

    const move = (moveEvent: PointerEvent) => {
      void resizeWindow(start.width + moveEvent.clientX - startX, start.height + moveEvent.clientY - startY);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  const cellSize = (activeBoard?.cellSizePx ?? DEFAULT_CELL_SIZE) * zoom;

  if (!ready) return <div className="loading">Loading Kanban...</div>;

  return (
    <main className="app" style={{ width: windowSize.width, height: windowSize.height, ...themeVars }}>
      <header className="toolbar">
        <div className="boardTitle">
          <button
            className="boardToggle"
            title="Board settings"
            onClick={() => setBoardPanelOpen((value) => !value)}
          >
            <Settings size={16} />
          </button>
          <div>
            <strong>{activeBoard?.name ?? "Kanban"}</strong>
            <span>{activeBoard?.scope ?? "scene"}</span>
          </div>
          {boardPanelOpen && activeBoard && (
            <section className="boardPanel">
              <label>
                Board
                <select
                  aria-label="Board"
                  value={activeBoard.id}
                  onChange={(event) => void chooseBoard(event.target.value)}
                >
                  {boards.map((board) => (
                    <option key={board.id} value={board.id}>
                      {board.name} · {board.scope}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Name
                <input value={activeBoard.name} onChange={(event) => void updateActiveBoard({ name: event.target.value })} />
              </label>
              <label>
                Cell
                <input
                  type="number"
                  min={MIN_CELL_SIZE}
                  max={MAX_CELL_SIZE}
                  value={activeBoard.cellSizePx}
                  onChange={(event) =>
                    void updateActiveBoard({
                      cellSizePx: clampNumber(Number(event.target.value), MIN_CELL_SIZE, MAX_CELL_SIZE),
                    })
                  }
                />
              </label>
              <div className="boardPanelActions">
                <button title="Create scene board" onClick={() => void addBoard("scene")}>
                  <Plus size={16} /> Scene
                </button>
                <button title="Create room board" onClick={() => void addBoard("room")}>
                  <Plus size={16} /> Room
                </button>
                <button title="Delete board" onClick={() => void removeActiveBoard()} disabled={!activeBoard}>
                  <Trash2 size={16} />
                </button>
              </div>
            </section>
          )}
        </div>

        <div className="tools">
          <button title="Add item" onClick={() => setAddModalOpen(true)}>
            <Plus size={16} /> Add
          </button>
          <button title="Zoom out" onClick={() => setZoom((value) => clampNumber(value - 0.1, MIN_ZOOM, MAX_ZOOM))}>
            <Minus size={16} />
          </button>
          <span className="zoom">{Math.round(zoom * 100)}%</span>
          <button title="Zoom in" onClick={() => setZoom((value) => clampNumber(value + 0.1, MIN_ZOOM, MAX_ZOOM))}>
            <Plus size={16} />
          </button>
          <button title="Reset view" onClick={resetView}>
            <RefreshCw size={16} />
          </button>
        </div>
      </header>

      <div
        ref={gridRef}
        className="gridSurface"
        onPointerDown={handleGridPointerDown}
        onPointerMove={handleGridPointerMove}
        onPointerUp={(event) => void handleGridPointerUp(event)}
        onWheel={handleWheel}
        onAuxClick={(event) => {
          if (event.button === 1) event.preventDefault();
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          if (!activeBoard) return;
          const grid = pointerToGrid(event.clientX, event.clientY);
          const item = boardItemAt(activeBoard, grid.x, grid.y);
          if (item) setContextItem({ item, x: event.clientX, y: event.clientY });
        }}
        style={{
          backgroundSize: `${cellSize}px ${cellSize}px`,
          backgroundPosition: `${pan.x}px ${pan.y}px`,
        }}
      >
        <div
          className="gridPlane"
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          }}
        >
          {activeBoard?.items.map((item) => (
            <KanbanItem
              key={item.id}
              item={
                resizeItemState?.itemId === item.id
                  ? { ...item, gridWidth: resizeItemState.gridWidth, gridHeight: resizeItemState.gridHeight }
                  : item
              }
              cellSize={activeBoard.cellSizePx}
              onResizePointerDown={startItemResize}
            />
          ))}
        </div>
        <div className="surfaceHud">
          <span>{activeBoard?.items.length ?? 0} items</span>
          <span>{Math.round(cellSize)} px cells</span>
        </div>
      </div>

      {contextItem && (
        <div className="contextMenu" style={{ left: contextItem.x, top: contextItem.y }}>
          <label className="colorMenuItem">
            Border
            <input
              type="color"
              value={contextItem.item.borderColor ?? DEFAULT_ITEM_BORDER_COLOR}
              onChange={(event) => void updateItemBorderColor(contextItem.item.id, event.target.value)}
            />
          </label>
          <button onClick={() => void deleteItem(contextItem.item.id)}>
            <Trash2 size={15} /> Delete
          </button>
        </div>
      )}

      {addModalOpen && (
        <div className="modalBackdrop" onPointerDown={() => setAddModalOpen(false)}>
          <section className="addModal" role="dialog" aria-modal="true" aria-label="Add item" onPointerDown={(event) => event.stopPropagation()}>
            <div className="modalHeader">
              <strong>Add item</strong>
              <button title="Close" onClick={() => setAddModalOpen(false)}>
                <Minus size={16} />
              </button>
            </div>
            <div className="itemTypeTabs" role="tablist" aria-label="Item type">
              <button
                className={addItemType === "text" ? "active" : undefined}
                role="tab"
                aria-selected={addItemType === "text"}
                onClick={() => setAddItemType("text")}
              >
                <Type size={16} /> Text
              </button>
              <button
                className={addItemType === "image" ? "active" : undefined}
                role="tab"
                aria-selected={addItemType === "image"}
                onClick={() => setAddItemType("image")}
              >
                <ImagePlus size={16} /> Image
              </button>
            </div>
            <div className="modalGrid">
              <label>
                W
                <input
                  inputMode="numeric"
                  placeholder="auto"
                  value={itemWidth}
                  onChange={(event) => setItemWidth(event.target.value)}
                  onBlur={() => setItemWidth((value) => (value.trim() ? value : AUTO_SIZE))}
                />
              </label>
              <label>
                H
                <input
                  inputMode="numeric"
                  placeholder="auto"
                  value={itemHeight}
                  onChange={(event) => setItemHeight(event.target.value)}
                  onBlur={() => setItemHeight((value) => (value.trim() ? value : AUTO_SIZE))}
                />
              </label>
              <label>
                Border
                <input
                  type="color"
                  value={borderColorDraft}
                  onChange={(event) => setBorderColorDraft(event.target.value)}
                />
              </label>
              {addItemType === "text" ? (
                <>
                  <label className="wideField">
                    Text
                    <input value={textDraft} onChange={(event) => setTextDraft(event.target.value)} />
                  </label>
                  <button className="primaryAction" title="Add text" onClick={() => void addKanbanItem("text")}>
                    <Type size={16} /> Add text
                  </button>
                </>
              ) : (
                <>
                  <label className="wideField">
                    Image URL
                    <input
                      value={imageDraft}
                      onChange={(event) => {
                        setImageDraft(event.target.value);
                        setImagePreviewSize(undefined);
                      }}
                    />
                  </label>
                  <button title="Pick Owlbear image" onClick={() => void pickOwlbearImage()} disabled={!OBR.isAvailable}>
                    <ImagePlus size={16} /> Owlbear
                  </button>
                  <div className="imageAddRow">
                    <button className="primaryAction" title="Add image" onClick={() => void addKanbanItem("image")}>
                      <ImagePlus size={16} /> Add
                    </button>
                  </div>
                  {imageDraft.trim() && (
                    <div className="imagePreviewPanel">
                      <img
                        src={imageDraft.trim()}
                        alt="Image preview"
                        onLoad={(event) =>
                          setImagePreviewSize({
                            width: event.currentTarget.naturalWidth,
                            height: event.currentTarget.naturalHeight,
                          })
                        }
                        onError={() => setImagePreviewSize(undefined)}
                      />
                    </div>
                  )}
                </>
              )}
            </div>
          </section>
        </div>
      )}

      <div className="resizeGrip" onPointerDown={startResize} title="Resize window">
        <Grip size={18} />
      </div>
    </main>
  );
}

function KanbanItem({
  item,
  cellSize,
  onResizePointerDown,
}: {
  item: BoardItem;
  cellSize: number;
  onResizePointerDown: (event: React.PointerEvent<HTMLElement>, item: BoardItem) => void;
}) {
  return (
    <article
      className={`kanbanItem ${item.type}`}
      style={{
        left: item.gridX * cellSize,
        top: item.gridY * cellSize,
        width: item.gridWidth * cellSize,
        height: item.gridHeight * cellSize,
        borderColor: item.borderColor ?? DEFAULT_ITEM_BORDER_COLOR,
      }}
      title={item.text}
    >
      {item.type === "image" && item.imageUrl ? (
        <img src={item.imageUrl} alt={item.text || "Kanban image"} />
      ) : (
        <div className="textPreview">{item.text}</div>
      )}
      <button className="itemResizeHandle" title="Resize item" onPointerDown={(event) => onResizePointerDown(event, item)}>
        <Maximize2 size={13} />
      </button>
    </article>
  );
}
