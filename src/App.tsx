import OBR from "@owlbear-rodeo/sdk";
import type { Theme } from "@owlbear-rodeo/sdk";
import { Grip, ImagePlus, Maximize2, Minus, Pencil, Plus, RefreshCw, Settings, Trash2, Type } from "lucide-react";
import type React from "react";
import type { CSSProperties } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_CELL_GAP, DEFAULT_CELL_SIZE, DEFAULT_WINDOW, MAX_CELL_GAP, MAX_CELL_SIZE, MIN_CELL_GAP, MIN_CELL_SIZE } from "./constants";
import { boardItemAt, collides, makeRectCells, updateBoardItemPosition, updateBoardItemRect } from "./grid";
import { createId, nowIso } from "./ids";
import { MarkdownView } from "./markdown";
import { resizeAction } from "./owlbear";
import { autoImageSize, autoTextSize, clampNumber, parseItemSize } from "./sizing";
import { deleteBoard, getRoomOwnerId, getSceneKey, loadAllVisibleBoards, loadPreferences, loadWindowPreferences, markPrivateBoardOpened, orderPrivateBoards, saveBoard, savePreferences, saveViewport, saveWindowPreferences } from "./storage";
import type { Board, BoardItem, BoardScope, BoardVisibility, PlayerPreferences } from "./types";

type DragState = { itemId: string; offsetX: number; offsetY: number };
type ResizeItemState = { itemId: string; gridX: number; gridY: number; gridWidth: number; gridHeight: number };
type AddTarget = { x: number; y: number } | undefined;
type History = { undo: Board[]; redo: Board[] };

const DEFAULT_ZOOM = 0.6;
const MIN_ZOOM = 0.35;
const MAX_ZOOM = 2;
const DEFAULT_PAN = { x: 260, y: 180 };
const SAMPLE_IMAGE = "https://images.unsplash.com/photo-1549880338-65ddcdfd017b?auto=format&fit=crop&w=900&q=80";
const AUTO_SIZE = "auto";
const DEFAULT_ITEM_BORDER_COLOR = "#bb99ff";
const MAX_HISTORY = 20;
const FALLBACK_THEME: Theme = { mode: "DARK", primary: { main: "#bb99ff", light: "#d2bdff", dark: "#826bb2", contrastText: "#ffffff" }, secondary: { main: "#03dac6", light: "#66fff8", dark: "#00a896", contrastText: "#ffffff" }, background: { default: "#1e2231", paper: "#2c3042" }, text: { primary: "#ffffff", secondary: "#ffffff", disabled: "#ffffff" } };

function createItemBase(gridX: number, gridY: number, gridWidth: number, gridHeight: number) {
  const timestamp = nowIso();
  return { id: createId("board_item"), gridX, gridY, gridWidth, gridHeight, occupiedCells: makeRectCells(gridX, gridY, gridWidth, gridHeight), createdAt: timestamp, updatedAt: timestamp };
}

function sampleBoard(): Board {
  const timestamp = nowIso();
  return {
    id: "preview", name: "Preview Board", scope: "scene", visibility: "private", revision: 1, cellSizePx: DEFAULT_CELL_SIZE, cellGapPx: DEFAULT_CELL_GAP, createdAt: timestamp, updatedAt: timestamp,
    items: [
      { ...createItemBase(0, 0, 3, 2), type: "text", text: "## Clue\n- **Blood** on the door\n- A cold draft", borderColor: DEFAULT_ITEM_BORDER_COLOR },
      { ...createItemBase(4, 0, 3, 2), type: "image", imageUrl: SAMPLE_IMAGE, borderColor: "#03dac6" },
      { ...createItemBase(-2, 3, 3, 1), type: "text", text: "NPC reaction", borderColor: "#ffb86b" },
    ],
  };
}

function makeBoard(scope: BoardScope, visibility: BoardVisibility, name?: string, ownerId?: string): Board {
  const timestamp = nowIso();
  return { id: createId("board"), name: visibility === "shared" ? `Shared ${scope === "scene" ? "Scene" : "Room"} Board` : name || `New ${scope === "scene" ? "Scene" : "Room"} Board`, scope, visibility, ownerId, revision: 0, cellSizePx: DEFAULT_CELL_SIZE, cellGapPx: DEFAULT_CELL_GAP, items: [], createdAt: timestamp, updatedAt: timestamp };
}

