import OBR from "@owlbear-rodeo/sdk";
import type { Theme } from "@owlbear-rodeo/sdk";
import { AlignCenter, AlignJustify, AlignLeft, AlignRight, AlignVerticalJustifyCenter, AlignVerticalJustifyEnd, AlignVerticalJustifyStart, Bold, ChevronDown, Grip, ImagePlus, Italic, Maximize2, Minus, Pencil, Plus, RefreshCw, Save, Settings, Trash2, Type, X } from "lucide-react";
import type React from "react";
import type { CSSProperties } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_CELL_GAP, DEFAULT_CELL_SIZE, DEFAULT_WINDOW, MAX_CELL_GAP, MAX_CELL_SIZE, MIN_CELL_GAP, MIN_CELL_SIZE } from "./constants";
import { boardItemAt, collides, updateBoardItemPosition, updateBoardItemRect } from "./grid";
import { createId, nowIso } from "./ids";
import { MarkdownView } from "./markdown";
import { resizeAction } from "./owlbear";
import { autoImageSize, autoTextSize, clampNumber, normalizeCounterValue, parseItemSize, textFillScale } from "./sizing";
import { zoomPanToCursor } from "./viewport";
import { toggleMarkdownStyle } from "./textFormatting";
import { boardSaving, getPlayerId, getPlayerName, getRoomOwnerId, getSceneKey, loadAllVisibleBoards, loadPreferences, loadWindowPreferences, markPrivateBoardOpened, savePreferences, saveViewport, saveWindowPreferences } from "./storage";
import { buildBoardPickerRows, groupPlayerBoards } from "./boardSession";
import { canEditBoard, canRenameBoard, type PlayerRole } from "./boardPermissions";
import type { Board, BoardItem, BoardScope, BoardVisibility, PlayerPreferences } from "./types";

type DragState = { itemId: string; offsetX: number; offsetY: number; startX: number; startY: number; moved: boolean };
type ResizeItemState = { itemId: string; gridX: number; gridY: number; gridWidth: number; gridHeight: number };
type AddTarget = { x: number; y: number } | undefined;
type History = { undo: Board[]; redo: Board[] };
type ImageEdit = { itemId: string; url: string; borderColor: string; imageFit: "cover" | "contain" };
type CounterEdit = { itemId: string; label: string; labelPosition: NonNullable<BoardItem["counterLabelPosition"]>; value: string; max: string; borderColor: string; zeroColorEnabled: boolean; zeroColor: string; maxColorEnabled: boolean; maxColor: string; dimAtZero: boolean };

const DEFAULT_ZOOM = 0.6;
const MIN_ZOOM = 0.05;
const MAX_ZOOM = 2;
const DEFAULT_PAN = { x: 260, y: 180 };
const SAMPLE_IMAGE = "https://images.unsplash.com/photo-1549880338-65ddcdfd017b?auto=format&fit=crop&w=900&q=80";
const AUTO_SIZE = "auto";
const DEFAULT_ITEM_BORDER_COLOR = "#bb99ff";
const MAX_HISTORY = 20;
const DEFAULT_COUNTER_ZERO_COLOR = "#ff6b8a";
const DEFAULT_COUNTER_MAX_COLOR = "#ffd166";
const FALLBACK_THEME: Theme = { mode: "DARK", primary: { main: "#bb99ff", light: "#d2bdff", dark: "#826bb2", contrastText: "#ffffff" }, secondary: { main: "#03dac6", light: "#66fff8", dark: "#00a896", contrastText: "#ffffff" }, background: { default: "#1e2231", paper: "#2c3042" }, text: { primary: "#ffffff", secondary: "#ffffff", disabled: "#ffffff" } };

