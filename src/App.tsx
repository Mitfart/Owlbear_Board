import OBR, { type Item } from "@owlbear-rodeo/sdk";
import {
  Download,
  Grip,
  Minus,
  MousePointer2,
  Plus,
  RefreshCw,
  Settings,
  Trash2,
  Upload,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_CELL_SIZE,
  DEFAULT_WINDOW,
  MAX_CELL_SIZE,
  MIN_CELL_SIZE,
} from "./constants";
import {
  boardItemAt,
  collides,
  makeRectCells,
  pendingPlacementFromBounds,
  updateBoardItemPosition,
} from "./grid";
import { createId, nowIso } from "./ids";
import { previewImageUrl, previewKind, previewText, shapeStyle } from "./itemPreview";
import { addSnapshotToScene, itemBounds, resizeAction, selectedSceneItems } from "./owlbear";
import {
  deleteBoard,
  loadAllVisibleBoards,
  loadWindowPreferences,
  saveActiveBoardId,
  saveBoard,
  saveWindowPreferences,
} from "./storage";
import type { Board, BoardItem, BoardScope, PendingPlacement } from "./types";

type DragState = {
  itemId: string;
  offsetX: number;
  offsetY: number;
};

function createBoard(scope: BoardScope): Board {
  const timestamp = nowIso();
  return {
    id: createId("board"),
    name: scope === "scene" ? "Scene Board" : "Room Board",
    scope,
    cellSizePx: DEFAULT_CELL_SIZE,
    items: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function itemLabel(item: Item) {
  return item.name || item.type || "Scene item";
}

export default function App() {
  const [ready, setReady] = useState(!OBR.isAvailable);
  const [boards, setBoards] = useState<Board[]>([]);
  const [activeBoardId, setActiveBoardId] = useState<string>();
  const [pending, setPending] = useState<PendingPlacement[]>([]);
  const [pendingIndex, setPendingIndex] = useState(0);
  const [pan, setPan] = useState({ x: 260, y: 180 });
  const [zoom, setZoom] = useState(1);
  const [windowSize, setWindowSize] = useState(DEFAULT_WINDOW);
  const [status, setStatus] = useState("Open a board to begin.");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [contextItem, setContextItem] = useState<{
    item: BoardItem;
    x: number;
    y: number;
  }>();
  const [dragState, setDragState] = useState<DragState>();
  const [panning, setPanning] = useState<{ x: number; y: number }>();
  const [hoverGrid, setHoverGrid] = useState({ x: 0, y: 0 });
  const gridRef = useRef<HTMLDivElement>(null);

  const activeBoard = useMemo(
    () => boards.find((board) => board.id === activeBoardId) ?? boards[0],
    [activeBoardId, boards],
  );

  const activePending = pending[pendingIndex];

  const persistBoard = useCallback(
    async (board: Board) => {
      setBoards((current) =>
        current.some((candidate) => candidate.id === board.id)
          ? current.map((candidate) => (candidate.id === board.id ? board : candidate))
          : [...current, board],
      );
      if (OBR.isAvailable) await saveBoard(board, board.id);
    },
    [],
  );

  const refresh = useCallback(async () => {
    if (!OBR.isAvailable) {
      const demo = createBoard("scene");
      setBoards([demo]);
      setActiveBoardId(demo.id);
      setStatus("Running outside Owlbear. SDK actions are disabled.");
      return;
    }

    const [visibleBoards, preferences] = await Promise.all([
      loadAllVisibleBoards(),
      loadWindowPreferences(),
    ]);
    const nextBoards =
      visibleBoards.boards.length > 0 ? visibleBoards.boards : [createBoard("scene")];

    setBoards(nextBoards);
    setActiveBoardId(visibleBoards.activeBoardId ?? nextBoards[0]?.id);
    setWindowSize(preferences);
    await resizeAction(preferences.width, preferences.height);
    if (visibleBoards.boards.length === 0) await saveBoard(nextBoards[0], nextBoards[0].id);
    setStatus("Ready.");
  }, []);

  useEffect(() => {
    if (!OBR.isAvailable) {
      void refresh();
      return;
    }

    OBR.onReady(() => {
      setReady(true);
      void refresh();
    });
  }, [refresh]);

  async function addBoard(scope: BoardScope) {
    const board = createBoard(scope);
    await persistBoard(board);
    setActiveBoardId(board.id);
    setStatus(`Created ${board.name}.`);
  }

  async function removeActiveBoard() {
    if (!activeBoard) return;
    const nextBoards = boards.filter((board) => board.id !== activeBoard.id);
    setBoards(nextBoards);
    setActiveBoardId(nextBoards[0]?.id);
    if (OBR.isAvailable) await deleteBoard(activeBoard);
    setStatus(`Deleted ${activeBoard.name}.`);
  }

  async function updateActiveBoard(update: Partial<Board>) {
    if (!activeBoard) return;
    const board = { ...activeBoard, ...update, updatedAt: nowIso() };
    await persistBoard(board);
  }

  async function chooseBoard(id: string) {
    setActiveBoardId(id);
    const board = boards.find((candidate) => candidate.id === id);
    if (board && OBR.isAvailable) await saveActiveBoardId(board);
  }

  async function importSelection() {
    if (!activeBoard) return;
    if (!OBR.isAvailable) {
      setStatus("Import requires Owlbear scene selection.");
      return;
    }

    const items = await selectedSceneItems();
    if (!items.length) {
      setStatus("Select one or more scene items first.");
      return;
    }

    const placements: PendingPlacement[] = [];
    for (const item of items) {
      const bounds = await itemBounds([item.id]);
      placements.push(
        pendingPlacementFromBounds(
          item.id,
          structuredClone(item),
          bounds ?? { width: activeBoard.cellSizePx, height: activeBoard.cellSizePx },
          activeBoard.cellSizePx,
        ),
      );
    }

    setPending(placements);
    setPendingIndex(0);
    setStatus(`Place ${placements.length} imported item(s) on free cells.`);
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

  async function placePending(clientX: number, clientY: number) {
    if (!activeBoard || !activePending) return;
    const grid = pointerToGrid(clientX, clientY);
    if (
      collides(
        activeBoard,
        grid.x,
        grid.y,
        activePending.gridWidth,
        activePending.gridHeight,
      )
    ) {
      setStatus("Those cells are occupied.");
      return;
    }

    const timestamp = nowIso();
    const item: BoardItem = {
      id: createId("kanban_item"),
      sourceItemId: activePending.sourceItemId,
      snapshot: activePending.snapshot,
      gridX: grid.x,
      gridY: grid.y,
      gridWidth: activePending.gridWidth,
      gridHeight: activePending.gridHeight,
      occupiedCells: makeRectCells(
        grid.x,
        grid.y,
        activePending.gridWidth,
        activePending.gridHeight,
      ),
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    const board = {
      ...activeBoard,
      items: [...activeBoard.items, item],
      updatedAt: timestamp,
    };
    await persistBoard(board);

    if (pendingIndex + 1 >= pending.length) {
      setPending([]);
      setPendingIndex(0);
      setStatus("Import complete.");
    } else {
      setPendingIndex((value) => value + 1);
      setStatus(`Placed item ${pendingIndex + 1}. Place the next item.`);
    }
  }

  async function moveItem(itemId: string, clientX: number, clientY: number) {
    if (!activeBoard) return;
    const item = activeBoard.items.find((candidate) => candidate.id === itemId);
    if (!item) return;
    const grid = pointerToGrid(clientX, clientY);
    if (collides(activeBoard, grid.x, grid.y, item.gridWidth, item.gridHeight, item.id)) {
      setStatus("Move rejected: cells are occupied.");
      return;
    }

    const board = {
      ...activeBoard,
      items: activeBoard.items.map((candidate) =>
        candidate.id === item.id ? updateBoardItemPosition(candidate, grid.x, grid.y) : candidate,
      ),
      updatedAt: nowIso(),
    };
    await persistBoard(board);
  }

  async function deleteItem(itemId: string) {
    if (!activeBoard) return;
    const board = {
      ...activeBoard,
      items: activeBoard.items.filter((item) => item.id !== itemId),
      updatedAt: nowIso(),
    };
    await persistBoard(board);
    setContextItem(undefined);
    setStatus("Removed from Kanban.");
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
    setContextItem(undefined);
    if (activePending) return;

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
    setHoverGrid(pointerToGrid(event.clientX, event.clientY));
    if (panning) {
      setPan({ x: event.clientX - panning.x, y: event.clientY - panning.y });
    }
  }

  async function handleGridPointerUp(event: React.PointerEvent<HTMLDivElement>) {
    if (activePending) {
      await placePending(event.clientX, event.clientY);
    } else if (dragState) {
      await moveItem(
        dragState.itemId,
        event.clientX - dragState.offsetX,
        event.clientY - dragState.offsetY,
      );
    }

    setDragState(undefined);
    setPanning(undefined);
  }

  function handleWheel(event: React.WheelEvent<HTMLDivElement>) {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    setZoom((value) => Math.min(2, Math.max(0.45, value + (event.deltaY < 0 ? 0.1 : -0.1))));
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
  const pendingInvalid =
    !!activeBoard &&
    !!activePending &&
    collides(
      activeBoard,
      hoverGrid.x,
      hoverGrid.y,
      activePending.gridWidth,
      activePending.gridHeight,
    );

  if (!ready) {
    return <div className="loading">Loading Kanban...</div>;
  }

  return (
    <main className="app" style={{ width: windowSize.width, height: windowSize.height }}>
      <header className="toolbar">
        <div className="boardControls">
          <select
            aria-label="Board"
            value={activeBoard?.id ?? ""}
            onChange={(event) => void chooseBoard(event.target.value)}
          >
            {boards.map((board) => (
              <option key={board.id} value={board.id}>
                {board.name} · {board.scope}
              </option>
            ))}
          </select>
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

        <div className="tools">
          <button title="Add selected from scene" onClick={() => void importSelection()}>
            <Upload size={16} /> Add selected
          </button>
          <button title="Zoom out" onClick={() => setZoom((value) => Math.max(0.45, value - 0.1))}>
            <Minus size={16} />
          </button>
          <span className="zoom">{Math.round(zoom * 100)}%</span>
          <button title="Zoom in" onClick={() => setZoom((value) => Math.min(2, value + 0.1))}>
            <Plus size={16} />
          </button>
          <button title="Reset view" onClick={() => setPan({ x: 260, y: 180 })}>
            <RefreshCw size={16} />
          </button>
          <button title="Settings" onClick={() => setSettingsOpen((value) => !value)}>
            <Settings size={16} />
          </button>
        </div>
      </header>

      {settingsOpen && activeBoard && (
        <section className="settings">
          <label>
            Name
            <input
              value={activeBoard.name}
              onChange={(event) => void updateActiveBoard({ name: event.target.value })}
            />
          </label>
          <label>
            Cell size
            <input
              type="number"
              min={MIN_CELL_SIZE}
              max={MAX_CELL_SIZE}
              value={activeBoard.cellSizePx}
              onChange={(event) =>
                void updateActiveBoard({
                  cellSizePx: Math.min(
                    MAX_CELL_SIZE,
                    Math.max(MIN_CELL_SIZE, Number(event.target.value)),
                  ),
                })
              }
            />
          </label>
          <span className="scope">Scope: {activeBoard.scope}</span>
        </section>
      )}

      <div
        ref={gridRef}
        className={`gridSurface ${activePending ? "placing" : ""}`}
        onPointerDown={handleGridPointerDown}
        onPointerMove={handleGridPointerMove}
        onPointerUp={(event) => void handleGridPointerUp(event)}
        onWheel={handleWheel}
        onContextMenu={(event) => {
          event.preventDefault();
          if (!activeBoard) return;
          const grid = pointerToGrid(event.clientX, event.clientY);
          const item = boardItemAt(activeBoard, grid.x, grid.y);
          if (item) setContextItem({ item, x: event.clientX, y: event.clientY });
        }}
      >
        <div
          className="gridPlane"
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            backgroundSize: `${activeBoard?.cellSizePx ?? DEFAULT_CELL_SIZE}px ${activeBoard?.cellSizePx ?? DEFAULT_CELL_SIZE}px`,
          }}
        >
          {activeBoard?.items.map((item) => (
            <KanbanItem
              key={item.id}
              item={item}
              cellSize={activeBoard.cellSizePx}
              onExport={() => void addSnapshotToScene(item.snapshot)}
            />
          ))}
          {activePending && (
            <div
              className={`pendingHint ${pendingInvalid ? "invalid" : ""}`}
              style={{
                left: hoverGrid.x * (activeBoard?.cellSizePx ?? DEFAULT_CELL_SIZE),
                top: hoverGrid.y * (activeBoard?.cellSizePx ?? DEFAULT_CELL_SIZE),
                width: activePending.gridWidth * (activeBoard?.cellSizePx ?? DEFAULT_CELL_SIZE),
                height: activePending.gridHeight * (activeBoard?.cellSizePx ?? DEFAULT_CELL_SIZE),
              }}
            >
              <MousePointer2 size={18} />
              {pendingInvalid ? "Occupied" : "Click free cells"}
            </div>
          )}
        </div>
        <div className="surfaceHud">
          <span>{activeBoard?.items.length ?? 0} items</span>
          <span>{Math.round(cellSize)} px cells</span>
          {activePending && (
            <span>
              placing {pendingIndex + 1}/{pending.length}: {itemLabel(activePending.snapshot)}
            </span>
          )}
        </div>
      </div>

      {contextItem && (
        <div className="contextMenu" style={{ left: contextItem.x, top: contextItem.y }}>
          <button onClick={() => void deleteItem(contextItem.item.id)}>
            <Trash2 size={15} /> Delete from Kanban
          </button>
        </div>
      )}

      <footer className="status">
        <span>{status}</span>
        <span>
          {windowSize.width} x {windowSize.height}
        </span>
      </footer>
      <div className="resizeGrip" onPointerDown={startResize} title="Resize window">
        <Grip size={18} />
      </div>
    </main>
  );
}

function KanbanItem({
  item,
  cellSize,
  onExport,
}: {
  item: BoardItem;
  cellSize: number;
  onExport: () => void;
}) {
  const kind = previewKind(item.snapshot);
  return (
    <article
      className="kanbanItem"
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData("text/plain", item.id);
        event.dataTransfer.effectAllowed = "copy";
      }}
      onDoubleClick={onExport}
      style={{
        left: item.gridX * cellSize,
        top: item.gridY * cellSize,
        width: item.gridWidth * cellSize,
        height: item.gridHeight * cellSize,
      }}
      title="Double-click to copy to scene"
    >
      <button className="exportButton" title="Copy to scene" onClick={onExport}>
        <Download size={14} />
      </button>
      {kind === "image" && <img src={previewImageUrl(item.snapshot)} alt={previewText(item.snapshot)} />}
      {kind === "text" && <div className="textPreview">{previewText(item.snapshot)}</div>}
      {kind === "shape" && <div className="shapePreview" style={shapeStyle(item.snapshot)} />}
      {kind === "generic" && <div className="genericPreview">{previewText(item.snapshot)}</div>}
    </article>
  );
}