function groupLabel(board: Board) {
  return `${board.visibility === "shared" ? "Shared" : "Private"} · ${board.scope === "scene" ? "Scene" : "Room"}`;
}

function firstFreeNear(board: Board, gridX: number, gridY: number, gridWidth: number, gridHeight: number) {
  if (!collides(board, gridX, gridY, gridWidth, gridHeight)) return { x: gridX, y: gridY };
  for (let radius = 1; radius < 80; radius += 1) {
    for (let y = gridY - radius; y <= gridY + radius; y += 1) {
      for (let x = gridX - radius; x <= gridX + radius; x += 1) {
        if (!collides(board, x, y, gridWidth, gridHeight)) return { x, y };
      }
    }
  }
  return { x: gridX, y: gridY };
}

export default function App() {
  const [ready, setReady] = useState(!OBR.isAvailable);
  const [boards, setBoards] = useState<Board[]>([]);
  const [preferences, setPreferences] = useState<PlayerPreferences>();
  const [sceneKey, setSceneKey] = useState("scene");
  const [activeBoardId, setActiveBoardId] = useState<string>();
  const [previewDismissed, setPreviewDismissed] = useState(false);
  const [pan, setPan] = useState(DEFAULT_PAN);
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);
  const [windowSize, setWindowSize] = useState(DEFAULT_WINDOW);
  const [boardPanelOpen, setBoardPanelOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("New Board");
  const [createScope, setCreateScope] = useState<BoardScope>("scene");
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [addItemType, setAddItemType] = useState<BoardItem["type"]>("text");
  const [addTarget, setAddTarget] = useState<AddTarget>();
  const [textDraft, setTextDraft] = useState("");
  const [imageDraft, setImageDraft] = useState("");
  const [borderColorDraft, setBorderColorDraft] = useState(DEFAULT_ITEM_BORDER_COLOR);
  const [itemWidth, setItemWidth] = useState(AUTO_SIZE);
  const [itemHeight, setItemHeight] = useState(AUTO_SIZE);
  const [imagePreviewSize, setImagePreviewSize] = useState<{ width: number; height: number }>();
  const [contextItem, setContextItem] = useState<{ item: BoardItem; x: number; y: number }>();
  const [emptyContext, setEmptyContext] = useState<{ gridX: number; gridY: number; x: number; y: number }>();
  const [focusedItemId, setFocusedItemId] = useState<string>();
  const [focusDraft, setFocusDraft] = useState("");
  const [newFocusedItemId, setNewFocusedItemId] = useState<string>();
  const [selectedItemId, setSelectedItemId] = useState<string>();
  const [dragState, setDragState] = useState<DragState>();
  const [resizeItemState, setResizeItemState] = useState<ResizeItemState>();
  const [panning, setPanning] = useState<{ x: number; y: number }>();
  const [history, setHistory] = useState<Record<string, History>>({});
  const [, setTheme] = useState(FALLBACK_THEME);
  const gridRef = useRef<HTMLDivElement>(null);

  const activeBoard = useMemo(() => boards.find((board) => board.id === activeBoardId), [activeBoardId, boards]);
  const showPreview = !activeBoard && boards.length === 0 && !previewDismissed;
  const displayBoard = activeBoard ?? (showPreview ? sampleBoard() : undefined);
  const isPreview = displayBoard?.id === "preview";
  const themeVars = useMemo(() => ({ "--bg": "#1e2231", "--surface": "#202435", "--panel": "#25293c", "--panel-soft": "#1c2030", "--panel-raised": "#2c3042", "--border": "rgba(187, 153, 255, 0.14)", "--border-strong": "rgba(187, 153, 255, 0.28)", "--text": "#ffffff", "--muted": "#ffffff", "--muted-2": "#ffffff", "--accent": "#bb99ff", "--accent-strong": "#d2bdff", "--accent-dark": "#826bb2", "--accent-soft": "rgba(187, 153, 255, 0.16)", "--danger": "#ff6b8a", "--shadow": "rgba(4, 6, 14, 0.42)" }) as CSSProperties, []);

  const refresh = useCallback(async () => {
    if (!OBR.isAvailable) {
      const prefs = await loadPreferences();
      setPreferences(prefs); setPreviewDismissed(!!prefs.previewDismissed); setBoards([]); setActiveBoardId(undefined); return;
    }
    const [visible, prefs, win, key] = await Promise.all([loadAllVisibleBoards(), loadPreferences(), loadWindowPreferences(), getSceneKey()]);
    const privateScene = orderPrivateBoards(visible.privateScene.boards, "scene", prefs, key);
    const privateRoom = orderPrivateBoards(visible.privateRoom.boards, "room", prefs, key);
    const ordered = [...privateScene, ...privateRoom, ...visible.sharedScene.boards, ...visible.sharedRoom.boards];
    setSceneKey(key); setPreferences(prefs); setPreviewDismissed(!!prefs.previewDismissed); setBoards(ordered); setWindowSize(win); await resizeAction(win.width, win.height);
    setActiveBoardId((current) => {
      const preserved = ordered.find((board) => board.id === current);
      const next = preserved ?? ordered[0];
      if (next && !preserved) {
        void markPrivateBoardOpened(next);
        const viewport = prefs.viewportByBoardId[next.id];
        setPan(viewport?.pan ?? DEFAULT_PAN); setZoom(viewport?.zoom ?? DEFAULT_ZOOM);
      }
      return next?.id;
    });
  }, []);

  useEffect(() => { if (!OBR.isAvailable) { void refresh(); return; } OBR.onReady(() => { setReady(true); void refresh(); void OBR.theme.getTheme().then(setTheme); }); }, [refresh]);
  useEffect(() => { if (!OBR.isAvailable || !ready) return; return OBR.theme.onChange(setTheme); }, [ready]);
  useEffect(() => {
    if (!ready) return;
    const id = window.setInterval(() => {
      if (!focusedItemId && !dragState && !resizeItemState) void refresh();
    }, 2500);
    return () => window.clearInterval(id);
  }, [dragState, focusedItemId, ready, refresh, resizeItemState]);
  useEffect(() => { if (!activeBoard || isPreview) return; const id = window.setTimeout(() => void saveViewport(activeBoard.id, { pan, zoom }), 250); return () => window.clearTimeout(id); }, [activeBoard, isPreview, pan, zoom]);

  async function persistBoard(board: Board, pushHistory = true) {
    if (isPreview) return;
    if (pushHistory && activeBoard && activeBoard.id === board.id) setHistory((current) => ({ ...current, [board.id]: { undo: [activeBoard, ...(current[board.id]?.undo ?? [])].slice(0, MAX_HISTORY), redo: [] } }));
    const saved = await saveBoard({ ...board, updatedAt: nowIso() });
    setBoards((current) => current.some((candidate) => candidate.id === saved.id) ? current.map((candidate) => candidate.id === saved.id ? saved : candidate) : [saved, ...current]);
    setActiveBoardId(saved.id);
  }

  async function chooseBoard(board: Board) {
    setActiveBoardId(board.id); setBoardPanelOpen(false); await markPrivateBoardOpened(board);
    const viewport = preferences?.viewportByBoardId[board.id]; setPan(viewport?.pan ?? DEFAULT_PAN); setZoom(viewport?.zoom ?? DEFAULT_ZOOM);
  }

  async function createShared(scope: BoardScope) {
    const existing = boards.find((b) => b.visibility === "shared" && b.scope === scope);
    if (existing) return chooseBoard(existing);
    const board = makeBoard(scope, "shared", undefined, await getRoomOwnerId());
    await persistBoard(board, false); await refresh();
  }

  async function createPrivateBoard() {
    const name = createName.trim();
    if (!name || name.length > 60) return;
    const duplicate = boards.some((b) => b.visibility === "private" && b.scope === createScope && b.name.trim().toLowerCase() === name.toLowerCase());
    if (duplicate) return;
    const board = makeBoard(createScope, "private", name);
    await persistBoard(board, false); await markPrivateBoardOpened(board); setCreateOpen(false); await refresh();
  }

  function pointerToGrid(clientX: number, clientY: number) {
    const rect = gridRef.current?.getBoundingClientRect(); const board = displayBoard;
    if (!rect || !board) return { x: 0, y: 0 };
    const cell = board.cellSizePx * zoom;
    return { x: Math.floor((clientX - rect.left - pan.x) / cell), y: Math.floor((clientY - rect.top - pan.y) / cell) };
  }

  function viewportCenterGrid() {
    const rect = gridRef.current?.getBoundingClientRect(); if (!rect) return { x: 0, y: 0 };
    return pointerToGrid(rect.left + rect.width / 2, rect.top + rect.height / 2);
  }

  async function updateActiveBoard(update: Partial<Board>) { if (activeBoard) await persistBoard({ ...activeBoard, ...update }); }
  async function updateGridSize(value: number) { if (!activeBoard) return; const cellSizePx = clampNumber(value, MIN_CELL_SIZE, MAX_CELL_SIZE); await updateActiveBoard({ cellSizePx }); }

  function resolveItemSize(type: BoardItem["type"], imageSize?: { width: number; height: number }) {
    const widthDraft = parseItemSize(itemWidth); const heightDraft = parseItemSize(itemHeight);
    const preferredWidth = widthDraft === AUTO_SIZE ? undefined : widthDraft; const preferredHeight = heightDraft === AUTO_SIZE ? undefined : heightDraft;
    const autoSize = type === "image" ? autoImageSize(imageSize?.width ?? imagePreviewSize?.width, imageSize?.height ?? imagePreviewSize?.height, preferredWidth, preferredHeight, activeBoard?.cellSizePx) : autoTextSize(textDraft || "New text", preferredWidth);
    return { width: preferredWidth ?? autoSize.width, height: preferredHeight ?? autoSize.height };
  }

  async function createTextAt(target: { x: number; y: number }) {
    if (!activeBoard) return;
    const position = firstFreeNear(activeBoard, target.x, target.y, 2, 1);
    const item: BoardItem = { ...createItemBase(position.x, position.y, 2, 1), type: "text", text: "", borderColor: DEFAULT_ITEM_BORDER_COLOR };
    await persistBoard({ ...activeBoard, items: [...activeBoard.items, item] });
    setFocusedItemId(item.id); setNewFocusedItemId(item.id); setFocusDraft("");
  }

  async function addImage(source?: string, imageSize?: { width: number; height: number }) {
    if (!activeBoard) return; const url = (source ?? imageDraft).trim();
    try { const parsed = new URL(url); if (!["http:", "https:"].includes(parsed.protocol)) return; } catch { return; }
    const size = resolveItemSize("image", imageSize); const target = addTarget ?? viewportCenterGrid(); const position = firstFreeNear(activeBoard, target.x, target.y, clampNumber(size.width, 1, 24), clampNumber(size.height, 1, 24));
    const item: BoardItem = { ...createItemBase(position.x, position.y, clampNumber(size.width, 1, 24), clampNumber(size.height, 1, 24)), type: "image", imageUrl: url, borderColor: borderColorDraft };
    await persistBoard({ ...activeBoard, items: [...activeBoard.items, item] }); setAddModalOpen(false); setImageDraft(""); setAddTarget(undefined);
  }

  async function pickOwlbearImage() { if (!OBR.isAvailable) return; const images = await OBR.assets.downloadImages(false, undefined, "NOTE"); const image = images[0]?.image; if (image?.url) await addImage(image.url, { width: image.width, height: image.height }); }

  async function updateItemRect(itemId: string, gridX: number, gridY: number, gridWidth: number, gridHeight: number) {
    if (!activeBoard) return; if (collides(activeBoard, gridX, gridY, gridWidth, gridHeight, itemId)) return;
    await persistBoard({ ...activeBoard, items: activeBoard.items.map((item) => item.id === itemId ? updateBoardItemRect(item, gridX, gridY, gridWidth, gridHeight) : item) });
  }

  async function deleteItem(itemId: string) { if (!activeBoard) return; await persistBoard({ ...activeBoard, items: activeBoard.items.filter((item) => item.id !== itemId) }); setContextItem(undefined); setSelectedItemId(undefined); }
  async function saveFocusedText() {
    if (!activeBoard || !focusedItemId) return; const item = activeBoard.items.find((candidate) => candidate.id === focusedItemId); if (!item) return; const text = focusDraft.trim();
    if (!text) { if (newFocusedItemId === focusedItemId) await deleteItem(focusedItemId); setFocusedItemId(undefined); setNewFocusedItemId(undefined); return; }
    await persistBoard({ ...activeBoard, items: activeBoard.items.map((candidate) => candidate.id === focusedItemId ? { ...candidate, text, updatedAt: nowIso() } : candidate) }); setFocusedItemId(undefined); setNewFocusedItemId(undefined);
  }
  async function cancelFocusedText() { if (newFocusedItemId && activeBoard) await deleteItem(newFocusedItemId); setFocusedItemId(undefined); setNewFocusedItemId(undefined); setFocusDraft(""); }

  async function undo() { if (!activeBoard) return; const entry = history[activeBoard.id]; const previous = entry?.undo[0]; if (!previous) return; setHistory((current) => ({ ...current, [activeBoard.id]: { undo: entry.undo.slice(1), redo: [activeBoard, ...entry.redo].slice(0, MAX_HISTORY) } })); await persistBoard(previous, false); }
  async function redo() { if (!activeBoard) return; const entry = history[activeBoard.id]; const next = entry?.redo[0]; if (!next) return; setHistory((current) => ({ ...current, [activeBoard.id]: { undo: [activeBoard, ...entry.undo].slice(0, MAX_HISTORY), redo: entry.redo.slice(1) } })); await persistBoard(next, false); }

  useEffect(() => { const handler = (event: KeyboardEvent) => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") { event.preventDefault(); void (event.shiftKey ? redo() : undo()); } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") { event.preventDefault(); void redo(); } else if (event.key === "Delete" && selectedItemId && !focusedItemId) { void deleteItem(selectedItemId); } }; window.addEventListener("keydown", handler); return () => window.removeEventListener("keydown", handler); });

  function handleGridPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (!displayBoard || event.button !== 0 && event.button !== 1) return; if (event.button === 1) event.preventDefault(); setContextItem(undefined); setEmptyContext(undefined);
    if (event.button === 1) { setPanning({ x: event.clientX - pan.x, y: event.clientY - pan.y }); event.currentTarget.setPointerCapture(event.pointerId); return; }
    const grid = pointerToGrid(event.clientX, event.clientY); const item = boardItemAt(displayBoard, grid.x, grid.y);
    if (item) { setSelectedItemId(item.id); const rect = gridRef.current?.getBoundingClientRect(); const cell = displayBoard.cellSizePx * zoom; setDragState({ itemId: item.id, offsetX: event.clientX - ((rect?.left ?? 0) + pan.x + item.gridX * cell), offsetY: event.clientY - ((rect?.top ?? 0) + pan.y + item.gridY * cell) }); event.currentTarget.setPointerCapture(event.pointerId); return; }
    setSelectedItemId(undefined); setPanning({ x: event.clientX - pan.x, y: event.clientY - pan.y }); event.currentTarget.setPointerCapture(event.pointerId);
  }
  function handleGridPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (!activeBoard) { if (panning) setPan({ x: event.clientX - panning.x, y: event.clientY - panning.y }); return; }
    if (resizeItemState) { const grid = pointerToGrid(event.clientX, event.clientY); const gridWidth = Math.max(1, grid.x - resizeItemState.gridX + 1); const gridHeight = Math.max(1, grid.y - resizeItemState.gridY + 1); if (!collides(activeBoard, resizeItemState.gridX, resizeItemState.gridY, gridWidth, gridHeight, resizeItemState.itemId)) setResizeItemState({ ...resizeItemState, gridWidth, gridHeight }); return; }
    if (dragState) { const item = activeBoard.items.find((candidate) => candidate.id === dragState.itemId); if (!item) return; const grid = pointerToGrid(event.clientX - dragState.offsetX, event.clientY - dragState.offsetY); if (!collides(activeBoard, grid.x, grid.y, item.gridWidth, item.gridHeight, item.id)) setBoards((current) => current.map((board) => board.id === activeBoard.id ? { ...board, items: board.items.map((candidate) => candidate.id === item.id ? updateBoardItemPosition(candidate, grid.x, grid.y) : candidate) } : board)); return; }
    if (panning) setPan({ x: event.clientX - panning.x, y: event.clientY - panning.y });
  }
  async function handleGridPointerUp(event: React.PointerEvent<HTMLDivElement>) { if (resizeItemState) await updateItemRect(resizeItemState.itemId, resizeItemState.gridX, resizeItemState.gridY, resizeItemState.gridWidth, resizeItemState.gridHeight); if (dragState && activeBoard) { const item = activeBoard.items.find((candidate) => candidate.id === dragState.itemId); if (item) await updateItemRect(item.id, item.gridX, item.gridY, item.gridWidth, item.gridHeight); } setDragState(undefined); setResizeItemState(undefined); setPanning(undefined); }
  function startItemResize(event: React.PointerEvent<HTMLElement>, item: BoardItem) { event.preventDefault(); event.stopPropagation(); setSelectedItemId(item.id); setResizeItemState({ itemId: item.id, gridX: item.gridX, gridY: item.gridY, gridWidth: item.gridWidth, gridHeight: item.gridHeight }); gridRef.current?.setPointerCapture(event.pointerId); }
  async function resizeWindow(width: number, height: number) { const next = { width: Math.max(520, Math.round(width)), height: Math.max(420, Math.round(height)) }; setWindowSize(next); await saveWindowPreferences(next); await resizeAction(next.width, next.height); }
  function startResize(event: React.PointerEvent<HTMLElement>) { const startX = event.clientX; const startY = event.clientY; const start = { ...windowSize }; const move = (moveEvent: PointerEvent) => void resizeWindow(start.width + moveEvent.clientX - startX, start.height + moveEvent.clientY - startY); const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); }; window.addEventListener("pointermove", move); window.addEventListener("pointerup", up); }

  const cellSize = (displayBoard?.cellSizePx ?? DEFAULT_CELL_SIZE) * zoom;
  if (!ready) return <div className="loading">Loading Board...</div>;

  return <main className="app" style={{ width: windowSize.width, height: windowSize.height, ...themeVars }}>
    <header className="toolbar"><div className="boardTitle"><button className="boardToggle" title="Board settings" onClick={() => setBoardPanelOpen((value) => !value)}><Settings size={16} /></button><div><strong>{displayBoard?.name ?? "No board"}</strong><span>{isPreview ? "Preview" : displayBoard ? groupLabel(displayBoard) : "Create a board"}</span></div>{boardPanelOpen && <section className="boardPanel">
      <div className="boardGroups"><strong>Private Scene Boards</strong>{boards.filter((b) => b.visibility === "private" && b.scope === "scene").map((b) => <button key={b.id} className={b.id === activeBoardId ? "active" : undefined} onClick={() => void chooseBoard(b)}>{b.name}</button>)}<strong>Private Room Boards</strong>{boards.filter((b) => b.visibility === "private" && b.scope === "room").map((b) => <button key={b.id} className={b.id === activeBoardId ? "active" : undefined} onClick={() => void chooseBoard(b)}>{b.name}</button>)}<strong>Shared Boards</strong><button onClick={() => void createShared("scene")}>Shared Scene Board</button><button onClick={() => void createShared("room")}>Shared Room Board</button></div>
      {activeBoard && <><label>Name<input disabled={activeBoard.visibility === "shared"} value={activeBoard.name} onChange={(event) => void updateActiveBoard({ name: event.target.value.slice(0, 60) })} /></label><div className="boardInlineFields"><label><span>Grid size</span><input type="number" min={MIN_CELL_SIZE} max={MAX_CELL_SIZE} value={activeBoard.cellSizePx} onChange={(event) => void updateGridSize(Number(event.target.value))} /></label><label><span>Grid cell gap</span><input type="number" min={MIN_CELL_GAP} max={MAX_CELL_GAP} value={activeBoard.cellGapPx} onChange={(event) => void updateActiveBoard({ cellGapPx: clampNumber(Number(event.target.value), MIN_CELL_GAP, MAX_CELL_GAP) })} /></label></div><button title="Delete board" onClick={() => { if (confirm(`Delete ${activeBoard.name}? This cannot be undone.`)) void deleteBoard(activeBoard).then(refresh); }}><Trash2 size={16} /> Delete Board</button></>}
      <button className="primaryAction" onClick={() => setCreateOpen(true)}><Plus size={16} /> Create Private Board</button>
    </section>}</div><div className="tools"><button title="Add item" disabled={!activeBoard} onClick={() => { setAddTarget(viewportCenterGrid()); setAddModalOpen(true); }}><Plus size={16} /> Add</button><button title="Zoom out" onClick={() => setZoom((value) => clampNumber(value - 0.1, MIN_ZOOM, MAX_ZOOM))}><Minus size={16} /></button><span className="zoom">{Math.round(zoom * 100)}%</span><button title="Zoom in" onClick={() => setZoom((value) => clampNumber(value + 0.1, MIN_ZOOM, MAX_ZOOM))}><Plus size={16} /></button><button title="Reset view" onClick={() => { setPan(DEFAULT_PAN); setZoom(DEFAULT_ZOOM); }}><RefreshCw size={16} /></button></div></header>

    <div ref={gridRef} className="gridSurface" onDoubleClick={(event) => { if (!activeBoard) return; const grid = pointerToGrid(event.clientX, event.clientY); if (!boardItemAt(activeBoard, grid.x, grid.y)) void createTextAt(grid); }} onPointerDown={handleGridPointerDown} onPointerMove={handleGridPointerMove} onPointerUp={(event) => void handleGridPointerUp(event)} onWheel={(event) => { event.preventDefault(); setZoom((value) => clampNumber(value + (event.deltaY < 0 ? 0.05 : -0.05), MIN_ZOOM, MAX_ZOOM)); }} onContextMenu={(event) => { event.preventDefault(); if (!displayBoard) return; const grid = pointerToGrid(event.clientX, event.clientY); const item = boardItemAt(displayBoard, grid.x, grid.y); if (item) setContextItem({ item, x: event.clientX, y: event.clientY }); else setEmptyContext({ gridX: grid.x, gridY: grid.y, x: event.clientX, y: event.clientY }); }} style={{ backgroundSize: `${cellSize}px ${cellSize}px`, backgroundPosition: `${pan.x}px ${pan.y}px` }}>
      <div className="gridPlane" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}>{displayBoard?.items.map((item) => <BoardItemView key={item.id} item={resizeItemState?.itemId === item.id ? { ...item, gridWidth: resizeItemState.gridWidth, gridHeight: resizeItemState.gridHeight } : item} selected={selectedItemId === item.id} focused={focusedItemId === item.id} focusDraft={focusDraft} cellSize={displayBoard.cellSizePx} cellGap={displayBoard.cellGapPx} onFocusDraft={setFocusDraft} onSave={() => void saveFocusedText()} onCancel={() => void cancelFocusedText()} onResizePointerDown={startItemResize} onDoubleClick={(target) => { if (target.type === "text") { setFocusedItemId(target.id); setFocusDraft(target.text ?? ""); } }} />)}</div>
      {showPreview && <div className="emptyState"><strong>Preview Board</strong><button className="primaryAction" onClick={() => setCreateOpen(true)}><Plus size={16} /> Create Private Board</button><button onClick={async () => { const prefs = preferences ?? await loadPreferences(); await savePreferences({ ...prefs, previewDismissed: true }); setPreviewDismissed(true); }}>Dismiss</button></div>}
      {!displayBoard && !showPreview && <div className="emptyState"><strong>No boards</strong><button className="primaryAction" onClick={() => setCreateOpen(true)}><Plus size={16} /> Create Private Board</button></div>}
      <div className="surfaceHud"><span>{displayBoard?.items.length ?? 0} items</span><span>{Math.round(cellSize)} px cells</span></div>
    </div>

    {contextItem && <div className="contextMenu" style={{ left: contextItem.x, top: contextItem.y }}><button onClick={() => { setFocusedItemId(contextItem.item.id); setFocusDraft(contextItem.item.text ?? ""); setContextItem(undefined); }}><Pencil size={15} /> Edit</button><label className="colorMenuItem">Border<input type="color" value={contextItem.item.borderColor ?? DEFAULT_ITEM_BORDER_COLOR} onChange={(event) => activeBoard && void persistBoard({ ...activeBoard, items: activeBoard.items.map((item) => item.id === contextItem.item.id ? { ...item, borderColor: event.target.value } : item) })} /></label><button onClick={() => void deleteItem(contextItem.item.id)}><Trash2 size={15} /> Delete</button></div>}
    {emptyContext && <div className="contextMenu" style={{ left: emptyContext.x, top: emptyContext.y }}><button onClick={() => { void createTextAt({ x: emptyContext.gridX, y: emptyContext.gridY }); setEmptyContext(undefined); }}><Type size={15} /> Add Text Here</button><button onClick={() => { setAddTarget({ x: emptyContext.gridX, y: emptyContext.gridY }); setAddItemType("image"); setAddModalOpen(true); setEmptyContext(undefined); }}><ImagePlus size={15} /> Add Image Here</button></div>}
    {createOpen && <div className="modalBackdrop" onPointerDown={() => setCreateOpen(false)}><section className="editModal" onPointerDown={(event) => event.stopPropagation()}><div className="modalHeader"><strong>Create Private Board</strong><button onClick={() => setCreateOpen(false)}><Minus size={16} /></button></div><div className="editModalBody"><label>Name<input value={createName} maxLength={60} onChange={(event) => setCreateName(event.target.value)} /></label><label>Scope<select value={createScope} onChange={(event) => setCreateScope(event.target.value as BoardScope)}><option value="scene">Scene</option><option value="room">Room</option></select></label><button className="primaryAction" onClick={() => void createPrivateBoard()}><Plus size={16} /> Create</button></div></section></div>}
    {addModalOpen && <div className="modalBackdrop" onPointerDown={() => setAddModalOpen(false)}><section className="addModal" onPointerDown={(event) => event.stopPropagation()}><div className="modalHeader"><strong>Add item</strong><button onClick={() => setAddModalOpen(false)}><Minus size={16} /></button></div><div className="itemTypeTabs"><button className={addItemType === "text" ? "active" : undefined} onClick={() => setAddItemType("text")}><Type size={16} /> Text</button><button className={addItemType === "image" ? "active" : undefined} onClick={() => setAddItemType("image")}><ImagePlus size={16} /> Image</button></div><div className="modalGrid"><label>W<input value={itemWidth} onChange={(event) => setItemWidth(event.target.value)} /></label><label>H<input value={itemHeight} onChange={(event) => setItemHeight(event.target.value)} /></label><label>Border<input type="color" value={borderColorDraft} onChange={(event) => setBorderColorDraft(event.target.value)} /></label>{addItemType === "text" ? <button className="primaryAction" onClick={() => { if (activeBoard) void createTextAt(addTarget ?? viewportCenterGrid()).then(() => setAddModalOpen(false)); }}><Type size={16} /> Add text</button> : <><label className="wideField">Image URL<input value={imageDraft} onChange={(event) => { setImageDraft(event.target.value); setImagePreviewSize(undefined); }} /></label><button onClick={() => void pickOwlbearImage()} disabled={!OBR.isAvailable}><ImagePlus size={16} /> Owlbear</button><button className="primaryAction" onClick={() => void addImage()}><ImagePlus size={16} /> Add</button>{imageDraft.trim() && <div className="imagePreviewPanel"><img src={imageDraft.trim()} alt="Image preview" onLoad={(event) => setImagePreviewSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })} onError={() => setImagePreviewSize(undefined)} /></div>}</>}</div></section></div>}
    <div className="resizeGrip" onPointerDown={startResize} title="Resize window"><Grip size={18} /></div>
  </main>;
}