function createItemBase(gridX: number, gridY: number, gridWidth: number, gridHeight: number) {
  const timestamp = nowIso();
  return { id: createId("board_item"), gridX, gridY, gridWidth, gridHeight, createdAt: timestamp, updatedAt: timestamp };
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
  const [playerRole, setPlayerRole] = useState<PlayerRole>("GM");
  const [playerId, setPlayerId] = useState("demo-player");
  const [sceneKey, setSceneKey] = useState("scene");
  const [activeBoardId, setActiveBoardId] = useState<string>();
  const [previewDismissed, setPreviewDismissed] = useState(false);
  const [error, setError] = useState<string>();
  const [saveStatus, setSaveStatus] = useState<string>();
  const [pan, setPan] = useState(DEFAULT_PAN);
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);
  const [windowSize, setWindowSize] = useState(DEFAULT_WINDOW);
  const [boardPanelOpen, setBoardPanelOpen] = useState(false);
  const [boardPickerOpen, setBoardPickerOpen] = useState(false);
  const [openBoardIds, setOpenBoardIds] = useState<string[]>([]);
  const tabsInitialized = useRef(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("New Board");
  const [createScope, setCreateScope] = useState<BoardScope>("scene");
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [addItemType, setAddItemType] = useState<BoardItem["type"]>("text");
  const [addTarget, setAddTarget] = useState<AddTarget>();
  const [textDraft, setTextDraft] = useState("");
  const [imageDraft, setImageDraft] = useState("");
  const [borderColorDraft, setBorderColorDraft] = useState(DEFAULT_ITEM_BORDER_COLOR);
  const [counterValueDraft, setCounterValueDraft] = useState("0");
  const [counterMaxDraft, setCounterMaxDraft] = useState("");
  const [itemWidth, setItemWidth] = useState(AUTO_SIZE);
  const [itemHeight, setItemHeight] = useState(AUTO_SIZE);
  const [imagePreviewSize, setImagePreviewSize] = useState<{ width: number; height: number }>();
  const [contextItem, setContextItem] = useState<{ item: BoardItem; x: number; y: number }>();
  const [emptyContext, setEmptyContext] = useState<{ gridX: number; gridY: number; x: number; y: number }>();
  const [focusedItemId, setFocusedItemId] = useState<string>();
  const [focusDraft, setFocusDraft] = useState("");
  const [hasTextSelection, setHasTextSelection] = useState(false);
  const [textFillBlock, setTextFillBlock] = useState(true);
  const [textVerticalAlignment, setTextVerticalAlignment] = useState<NonNullable<BoardItem["textVerticalAlignment"]>>("top");
  const [horizontalAlignmentOpen, setHorizontalAlignmentOpen] = useState(false);
  const [verticalAlignmentOpen, setVerticalAlignmentOpen] = useState(false);
  const [markdownHelpOpen, setMarkdownHelpOpen] = useState(false);
  const [imageEdit, setImageEdit] = useState<ImageEdit>();
  const [counterEdit, setCounterEdit] = useState<CounterEdit>();
  const [newFocusedItemId, setNewFocusedItemId] = useState<string>();
  const [selectedItemId, setSelectedItemId] = useState<string>();
  const [dragState, setDragState] = useState<DragState>();
  const [resizeItemState, setResizeItemState] = useState<ResizeItemState>();
  const [panning, setPanning] = useState<{ x: number; y: number }>();
  const [history, setHistory] = useState<Record<string, History>>({});
  const [, setTheme] = useState(FALLBACK_THEME);
  const gridRef = useRef<HTMLDivElement>(null);
  const focusTextarea = useRef<HTMLTextAreaElement>(null);
  const previewContent = useRef<HTMLDivElement>(null);
  const textEditorReturnFocus = useRef<HTMLElement | null>(null);
  const markdownHelpPanel = useRef<HTMLDivElement>(null);
  const markdownHelpTrigger = useRef<HTMLButtonElement>(null);
  const textScrollSyncing = useRef(false);
  const tabDrag = useRef<{ x: number; scrollLeft: number; moved: boolean; pointerId: number } | undefined>(undefined);
  const counterChangeQueue = useRef(Promise.resolve());
  const pendingCounterChanges = useRef(0);
  const boardDraft = useRef<Board | undefined>(undefined);
  const activeBoard = useMemo(() => boards.find((board) => board.id === activeBoardId), [activeBoardId, boards]);
  boardDraft.current = activeBoard;
  const showPreview = !activeBoard && !previewDismissed;
  const displayBoard = activeBoard ?? (showPreview ? sampleBoard() : undefined);
  const isPreview = displayBoard?.id === "preview";
  const readOnly = !!activeBoard && !canEditBoard(activeBoard, playerRole, playerId);
  const playerBoards = useMemo(() => groupPlayerBoards(boards.filter((board) => board.visibility === "gm-shared")), [boards]);
  const themeVars = useMemo(() => ({ "--bg": "#1e2231", "--surface": "#202435", "--panel": "#25293c", "--panel-soft": "#1c2030", "--panel-raised": "#2c3042", "--border": "rgba(187, 153, 255, 0.14)", "--border-strong": "rgba(187, 153, 255, 0.28)", "--text": "#ffffff", "--muted": "#ffffff", "--muted-2": "#ffffff", "--accent": "#bb99ff", "--accent-strong": "#d2bdff", "--accent-dark": "#826bb2", "--accent-soft": "rgba(187, 153, 255, 0.16)", "--danger": "#ff6b8a", "--shadow": "rgba(4, 6, 14, 0.42)" }) as CSSProperties, []);

  const refresh = useCallback(async () => {
    const role = OBR.isAvailable ? await OBR.player.getRole() : "GM" as const;
    const id = await getPlayerId();
    const [visible, prefs, win, key] = await Promise.all([loadAllVisibleBoards(role, id), loadPreferences(), loadWindowPreferences(), getSceneKey()]);
    const ordered = buildBoardPickerRows({
      privateSceneBoards: visible.privateScene.boards,
      privateRoomBoards: visible.privateRoom.boards,
      sharedSceneBoards: visible.sharedScene.boards,
      sharedRoomBoards: visible.sharedRoom.boards,
      preferences: prefs,
      sceneKey: key,
    }).flatMap((row) => row.kind === "board" ? [row.board] : []).concat(visible.gmShared.boards);
    setSceneKey(key); setPlayerId(id); setPreferences(prefs); setPlayerRole(role); setPreviewDismissed(!!prefs.previewDismissed); setBoards(ordered); setWindowSize(win); await resizeAction(win.width, win.height);
    setOpenBoardIds((ids) => ids.filter((id) => ordered.some((board) => board.id === id)));
    setActiveBoardId((current) => {
      const preserved = ordered.find((board) => board.id === current);
      const next = preserved ?? (tabsInitialized.current ? undefined : ordered[0]);
      if (next && !preserved) {
        setOpenBoardIds((ids) => ids.includes(next.id) ? ids.filter((id) => ordered.some((board) => board.id === id)) : [...ids.filter((id) => ordered.some((board) => board.id === id)), next.id]);
        void markPrivateBoardOpened(next);
        const viewport = prefs.viewportByBoardId[next.id];
        setPan(viewport?.pan ?? DEFAULT_PAN); setZoom(viewport?.zoom ?? DEFAULT_ZOOM);
      }
      return next?.id;
    });
    tabsInitialized.current = true;
  }, []);

  useEffect(() => { if (!OBR.isAvailable) { void refresh(); return; } OBR.onReady(() => { setReady(true); void refresh(); void OBR.theme.getTheme().then(setTheme); }); }, [refresh]);
  useEffect(() => { if (!OBR.isAvailable || !ready) return; return OBR.theme.onChange(setTheme); }, [ready]);
  useEffect(() => {
    if (!ready) return;
    const id = window.setInterval(() => {
      if (!focusedItemId && !dragState && !resizeItemState && pendingCounterChanges.current === 0) void refresh();
    }, 2500);
    return () => window.clearInterval(id);
  }, [dragState, focusedItemId, ready, refresh, resizeItemState]);
  useEffect(() => { if (!activeBoard || isPreview) return; const id = window.setTimeout(() => void saveViewport(activeBoard.id, { pan, zoom }), 250); return () => window.clearTimeout(id); }, [activeBoard, isPreview, pan, zoom]);
  useEffect(() => {
    if (focusedItemId) {
      requestAnimationFrame(() => focusTextarea.current?.focus());
      return;
    }
    const returnFocus = textEditorReturnFocus.current;
    textEditorReturnFocus.current = null;
    if (returnFocus?.isConnected) requestAnimationFrame(() => returnFocus.focus({ preventScroll: true }));
  }, [focusedItemId]);

  useEffect(() => {
    if (!focusedItemId) setMarkdownHelpOpen(false);
  }, [focusedItemId]);

  useEffect(() => {
    if (!markdownHelpOpen) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && !markdownHelpPanel.current?.contains(target) && !markdownHelpTrigger.current?.contains(target)) setMarkdownHelpOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setMarkdownHelpOpen(false); };
    document.addEventListener("pointerdown", closeOnOutsidePointer, true);
    document.addEventListener("keydown", closeOnEscape);
    return () => { document.removeEventListener("pointerdown", closeOnOutsidePointer, true); document.removeEventListener("keydown", closeOnEscape); };
  }, [markdownHelpOpen]);

  function syncTextScroll(source: HTMLElement, target: HTMLElement) {
    if (textScrollSyncing.current) return;
    textScrollSyncing.current = true;
    target.scrollTop = source.scrollTop;
    target.scrollLeft = source.scrollLeft;
    requestAnimationFrame(() => { textScrollSyncing.current = false; });
  }

  useEffect(() => {
    const surface = gridRef.current;
    if (!surface) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      // ponytail: wheel events do not identify their device; small deltas are treated as trackpad swipes.
      if (!event.ctrlKey && !event.metaKey && (event.deltaX !== 0 || Math.abs(event.deltaY) < 50)) {
        setPan((value) => ({ x: value.x - event.deltaX, y: value.y - event.deltaY }));
        return;
      }
      const rect = surface.getBoundingClientRect();
      const cursor = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      setZoom((value) => {
        const next = clampNumber(value + (event.deltaY < 0 ? 0.05 : -0.05), MIN_ZOOM, MAX_ZOOM);
        setPan((pan) => zoomPanToCursor(pan, value, next, cursor));
        return next;
      });
    };
    surface.addEventListener("wheel", wheel, { passive: false });
    return () => surface.removeEventListener("wheel", wheel);
  }, [ready]);

  async function persistBoard(board: Board, pushHistory = true, reportSave = false) {
    if (!canEditBoard(board, playerRole, playerId)) return;
    try {
      await counterChangeQueue.current;
      if (pushHistory && activeBoard && activeBoard.id === board.id) setHistory((current) => ({ ...current, [board.id]: { undo: [activeBoard, ...(current[board.id]?.undo ?? [])].slice(0, MAX_HISTORY), redo: [] } }));
      const saved = await boardSaving.save({ ...board, updatedAt: nowIso() });
      setBoards((current) => current.some((candidate) => candidate.id === saved.id) ? current.map((candidate) => candidate.id === saved.id ? saved : candidate) : [saved, ...current]);
      setActiveBoardId(saved.id);
      setError(undefined);
      setSaveStatus(reportSave ? "Saved" : undefined);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  function clearBoardUi() {
    setContextItem(undefined); setEmptyContext(undefined); setFocusedItemId(undefined); setFocusDraft(""); setImageEdit(undefined); setCounterEdit(undefined); setHasTextSelection(false); setNewFocusedItemId(undefined); setSelectedItemId(undefined); setDragState(undefined); setResizeItemState(undefined); setAddModalOpen(false); setAddTarget(undefined);
  }

  async function chooseBoard(board: Board) {
    const viewport = preferences?.viewportByBoardId[board.id];
    clearBoardUi(); setActiveBoardId(board.id); setPan(viewport?.pan ?? DEFAULT_PAN); setZoom(viewport?.zoom ?? DEFAULT_ZOOM); setBoardPickerOpen(false); setOpenBoardIds((ids) => ids.includes(board.id) ? ids : [...ids, board.id]); await markPrivateBoardOpened(board);
  }

  function closeBoardTab(boardId: string) {
    const index = openBoardIds.indexOf(boardId);
    const nextId = openBoardIds[index + 1] ?? openBoardIds[index - 1];
    setOpenBoardIds((ids) => ids.filter((id) => id !== boardId));
    if (activeBoardId === boardId) {
      const next = boards.find((board) => board.id === nextId);
      if (next) void chooseBoard(next);
      else { clearBoardUi(); setActiveBoardId(undefined); setPan(DEFAULT_PAN); setZoom(DEFAULT_ZOOM); }
    }
  }

  function startTabDrag(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    tabDrag.current = { x: event.clientX, scrollLeft: event.currentTarget.scrollLeft, moved: false, pointerId: event.pointerId };
  }

  function moveTabDrag(event: React.PointerEvent<HTMLDivElement>) {
    const drag = tabDrag.current;
    if (!drag) return;
    const distance = event.clientX - drag.x;
    if (!drag.moved && Math.abs(distance) > 3) { drag.moved = true; event.currentTarget.setPointerCapture(drag.pointerId); }
    event.currentTarget.scrollLeft = drag.scrollLeft - distance;
  }

  function endTabDrag(event: React.PointerEvent<HTMLDivElement>) {
    const moved = tabDrag.current?.moved;
    tabDrag.current = undefined;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (moved) event.preventDefault();
  }

  async function moveActiveBoardToScene() {
    if (!activeBoard || activeBoard.visibility !== "private" || activeBoard.scope !== "room") return;
    await boardSaving.relocate({ ...activeBoard, updatedAt: nowIso() });
    await refresh();
  }

  async function createShared(scope: BoardScope) {
    const existing = boards.find((b) => b.visibility === "shared" && b.scope === scope);
    if (existing) return chooseBoard(existing);
    const board = makeBoard(scope, "shared", undefined, await getRoomOwnerId());
    await persistBoard(board, false); await refresh(); await chooseBoard(board);
  }

  async function createPrivateBoard() {
    const name = createName.trim();
    if (!name || name.length > 60) return;
    const duplicate = boards.some((b) => b.visibility === "private" && b.scope === createScope && b.name.trim().toLowerCase() === name.toLowerCase());
    if (duplicate) return;
    const board = { ...makeBoard(createScope, "private", name, playerId), ownerName: await getPlayerName() };
    await persistBoard(board, false); await markPrivateBoardOpened(board); setCreateOpen(false); await refresh(); await chooseBoard(board);
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

  async function updateActiveBoard(update: Partial<Board>) {
    if (!activeBoard || !canEditBoard(activeBoard, playerRole, playerId) || ("name" in update && !canRenameBoard(activeBoard, playerRole))) return;
    await persistBoard({ ...activeBoard, ...update });
  }
  async function updateGridSize(value: number) { if (!activeBoard || readOnly) return; const cellSizePx = clampNumber(value, MIN_CELL_SIZE, MAX_CELL_SIZE); await updateActiveBoard({ cellSizePx }); }

  function resolveItemSize(type: BoardItem["type"], imageSize?: { width: number; height: number }) {
    const widthDraft = parseItemSize(itemWidth); const heightDraft = parseItemSize(itemHeight);
    const preferredWidth = widthDraft === AUTO_SIZE ? undefined : widthDraft; const preferredHeight = heightDraft === AUTO_SIZE ? undefined : heightDraft;
    const autoSize = type === "image" ? autoImageSize(imageSize?.width ?? imagePreviewSize?.width, imageSize?.height ?? imagePreviewSize?.height, preferredWidth, preferredHeight, activeBoard?.cellSizePx) : autoTextSize(textDraft || "New text", preferredWidth);
    return { width: preferredWidth ?? autoSize.width, height: preferredHeight ?? autoSize.height };
  }

  async function createTextAt(target: { x: number; y: number }) {
    if (!activeBoard || readOnly) return;
    textEditorReturnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const size = resolveItemSize("text");
    const gridWidth = clampNumber(size.width, 1, 24); const gridHeight = clampNumber(size.height, 1, 24);
    const position = firstFreeNear(activeBoard, target.x, target.y, gridWidth, gridHeight);
    const item: BoardItem = { ...createItemBase(position.x, position.y, gridWidth, gridHeight), type: "text", text: "", textBaselineWidth: autoTextSize("").width, fillBlock: true, textVerticalAlignment: "top", borderColor: borderColorDraft };
    await persistBoard({ ...activeBoard, items: [...activeBoard.items, item] });
    const alignment = preferences?.textAlignment ?? 0;
    setFocusedItemId(item.id); setNewFocusedItemId(item.id); setFocusDraft(alignment ? `^${alignment} ` : ""); setHorizontalAlignmentOpen(false); setVerticalAlignmentOpen(false);
  }

  async function addImage(source?: string, imageSize?: { width: number; height: number }) {
    if (!activeBoard || readOnly) return; const url = (source ?? imageDraft).trim();
    try { const parsed = new URL(url); if (!["http:", "https:"].includes(parsed.protocol)) return; } catch { return; }
    const size = resolveItemSize("image", imageSize); const target = addTarget ?? viewportCenterGrid();
    const gridWidth = clampNumber(size.width, 1, 24); const gridHeight = clampNumber(size.height, 1, 24);
    const position = firstFreeNear(activeBoard, target.x, target.y, gridWidth, gridHeight);
    const item: BoardItem = { ...createItemBase(position.x, position.y, gridWidth, gridHeight), type: "image", imageUrl: url, imageFit: "cover", borderColor: borderColorDraft };
    await persistBoard({ ...activeBoard, items: [...activeBoard.items, item] }); setAddModalOpen(false); setImageDraft(""); setAddTarget(undefined);
  }

  async function addCounter() {
    if (!activeBoard || readOnly) return;
    const size = resolveItemSize("counter");
    const gridWidth = clampNumber(size.width, 1, 24); const gridHeight = clampNumber(size.height, 1, 24);
    const target = addTarget ?? viewportCenterGrid(); const position = firstFreeNear(activeBoard, target.x, target.y, gridWidth, gridHeight);
    const max = counterMaxDraft.trim() ? normalizeCounterValue(Number(counterMaxDraft)) : undefined;
    const item: BoardItem = { ...createItemBase(position.x, position.y, gridWidth, gridHeight), type: "counter", counterValue: normalizeCounterValue(Number(counterValueDraft), max), counterMax: max, counterLabelPosition: "top-center", counterDimAtZero: true, borderColor: borderColorDraft, counterZeroColor: DEFAULT_COUNTER_ZERO_COLOR, counterMaxColor: DEFAULT_COUNTER_MAX_COLOR };
    await persistBoard({ ...activeBoard, items: [...activeBoard.items, item] }); setAddModalOpen(false); setAddTarget(undefined); setCounterValueDraft("0"); setCounterMaxDraft("");
  }

  async function pickOwlbearImage() { if (!OBR.isAvailable) return; const images = await OBR.assets.downloadImages(false, undefined, "NOTE"); const image = images[0]?.image; if (image?.url) await addImage(image.url, { width: image.width, height: image.height }); }

  function openItemEditor(item: BoardItem) {
    if (!activeBoard || !canEditBoard(activeBoard, playerRole, playerId)) return;
    textEditorReturnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setFocusedItemId(item.id);
    if (item.type === "text") { setFocusDraft(item.text ?? ""); setTextFillBlock(item.fillBlock !== false); setTextVerticalAlignment(item.textVerticalAlignment ?? "top"); setHorizontalAlignmentOpen(false); setVerticalAlignmentOpen(false); setHasTextSelection(false); setImageEdit(undefined); setCounterEdit(undefined); }
    else if (item.type === "image") { setImageEdit({ itemId: item.id, url: item.imageUrl ?? "", borderColor: item.borderColor ?? DEFAULT_ITEM_BORDER_COLOR, imageFit: item.imageFit ?? "cover" }); setCounterEdit(undefined); }
    else setCounterEdit({ itemId: item.id, label: item.counterLabel ?? "", labelPosition: item.counterLabelPosition ?? "top-center", value: String(item.counterValue ?? 0), max: item.counterMax === undefined ? "" : String(item.counterMax), borderColor: item.borderColor ?? DEFAULT_ITEM_BORDER_COLOR, zeroColorEnabled: !!item.counterZeroColorEnabled, zeroColor: item.counterZeroColor ?? DEFAULT_COUNTER_ZERO_COLOR, maxColorEnabled: !!item.counterMaxColorEnabled, maxColor: item.counterMaxColor ?? DEFAULT_COUNTER_MAX_COLOR, dimAtZero: item.counterDimAtZero ?? true });
  }

  async function pickOwlbearEditImage() {
    if (!OBR.isAvailable) return;
    const image = (await OBR.assets.downloadImages(false, undefined, "NOTE"))[0]?.image;
    if (image?.url) setImageEdit((current) => current && { ...current, url: image.url });
  }

  async function updateItemRect(itemId: string, gridX: number, gridY: number, gridWidth: number, gridHeight: number) {
    if (!activeBoard || readOnly) return; if (collides(activeBoard, gridX, gridY, gridWidth, gridHeight, itemId)) return;
    await persistBoard({ ...activeBoard, items: activeBoard.items.map((item) => item.id === itemId ? updateBoardItemRect(item, gridX, gridY, gridWidth, gridHeight) : item) });
  }

  async function deleteItem(itemId: string) { if (!activeBoard || readOnly) return; await persistBoard({ ...activeBoard, items: activeBoard.items.filter((item) => item.id !== itemId) }); setContextItem(undefined); setSelectedItemId(undefined); }
  async function saveFocusedText() {
    if (!activeBoard || !focusedItemId) return; const item = activeBoard.items.find((candidate) => candidate.id === focusedItemId); if (!item) return; const text = focusDraft.trim();
    if (!text || /^\^[1-3]\s*$/.test(text)) { if (newFocusedItemId === focusedItemId) await deleteItem(focusedItemId); setFocusedItemId(undefined); setNewFocusedItemId(undefined); setHorizontalAlignmentOpen(false); setVerticalAlignmentOpen(false); return; }
    const baseline = autoTextSize(text);
    await persistBoard({ ...activeBoard, items: activeBoard.items.map((candidate) => candidate.id === focusedItemId ? { ...candidate, text, textBaselineWidth: baseline.width, fillBlock: textFillBlock, textVerticalAlignment, updatedAt: nowIso() } : candidate) }); setFocusedItemId(undefined); setNewFocusedItemId(undefined); setHasTextSelection(false); setHorizontalAlignmentOpen(false); setVerticalAlignmentOpen(false);
  }
  async function cancelFocusedText() { if (newFocusedItemId && activeBoard) await deleteItem(newFocusedItemId); setFocusedItemId(undefined); setNewFocusedItemId(undefined); setFocusDraft(""); setHasTextSelection(false); setVerticalAlignmentOpen(false); }

  async function saveFocusedImage() {
    if (!activeBoard || !imageEdit) return;
    try { const url = new URL(imageEdit.url.trim()); if (!["http:", "https:"].includes(url.protocol)) return; } catch { return; }
    await persistBoard({ ...activeBoard, items: activeBoard.items.map((item) => item.id === imageEdit.itemId ? { ...item, imageUrl: imageEdit.url.trim(), borderColor: imageEdit.borderColor, imageFit: imageEdit.imageFit, updatedAt: nowIso() } : item) });
    setImageEdit(undefined); setFocusedItemId(undefined);
  }

  function cancelFocusedImage() { setImageEdit(undefined); setFocusedItemId(undefined); }

  async function saveFocusedCounter() {
    if (!activeBoard || !counterEdit) return;
    const max = counterEdit.max.trim() ? normalizeCounterValue(Number(counterEdit.max)) : undefined;
    const value = normalizeCounterValue(Number(counterEdit.value), max);
    await persistBoard({ ...activeBoard, items: activeBoard.items.map((item) => item.id === counterEdit.itemId ? { ...item, counterLabel: counterEdit.label.trim().slice(0, 120), counterLabelPosition: counterEdit.labelPosition, counterValue: value, counterMax: max, borderColor: counterEdit.borderColor, counterZeroColorEnabled: counterEdit.zeroColorEnabled, counterZeroColor: counterEdit.zeroColor, counterMaxColorEnabled: counterEdit.maxColorEnabled, counterMaxColor: counterEdit.maxColor, counterDimAtZero: counterEdit.dimAtZero, updatedAt: nowIso() } : item) });
    setCounterEdit(undefined); setFocusedItemId(undefined);
  }

  function cancelFocusedCounter() { setCounterEdit(undefined); setFocusedItemId(undefined); }

  function changeCounter(item: BoardItem, delta: number) {
    const board = boardDraft.current; if (!board || !canEditBoard(board, playerRole, playerId)) return;
    const current = board.items.find((candidate) => candidate.id === item.id); if (!current) return;
    const value = normalizeCounterValue((current.counterValue ?? 0) + delta, current.counterMax); if (value === current.counterValue) return;
    const next = { ...board, items: board.items.map((candidate) => candidate.id === item.id ? { ...candidate, counterValue: value, updatedAt: nowIso() } : candidate) };
    boardDraft.current = next; setBoards((boards) => boards.map((candidate) => candidate.id === next.id ? next : candidate));
    setHistory((history) => ({ ...history, [board.id]: { undo: [board, ...(history[board.id]?.undo ?? [])].slice(0, MAX_HISTORY), redo: [] } }));
    pendingCounterChanges.current += 1;
    counterChangeQueue.current = counterChangeQueue.current.then(async () => {
      try {
        const draft = boardDraft.current; const saved = await boardSaving.save({ ...next, revision: draft?.revision ?? next.revision });
        const current = boardDraft.current; if (current?.id === saved.id) {
          const revised = { ...current, revision: saved.revision, updatedAt: saved.updatedAt }; boardDraft.current = revised;
          setBoards((boards) => boards.map((candidate) => candidate.id === revised.id ? revised : candidate));
        }
        setError(undefined);
      }
      catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
      finally { pendingCounterChanges.current -= 1; }
    });
  }

  function restoreTextSelection(start: number, end: number) {
    requestAnimationFrame(() => { focusTextarea.current?.focus(); focusTextarea.current?.setSelectionRange(start, end); });
  }

  function toggleTextStyle(marker: "*" | "**") {
    const input = focusTextarea.current; if (!input || input.selectionStart === input.selectionEnd) return;
    const result = toggleMarkdownStyle(focusDraft, input.selectionStart, input.selectionEnd, marker);
    setFocusDraft(result.value);
    restoreTextSelection(result.selectionStart, result.selectionEnd);
  }

  async function alignTextBlocks(alignment: 0 | 1 | 2 | 3) {
    const input = focusTextarea.current; if (!input) return;
    const start = input.selectionStart; const end = input.selectionEnd; const lines = focusDraft.split("\n");
    const startLine = focusDraft.slice(0, start).split("\n").length - 1;
    const endLine = focusDraft.slice(0, Math.max(start, end - (end > start ? 1 : 0))).split("\n").length - 1;
    const targets = new Set<number>(); let codeStart = -1;
    for (let index = 0; index < lines.length; index += 1) {
      const plain = lines[index].replace(/^\^[1-3]\s+/, "");
      if (plain.trim().startsWith("```")) { if (codeStart < 0) codeStart = index; else { if (codeStart <= endLine && index >= startLine) targets.add(codeStart); codeStart = -1; } }
      else if (codeStart < 0 && index >= startLine && index <= endLine && plain.trim()) targets.add(index);
    }
    if (codeStart >= 0 && codeStart <= endLine) targets.add(codeStart);
    setFocusDraft(lines.map((line, index) => targets.has(index) ? `${alignment ? `^${alignment} ` : ""}${line.replace(/^\^[1-3]\s+/, "")}` : line).join("\n"));
    const next = { ...(preferences ?? await loadPreferences()), textAlignment: alignment };
    setPreferences(next); await savePreferences(next); restoreTextSelection(start, end);
  }

  async function undo() { if (!activeBoard) return; const entry = history[activeBoard.id]; const previous = entry?.undo[0]; if (!previous) return; setHistory((current) => ({ ...current, [activeBoard.id]: { undo: entry.undo.slice(1), redo: [activeBoard, ...entry.redo].slice(0, MAX_HISTORY) } })); await persistBoard(previous, false); }
  async function redo() { if (!activeBoard) return; const entry = history[activeBoard.id]; const next = entry?.redo[0]; if (!next) return; setHistory((current) => ({ ...current, [activeBoard.id]: { undo: [activeBoard, ...entry.undo].slice(0, MAX_HISTORY), redo: entry.redo.slice(1) } })); await persistBoard(next, false); }

  useEffect(() => { const handler = (event: KeyboardEvent) => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") { event.preventDefault(); void (event.shiftKey ? redo() : undo()); } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") { event.preventDefault(); void redo(); } else if (event.key === "Delete" && selectedItemId && !focusedItemId) { void deleteItem(selectedItemId); } }; window.addEventListener("keydown", handler); return () => window.removeEventListener("keydown", handler); });

  function handleGridPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (!displayBoard || event.button !== 0 && event.button !== 1) return; if (event.button === 1) event.preventDefault(); setContextItem(undefined); setEmptyContext(undefined);
    if (event.button === 1) { setPanning({ x: event.clientX - pan.x, y: event.clientY - pan.y }); event.currentTarget.setPointerCapture(event.pointerId); return; }
    const grid = pointerToGrid(event.clientX, event.clientY); const item = boardItemAt(displayBoard, grid.x, grid.y);
    if (readOnly) { if (event.button === 0) setPanning({ x: event.clientX - pan.x, y: event.clientY - pan.y }); event.currentTarget.setPointerCapture(event.pointerId); return; }
    if (item) { setSelectedItemId(item.id); if (event.detail > 1) return; const rect = gridRef.current?.getBoundingClientRect(); const cell = displayBoard.cellSizePx * zoom; setDragState({ itemId: item.id, offsetX: event.clientX - ((rect?.left ?? 0) + pan.x + item.gridX * cell), offsetY: event.clientY - ((rect?.top ?? 0) + pan.y + item.gridY * cell), startX: event.clientX, startY: event.clientY, moved: false }); event.currentTarget.setPointerCapture(event.pointerId); return; }
    setSelectedItemId(undefined); setPanning({ x: event.clientX - pan.x, y: event.clientY - pan.y }); event.currentTarget.setPointerCapture(event.pointerId);
  }
  function handleGridPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (!activeBoard || readOnly) { if (panning) setPan({ x: event.clientX - panning.x, y: event.clientY - panning.y }); return; }
    if (resizeItemState) { const grid = pointerToGrid(event.clientX, event.clientY); const gridWidth = Math.max(1, grid.x - resizeItemState.gridX + 1); const gridHeight = Math.max(1, grid.y - resizeItemState.gridY + 1); if (!collides(activeBoard, resizeItemState.gridX, resizeItemState.gridY, gridWidth, gridHeight, resizeItemState.itemId)) setResizeItemState({ ...resizeItemState, gridWidth, gridHeight }); return; }
    if (dragState) { if (!dragState.moved && Math.hypot(event.clientX - dragState.startX, event.clientY - dragState.startY) < 4) return; const moving = dragState.moved ? dragState : { ...dragState, moved: true }; if (!dragState.moved) setDragState(moving); const item = activeBoard.items.find((candidate) => candidate.id === moving.itemId); if (!item) return; const grid = pointerToGrid(event.clientX - moving.offsetX, event.clientY - moving.offsetY); if (!collides(activeBoard, grid.x, grid.y, item.gridWidth, item.gridHeight, item.id)) setBoards((current) => current.map((board) => board.id === activeBoard.id ? { ...board, items: board.items.map((candidate) => candidate.id === item.id ? updateBoardItemPosition(candidate, grid.x, grid.y) : candidate) } : board)); return; }
    if (panning) setPan({ x: event.clientX - panning.x, y: event.clientY - panning.y });
  }
  async function handleGridPointerUp(event: React.PointerEvent<HTMLDivElement>) { if (resizeItemState) await updateItemRect(resizeItemState.itemId, resizeItemState.gridX, resizeItemState.gridY, resizeItemState.gridWidth, resizeItemState.gridHeight); if (dragState?.moved && activeBoard) { const item = activeBoard.items.find((candidate) => candidate.id === dragState.itemId); if (item) await updateItemRect(item.id, item.gridX, item.gridY, item.gridWidth, item.gridHeight); } setDragState(undefined); setResizeItemState(undefined); setPanning(undefined); }
  function startItemResize(event: React.PointerEvent<HTMLElement>, item: BoardItem) { if (readOnly) return; event.preventDefault(); event.stopPropagation(); setSelectedItemId(item.id); setResizeItemState({ itemId: item.id, gridX: item.gridX, gridY: item.gridY, gridWidth: item.gridWidth, gridHeight: item.gridHeight }); gridRef.current?.setPointerCapture(event.pointerId); }
  async function resizeWindow(width: number, height: number) { const next = { width: Math.max(1, Math.round(width)), height: Math.max(1, Math.round(height)) }; setWindowSize(next); await saveWindowPreferences(next); await resizeAction(next.width, next.height); }
  function startResize(event: React.PointerEvent<HTMLElement>) { const target = event.currentTarget; const startX = event.clientX; const startY = event.clientY; const start = { ...windowSize }; target.setPointerCapture(event.pointerId); const move = (moveEvent: PointerEvent) => void resizeWindow(start.width + moveEvent.clientX - startX, start.height + moveEvent.clientY - startY); const up = () => { target.releasePointerCapture(event.pointerId); target.removeEventListener("pointermove", move); target.removeEventListener("pointerup", up); }; target.addEventListener("pointermove", move); target.addEventListener("pointerup", up); }

  const cellSize = (displayBoard?.cellSizePx ?? DEFAULT_CELL_SIZE) * zoom;
  const focusedItem = activeBoard?.items.find((item) => item.id === focusedItemId);
  const showBoardActions = !!activeBoard && (displayBoard?.items.length ?? 0) > 0;
  if (!ready) return <div className="loading">Loading Board...</div>;

  return <main className="app" style={{ width: windowSize.width, height: windowSize.height, ...themeVars }}>
    <header className="toolbar"><div className="boardTitle"><button className="boardToggle" title="Board settings" onClick={() => { setBoardPanelOpen((value) => !value); setBoardPickerOpen(false); }}><Settings size={16} /></button><button className="boardToggle" title="Boards" onClick={() => { setBoardPickerOpen((value) => !value); setBoardPanelOpen(false); }}><ChevronDown size={16} /></button><div className="boardTabs" onPointerDown={startTabDrag} onPointerMove={moveTabDrag} onPointerUp={endTabDrag} onPointerCancel={endTabDrag}>{openBoardIds.flatMap((id) => boards.filter((board) => board.id === id)).map((board) => <button key={board.id} className={`boardTab ${board.id === activeBoardId ? "active" : ""}`} onClick={() => void chooseBoard(board)} onContextMenu={(event) => { event.preventDefault(); void chooseBoard(board); setBoardPanelOpen(true); }}>{board.name}<X size={13} onClick={(event) => { event.stopPropagation(); closeBoardTab(board.id); }} /></button>)}</div>{boardPanelOpen && <section className="boardPanel">
      {activeBoard ? <>{!readOnly && canRenameBoard(activeBoard, playerRole) && <label>Name<input value={activeBoard.name} onChange={(event) => void updateActiveBoard({ name: event.target.value.slice(0, 60) })} /></label>}<div className="boardInlineFields"><label><span>Grid size</span><input disabled={readOnly} type="number" min={MIN_CELL_SIZE} max={MAX_CELL_SIZE} value={activeBoard.cellSizePx} onChange={(event) => void updateGridSize(Number(event.target.value))} /></label><label><span>Grid cell gap</span><input disabled={readOnly} type="number" min={MIN_CELL_GAP} max={MAX_CELL_GAP} value={activeBoard.cellGapPx} onChange={(event) => void updateActiveBoard({ cellGapPx: clampNumber(Number(event.target.value), MIN_CELL_GAP, MAX_CELL_GAP) })} /></label></div>{!readOnly && activeBoard.visibility === "private" && <label><input type="checkbox" checked={!!activeBoard.showToGM} onChange={(event) => void updateActiveBoard({ showToGM: event.target.checked })} /> Show to GM</label>}{!readOnly && activeBoard.visibility === "private" && activeBoard.scope === "room" && <button onClick={() => void moveActiveBoardToScene()}>Move to Scene</button>}{!readOnly && <button title="Delete board" onClick={() => { if (confirm(`Delete ${activeBoard.name}? This cannot be undone.`)) void boardSaving.delete(activeBoard).then(refresh); }}><Trash2 size={16} /> Delete Board</button>}</> : <span className="emptyBoardGroup">Open a board or create one from the Boards menu.</span>}
    </section>}{boardPickerOpen && <section className="boardPanel boardPicker"><button className="primaryAction" onClick={() => { setCreateOpen(true); setBoardPickerOpen(false); }}><Plus size={16} /> Create Private Board</button><div className="boardGroups"><strong>Shared Boards</strong>{boards.filter((board) => board.visibility === "shared").map((board) => <button key={board.id} onClick={() => void chooseBoard(board)}>{board.name}</button>)}{!boards.some((board) => board.visibility === "shared" && board.scope === "scene") && <button onClick={() => void createShared("scene")}>Shared Scene Board</button>}{!boards.some((board) => board.visibility === "shared" && board.scope === "room") && <button onClick={() => void createShared("room")}>Shared Room Board</button>}<strong>Private Scene Boards</strong>{boards.filter((board) => board.visibility === "private" && board.scope === "scene").map((board) => <button key={board.id} onClick={() => void chooseBoard(board)}>{board.name}</button>)}{!boards.some((board) => board.visibility === "private" && board.scope === "scene") && <span className="emptyBoardGroup">Empty</span>}<strong>Private Room Boards</strong>{boards.filter((board) => board.visibility === "private" && board.scope === "room").map((board) => <button key={board.id} onClick={() => void chooseBoard(board)}>{board.name}</button>)}{!boards.some((board) => board.visibility === "private" && board.scope === "room") && <span className="emptyBoardGroup">Empty</span>}{playerRole === "GM" && <><button className="boardGroupButton" disabled={playerBoards.length === 0}>Player Boards</button>{playerBoards.map((group) => <div key={group.playerName}><strong>{group.playerName}</strong>{group.boards.map((board) => <button key={board.id} onClick={() => void chooseBoard(board)}>{board.name}</button>)}</div>)}</>}</div></section>}</div><div className="tools">{showBoardActions && <><button disabled={readOnly} title="Save board" onClick={() => void persistBoard(activeBoard!, false, true)}><Save size={16} /> {saveStatus ?? "Save"}</button>{!readOnly && <button title="Add item" onClick={() => { setAddTarget(viewportCenterGrid()); setAddModalOpen(true); }}><Plus size={16} /> Add</button>}</>}<button title="Zoom out" onClick={() => setZoom((value) => clampNumber(value - 0.1, MIN_ZOOM, MAX_ZOOM))}><Minus size={16} /></button><span className="zoom">{Math.round(zoom * 100)}%</span><button title="Zoom in" onClick={() => setZoom((value) => clampNumber(value + 0.1, MIN_ZOOM, MAX_ZOOM))}><Plus size={16} /></button><button title="Reset view" onClick={() => { setPan(DEFAULT_PAN); setZoom(DEFAULT_ZOOM); }}><RefreshCw size={16} /></button></div></header>

    <div ref={gridRef} className="gridSurface" onDoubleClick={(event) => { if (!activeBoard || readOnly) return; const grid = pointerToGrid(event.clientX, event.clientY); if (!boardItemAt(activeBoard, grid.x, grid.y)) void createTextAt(grid); }} onPointerDown={handleGridPointerDown} onPointerMove={handleGridPointerMove} onPointerUp={(event) => void handleGridPointerUp(event)} onContextMenu={(event) => { event.preventDefault(); if (!activeBoard || readOnly) { if (!activeBoard) setCreateOpen(true); return; } const grid = pointerToGrid(event.clientX, event.clientY); const item = boardItemAt(activeBoard, grid.x, grid.y); if (item) setContextItem({ item, x: event.clientX, y: event.clientY }); else setEmptyContext({ gridX: grid.x, gridY: grid.y, x: event.clientX, y: event.clientY }); }} style={{ backgroundSize: `${cellSize}px ${cellSize}px`, backgroundPosition: `${pan.x}px ${pan.y}px` }}>
      <div key={displayBoard?.id ?? "empty"} className="gridPlane" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}>{displayBoard?.items.map((item) => <BoardItemView key={item.id} item={resizeItemState?.itemId === item.id ? { ...item, gridWidth: resizeItemState.gridWidth, gridHeight: resizeItemState.gridHeight } : item} selected={selectedItemId === item.id} cellSize={displayBoard.cellSizePx} cellGap={displayBoard.cellGapPx} onResizePointerDown={startItemResize} onDoubleClick={openItemEditor} onCounterChange={changeCounter} readOnly={readOnly} />)}</div>
      {showPreview && <div className="emptyState" onPointerDown={(event) => event.stopPropagation()} onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); }}><strong>Preview Board</strong><button className="primaryAction" onClick={() => setCreateOpen(true)}><Plus size={16} /> Create Private Board</button><button onClick={async () => { const prefs = preferences ?? await loadPreferences(); await savePreferences({ ...prefs, previewDismissed: true }); setPreviewDismissed(true); }}>Dismiss</button></div>}
      {error && <div className="saveError">Could not save Board: {error}</div>}
      <div className="surfaceHud"><span>{displayBoard?.items.length ?? 0} items</span><span>{Math.round(cellSize)} px cells</span></div>
    </div>

    {focusedItem?.type === "text" && <div className="modalBackdrop" onPointerDown={() => void saveFocusedText()}><section className="editModal textEditModal" role="dialog" aria-modal="true" aria-labelledby="text-edit-title" onPointerDown={(event) => event.stopPropagation()}><div className="modalHeader"><div className="editTextTitle"><div className="markdownHelpTrigger"><button ref={markdownHelpTrigger} className="markdownHelpButton" aria-label="Markdown help" aria-expanded={markdownHelpOpen} aria-controls="markdown-help-panel" onClick={() => setMarkdownHelpOpen((open) => !open)}>?</button></div><strong id="text-edit-title">Edit text</strong></div><div className="modalHeaderActions"><button className="primaryAction" onClick={() => void saveFocusedText()}><Save size={16} /> Save</button><button title="Cancel" onClick={() => void cancelFocusedText()}><X size={16} /></button></div></div><div className="editModalBody textEditLayout"><MarkdownHelp open={markdownHelpOpen} panelRef={markdownHelpPanel} /><div className="textEditToolbar"><button title="Bold selected text" disabled={!hasTextSelection} onMouseDown={(event) => event.preventDefault()} onClick={() => toggleTextStyle("**")}><Bold size={16} /></button><button title="Italic selected text" disabled={!hasTextSelection} onMouseDown={(event) => event.preventDefault()} onClick={() => toggleTextStyle("*")}><Italic size={16} /></button><div className="alignmentDropdown"><button className="alignmentButton" title="Horizontal text alignment" onClick={() => setHorizontalAlignmentOpen((open) => !open)}>{[<AlignLeft size={16} />, <AlignCenter size={16} />, <AlignRight size={16} />, <AlignJustify size={16} />][preferences?.textAlignment ?? 0]}<ChevronDown size={13} /></button>{horizontalAlignmentOpen && <div className="alignmentMenu">{[[0, <AlignLeft size={16} />, "Align left"], [1, <AlignCenter size={16} />, "Align center"], [2, <AlignRight size={16} />, "Align right"], [3, <AlignJustify size={16} />, "Justify"]].map(([alignment, icon, label]) => <button key={String(alignment)} title={String(label)} onMouseDown={(event) => event.preventDefault()} onClick={() => { setHorizontalAlignmentOpen(false); void alignTextBlocks(Number(alignment) as 0 | 1 | 2 | 3); }}>{icon}</button>)}</div>}</div><div className="alignmentDropdown"><button className="alignmentButton" title="Vertical text alignment" onClick={() => { setVerticalAlignmentOpen((open) => !open); setHorizontalAlignmentOpen(false); }}>{({ top: <AlignVerticalJustifyStart size={16} />, center: <AlignVerticalJustifyCenter size={16} />, bottom: <AlignVerticalJustifyEnd size={16} /> })[textVerticalAlignment]}<ChevronDown size={13} /></button>{verticalAlignmentOpen && <div className="alignmentMenu"><button title="Align top" onClick={() => { setTextVerticalAlignment("top"); setVerticalAlignmentOpen(false); }}><AlignVerticalJustifyStart size={16} /></button><button title="Align center" onClick={() => { setTextVerticalAlignment("center"); setVerticalAlignmentOpen(false); }}><AlignVerticalJustifyCenter size={16} /></button><button title="Align bottom" onClick={() => { setTextVerticalAlignment("bottom"); setVerticalAlignmentOpen(false); }}><AlignVerticalJustifyEnd size={16} /></button></div>}</div><button className={`fillBlockButton ${textFillBlock ? "active" : ""}`} onClick={() => setTextFillBlock((value) => !value)}>Fill</button></div><div className="textEditControls"><textarea ref={focusTextarea} className="editorTextarea" value={focusDraft} autoFocus onScroll={(event) => { if (previewContent.current) syncTextScroll(event.currentTarget, previewContent.current); }} onChange={(event) => { setFocusDraft(event.target.value); setHasTextSelection(event.currentTarget.selectionStart !== event.currentTarget.selectionEnd); }} onSelect={(event) => setHasTextSelection(event.currentTarget.selectionStart !== event.currentTarget.selectionEnd)} onKeyUp={(event) => setHasTextSelection(event.currentTarget.selectionStart !== event.currentTarget.selectionEnd)} onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); void cancelFocusedText(); } if ((event.ctrlKey || event.metaKey) && event.key === "Enter") { event.preventDefault(); void saveFocusedText(); } }} /></div><aside className="textPreviewPane"><div className="textLivePreview"><div ref={previewContent} className="textPreviewContent" onScroll={(event) => { if (focusTextarea.current) syncTextScroll(event.currentTarget, focusTextarea.current); }}>{!focusDraft && <span className="previewPlaceholder">Preview</span>}<MarkdownView value={focusDraft} /></div></div></aside></div></section></div>}
    {imageEdit && <div className="modalBackdrop" onPointerDown={() => void saveFocusedImage()}><section className="editModal" onPointerDown={(event) => event.stopPropagation()} onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); cancelFocusedImage(); } if ((event.ctrlKey || event.metaKey) && event.key === "Enter") { event.preventDefault(); void saveFocusedImage(); } }}><div className="modalHeader"><strong>Edit image</strong><div className="modalHeaderActions"><button className="primaryAction" onClick={() => void saveFocusedImage()}><Save size={16} /> Save</button><button title="Cancel" onClick={cancelFocusedImage}><X size={16} /></button></div></div><div className="editModalBody imageEditBody"><div className="imageUrlRow"><input value={imageEdit.url} onChange={(event) => setImageEdit({ ...imageEdit, url: event.target.value })} /><button onClick={() => void pickOwlbearEditImage()} disabled={!OBR.isAvailable}><ImagePlus size={16} /> Owlbear</button></div><div className="imageOptionRow"><label className="imageOption"><span>Border</span><input type="color" value={imageEdit.borderColor} onChange={(event) => setImageEdit({ ...imageEdit, borderColor: event.target.value })} /></label><label className="imageOption"><span>Fit</span><select value={imageEdit.imageFit} onChange={(event) => setImageEdit({ ...imageEdit, imageFit: event.target.value as ImageEdit["imageFit"] })}><option value="cover">Cover</option><option value="contain">Contain</option></select></label></div></div></section></div>}
    {counterEdit && <div className="modalBackdrop" onPointerDown={() => void saveFocusedCounter()}><section className="editModal counterEditModal" role="dialog" aria-modal="true" aria-labelledby="counter-edit-title" onPointerDown={(event) => event.stopPropagation()}><div className="modalHeader"><strong id="counter-edit-title">Edit counter</strong><div className="modalHeaderActions"><button className="primaryAction" onClick={() => void saveFocusedCounter()}><Save size={16} /> Save</button><button title="Cancel" onClick={cancelFocusedCounter}><X size={16} /></button></div></div><div className="editModalBody counterEditLayout"><section className="counterEditSection"><label>Label<input value={counterEdit.label} maxLength={120} onChange={(event) => setCounterEdit({ ...counterEdit, label: event.target.value })} /></label><label>Label placement<select value={counterEdit.labelPosition} onChange={(event) => setCounterEdit({ ...counterEdit, labelPosition: event.target.value as CounterEdit["labelPosition"] })}><option value="top-left">Top left</option><option value="top-center">Top center</option><option value="top-right">Top right</option><option value="bottom-left">Bottom left</option><option value="bottom-center">Bottom center</option><option value="bottom-right">Bottom right</option></select></label><div className="counterEditNumbers"><label>Value<input type="number" min="0" step="1" value={counterEdit.value} onChange={(event) => setCounterEdit({ ...counterEdit, value: event.target.value })} /></label><label>Maximum<input aria-label="Maximum value" type="number" min="0" step="1" placeholder="no max" value={counterEdit.max} onChange={(event) => setCounterEdit({ ...counterEdit, max: event.target.value })} /></label></div></section><section className="counterEditSection"><strong>Appearance</strong><label className="counterColorField"><span>Normal border</span><input type="color" value={counterEdit.borderColor} onChange={(event) => setCounterEdit({ ...counterEdit, borderColor: event.target.value })} /></label><div className="counterOption"><input aria-label="Enable zero border color" type="checkbox" checked={counterEdit.zeroColorEnabled} onChange={(event) => setCounterEdit({ ...counterEdit, zeroColorEnabled: event.target.checked })} /><span>Zero border color</span><input type="color" disabled={!counterEdit.zeroColorEnabled} aria-label="Zero border color" value={counterEdit.zeroColor} onChange={(event) => setCounterEdit({ ...counterEdit, zeroColor: event.target.value })} /></div><div className="counterOption"><input aria-label="Enable maximum border color" type="checkbox" checked={counterEdit.maxColorEnabled} onChange={(event) => setCounterEdit({ ...counterEdit, maxColorEnabled: event.target.checked })} /><span>Maximum border color</span><input type="color" disabled={!counterEdit.maxColorEnabled} aria-label="Maximum border color" value={counterEdit.maxColor} onChange={(event) => setCounterEdit({ ...counterEdit, maxColor: event.target.value })} /></div><label className="counterOption"><input aria-label="Dim counter at zero" type="checkbox" checked={counterEdit.dimAtZero} onChange={(event) => setCounterEdit({ ...counterEdit, dimAtZero: event.target.checked })} /><span>Dim at zero</span></label></section></div></section></div>}
    {contextItem && <div className="contextMenu" style={{ left: contextItem.x, top: contextItem.y }}><button onClick={() => { openItemEditor(contextItem.item); setContextItem(undefined); }}><Pencil size={15} /> Edit</button><label className="colorMenuItem">Border<input type="color" value={contextItem.item.borderColor ?? DEFAULT_ITEM_BORDER_COLOR} onChange={(event) => activeBoard && void persistBoard({ ...activeBoard, items: activeBoard.items.map((item) => item.id === contextItem.item.id ? { ...item, borderColor: event.target.value } : item) })} /></label><button onClick={() => void deleteItem(contextItem.item.id)}><Trash2 size={15} /> Delete</button></div>}
    {emptyContext && <div className="contextMenu" style={{ left: emptyContext.x, top: emptyContext.y }}><button onClick={() => { void createTextAt({ x: emptyContext.gridX, y: emptyContext.gridY }); setEmptyContext(undefined); }}><Type size={15} /> Add Text Here</button><button onClick={() => { setAddTarget({ x: emptyContext.gridX, y: emptyContext.gridY }); setAddItemType("counter"); setAddModalOpen(true); setEmptyContext(undefined); }}><Plus size={15} /> Add Counter Here</button><button onClick={() => { setAddTarget({ x: emptyContext.gridX, y: emptyContext.gridY }); setAddItemType("image"); setAddModalOpen(true); setEmptyContext(undefined); }}><ImagePlus size={15} /> Add Image Here</button></div>}
    {createOpen && <div className="modalBackdrop" onPointerDown={() => setCreateOpen(false)}><section className="editModal" onPointerDown={(event) => event.stopPropagation()}><div className="modalHeader"><strong>Create Private Board</strong><button onClick={() => setCreateOpen(false)}><Minus size={16} /></button></div><div className="editModalBody"><label>Name<input value={createName} maxLength={60} onChange={(event) => setCreateName(event.target.value)} /></label><label>Scope<select value={createScope} onChange={(event) => setCreateScope(event.target.value as BoardScope)}><option value="scene">Scene</option><option value="room">Room</option></select></label><button className="primaryAction" onClick={() => void createPrivateBoard()}><Plus size={16} /> Create</button></div></section></div>}
    {addModalOpen && <div className="modalBackdrop" onPointerDown={() => setAddModalOpen(false)}><section className="addModal" onPointerDown={(event) => event.stopPropagation()}><div className="modalHeader"><strong>Add item</strong><button onClick={() => setAddModalOpen(false)}><Minus size={16} /></button></div><div className="itemTypeTabs"><button className={addItemType === "text" ? "active" : undefined} onClick={() => setAddItemType("text")}><Type size={16} /> Text</button><button className={addItemType === "image" ? "active" : undefined} onClick={() => setAddItemType("image")}><ImagePlus size={16} /> Image</button><button className={addItemType === "counter" ? "active" : undefined} onClick={() => setAddItemType("counter")}><Plus size={16} /> Counter</button></div><div className="modalGrid"><label>W<input value={itemWidth} onChange={(event) => setItemWidth(event.target.value)} /></label><label>H<input value={itemHeight} onChange={(event) => setItemHeight(event.target.value)} /></label><label>Border<input type="color" value={borderColorDraft} onChange={(event) => setBorderColorDraft(event.target.value)} /></label>{addItemType === "text" ? <button className="primaryAction" onClick={() => { if (activeBoard) void createTextAt(addTarget ?? viewportCenterGrid()).then(() => setAddModalOpen(false)); }}><Type size={16} /> Add text</button> : addItemType === "counter" ? <><label>Initial value<input type="number" min="0" step="1" value={counterValueDraft} onChange={(event) => setCounterValueDraft(event.target.value)} /></label><label>Maximum<input aria-label="Initial maximum value" type="number" min="0" step="1" placeholder="no max" value={counterMaxDraft} onChange={(event) => setCounterMaxDraft(event.target.value)} /></label><button className="primaryAction" onClick={() => void addCounter()}><Plus size={16} /> Add counter</button></> : <><label className="wideField">Image URL<input value={imageDraft} onChange={(event) => { setImageDraft(event.target.value); setImagePreviewSize(undefined); }} /></label><button onClick={() => void pickOwlbearImage()} disabled={!OBR.isAvailable}><ImagePlus size={16} /> Owlbear</button><button className="primaryAction" onClick={() => void addImage()}><ImagePlus size={16} /> Add</button>{imageDraft.trim() && <div className="imagePreviewPanel"><img src={imageDraft.trim()} alt="Image preview" onLoad={(event) => setImagePreviewSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })} onError={() => setImagePreviewSize(undefined)} /></div>}</>}</div></section></div>}
    <div className="resizeGrip" onPointerDown={startResize} title="Resize window"><Grip size={18} /></div>
  </main>;
}