function BoardItemView({ item, selected, focused, focusDraft, cellSize, cellGap, onFocusDraft, onSave, onCancel, onResizePointerDown, onDoubleClick }: { item: BoardItem; selected: boolean; focused: boolean; focusDraft: string; cellSize: number; cellGap: number; onFocusDraft: (value: string) => void; onSave: () => void; onCancel: () => void; onResizePointerDown: (event: React.PointerEvent<HTMLElement>, item: BoardItem) => void; onDoubleClick: (item: BoardItem) => void }) {
  const inset = Math.min(cellGap, Math.max(0, (Math.min(item.gridWidth, item.gridHeight) * cellSize) / 2 - 4));
  return <article className={`boardItem ${item.type} ${selected ? "selected" : ""}`} style={{ left: item.gridX * cellSize + inset, top: item.gridY * cellSize + inset, width: Math.max(8, item.gridWidth * cellSize - inset * 2), height: Math.max(8, item.gridHeight * cellSize - inset * 2), borderColor: item.borderColor ?? DEFAULT_ITEM_BORDER_COLOR }} onDoubleClick={(event) => { event.stopPropagation(); onDoubleClick(item); }}>
    {item.type === "image" && item.imageUrl ? <img src={item.imageUrl} alt="Board item" /> : focused ? <textarea className="inlineEditor" value={focusDraft} autoFocus onChange={(event) => onFocusDraft(event.target.value)} onBlur={onSave} onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); onCancel(); } if ((event.ctrlKey || event.metaKey) && event.key === "Enter") { event.preventDefault(); onSave(); } }} /> : <div className="textPreview"><MarkdownView value={item.text || ""} /></div>}
    <button className="itemResizeHandle" title="Resize item" onPointerDown={(event) => onResizePointerDown(event, item)}><Maximize2 size={13} /></button>
  </article>;
}