function MarkdownHelp({ open, panelRef }: { open: boolean; panelRef: React.RefObject<HTMLDivElement | null> }) {
  return <div ref={panelRef} id="markdown-help-panel" className={`markdownHelpPanel ${open ? "open" : ""}`} role="dialog" aria-label="Markdown help" aria-hidden={!open}>
    <div className="markdownHelpContent"><strong>Markdown examples</strong>
    <section className="markdownHelpGroup"><strong>Headings</strong><div className="markdownSamples">
      <div className="markdownSample"><code># Heading</code><h1>Heading</h1></div>
      <div className="markdownSample"><code>## Heading</code><h2>Heading</h2></div>
      <div className="markdownSample"><code>### Heading</code><h3>Heading</h3></div>
    </div></section>
    <section className="markdownHelpGroup"><strong>Inline styles</strong><div className="markdownSamples">
      <div className="markdownSample"><code>**bold**</code><strong>Bold text</strong></div>
      <div className="markdownSample"><code>*italic*</code><em>Italic text</em></div>
      <div className="markdownSample"><code>~~strikethrough~~</code><s>Strikethrough</s></div>
      <div className="markdownSample"><code>`inline code`</code><code>inline code</code></div>
    </div></section>
    <section className="markdownHelpGroup"><strong>Blocks and lists</strong><div className="markdownSamples">
      <div className="markdownSample"><code>{"> quote"}</code><blockquote>Quoted text</blockquote></div>
      <div className="markdownSample"><code>- unordered item</code><ul><li>Unordered item</li></ul></div>
      <div className="markdownSample"><code>1. ordered item</code><ol><li>Ordered item</li></ol></div>
      <div className="markdownSample"><code>{"```"} code {"```"}</code><pre><code>block code</code></pre></div>
    </div></section>
    <section className="markdownHelpGroup"><strong>Links and alignment</strong><div className="markdownSamples">
      <div className="markdownSample"><code>[link](https://example.com)</code><a href="https://example.com" target="_blank" rel="noreferrer">Example link</a></div>
      <div className="markdownSample"><code>^1 centered</code><p className="align-1">Centered text</p></div>
      <div className="markdownSample"><code>^2 right</code><p className="align-2">Right-aligned text</p></div>
      <div className="markdownSample"><code>^3 justified</code><p className="align-3">Justified text</p></div>
    </div></section>
    </div>
  </div>;
}

function BoardItemView({ item, selected, cellSize, cellGap, onResizePointerDown, onDoubleClick, onCounterChange, readOnly = false }: { item: BoardItem; selected: boolean; cellSize: number; cellGap: number; onResizePointerDown: (event: React.PointerEvent<HTMLElement>, item: BoardItem) => void; onDoubleClick: (item: BoardItem) => void; onCounterChange: (item: BoardItem, delta: number) => void; readOnly?: boolean }) {
  const inset = Math.min(cellGap, Math.max(0, (Math.min(item.gridWidth, item.gridHeight) * cellSize) / 2 - 4)); const value = item.counterValue ?? 0; const atMax = item.type === "counter" && item.counterMax !== undefined && value === item.counterMax;
  const borderColor = atMax && item.counterMaxColorEnabled ? item.counterMaxColor : item.type === "counter" && value === 0 && item.counterZeroColorEnabled ? item.counterZeroColor : item.borderColor ?? DEFAULT_ITEM_BORDER_COLOR;
  const stopControl = (event: React.SyntheticEvent) => event.stopPropagation();
  const textScale = item.type === "text" && item.fillBlock !== false ? textFillScale(item.gridWidth, item.textBaselineWidth ?? item.gridWidth) : 1;
  return <article className={`boardItem ${item.type} ${selected ? "selected" : ""} ${item.type === "counter" && value === 0 && item.counterDimAtZero !== false ? "zeroDim" : ""}`} style={{ left: item.gridX * cellSize + inset, top: item.gridY * cellSize + inset, width: Math.max(8, item.gridWidth * cellSize - inset * 2), height: Math.max(8, item.gridHeight * cellSize - inset * 2), borderColor }} onMouseDown={(event) => { if (event.detail === 2) { event.stopPropagation(); onDoubleClick(item); } }} onDoubleClick={(event) => { event.stopPropagation(); onDoubleClick(item); }}>
    {item.type === "image" && item.imageUrl ? <img src={item.imageUrl} alt="Board item" style={{ objectFit: item.imageFit ?? "cover" }} /> : item.type === "counter" ? <><div className={`counterContent ${item.counterLabelPosition ?? "top-center"}`}>{item.counterLabel && <span className="counterLabel" title={item.counterLabel}>{item.counterLabel}</span>}<div className="counterNumbers"><strong>{value}</strong>{item.counterMax !== undefined && <span>/ {item.counterMax}</span>}</div></div>{!readOnly && <><button className="counterControl" aria-label="Decrease counter" disabled={value === 0} onPointerDown={stopControl} onMouseDown={stopControl} onDoubleClick={stopControl} onClick={(event) => { stopControl(event); void onCounterChange(item, -1); }}><Minus size={16} /></button><button className="counterControl" aria-label="Increase counter" disabled={atMax} onPointerDown={stopControl} onMouseDown={stopControl} onDoubleClick={stopControl} onClick={(event) => { stopControl(event); void onCounterChange(item, 1); }}><Plus size={16} /></button></>} </> : <div className={`textPreview textAlign-${item.textVerticalAlignment ?? "top"}`} style={{ "--text-scale": textScale } as CSSProperties}><div className="textScaleContent"><MarkdownView value={item.text || ""} /></div></div>}
    {!readOnly && <button className="itemResizeHandle" title="Resize item" onPointerDown={(event) => onResizePointerDown(event, item)}><Maximize2 size={13} /></button>}
  </article>;
}