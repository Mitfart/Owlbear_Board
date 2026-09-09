import OBR from "@owlbear-rodeo/sdk";
import { AlignCenter, AlignJustify, AlignLeft, AlignRight, AlignVerticalJustifyCenter, AlignVerticalJustifyEnd, AlignVerticalJustifyStart, Bold, Check, ChevronDown, CircleAlert, Grip, ImagePlus, Italic, Maximize2, Minus, PanelsTopLeft, Pencil, Plus, Save, Settings, Trash2, Type, X } from "lucide-react";
import type React from "react";
import type { Theme } from "@owlbear-rodeo/sdk";
import type { CSSProperties } from "react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { BOARD_DATA_LIMIT_BYTES, DEFAULT_CELL_GAP, DEFAULT_CELL_SIZE, DEFAULT_COUNTER_MAX_COLOR, DEFAULT_COUNTER_ZERO_COLOR, DEFAULT_ITEM_BORDER_COLOR, DEFAULT_WINDOW, EXTENSION_ID, BOARD_EVENT_CHANNEL, EDIT_PRESENCE_CHANNEL, MAX_CELL_GAP, MAX_CELL_SIZE, MIN_CELL_GAP, MIN_CELL_SIZE } from "./constants";
import { boardItemAt, collides, updateBoardItemRect } from "./grid";
import { clampColorValue, hexToHsv, hsvToHex, type HsvColor } from "./color";
import { createId, nowIso } from "./ids";
import { MarkdownView, TaskToggle, toggleTaskMarkdown } from "./markdown";
import { resizeAction } from "./owlbear";
import { autoImageSize, autoTextSize, clampNumber, counterMinimumReached, normalizeCounterValue, parseItemSize, textFillScale } from "./sizing";
import { zoomPanToCursor } from "./viewport";
import { toggleMarkdownStyle } from "./textFormatting";
import { createBoardMutationCoordinator, reconcileRefreshedBoards, type BoardMutationCoordinator } from "./boardCoordinator";
import { boardByteSize, carryRoomBoardsToCurrentScene, clearAllBoardData, clearColorPaletteData, deleteBoard, getColorPaletteSceneData, getPlayerId, getPlayerName, getSceneKey, loadAllVisibleBoards, loadColorPalette, loadPreferences, loadWindowPreferences, markPrivateBoardOpened, movePrivateRoomBoardToScene, saveBoard, saveColorPalette, savePreferences, saveViewport, saveWindowPreferences } from "./storage";
import { updateBoardItem } from "./editorAutosave";
import { activeEditPresence, shouldBroadcastEditPresence, visibleEditPresence, type EditPresence } from "./editingPresence";
import { buildBoardPickerRows } from "./boardSession";
import { canDeleteBoard, canEditBoard, canRenameBoard, type PlayerRole } from "./boardPermissions";
import type { Board, BoardItem, BoardScope, BoardVisibility, PlayerPreferences } from "./types";

type DragState = { itemId: string; offsetX: number; offsetY: number; startX: number; startY: number; gridX?: number; gridY?: number; moved: boolean };
type ResizeItemState = { itemId: string; gridX: number; gridY: number; gridWidth: number; gridHeight: number };
type AddTarget = { x: number; y: number } | undefined;
type ImageEdit = { itemId: string; url: string; borderColor: string; imageFit: "cover" | "contain" };
type CounterEdit = { itemId: string; label: string; labelPosition: NonNullable<BoardItem["counterLabelPosition"]>; value: string; min: string; max: string; borderColor: string; minColorEnabled: boolean; minColor: string; maxColorEnabled: boolean; maxColor: string; dimAtZero: boolean };

const OWLBEAR_COLORS = ["#1a6aff", "#ff7433", "#ff4d4d", "#ffd433", "#B07126", "#884dff", "#85ff66", "#519E00", "#eb8aff", "#44e0f1", "#0e0f16", "#222222", "#5a5a5a", "#b3b3b3", "#ffffff"];
const ColorPickerPreferences = createContext({ paletteColors: [] as string[], onAddColor: (_color: string) => {}, onUpdateColor: (_previous: string, _next: string) => {}, onDeleteColor: (_color: string) => {} });

export function paletteForSlots(savedPalette?: string[]) {
  if (Array.isArray(savedPalette)) {
    const slots = savedPalette.slice(0, 20);
    return slots.flatMap((slot, index) => slot === "-" ? OWLBEAR_COLORS[index] ? [OWLBEAR_COLORS[index]] : [] : hexToHsv(slot) ? [slot] : []);
  }
  return OWLBEAR_COLORS;
}

export function contextItemWithBorder<T extends Pick<BoardItem, "id" | "borderColor">>(contextItem: { item: T; x: number; y: number } | undefined, borderColor: string) {
  if (!contextItem) return undefined;
  return { ...contextItem, item: { ...contextItem.item, borderColor } };
}

function toPaletteSlots(colors: string[]) {
  return colors.slice(0, 20).map((color, index) => OWLBEAR_COLORS[index]?.toLowerCase() === color.toLowerCase() ? "-" : color.toLowerCase());
}

function ColorPicker({ value, defaultColor = DEFAULT_ITEM_BORDER_COLOR, onChange, disabled = false }: { value: string; defaultColor?: string; onChange: (value: string) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [customEditorOpen, setCustomEditorOpen] = useState(false);
  const [customHsv, setCustomHsv] = useState<HsvColor>(() => hexToHsv(value) ?? { hue: 0, saturation: 0, value: 100 });
  const [customHex, setCustomHex] = useState(value);
  const [editingPaletteColor, setEditingPaletteColor] = useState<string>();
  const { paletteColors, onAddColor, onUpdateColor, onDeleteColor } = useContext(ColorPickerPreferences);
  const pickerRef = useRef<HTMLSpanElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const paletteClickTimer = useRef<number | undefined>(undefined);
  const [menuPosition, setMenuPosition] = useState<{ top: number; left: number }>();
  const previewColor = hsvToHex(customHsv);
  const beginCustomColor = (color = value, paletteColor?: string) => {
    const hsv = hexToHsv(color) ?? { hue: 0, saturation: 0, value: 100 };
    setCustomHsv(hsv);
    setCustomHex(hsvToHex(hsv));
    setEditingPaletteColor(paletteColor);
    setCustomEditorOpen(true);
  };
  const updateCustomHsv = (next: HsvColor) => { setCustomHsv(next); setCustomHex(hsvToHex(next)); };
  const choosePaletteColor = (color: string) => {
    if (paletteClickTimer.current !== undefined) return;
    paletteClickTimer.current = window.setTimeout(() => {
      const selected = color.toLowerCase() === value.toLowerCase();
      onChange(selected ? defaultColor : color);
      setOpen(false);
      paletteClickTimer.current = undefined;
    }, 250);
  };
  const editPaletteColor = (color: string) => {
    if (paletteClickTimer.current !== undefined) { window.clearTimeout(paletteClickTimer.current); paletteClickTimer.current = undefined; }
    beginCustomColor(color, color);
  };
  useEffect(() => {
    if (!open) return;
    const updatePosition = () => {
      const rect = pickerRef.current?.getBoundingClientRect();
      if (rect) setMenuPosition({ top: rect.bottom + 6, left: rect.left });
    };
    const closeOnOutsidePointer = (event: PointerEvent) => { if (event.target instanceof Node && !pickerRef.current?.contains(event.target) && !menuRef.current?.contains(event.target)) setOpen(false); };
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    updatePosition();
    document.addEventListener("pointerdown", closeOnOutsidePointer, true);
    document.addEventListener("keydown", closeOnEscape);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => { if (paletteClickTimer.current !== undefined) window.clearTimeout(paletteClickTimer.current); document.removeEventListener("pointerdown", closeOnOutsidePointer, true); document.removeEventListener("keydown", closeOnEscape); window.removeEventListener("resize", updatePosition); window.removeEventListener("scroll", updatePosition, true); };
  }, [open]);
  const menu = open && menuPosition && createPortal(<div ref={menuRef} className="owlbearColorMenu" role="menu" style={menuPosition} onPointerDown={(event) => event.stopPropagation()}>{customEditorOpen ? <div className="customColorEditor"><div className="colorSaturation" style={{ backgroundColor: `hsl(${customHsv.hue} 100% 50%)` }}><div aria-label="Color" aria-valuetext={`Saturation ${Math.round(customHsv.saturation)}%, Brightness ${Math.round(customHsv.value)}%`} className="colorInteractive" role="slider" tabIndex={0} onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); const rect = event.currentTarget.getBoundingClientRect(); updateCustomHsv({ ...customHsv, saturation: clampColorValue((event.clientX - rect.left) / rect.width * 100, 0, 100), value: clampColorValue((rect.bottom - event.clientY) / rect.height * 100, 0, 100) }); }} onPointerMove={(event) => { if (!event.currentTarget.hasPointerCapture(event.pointerId)) return; const rect = event.currentTarget.getBoundingClientRect(); updateCustomHsv({ ...customHsv, saturation: clampColorValue((event.clientX - rect.left) / rect.width * 100, 0, 100), value: clampColorValue((rect.bottom - event.clientY) / rect.height * 100, 0, 100) }); }}><span className="colorPointer colorSaturationPointer" style={{ top: `${100 - customHsv.value}%`, left: `${customHsv.saturation}%` }}><span style={{ backgroundColor: previewColor }} /></span></div></div><input aria-label="Hue" className="colorHue" type="range" min="0" max="360" value={customHsv.hue} onChange={(event) => updateCustomHsv({ ...customHsv, hue: Number(event.target.value) })} /><input aria-label="Hex value" className="colorHexInput" spellCheck={false} value={customHex} onChange={(event) => { const next = event.target.value; setCustomHex(next); const hsv = hexToHsv(next); if (hsv) setCustomHsv(hsv); }} /><div className="customColorActions">{editingPaletteColor && <button type="button" aria-label="Delete color" title="Delete" onClick={() => { onDeleteColor(editingPaletteColor); setCustomEditorOpen(false); }}><Trash2 size={18} /></button>}<button type="button" aria-label="Cancel custom color" title="Cancel" onClick={() => setCustomEditorOpen(false)}><X size={18} /></button><button type="button" aria-label="Save custom color" title="Save" disabled={!hexToHsv(customHex)} onClick={() => { onChange(previewColor); if (editingPaletteColor) onUpdateColor(editingPaletteColor, previewColor); else onAddColor(previewColor); setOpen(false); setCustomEditorOpen(false); }}><Check size={18} /></button></div></div> : <><div className="colorPalette">{paletteColors.map((color) => <button key={color} type="button" role="menuitemradio" aria-label={color} aria-checked={color.toLowerCase() === value.toLowerCase()} onClick={() => choosePaletteColor(color)} onDoubleClick={() => editPaletteColor(color)}><span style={{ backgroundColor: color }} /></button>)}{paletteColors.length < 20 && <button type="button" className="customColorButton" aria-label="Add custom color" title="Add custom color" onClick={() => beginCustomColor()}><Plus size={16} /></button>}</div></>}</div>, document.body);
  return <span ref={pickerRef} className="owlbearColorPicker"><button type="button" aria-label={`Color ${value}`} aria-expanded={open} disabled={disabled} onClick={() => { if (!open) setCustomEditorOpen(false); setOpen((current) => !current); }}><span style={{ backgroundColor: value }} /></button>{menu}</span>;
}

const DEFAULT_ZOOM = 0.6;
const MIN_ZOOM = 0.05;
const MAX_ZOOM = 2;
const DEFAULT_PAN = { x: 260, y: 180 };
const SAMPLE_IMAGE = "https://images.unsplash.com/photo-1549880338-65ddcdfd017b?auto=format&fit=crop&w=900&q=80";
const AUTO_SIZE = "auto";

function formatDebugError(reason: unknown) {
  if (reason instanceof Error) return `${reason.message}${reason.stack ? `\n${reason.stack}` : ""}`;
  try { return JSON.stringify(reason, null, 2); } catch { return String(reason); }
}

function boardMetadata(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => key.startsWith(EXTENSION_ID)));
}

function boardSceneItems(value: unknown) {
  return Array.isArray(value) ? value.filter((item) => !!item && typeof item === "object" && ((item as { data?: { namespace?: unknown } }).data?.namespace === `${EXTENSION_ID}/shared-scene-board` || (item as { metadata?: Record<string, unknown> }).metadata?.[`${EXTENSION_ID}/shared-scene-board`])) : value;
}
const FALLBACK_THEME: Theme = { mode: "DARK", primary: { main: "#bb99ff", light: "#d2bdff", dark: "#826bb2", contrastText: "#ffffff" }, secondary: { main: "#03dac6", light: "#66fff8", dark: "#00a896", contrastText: "#ffffff" }, background: { default: "#1e2231", paper: "#2c3042" }, text: { primary: "#ffffff", secondary: "#ffffff", disabled: "#ffffff" } };

function createItemBase(gridX: number, gridY: number, gridWidth: number, gridHeight: number) {
  const timestamp = nowIso();
  return { id: createId("board_item"), gridX, gridY, gridWidth, gridHeight, updatedAt: timestamp };
}

function sampleBoard(): Board {
  const timestamp = nowIso();
  return {
    id: "preview", name: "Preview Board", scope: "scene", visibility: "private", revision: 1, cellSizePx: DEFAULT_CELL_SIZE, cellGapPx: DEFAULT_CELL_GAP, updatedAt: timestamp,
    items: [
      { ...createItemBase(0, 0, 3, 2), type: "text", text: "## Clue\n- **Blood** on the door\n- A cold draft", borderColor: DEFAULT_ITEM_BORDER_COLOR },
      { ...createItemBase(4, 0, 3, 2), type: "image", imageUrl: SAMPLE_IMAGE, borderColor: "#03dac6" },
      { ...createItemBase(-2, 3, 3, 1), type: "text", text: "NPC reaction", borderColor: "#ffb86b" },
    ],
  };
}

function makeBoard(scope: BoardScope, visibility: BoardVisibility, name?: string, ownerId?: string): Board {
  const timestamp = nowIso();
  return { id: createId("board"), name: visibility === "shared" ? `Shared ${scope === "scene" ? "Scene" : "Room"} Board` : name || `New ${scope === "scene" ? "Scene" : "Room"} Board`, scope, visibility, ownerId, allowedUserIds: visibility === "private" && ownerId ? [ownerId] : undefined, revision: 0, cellSizePx: DEFAULT_CELL_SIZE, cellGapPx: DEFAULT_CELL_GAP, items: [], updatedAt: timestamp };
}

function firstFreeNear(board: Board, gridX: number, gridY: number, gridWidth: number, gridHeight: number) {
  if (!collides(board, gridX, gridY, gridWidth, gridHeight)) return { x: gridX, y: gridY };
  for (let radius = 1; ; radius += 1) {
    for (let y = gridY - radius; y <= gridY + radius; y += 1) {
      for (let x = gridX - radius; x <= gridX + radius; x += 1) {
        if (!collides(board, x, y, gridWidth, gridHeight)) return { x, y };
      }
    }
  }
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
  const [warning, setWarning] = useState<string>();
  const [editPresence, setEditPresence] = useState<EditPresence>();
  const [presenceNow, setPresenceNow] = useState(() => Date.now());
  const [saveStatus, setSaveStatus] = useState<string>();
  const [debugOpen, setDebugOpen] = useState(false);
  const [manageBoardsOpen, setManageBoardsOpen] = useState(false);
  const [debugSnapshot, setDebugSnapshot] = useState<unknown>();
  const [debugLogs, setDebugLogs] = useState<string[]>([]);
  const [pan, setPan] = useState(DEFAULT_PAN);
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);
  const [windowSize, setWindowSize] = useState(DEFAULT_WINDOW);
  const [boardPanelOpen, setBoardPanelOpen] = useState(false);
  const [boardPanelBoard, setBoardPanelBoard] = useState<Board>();
  const [boardPanelPosition, setBoardPanelPosition] = useState<{ x: number; y: number }>();
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
  const [counterMinDraft, setCounterMinDraft] = useState("");
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
  const [textFontSize, setTextFontSize] = useState(16);
  const [textColor, setTextColor] = useState("#ffffff");
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
  const [theme, setTheme] = useState<Theme>(FALLBACK_THEME);
  const [colorPalette, setColorPalette] = useState<string[]>();
  const logDebug = useCallback((message: string) => setDebugLogs((logs) => [`${new Date().toISOString()} ${message}`, ...logs].slice(0, 100)), []);
  const reportPaletteFailure = useCallback((operation: "load" | "save", reason: unknown) => {
    const message = formatDebugError(reason);
    setError(`Could not ${operation} color palette: ${message}`);
    logDebug(`Could not ${operation} color palette: ${message}`);
    if (OBR.isAvailable) void OBR.notification.show(`Could not ${operation} color palette.`, "ERROR");
  }, [logDebug]);

  const updateColorPalette = useCallback(async (update: (palette: string[]) => string[]) => {
    const next = toPaletteSlots(update(paletteForSlots(colorPalette)).slice(0, 20));
    setColorPalette(next);
    try { await saveColorPalette(next); } catch (reason) { setColorPalette(colorPalette); reportPaletteFailure("save", reason); }
  }, [colorPalette, reportPaletteFailure]);
  const addPaletteColor = useCallback((color: string) => void updateColorPalette((palette) => palette.length >= 20 || palette.some((entry) => entry.toLowerCase() === color.toLowerCase()) ? palette : [...palette, color.toLowerCase()]), [updateColorPalette]);
  const updatePaletteColor = useCallback((previous: string, next: string) => void updateColorPalette((palette) => palette.map((entry) => entry.toLowerCase() === previous.toLowerCase() ? next.toLowerCase() : entry).filter((entry, index, values) => values.findIndex((candidate) => candidate.toLowerCase() === entry.toLowerCase()) === index)), [updateColorPalette]);
  const deletePaletteColor = useCallback((color: string) => void updateColorPalette((palette) => palette.filter((entry) => entry.toLowerCase() !== color.toLowerCase())), [updateColorPalette]);
  const gridRef = useRef<HTMLDivElement>(null);
  const focusTextarea = useRef<HTMLTextAreaElement>(null);
  const previewContent = useRef<HTMLDivElement>(null);
  const textEditorReturnFocus = useRef<HTMLElement | null>(null);
  const markdownHelpPanel = useRef<HTMLDivElement>(null);
  const markdownHelpTrigger = useRef<HTMLButtonElement>(null);
  const textScrollSyncing = useRef(false);
  const tabDrag = useRef<{ x: number; scrollLeft: number; moved: boolean; pointerId: number } | undefined>(undefined);
  const counterChangeQueue = useRef(Promise.resolve());
  const saveFocusedEditorRef = useRef<(discardEmptyNewText?: boolean) => Promise<boolean>>(async () => false);
  const editorDirty = useRef(false);
  const immediateEditorSave = useRef(false);
  const pendingCounterChanges = useRef(0);
  const mutationCoordinator = useRef<BoardMutationCoordinator | undefined>(undefined);
  const activeBoard = useMemo(() => boards.find((board) => board.id === activeBoardId), [activeBoardId, boards]);
  const showPreview = !activeBoard && boards.length === 0 && !previewDismissed;
  const displayBoard = activeBoard ?? (showPreview ? sampleBoard() : undefined);
  const currentEditPresence = activeEditPresence(editPresence, presenceNow);
  const visibleItemPresence = currentEditPresence && visibleEditPresence(currentEditPresence, displayBoard, playerRole, playerId, presenceNow) ? currentEditPresence : undefined;
  const isPreview = displayBoard?.id === "preview";
  const readOnly = !!activeBoard && !canEditBoard(activeBoard, playerRole, playerId);
  const boardSettings = boardPanelBoard ?? activeBoard;
  const boardSettingsReadOnly = !!boardSettings && !canEditBoard(boardSettings, playerRole, playerId);
  const canPickOwlbearImages = OBR.isAvailable && playerRole === "GM";
  const canDeleteActiveBoard = !!activeBoard && canDeleteBoard(activeBoard, playerRole, playerId);
  const boardAtLimit = !!activeBoard && boardByteSize(activeBoard) >= BOARD_DATA_LIMIT_BYTES;
  const themeVars = useMemo(() => {
    const alpha = (color: string, opacity: number) => {
      const hex = color.replace("#", "");
      if (!/^[0-9a-f]{6}$/i.test(hex)) return color;
      const rgb = [0, 2, 4].map((index) => Number.parseInt(hex.slice(index, index + 2), 16));
      return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${opacity})`;
    };
    const primary = theme.primary;
    return {
      "--bg": theme.background.default,
      "--surface": theme.background.paper,
      "--panel": theme.background.paper,
      "--panel-soft": theme.background.default,
      "--panel-raised": theme.background.paper,
      "--border": "rgba(187, 153, 255, 0.14)",
      "--border-strong": "rgba(187, 153, 255, 0.28)",
      "--text": theme.text.primary,
      "--muted": theme.text.secondary,
      "--muted-2": theme.text.disabled,
      "--accent": primary.main,
      "--accent-strong": primary.light,
      "--accent-dark": primary.dark,
      "--accent-soft": alpha(primary.main, 0.16),
      "--danger": theme.secondary.main,
      "--shadow": "rgba(4, 6, 14, 0.42)",
    } as CSSProperties;
  }, [theme]);

  if (!mutationCoordinator.current) mutationCoordinator.current = createBoardMutationCoordinator({
    save: saveBoard,
    apply: (next) => setBoards((current) => current.some((board) => board.id === next.id) ? current.map((board) => board.id === next.id ? next : board) : [next, ...current]),
    discard: (boardId) => setBoards((current) => current.filter((board) => board.id !== boardId)),
    reportError: (reason) => { const message = formatDebugError(reason); setError(message); if (OBR.isAvailable) void OBR.notification.show(message, "ERROR"); },
    reportDebug: logDebug,
  });

  const refresh = useCallback(async () => {
    const role = OBR.isAvailable ? await OBR.player.getRole() : "GM" as const;
    const id = await getPlayerId();
    const [visible, prefs, win, key] = await Promise.all([loadAllVisibleBoards(role, id), loadPreferences(), loadWindowPreferences(), getSceneKey()]);
    let palette: string[] | undefined;
    try { palette = await loadColorPalette(); } catch (reason) { reportPaletteFailure("load", reason); }
    const ordered = role === "GM" ? visible.boards : buildBoardPickerRows({
      privateSceneBoards: visible.privateScene.boards,
      privateRoomBoards: visible.privateRoom.boards,
      sharedSceneBoards: visible.sharedScene.boards,
      sharedRoomBoards: visible.sharedRoom.boards,
      preferences: prefs,
      sceneKey: key,
    }).flatMap((row) => row.kind === "board" ? [row.board] : []);
    const reconciled = reconcileRefreshedBoards(ordered, mutationCoordinator.current!);
    setSceneKey(key); setPlayerId(id); setPreferences(prefs); setColorPalette(palette); setPlayerRole(role); setPreviewDismissed(!!prefs.previewDismissed); setBoards((current) => JSON.stringify(current) === JSON.stringify(reconciled) ? current : reconciled); setWindowSize(win); await resizeAction(win.width, win.height);
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
  }, [reportPaletteFailure]);
  const refreshIfSafe = useCallback(() => {
    if (!focusedItemId && !dragState && !resizeItemState && pendingCounterChanges.current === 0 && !mutationCoordinator.current?.pending()) void refresh();
  }, [dragState, focusedItemId, refresh, resizeItemState]);

  useEffect(() => {
    if (!OBR.isAvailable) { void refresh(); return; }
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;
    let unsubscribeItems: (() => void) | undefined;
    let unsubscribeSceneMetadata: (() => void) | undefined;
    let unsubscribeRoomMetadata: (() => void) | undefined;
    OBR.onReady(() => {
      if (cancelled) return;
      setReady(true); void refreshIfSafe(); unsubscribeSceneMetadata = OBR.scene.onMetadataChange(refreshIfSafe); unsubscribeRoomMetadata = OBR.room.onMetadataChange(refreshIfSafe); void OBR.theme.getTheme().then(setTheme);
      const subscribeItems = () => {
        if (unsubscribeItems) return;
        const items = (OBR.scene as unknown as { items?: { onChange?: (callback: () => void) => () => void } }).items;
        if (items?.onChange) unsubscribeItems = items.onChange(refreshIfSafe);
      };
      void OBR.scene.isReady().then((sceneReady) => { if (sceneReady) subscribeItems(); });
      unsubscribe = (OBR.scene as unknown as { onReadyChange(callback: (sceneReady: boolean) => void): () => void }).onReadyChange((sceneReady) => {
        if (!sceneReady) { setReady(false); unsubscribeItems?.(); unsubscribeItems = undefined; }
        else { setReady(true); subscribeItems(); void carryRoomBoardsToCurrentScene().then(refreshIfSafe); }
      });
    });
    return () => { cancelled = true; unsubscribe?.(); unsubscribeItems?.(); unsubscribeSceneMetadata?.(); unsubscribeRoomMetadata?.(); };
  }, [refreshIfSafe]);
  useEffect(() => { if (!OBR.isAvailable || !ready) return; return OBR.theme.onChange(setTheme); }, [ready]);
  useEffect(() => { const timer = window.setInterval(() => setPresenceNow(Date.now()), 1000); return () => window.clearInterval(timer); }, []);
  useEffect(() => { if (!OBR.isAvailable || !ready) return; const timer = window.setInterval(() => refreshIfSafe(), 5000); return () => window.clearInterval(timer); }, [ready, refreshIfSafe]);
  useEffect(() => { if (!OBR.isAvailable || !ready) return; return OBR.broadcast.onMessage(BOARD_EVENT_CHANNEL, (message) => { const value = (message.data ?? {}) as { boardId?: string; itemIds?: string[] }; if (value.boardId === activeBoardId && focusedItemId && (!value.itemIds || value.itemIds.includes(focusedItemId))) setWarning("This Board Item changed while you were editing; your draft is retained."); else refreshIfSafe(); }); }, [ready, refreshIfSafe, focusedItemId, activeBoardId]);
  useEffect(() => { if (!OBR.isAvailable || !ready) return; return OBR.broadcast.onMessage(EDIT_PRESENCE_CHANNEL, (message) => { const value = message.data; if (!value || typeof value !== "object") return; const next = value as EditPresence; if (next.playerId !== playerId && visibleEditPresence(next, activeBoard, playerRole, playerId)) setEditPresence(next); }); }, [ready, playerId, activeBoard, playerRole]);
  useEffect(() => { if (!focusedItemId || !activeBoard) { setEditPresence((current) => current?.playerId === playerId ? undefined : current); return; } void announceEditPresence(focusedItemId); const timer = window.setInterval(() => void announceEditPresence(focusedItemId), 3000); return () => window.clearInterval(timer); }, [focusedItemId, activeBoard?.id, playerId]);
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
    if (!error && !warning) return;
    const timeout = window.setTimeout(() => { setError(undefined); setWarning(undefined); }, 5000);
    return () => window.clearTimeout(timeout);
  }, [error, warning]);

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


  useEffect(() => {
    if (!boardPanelOpen) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target : undefined;
      if (!target?.closest(".boardPanel, .boardToggle, .manageBoardSettings")) { setBoardPanelOpen(false); setBoardPanelBoard(undefined); }
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer, true);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointer, true);
  }, [boardPanelOpen]);

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

  async function openDebugTab() {
    setDebugOpen(true);
    logDebug("Collecting save/load diagnostics.");
    const capture = async <T,>(action: () => Promise<T>) => {
      try { return await action(); } catch (reason) { return { error: formatDebugError(reason) }; }
    };
    const capturePaletteSceneData = async () => {
      try { return await getColorPaletteSceneData(); } catch (reason) {
        reportPaletteFailure("load", reason);
        return { error: formatDebugError(reason) };
      }
    };
    const sceneReady = OBR.isAvailable ? await capture(() => OBR.scene.isReady()) : false;
    const readyScene = sceneReady === true;
    const [playerMetadata, paletteSceneData, roomMetadata, sceneMetadata, sceneItems, visibleBoards] = OBR.isAvailable
      ? await Promise.all([
        capture(() => OBR.player.getMetadata()), capturePaletteSceneData(), capture(() => OBR.room.getMetadata()),
        readyScene ? capture(() => OBR.scene.getMetadata()) : undefined,
        readyScene ? capture(() => (OBR.scene as unknown as { items: { getItems(): Promise<unknown[]> } }).items.getItems()) : [],
        capture(() => loadAllVisibleBoards(playerRole, playerId)),
      ])
      : [undefined, undefined, undefined, undefined, [], undefined];
    const snapshot = {
      capturedAt: new Date().toISOString(),
      diagnostics: { available: OBR.isAvailable, sceneReady, ready, playerRole, playerId, sceneKey, activeBoardId, saveStatus, error },
      uiBoards: boards,
      playerMetadata: boardMetadata(playerMetadata), paletteSceneData, roomMetadata: boardMetadata(roomMetadata), sceneMetadata: boardMetadata(sceneMetadata), sceneItems: boardSceneItems(sceneItems), visibleBoards,
    };
    setDebugSnapshot(snapshot);
    logDebug("Save/load diagnostics collected.");
    console.info("[Owlbear Board debug]", snapshot);
  }

  async function clearDebugData() {
    if (!confirm("Clear all Owlbear Board scene, room, and local data? This cannot be undone.")) return;
    try {
      await clearAllBoardData();
      clearBoardUi(); setActiveBoardId(undefined); setOpenBoardIds([]); setDebugSnapshot(undefined);
      logDebug("Cleared all Owlbear Board data.");
      await refresh(); await openDebugTab();
    } catch (reason) {
      const message = formatDebugError(reason);
      setError(message); logDebug(`Could not clear Board data: ${message}`);
      if (OBR.isAvailable) void OBR.notification.show("Could not clear Board data.", "ERROR");
    }
  }

  async function clearPaletteSceneData() {
    if (!confirm("Clear the shared color palette for this scene? Board data will be kept.")) return;
    try {
      await clearColorPaletteData();
      setColorPalette(undefined); setDebugSnapshot(undefined);
      logDebug("Cleared color palette Scene Data Item.");
      await refresh(); await openDebugTab();
    } catch (reason) {
      const message = formatDebugError(reason);
      setError(message); logDebug(`Could not clear color palette data: ${message}`);
      if (OBR.isAvailable) void OBR.notification.show("Could not clear color palette data.", "ERROR");
    }
  }

  async function persistBoard(board: Board | { boardId: string; update: (current: Board) => Board }, pushHistory = true, reportSave = false, activate = true) {
    const boardId = "update" in board ? board.boardId : board.id;
    const current = mutationCoordinator.current?.current(boardId) ?? ("update" in board ? undefined : board);
    if (!current || !canEditBoard(current, playerRole, playerId)) return false;
    const saved = await mutationCoordinator.current?.mutate(board, pushHistory);
    if (!saved) return false;
    if (activate) setActiveBoardId(saved.id);
    setError(undefined); setSaveStatus(reportSave ? "Saved" : undefined);
    return true;
  }

  function clearBoardUi() {
    setContextItem(undefined); setEmptyContext(undefined); setFocusedItemId(undefined); setFocusDraft(""); setImageEdit(undefined); setCounterEdit(undefined); setHasTextSelection(false); setNewFocusedItemId(undefined); setSelectedItemId(undefined); setDragState(undefined); setResizeItemState(undefined); setAddModalOpen(false); setAddTarget(undefined);
  }

  async function chooseBoard(board: Board, openTab = true) {
    if (board.id !== activeBoardId && !await saveFocusedEditorRef.current()) return;
    const viewport = preferences?.viewportByBoardId[board.id];
    clearBoardUi(); setActiveBoardId(board.id); setPan(viewport?.pan ?? DEFAULT_PAN); setZoom(viewport?.zoom ?? DEFAULT_ZOOM); setManageBoardsOpen(false); if (openTab) setOpenBoardIds((ids) => ids.includes(board.id) ? ids : [...ids, board.id]); await markPrivateBoardOpened(board);
  }

  async function closeBoardTab(boardId: string) {
    const index = openBoardIds.indexOf(boardId);
    const nextId = openBoardIds[index + 1] ?? openBoardIds[index - 1];
    if (activeBoardId === boardId && !await saveFocusedEditorRef.current()) return;
    setOpenBoardIds((ids) => ids.filter((id) => id !== boardId));
    if (activeBoardId === boardId) {
      const next = boards.find((board) => board.id === nextId);
      if (next) await chooseBoard(next);
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
    await movePrivateRoomBoardToScene({ ...activeBoard, updatedAt: nowIso() });
    await refresh();
  }

  async function createShared(scope: BoardScope) {
    const existing = boards.find((b) => b.visibility === "shared" && b.scope === scope);
    if (existing) return chooseBoard(existing);
    const board = makeBoard(scope, "shared", undefined, playerId);
    if (!await persistBoard(board, false)) return;
    await refresh(); await chooseBoard(board);
  }

  async function createPrivateBoard() {
    const name = createName.trim();
    if (!name || name.length > 60) return;
    const duplicate = boards.some((b) => b.visibility === "private" && b.scope === createScope && b.name.trim().toLowerCase() === name.toLowerCase());
    if (duplicate) return;
    const board = { ...makeBoard(createScope, "private", name, playerId), ownerName: await getPlayerName() };
    if (!await persistBoard(board, false)) return;
    await markPrivateBoardOpened(board); setCreateOpen(false); await refresh(); await chooseBoard(board);
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
  async function updateBoardSettings(update: Partial<Board>) {
    if (!boardSettings || !canEditBoard(boardSettings, playerRole, playerId) || ("name" in update && !canRenameBoard(boardSettings, playerRole))) return;
    const next = { ...boardSettings, ...update }; setBoardPanelBoard(next); await persistBoard(next, true, false, false);
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
    if (boardAtLimit) { setWarning("Board has reached the 1 MB data limit."); return; }
    textEditorReturnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const size = resolveItemSize("text");
    const gridWidth = clampNumber(size.width, 1, 24); const gridHeight = clampNumber(size.height, 1, 24);
    const position = firstFreeNear(activeBoard, target.x, target.y, gridWidth, gridHeight);
    const item: BoardItem = { ...createItemBase(position.x, position.y, gridWidth, gridHeight), type: "text", text: "", textBaselineWidth: autoTextSize("").width, fontSize: 16, textColor: "#ffffff", fillBlock: true, textVerticalAlignment: "top", borderColor: borderColorDraft };
    if (!await persistBoard({ ...activeBoard, items: [...activeBoard.items, item] })) return;
    const alignment = preferences?.textAlignment ?? 0;
    setFocusedItemId(item.id); setNewFocusedItemId(item.id); setFocusDraft(alignment ? `^${alignment} ` : ""); setHorizontalAlignmentOpen(false); setVerticalAlignmentOpen(false);
  }

  async function addImage(source?: string, imageSize?: { width: number; height: number }) {
    if (!activeBoard || readOnly) return; const url = (source ?? imageDraft).trim();
    try { const parsed = new URL(url); if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("Image link must use http or https."); } catch (reason) { reportImageFailure(reason); return; }
    const size = resolveItemSize("image", imageSize); const target = addTarget ?? viewportCenterGrid();
    const gridWidth = clampNumber(size.width, 1, 24); const gridHeight = clampNumber(size.height, 1, 24);
    const position = firstFreeNear(activeBoard, target.x, target.y, gridWidth, gridHeight);
    const item: BoardItem = { ...createItemBase(position.x, position.y, gridWidth, gridHeight), type: "image", imageUrl: url, imageFit: "cover", borderColor: borderColorDraft };
    const next = { ...activeBoard, items: [...activeBoard.items, item] };
    if (boardByteSize(next) > BOARD_DATA_LIMIT_BYTES) { reportImageFailure("Image link was not added: Board data is limited to 1 MB."); return; }
    if (await persistBoard(next)) { setAddModalOpen(false); setImageDraft(""); setAddTarget(undefined); }
  }

  async function addCounter() {
    if (!activeBoard || readOnly) return;
    const min = counterMinDraft.trim() ? normalizeCounterValue(Number(counterMinDraft)) : undefined;
    const max = counterMaxDraft.trim() ? normalizeCounterValue(Number(counterMaxDraft)) : undefined;
    if (min !== undefined && max !== undefined && min > max) { reportCounterFailure("Counter Minimum cannot exceed Counter Maximum."); return; }
    const size = resolveItemSize("counter");
    const gridWidth = clampNumber(size.width, 1, 24); const gridHeight = clampNumber(size.height, 1, 24);
    const target = addTarget ?? viewportCenterGrid(); const position = firstFreeNear(activeBoard, target.x, target.y, gridWidth, gridHeight);
    const item: BoardItem = { ...createItemBase(position.x, position.y, gridWidth, gridHeight), type: "counter", counterValue: normalizeCounterValue(Number(counterValueDraft), min, max), counterMin: min, counterMax: max, counterLabelPosition: "top-center", counterDimAtZero: true, borderColor: borderColorDraft, counterMinColor: DEFAULT_COUNTER_ZERO_COLOR, counterMaxColor: DEFAULT_COUNTER_MAX_COLOR };
    if (await persistBoard({ ...activeBoard, items: [...activeBoard.items, item] })) { setAddModalOpen(false); setAddTarget(undefined); setCounterValueDraft("0"); setCounterMinDraft(""); setCounterMaxDraft(""); }
  }

  async function pickOwlbearImage() { if (!OBR.isAvailable) return; const images = await OBR.assets.downloadImages(false, undefined, "NOTE"); const image = images[0]?.image; if (image?.url) await addImage(image.url, { width: image.width, height: image.height }); }

  async function announceEditPresence(itemId: string) {
    if (!OBR.isAvailable || !activeBoard || !shouldBroadcastEditPresence(activeBoard)) return;
    await OBR.broadcast.sendMessage(EDIT_PRESENCE_CHANNEL, { playerId, playerName: await getPlayerName(), boardId: activeBoard.id, itemId, expiresAt: Date.now() + 6000 }, { destination: "REMOTE" });
  }

  function openItemEditor(item: BoardItem) {
    if (!activeBoard || !canEditBoard(activeBoard, playerRole, playerId)) return;
    void announceEditPresence(item.id);
    textEditorReturnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setFocusedItemId(item.id);
    if (item.type === "text") { setFocusDraft(item.text ?? ""); setTextFontSize(item.fontSize ?? 16); setTextColor(item.textColor ?? "#ffffff"); setTextFillBlock(item.fillBlock !== false); setTextVerticalAlignment(item.textVerticalAlignment ?? "top"); setHorizontalAlignmentOpen(false); setVerticalAlignmentOpen(false); setHasTextSelection(false); setImageEdit(undefined); setCounterEdit(undefined); }
    else if (item.type === "image") { setImageEdit({ itemId: item.id, url: item.imageUrl ?? "", borderColor: item.borderColor ?? DEFAULT_ITEM_BORDER_COLOR, imageFit: item.imageFit ?? "cover" }); setCounterEdit(undefined); }
    else setCounterEdit({ itemId: item.id, label: item.counterLabel ?? "", labelPosition: item.counterLabelPosition ?? "top-center", value: String(item.counterValue ?? 0), min: item.counterMin === undefined ? "" : String(item.counterMin), max: item.counterMax === undefined ? "" : String(item.counterMax), borderColor: item.borderColor ?? DEFAULT_ITEM_BORDER_COLOR, minColorEnabled: !!item.counterMinColorEnabled, minColor: item.counterMinColor ?? DEFAULT_COUNTER_ZERO_COLOR, maxColorEnabled: !!item.counterMaxColorEnabled, maxColor: item.counterMaxColor ?? DEFAULT_COUNTER_MAX_COLOR, dimAtZero: item.counterDimAtZero ?? true });
  }

  async function pickOwlbearEditImage() {
    if (!OBR.isAvailable) return;
    const image = (await OBR.assets.downloadImages(false, undefined, "NOTE"))[0]?.image;
    if (image?.url) { markEditorDirty(true); setImageEdit((current) => current && { ...current, url: image.url }); }
  }

  async function updateItemRect(itemId: string, gridX: number, gridY: number, gridWidth: number, gridHeight: number) {
    if (!activeBoard || readOnly) return; if (collides(activeBoard, gridX, gridY, gridWidth, gridHeight, itemId)) return;
    await persistBoard({ ...activeBoard, items: activeBoard.items.map((item) => item.id === itemId ? updateBoardItemRect(item, gridX, gridY, gridWidth, gridHeight) : item) });
  }

  async function deleteItem(itemId: string) { if (!activeBoard || readOnly) return false; const saved = await persistBoard({ ...activeBoard, items: activeBoard.items.filter((item) => item.id !== itemId) }); if (saved) { setContextItem(undefined); setSelectedItemId(undefined); } return !!saved; }

  async function updateContextItemBorder(borderColor: string) {
    if (!activeBoard || !contextItem) return;
    const previousItem = contextItem.item;
    const nextContextItem = contextItemWithBorder(contextItem, borderColor);
    setContextItem((current) => current?.item.id === previousItem.id ? nextContextItem : current);
    const saved = await persistBoard({ ...activeBoard, items: activeBoard.items.map((item) => item.id === previousItem.id ? { ...item, borderColor } : item) });
    setContextItem((current) => {
      if (current?.item.id !== previousItem.id) return current;
      return saved ? current : { ...current, item: previousItem };
    });
  }
  async function saveFocusedText(close = true, discardEmptyNewText = close) {
    if (!activeBoard || !focusedItemId) return false; const item = activeBoard.items.find((candidate) => candidate.id === focusedItemId); if (!item) return false; const text = focusDraft.trim();
    if (!text || /^\^[1-3]\s*$/.test(text)) { if (discardEmptyNewText && newFocusedItemId === focusedItemId) { const saved = await deleteItem(focusedItemId); if (saved === false) return false; } if (close) { setFocusedItemId(undefined); setNewFocusedItemId(undefined); setHorizontalAlignmentOpen(false); setVerticalAlignmentOpen(false); } return true; }
    const baseline = autoTextSize(text);
    const saved = await persistBoard({ boardId: activeBoard.id, update: (board) => updateBoardItem(board, focusedItemId, (candidate) => ({ ...candidate, text, textBaselineWidth: baseline.width, fontSize: Math.max(1, textFontSize), textColor, fillBlock: textFillBlock, textVerticalAlignment, updatedAt: nowIso() })) });
    if (saved && close) { setFocusedItemId(undefined); setNewFocusedItemId(undefined); setHasTextSelection(false); setHorizontalAlignmentOpen(false); setVerticalAlignmentOpen(false); }
    return !!saved;
  }
  function cancelFocusedText() { editorDirty.current = false; immediateEditorSave.current = false; void saveFocusedText(true, false); }

  async function saveFocusedImage(close = true) {
    if (!activeBoard || !imageEdit) return false;
    const next = updateBoardItem(mutationCoordinator.current?.current(activeBoard.id) ?? activeBoard, imageEdit.itemId, (item) => ({ ...item, imageUrl: imageEdit.url.trim(), borderColor: imageEdit.borderColor, imageFit: imageEdit.imageFit, updatedAt: nowIso() }));
    if (boardByteSize(next) > BOARD_DATA_LIMIT_BYTES) { reportImageFailure("Image link was not changed: Board data is limited to 1 MB."); return false; }
    try { const url = new URL(imageEdit.url.trim()); if (!["http:", "https:"].includes(url.protocol)) throw new Error("Image link must use http or https."); } catch (reason) { reportImageFailure(reason); return false; }
    const saved = await persistBoard({ boardId: activeBoard.id, update: (board) => {
      const updated = updateBoardItem(board, imageEdit.itemId, (item) => ({ ...item, imageUrl: imageEdit.url.trim(), borderColor: imageEdit.borderColor, imageFit: imageEdit.imageFit, updatedAt: nowIso() }));
      if (boardByteSize(updated) > BOARD_DATA_LIMIT_BYTES) throw new Error("Image link was not changed: Board data is limited to 1 MB.");
      return updated;
    } });
    if (saved && close) { setImageEdit(undefined); setFocusedItemId(undefined); }
    return saved;
  }

  function cancelFocusedImage() { editorDirty.current = false; immediateEditorSave.current = false; void saveFocusedImage(true); }

  function reportImageFailure(reason: unknown) { const message = formatDebugError(reason); setError(message); logDebug(`Image link update failed: ${message}`); if (OBR.isAvailable) void OBR.notification.show(message, "ERROR"); }
  function reportCounterFailure(reason: unknown) { const message = formatDebugError(reason); setError(message); logDebug(`Counter update failed: ${message}`); if (OBR.isAvailable) void OBR.notification.show(message, "ERROR"); }

  async function saveFocusedCounter(close = true) {
    if (!activeBoard || !counterEdit) return false;
    const min = counterEdit.min.trim() ? normalizeCounterValue(Number(counterEdit.min)) : undefined;
    const max = counterEdit.max.trim() ? normalizeCounterValue(Number(counterEdit.max)) : undefined;
    if (min !== undefined && max !== undefined && min > max) { reportCounterFailure("Counter Minimum cannot exceed Counter Maximum."); return false; }
    const value = normalizeCounterValue(Number(counterEdit.value), min, max);
    const saved = await persistBoard({ boardId: activeBoard.id, update: (board) => updateBoardItem(board, counterEdit.itemId, (item) => ({ ...item, counterLabel: counterEdit.label.trim().slice(0, 120), counterLabelPosition: counterEdit.labelPosition, counterValue: value, counterMin: min, counterMax: max, borderColor: counterEdit.borderColor, counterMinColorEnabled: counterEdit.minColorEnabled, counterMinColor: counterEdit.minColor, counterMaxColorEnabled: counterEdit.maxColorEnabled, counterMaxColor: counterEdit.maxColor, counterDimAtZero: counterEdit.dimAtZero, updatedAt: nowIso() })) });
    if (saved && close) { setCounterEdit(undefined); setFocusedItemId(undefined); }
    return saved;
  }

  function cancelFocusedCounter() { editorDirty.current = false; immediateEditorSave.current = false; void saveFocusedCounter(true); }

  saveFocusedEditorRef.current = (discardEmptyNewText = false) => {
    editorDirty.current = false;
    return imageEdit ? saveFocusedImage(false) : counterEdit ? saveFocusedCounter(false) : focusedItemId ? saveFocusedText(false, discardEmptyNewText) : Promise.resolve(true);
  };

  function markEditorDirty(immediate = false) {
    editorDirty.current = true;
    immediateEditorSave.current ||= immediate;
  }

  function changeCounter(item: BoardItem, delta: number) {
    const board = mutationCoordinator.current?.current(activeBoard?.id ?? ""); if (!board || !canEditBoard(board, playerRole, playerId)) return;
    const current = board.items.find((candidate) => candidate.id === item.id); if (!current) return;
    const value = normalizeCounterValue((current.counterValue ?? 0) + delta, current.counterMin, current.counterMax); if (value === current.counterValue) return;
    void persistBoard({ ...board, items: board.items.map((candidate) => candidate.id === item.id ? { ...candidate, counterValue: value, updatedAt: nowIso() } : candidate) });
  }

  function toggleTextTask(item: BoardItem, line: number) {
    const board = mutationCoordinator.current?.current(activeBoard?.id ?? ""); if (!board || readOnly || item.type !== "text") return;
    void persistBoard({ boardId: board.id, update: (currentBoard) => {
      const current = currentBoard.items.find((candidate) => candidate.id === item.id); if (!current) return currentBoard;
      const text = toggleTaskMarkdown(current.text ?? "", line); if (text === current.text) return currentBoard;
      return { ...currentBoard, items: currentBoard.items.map((candidate) => candidate.id === item.id ? { ...candidate, text, updatedAt: nowIso() } : candidate) };
    } });
  }

  function restoreTextSelection(start: number, end: number) {
    requestAnimationFrame(() => { focusTextarea.current?.focus(); focusTextarea.current?.setSelectionRange(start, end); });
  }

  function toggleTextStyle(marker: "*" | "**") {
    const input = focusTextarea.current; if (!input || input.selectionStart === input.selectionEnd) return;
    const result = toggleMarkdownStyle(focusDraft, input.selectionStart, input.selectionEnd, marker);
    markEditorDirty(true); setFocusDraft(result.value);
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
    markEditorDirty(true); setFocusDraft(lines.map((line, index) => targets.has(index) ? `${alignment ? `^${alignment} ` : ""}${line.replace(/^\^[1-3]\s+/, "")}` : line).join("\n"));
    const next = { ...(preferences ?? await loadPreferences()), textAlignment: alignment };
    setPreferences(next); await savePreferences(next); restoreTextSelection(start, end);
  }

  async function undo() { if (!activeBoard) return; await mutationCoordinator.current?.undo(activeBoard.id); }
  async function redo() { if (!activeBoard) return; await mutationCoordinator.current?.redo(activeBoard.id); }

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
    if (dragState) { if (!dragState.moved && Math.hypot(event.clientX - dragState.startX, event.clientY - dragState.startY) < 4) return; const moving = dragState.moved ? dragState : { ...dragState, moved: true }; const item = activeBoard.items.find((candidate) => candidate.id === moving.itemId); if (!item) return; const grid = pointerToGrid(event.clientX - moving.offsetX, event.clientY - moving.offsetY); if (!collides(activeBoard, grid.x, grid.y, item.gridWidth, item.gridHeight, item.id)) setDragState({ ...moving, gridX: grid.x, gridY: grid.y }); return; }
    if (panning) setPan({ x: event.clientX - panning.x, y: event.clientY - panning.y });
  }
  async function handleGridPointerUp(event: React.PointerEvent<HTMLDivElement>) { if (resizeItemState) await updateItemRect(resizeItemState.itemId, resizeItemState.gridX, resizeItemState.gridY, resizeItemState.gridWidth, resizeItemState.gridHeight); if (dragState?.moved && activeBoard && dragState.gridX !== undefined && dragState.gridY !== undefined) { const item = activeBoard.items.find((candidate) => candidate.id === dragState.itemId); if (item) await updateItemRect(item.id, dragState.gridX, dragState.gridY, item.gridWidth, item.gridHeight); } setDragState(undefined); setResizeItemState(undefined); setPanning(undefined); }
  function startItemResize(event: React.PointerEvent<HTMLElement>, item: BoardItem) { if (readOnly) return; event.preventDefault(); event.stopPropagation(); setSelectedItemId(item.id); setResizeItemState({ itemId: item.id, gridX: item.gridX, gridY: item.gridY, gridWidth: item.gridWidth, gridHeight: item.gridHeight }); gridRef.current?.setPointerCapture(event.pointerId); }
  async function resizeWindow(width: number, height: number) { const next = { width: Math.max(1, Math.round(width)), height: Math.max(1, Math.round(height)) }; setWindowSize(next); await saveWindowPreferences(next); await resizeAction(next.width, next.height); }
  function startResize(event: React.PointerEvent<HTMLElement>) { const target = event.currentTarget; const startX = event.clientX; const startY = event.clientY; const start = { ...windowSize }; target.setPointerCapture(event.pointerId); const move = (moveEvent: PointerEvent) => void resizeWindow(start.width + moveEvent.clientX - startX, start.height + moveEvent.clientY - startY); const up = () => { target.releasePointerCapture(event.pointerId); target.removeEventListener("pointermove", move); target.removeEventListener("pointerup", up); }; target.addEventListener("pointermove", move); target.addEventListener("pointerup", up); }

  useEffect(() => {
    if (!focusedItemId || !editorDirty.current) return;
    if (immediateEditorSave.current) {
      immediateEditorSave.current = false;
      editorDirty.current = false;
      void saveFocusedEditorRef.current(false);
      return;
    }
    const timer = window.setTimeout(() => { void saveFocusedEditorRef.current(false); }, 500);
    return () => window.clearTimeout(timer);
  }, [focusedItemId, focusDraft, textFontSize, textColor, textFillBlock, textVerticalAlignment, imageEdit, counterEdit]);
  useEffect(() => () => { void saveFocusedEditorRef.current(); }, []);

  const cellSize = (displayBoard?.cellSizePx ?? DEFAULT_CELL_SIZE) * zoom;
  const focusedItem = activeBoard?.items.find((item) => item.id === focusedItemId);
  const showBoardActions = !!activeBoard;
  if (!ready) return <div className="loading">Loading Board...</div>;

  return <ColorPickerPreferences.Provider value={{ paletteColors: paletteForSlots(colorPalette), onAddColor: addPaletteColor, onUpdateColor: updatePaletteColor, onDeleteColor: deletePaletteColor }}><main className="app" style={{ width: windowSize.width, height: windowSize.height, ...themeVars }}>
    <header className="toolbar"><div className="boardTitle">{activeBoard && <button className="boardToggle" title="Board settings" onClick={() => { setBoardPanelBoard(undefined); setBoardPanelPosition(undefined); setBoardPanelOpen((value) => !value); }}><Settings size={16} /></button>}<button className={`boardToggle ${manageBoardsOpen ? "active" : ""}`} title="Manage Boards" aria-label="Manage Boards" onClick={() => { setManageBoardsOpen(true); setBoardPanelOpen(false); }}><PanelsTopLeft size={16} /></button><div className="boardTabs" onPointerDown={startTabDrag} onPointerMove={moveTabDrag} onPointerUp={endTabDrag} onPointerCancel={endTabDrag}>{openBoardIds.flatMap((id) => boards.filter((board) => board.id === id)).map((board) => <button key={board.id} className={`boardTab ${board.id === activeBoardId ? "active" : ""}`} onClick={() => void chooseBoard(board)} onContextMenu={(event) => { event.preventDefault(); void chooseBoard(board); setBoardPanelOpen(true); }}>{board.name}<X size={13} onClick={(event) => { event.stopPropagation(); closeBoardTab(board.id); }} /></button>)}</div>{boardPanelOpen && <section className="boardPanel" style={boardPanelPosition ? { left: boardPanelPosition.x, top: boardPanelPosition.y } : undefined}>
      {boardSettings ? <>{!boardSettingsReadOnly && canRenameBoard(boardSettings, playerRole) && <label>Name<input value={boardSettings.name} onChange={(event) => void updateBoardSettings({ name: event.target.value.slice(0, 60) })} /></label>}<div className="boardInlineFields"><label><span>Grid size</span><input disabled={boardSettingsReadOnly} type="number" min={MIN_CELL_SIZE} max={MAX_CELL_SIZE} value={boardSettings.cellSizePx} onChange={(event) => void updateBoardSettings({ cellSizePx: clampNumber(Number(event.target.value), MIN_CELL_SIZE, MAX_CELL_SIZE) })} /></label><label><span>Grid cell gap</span><input disabled={boardSettingsReadOnly} type="number" min={MIN_CELL_GAP} max={MAX_CELL_GAP} value={boardSettings.cellGapPx} onChange={(event) => void updateBoardSettings({ cellGapPx: clampNumber(Number(event.target.value), MIN_CELL_GAP, MAX_CELL_GAP) })} /></label></div>{!boardSettingsReadOnly && boardSettings.visibility === "private" && boardSettings.scope === "room" && <button onClick={() => void movePrivateRoomBoardToScene(boardSettings).then(refresh)}>Move to Scene</button>}{canDeleteBoard(boardSettings, playerRole, playerId) && <button title="Delete board" onClick={() => { if (confirm(`Delete ${boardSettings.name}? This cannot be undone.`)) void deleteBoard(boardSettings).then(async () => { setBoardPanelOpen(false); setBoardPanelBoard(undefined); await refresh(); }); }}><Trash2 size={16} /> Delete Board</button>}</> : <span className="emptyBoardGroup">Open a board or create one from the Boards menu.</span>}
    </section>}{false && boardPickerOpen && <section className="boardPanel boardPicker"><button className="primaryAction" onClick={() => { setCreateOpen(true); setBoardPickerOpen(false); }}><Plus size={16} /> Create Private Board</button><div className="boardGroups"><strong>Shared Boards</strong>{boards.filter((board) => board.visibility === "shared").map((board) => <button key={board.id} onClick={() => void chooseBoard(board)}>{board.name}</button>)}{!boards.some((board) => board.visibility === "shared" && board.scope === "scene") && <button onClick={() => void createShared("scene")}>Shared Scene Board</button>}{!boards.some((board) => board.visibility === "shared" && board.scope === "room") && <button onClick={() => void createShared("room")}>Shared Room Board</button>}<strong>Private Scene Boards</strong>{boards.filter((board) => board.visibility === "private" && board.scope === "scene").map((board) => <button key={board.id} onClick={() => void chooseBoard(board)}>{board.name}</button>)}{!boards.some((board) => board.visibility === "private" && board.scope === "scene") && <span className="emptyBoardGroup">Empty</span>}<strong>Private Room Boards</strong>{boards.filter((board) => board.visibility === "private" && board.scope === "room").map((board) => <button key={board.id} onClick={() => void chooseBoard(board)}>{board.name}</button>)}{!boards.some((board) => board.visibility === "private" && board.scope === "room") && <span className="emptyBoardGroup">Empty</span>}{playerRole === "GM" && <button className="boardGroupButton" onClick={() => { setManageBoardsOpen(true); setBoardPickerOpen(false); }}>Manage Boards</button>}</div></section>}</div><div className="tools">{showBoardActions && <><button disabled={readOnly} title="Save board" onClick={() => void persistBoard(activeBoard!, false, true)}><Save size={16} /> {saveStatus ?? "Save"}</button>{!readOnly && <button title="Add item" onClick={() => { setAddTarget(viewportCenterGrid()); setAddModalOpen(true); }}><Plus size={16} /> Add</button>}</>}<button title="Zoom out" onClick={() => setZoom((value) => clampNumber(value - 0.1, MIN_ZOOM, MAX_ZOOM))}><Minus size={16} /></button><button className="zoom" title="Reset scale" onClick={() => setZoom(DEFAULT_ZOOM)}>{Math.round(zoom * 100)}%</button><button title="Zoom in" onClick={() => setZoom((value) => clampNumber(value + 0.1, MIN_ZOOM, MAX_ZOOM))}><Plus size={16} /></button><button className={debugOpen ? "active" : undefined} title="Open save/load diagnostics" onClick={() => { if (debugOpen) setDebugOpen(false); else void openDebugTab(); }}>Debug</button></div></header>

    {manageBoardsOpen && <ManageBoards boards={boards} activeBoardId={activeBoardId} onCreate={() => setCreateOpen(true)} onCreateShared={(scope) => void createShared(scope)} onOpen={(board) => void chooseBoard(board)} onSettings={(board, event) => { event.stopPropagation(); setBoardPanelBoard(board); const rect = event.currentTarget.getBoundingClientRect(); const x = rect.right + 8 + 360 <= window.innerWidth ? rect.right + 8 : Math.max(8, rect.left - 368); setBoardPanelPosition({ x, y: rect.top }); setBoardPanelOpen(true); }} />}
    {debugOpen && <DebugPanel snapshot={debugSnapshot} logs={debugLogs} onRefresh={() => void openDebugTab()} onClear={() => void clearDebugData()} onClearPalette={playerRole === "GM" ? () => void clearPaletteSceneData() : undefined} />}
    <div ref={gridRef} className={`gridSurface ${boardAtLimit ? "boardAtLimit" : ""}`} onDoubleClick={(event) => { if (!activeBoard || readOnly) return; const grid = pointerToGrid(event.clientX, event.clientY); if (!boardItemAt(activeBoard, grid.x, grid.y)) void createTextAt(grid); }} onPointerDown={handleGridPointerDown} onPointerMove={handleGridPointerMove} onPointerUp={(event) => void handleGridPointerUp(event)} onContextMenu={(event) => { event.preventDefault(); if (!activeBoard || readOnly) { if (!activeBoard) setCreateOpen(true); return; } const grid = pointerToGrid(event.clientX, event.clientY); const item = boardItemAt(activeBoard, grid.x, grid.y); if (item) setContextItem({ item, x: event.clientX, y: event.clientY }); else setEmptyContext({ gridX: grid.x, gridY: grid.y, x: event.clientX, y: event.clientY }); }} style={{ backgroundSize: `${cellSize}px ${cellSize}px`, backgroundPosition: `${pan.x}px ${pan.y}px` }}>
      <div key={displayBoard?.id ?? "empty"} className="gridPlane" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}>{displayBoard?.items.map((item) => <BoardItemView key={item.id} item={resizeItemState?.itemId === item.id ? { ...item, gridWidth: resizeItemState.gridWidth, gridHeight: resizeItemState.gridHeight } : dragState?.itemId === item.id && dragState.gridX !== undefined && dragState.gridY !== undefined ? { ...item, gridX: dragState.gridX, gridY: dragState.gridY } : item} selected={selectedItemId === item.id} editPresence={visibleItemPresence?.itemId === item.id ? visibleItemPresence : undefined} cellSize={displayBoard.cellSizePx} cellGap={displayBoard.cellGapPx} onResizePointerDown={startItemResize} onDoubleClick={openItemEditor} onCounterChange={changeCounter} onTaskToggle={toggleTextTask} readOnly={readOnly} />)}</div>
      {showPreview && <div className="emptyState" onPointerDown={(event) => event.stopPropagation()} onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); }}><strong>Preview Board</strong><button className="primaryAction" onClick={() => setCreateOpen(true)}><Plus size={16} /> Create Private Board</button><button onClick={async () => { const prefs = preferences ?? await loadPreferences(); await savePreferences({ ...prefs, previewDismissed: true }); setPreviewDismissed(true); }}>Dismiss</button></div>}
      {warning && <div className="saveError saveWarning" role="status"><CircleAlert size={18} /><span>{warning}</span><button aria-label="Dismiss warning" onClick={() => setWarning(undefined)}><X size={16} /></button></div>}
       {error && <div className="saveError" role="alert"><CircleAlert size={18} /><span>{error}</span><button aria-label="Dismiss error" onClick={() => setError(undefined)}><X size={16} /></button></div>}
      <div className="surfaceHud"><span>{displayBoard?.items.length ?? 0} items</span><span>{Math.round(cellSize)} px cells</span></div>
    </div>

    {focusedItem?.type === "text" && <div className="modalBackdrop" onPointerDown={() => void cancelFocusedText()}><section className="editModal textEditModal" role="dialog" aria-modal="true" aria-labelledby="text-edit-title" onPointerDown={(event) => event.stopPropagation()}><div className="modalHeader"><div className="editTextTitle"><div className="markdownHelpTrigger"><button ref={markdownHelpTrigger} className="markdownHelpButton" aria-label="Markdown help" aria-expanded={markdownHelpOpen} aria-controls="markdown-help-panel" onClick={() => setMarkdownHelpOpen((open) => !open)}>?</button></div><strong id="text-edit-title">Edit text</strong></div><div className="modalHeaderActions"><button title="Cancel" onClick={() => void cancelFocusedText()}><X size={16} /></button></div></div><div className="editModalBody textEditLayout"><MarkdownHelp open={markdownHelpOpen} panelRef={markdownHelpPanel} /><div className="textEditToolbar"><button title="Bold selected text" disabled={!hasTextSelection} onMouseDown={(event) => event.preventDefault()} onClick={() => toggleTextStyle("**")}><Bold size={16} /></button><button title="Italic selected text" disabled={!hasTextSelection} onMouseDown={(event) => event.preventDefault()} onClick={() => toggleTextStyle("*")}><Italic size={16} /></button><div className="alignmentDropdown"><button className="alignmentButton" title="Horizontal text alignment" onClick={() => setHorizontalAlignmentOpen((open) => !open)}>{[<AlignLeft size={16} />, <AlignCenter size={16} />, <AlignRight size={16} />, <AlignJustify size={16} />][preferences?.textAlignment ?? 0]}<ChevronDown size={13} /></button>{horizontalAlignmentOpen && <div className="alignmentMenu">{[[0, <AlignLeft size={16} />, "Align left"], [1, <AlignCenter size={16} />, "Align center"], [2, <AlignRight size={16} />, "Align right"], [3, <AlignJustify size={16} />, "Justify"]].map(([alignment, icon, label]) => <button key={String(alignment)} title={String(label)} onMouseDown={(event) => event.preventDefault()} onClick={() => { setHorizontalAlignmentOpen(false); void alignTextBlocks(Number(alignment) as 0 | 1 | 2 | 3); }}>{icon}</button>)}</div>}</div><div className="alignmentDropdown"><button className="alignmentButton" title="Vertical text alignment" onClick={() => { setVerticalAlignmentOpen((open) => !open); setHorizontalAlignmentOpen(false); }}>{({ top: <AlignVerticalJustifyStart size={16} />, center: <AlignVerticalJustifyCenter size={16} />, bottom: <AlignVerticalJustifyEnd size={16} /> })[textVerticalAlignment]}<ChevronDown size={13} /></button>{verticalAlignmentOpen && <div className="alignmentMenu"><button title="Align top" onClick={() => { markEditorDirty(true); setTextVerticalAlignment("top"); setVerticalAlignmentOpen(false); }}><AlignVerticalJustifyStart size={16} /></button><button title="Align center" onClick={() => { markEditorDirty(true); setTextVerticalAlignment("center"); setVerticalAlignmentOpen(false); }}><AlignVerticalJustifyCenter size={16} /></button><button title="Align bottom" onClick={() => { markEditorDirty(true); setTextVerticalAlignment("bottom"); setVerticalAlignmentOpen(false); }}><AlignVerticalJustifyEnd size={16} /></button></div>}</div><button className={`fillBlockButton ${textFillBlock ? "active" : ""}`} onClick={() => { markEditorDirty(true); setTextFillBlock((value) => !value); }}>Fill</button><ColorPicker value={textColor} defaultColor="#ffffff" onChange={(color) => { markEditorDirty(true); setTextColor(color); }} /><div className="owlbearFontSizePicker"><input aria-label="Font size" type="number" min="1" step="1" value={textFontSize} onChange={(event) => { markEditorDirty(); setTextFontSize(Math.max(1, Number(event.target.value) || 1)); }} /><ChevronDown size={18} /></div></div><div className="textEditControls"><textarea ref={focusTextarea} className="editorTextarea" value={focusDraft} autoFocus onScroll={(event) => { if (previewContent.current) syncTextScroll(event.currentTarget, previewContent.current); }} onChange={(event) => { markEditorDirty(); setFocusDraft(event.target.value); setHasTextSelection(event.currentTarget.selectionStart !== event.currentTarget.selectionEnd); }} onSelect={(event) => setHasTextSelection(event.currentTarget.selectionStart !== event.currentTarget.selectionEnd)} onKeyUp={(event) => setHasTextSelection(event.currentTarget.selectionStart !== event.currentTarget.selectionEnd)} onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); void cancelFocusedText(); } }} /></div><aside className="textPreviewPane"><div className="textLivePreview"><div ref={previewContent} className="textPreview textAlign-top" style={{ "--text-scale": focusedItem && textFillBlock ? textFillScale(focusedItem.gridWidth, focusedItem.textBaselineWidth ?? focusedItem.gridWidth) : 1, "--text-font-size": `${textFontSize}px`, color: textColor } as CSSProperties} onScroll={(event) => { if (focusTextarea.current) syncTextScroll(event.currentTarget, focusTextarea.current); }}>{!focusDraft && <span className="previewPlaceholder">Preview</span>}<div className="textScaleContent"><MarkdownView value={focusDraft} /></div></div></div></aside></div></section></div>}
    {imageEdit && <div className="modalBackdrop" onPointerDown={cancelFocusedImage}><section className="editModal" onPointerDown={(event) => event.stopPropagation()} onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); cancelFocusedImage(); } }}><div className="modalHeader"><strong>Edit image</strong><div className="modalHeaderActions"><button title="Cancel" onClick={cancelFocusedImage}><X size={16} /></button></div></div><div className="editModalBody imageEditBody"><div className="imageUrlRow"><input value={imageEdit.url} onChange={(event) => { markEditorDirty(); setImageEdit({ ...imageEdit, url: event.target.value }); }} />{canPickOwlbearImages && <button onClick={() => void pickOwlbearEditImage()}><ImagePlus size={16} /> Owlbear</button>}</div><div className="imageOptionRow"><label className="imageOption"><span>Border</span><ColorPicker value={imageEdit.borderColor} defaultColor={DEFAULT_ITEM_BORDER_COLOR} onChange={(borderColor) => { markEditorDirty(true); setImageEdit({ ...imageEdit, borderColor }); }} /></label><label className="imageOption"><span>Fit</span><select value={imageEdit.imageFit} onChange={(event) => { markEditorDirty(true); setImageEdit({ ...imageEdit, imageFit: event.target.value as ImageEdit["imageFit"] }); }}><option value="cover">Cover</option><option value="contain">Contain</option></select></label></div></div></section></div>}
    {counterEdit && <div className="modalBackdrop" onPointerDown={cancelFocusedCounter}><section className="editModal counterEditModal" role="dialog" aria-modal="true" aria-labelledby="counter-edit-title" onPointerDown={(event) => event.stopPropagation()}><div className="modalHeader"><strong id="counter-edit-title">Edit counter</strong><div className="modalHeaderActions"><button title="Cancel" onClick={cancelFocusedCounter}><X size={16} /></button></div></div><div className="editModalBody counterEditLayout"><section className="counterEditSection counterEditFields"><div className="counterEditTopRow"><label>Label<input value={counterEdit.label} maxLength={120} onChange={(event) => { markEditorDirty(); setCounterEdit({ ...counterEdit, label: event.target.value }); }} /></label><label>Label placement<select value={counterEdit.labelPosition} onChange={(event) => { markEditorDirty(true); setCounterEdit({ ...counterEdit, labelPosition: event.target.value as CounterEdit["labelPosition"] }); }}><option value="top-left">Top left</option><option value="top-center">Top center</option><option value="top-right">Top right</option><option value="bottom-left">Bottom left</option><option value="bottom-center">Bottom center</option><option value="bottom-right">Bottom right</option></select></label></div><div className="counterEditNumbers"><label>Minimum<input aria-label="Minimum value" type="number" max={counterEdit.max || undefined} step="1" placeholder="no min" value={counterEdit.min} onChange={(event) => { markEditorDirty(); setCounterEdit({ ...counterEdit, min: event.target.value }); }} /></label><label>Value<input type="number" min={counterEdit.min || undefined} max={counterEdit.max || undefined} step="1" value={counterEdit.value} onChange={(event) => { markEditorDirty(); setCounterEdit({ ...counterEdit, value: event.target.value }); }} /></label><label>Maximum<input aria-label="Maximum value" type="number" min={counterEdit.min || undefined} step="1" placeholder="no max" value={counterEdit.max} onChange={(event) => { markEditorDirty(); setCounterEdit({ ...counterEdit, max: event.target.value }); }} /></label></div></section><section className="counterEditSection counterAppearanceSection"><strong>Appearance</strong><label className="counterColorField"><span>Normal border</span><ColorPicker value={counterEdit.borderColor} defaultColor={DEFAULT_ITEM_BORDER_COLOR} onChange={(borderColor) => { markEditorDirty(true); setCounterEdit({ ...counterEdit, borderColor }); }} /></label><div className="counterOption"><TaskToggle label="Enable minimum border color" checked={counterEdit.minColorEnabled} onChange={(event) => { markEditorDirty(true); setCounterEdit({ ...counterEdit, minColorEnabled: event.target.checked }); }} /><span>Min border</span><ColorPicker disabled={!counterEdit.minColorEnabled} value={counterEdit.minColor} defaultColor={DEFAULT_COUNTER_ZERO_COLOR} onChange={(minColor) => { markEditorDirty(true); setCounterEdit({ ...counterEdit, minColor }); }} /></div><div className="counterOption"><TaskToggle label="Enable maximum border color" checked={counterEdit.maxColorEnabled} onChange={(event) => { markEditorDirty(true); setCounterEdit({ ...counterEdit, maxColorEnabled: event.target.checked }); }} /><span>Max border</span><ColorPicker disabled={!counterEdit.maxColorEnabled} value={counterEdit.maxColor} defaultColor={DEFAULT_COUNTER_MAX_COLOR} onChange={(maxColor) => { markEditorDirty(true); setCounterEdit({ ...counterEdit, maxColor }); }} /></div><div className="counterOption"><TaskToggle label="Dim counter at zero" checked={counterEdit.dimAtZero} onChange={(event) => { markEditorDirty(true); setCounterEdit({ ...counterEdit, dimAtZero: event.target.checked }); }} /><span>Dim at zero</span></div></section></div></section></div>}
    {contextItem && <div className="contextMenu" style={{ left: contextItem.x, top: contextItem.y }}><button onClick={() => { openItemEditor(contextItem.item); setContextItem(undefined); }}><Pencil size={15} /> Edit</button><label className="colorMenuItem">Border<ColorPicker value={contextItem.item.borderColor ?? DEFAULT_ITEM_BORDER_COLOR} defaultColor={DEFAULT_ITEM_BORDER_COLOR} onChange={(borderColor) => void updateContextItemBorder(borderColor)} /></label><button onClick={() => void deleteItem(contextItem.item.id)}><Trash2 size={15} /> Delete</button></div>}
    {emptyContext && <div className="contextMenu creationMenu" style={{ left: emptyContext.x, top: emptyContext.y }}><button onClick={() => { void createTextAt({ x: emptyContext.gridX, y: emptyContext.gridY }); setEmptyContext(undefined); }}><Type size={15} /> Add Text</button><button onClick={() => { setAddTarget({ x: emptyContext.gridX, y: emptyContext.gridY }); setAddItemType("counter"); setAddModalOpen(true); setEmptyContext(undefined); }}><Plus size={15} /> Add Counter</button><button onClick={() => { setAddTarget({ x: emptyContext.gridX, y: emptyContext.gridY }); setAddItemType("image"); setAddModalOpen(true); setEmptyContext(undefined); }}><ImagePlus size={15} /> Add Image</button></div>}
    {createOpen && <div className="modalBackdrop" onPointerDown={() => setCreateOpen(false)}><section className="editModal" onPointerDown={(event) => event.stopPropagation()}><div className="modalHeader"><strong>Create Private Board</strong><button onClick={() => setCreateOpen(false)}><Minus size={16} /></button></div><div className="editModalBody"><label>Name<input value={createName} maxLength={60} onChange={(event) => setCreateName(event.target.value)} /></label><label>Scope<select value={createScope} onChange={(event) => setCreateScope(event.target.value as BoardScope)}><option value="scene">Scene</option><option value="room">Room</option></select></label><button className="primaryAction" onClick={() => void createPrivateBoard()}><Plus size={16} /> Create</button></div></section></div>}
    {addModalOpen && <div className="modalBackdrop" onPointerDown={() => setAddModalOpen(false)}><section className="addModal" onPointerDown={(event) => event.stopPropagation()}><div className="modalHeader"><strong>Add item</strong><button onClick={() => setAddModalOpen(false)}><Minus size={16} /></button></div><div className="itemTypeTabs"><button className={addItemType === "text" ? "active" : undefined} onClick={() => setAddItemType("text")}><Type size={16} /> Text</button><button className={addItemType === "image" ? "active" : undefined} onClick={() => setAddItemType("image")}><ImagePlus size={16} /> Image</button><button className={addItemType === "counter" ? "active" : undefined} onClick={() => setAddItemType("counter")}><Plus size={16} /> Counter</button></div><div className="modalGrid"><label className="compactField">W<input value={itemWidth} onChange={(event) => setItemWidth(event.target.value)} /></label><label className="compactField">H<input value={itemHeight} onChange={(event) => setItemHeight(event.target.value)} /></label><label className="compactField">Border<ColorPicker value={borderColorDraft} defaultColor={DEFAULT_ITEM_BORDER_COLOR} onChange={setBorderColorDraft} /></label>{addItemType === "text" ? <button className="primaryAction" onClick={() => { if (activeBoard) void createTextAt(addTarget ?? viewportCenterGrid()).then(() => setAddModalOpen(false)); }}><Type size={16} /> Add</button> : addItemType === "counter" ? <><label className="counterAddField">Initial value<input type="number" min={counterMinDraft || undefined} max={counterMaxDraft || undefined} step="1" value={counterValueDraft} onChange={(event) => setCounterValueDraft(event.target.value)} /></label><label className="counterAddField">Minimum<input aria-label="Initial minimum value" type="number" max={counterMaxDraft || undefined} step="1" placeholder="no min" value={counterMinDraft} onChange={(event) => setCounterMinDraft(event.target.value)} /></label><label className="counterAddField">Maximum<input aria-label="Initial maximum value" type="number" min={counterMinDraft || undefined} step="1" placeholder="no max" value={counterMaxDraft} onChange={(event) => setCounterMaxDraft(event.target.value)} /></label><button className="primaryAction" onClick={() => void addCounter()}><Plus size={16} /> Add</button></> : <><label className="wideField">Image URL<input value={imageDraft} onChange={(event) => { setImageDraft(event.target.value); setImagePreviewSize(undefined); }} /></label>{canPickOwlbearImages && <button onClick={() => void pickOwlbearImage()}><ImagePlus size={16} /> Owlbear</button>}<button className="primaryAction" onClick={() => void addImage()}><ImagePlus size={16} /> Add</button></>}</div>{addItemType === "image" && imageDraft.trim() && <div className="imagePreviewPanel"><img src={imageDraft.trim()} alt="Image preview" onLoad={(event) => setImagePreviewSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })} onError={() => setImagePreviewSize(undefined)} /></div>}</section></div>}
    <span className="versionBadge" aria-label={`App version ${__APP_VERSION__}`}>{__APP_VERSION__}</span>
    <div className="resizeGrip" onPointerDown={startResize} title="Resize window"><Grip size={18} /></div>
  </main></ColorPickerPreferences.Provider>;
}

function ManageBoards({ boards, activeBoardId, onCreate, onCreateShared, onOpen, onSettings }: { boards: Board[]; activeBoardId?: string; onCreate(): void; onCreateShared(scope: BoardScope): void; onOpen(board: Board): void; onSettings(board: Board, event: React.MouseEvent<HTMLButtonElement>): void }) {
  const date = (value: string) => new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: new Date(value).getFullYear() === new Date().getFullYear() ? undefined : "numeric" }).format(new Date(value));
  const groups = new Map<string, Board[]>();
  for (const board of boards) { const owner = board.visibility === "shared" ? "Shared" : board.ownerName || board.ownerId || "Unknown"; groups.set(owner, [...(groups.get(owner) ?? []), board]); }
  const ordered = [...groups].sort(([a], [b]) => a === "Shared" ? -1 : b === "Shared" ? 1 : a.localeCompare(b));
  return <section className="manageBoards"><div className="manageBoardActions"><button className="primaryAction" onClick={onCreate}><Plus size={16} /> Create Private Board</button>{!boards.some((board) => board.visibility === "shared" && board.scope === "scene") && <button onClick={() => onCreateShared("scene")}>Shared Scene Board</button>}{!boards.some((board) => board.visibility === "shared" && board.scope === "room") && <button onClick={() => onCreateShared("room")}>Shared Room Board</button>}</div>{ordered.map(([owner, owned]) => <section key={owner}><h3>{owner}</h3><div className="manageBoardGrid">{owned.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map((board) => <div key={board.id} className="manageBoardCard"><button className="manageBoard" onClick={() => onOpen(board)}><span className="manageBoardDate">{date(board.updatedAt)}</span><strong>{board.name}</strong></button><button className="manageBoardSettings" title={`Board settings for ${board.name}`} aria-label={`Board settings for ${board.name}`} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => onSettings(board, event)}><Settings size={15} /></button></div>)}</div></section>)}</section>;
}

function DebugPanel({ snapshot, logs, onRefresh, onClear, onClearPalette }: { snapshot: unknown; logs: string[]; onRefresh(): void; onClear(): void; onClearPalette?: () => void }) {
  return <section className="debugPanel"><div className="debugHeader"><strong>Save / Load Debug</strong><span><button onClick={onRefresh}>Refresh</button>{onClearPalette && <button onClick={onClearPalette}>Clear Palette Data</button>}<button onClick={onClear}>Clear All Board Data</button></span></div><h3>Logs</h3><pre>{logs.join("\n") || "No application events recorded."}</pre><h3>Snapshot</h3><pre>{snapshot ? JSON.stringify(snapshot, null, 2) : "Collecting diagnostics..."}</pre></section>;
}

function MarkdownHelp({ open, panelRef }: { open: boolean; panelRef: React.RefObject<HTMLDivElement | null> }) {
  return <div ref={panelRef} id="markdown-help-panel" className={`markdownHelpPanel ${open ? "open" : ""}`} role="dialog" aria-label="Markdown help" aria-hidden={!open}>
    <div className="markdownHelpContent"><strong>Markdown examples</strong>
    <section className="markdownHelpGroup"><strong>Headings</strong><div className="markdownSamples">
      <div className="markdownSample"><code># Heading</code><MarkdownView value="# Heading" /></div>
      <div className="markdownSample"><code>## Heading</code><MarkdownView value="## Heading" /></div>
      <div className="markdownSample"><code>### Heading</code><MarkdownView value="### Heading" /></div>
    </div></section>
    <section className="markdownHelpGroup"><strong>Inline styles</strong><div className="markdownSamples">
      <div className="markdownSample"><code>**bold**</code><MarkdownView value="**Bold text**" /></div>
      <div className="markdownSample"><code>*italic*</code><MarkdownView value="*Italic text*" /></div>
      <div className="markdownSample"><code>~~strikethrough~~</code><MarkdownView value="~~Strikethrough~~" /></div>
      <div className="markdownSample"><code>`inline code`</code><MarkdownView value="`inline code`" /></div>
    </div></section>
    <section className="markdownHelpGroup"><strong>Blocks and lists</strong><div className="markdownSamples">
      <div className="markdownSample"><code>{"> quote"}</code><MarkdownView value="> Quoted text" /></div>
      <div className="markdownSample"><code>- unordered item</code><MarkdownView value="- Unordered item" /></div>
      <div className="markdownSample"><code>1. ordered item</code><MarkdownView value="1. Ordered item" /></div>
      <div className="markdownSample"><code>- [ ] / [x] Task</code><MarkdownView value={"- [ ] Open\n- [x] Done"} /></div>
      <div className="markdownSample"><code>{"```"} code {"```"}</code><MarkdownView value={"```\nblock code\n```"} /></div>
    </div></section>
    <section className="markdownHelpGroup"><strong>Links and alignment</strong><div className="markdownSamples">
      <div className="markdownSample"><code>[link](https://example.com)</code><MarkdownView value="[Example link](https://example.com)" /></div>
      <div className="markdownSample"><code>^1 centered</code><MarkdownView value="^1 Centered text" /></div>
      <div className="markdownSample"><code>^2 right</code><MarkdownView value="^2 Right-aligned text" /></div>
      <div className="markdownSample"><code>^3 justified</code><MarkdownView value="^3 Justified text" /></div>
    </div></section>
    </div>
  </div>;
}

function BoardItemView({ item, selected, editPresence, cellSize, cellGap, onResizePointerDown, onDoubleClick, onCounterChange, onTaskToggle, readOnly = false }: { item: BoardItem; selected: boolean; editPresence?: EditPresence; cellSize: number; cellGap: number; onResizePointerDown: (event: React.PointerEvent<HTMLElement>, item: BoardItem) => void; onDoubleClick: (item: BoardItem) => void; onCounterChange: (item: BoardItem, delta: number) => void; onTaskToggle: (item: BoardItem, line: number) => void; readOnly?: boolean }) {
  const inset = Math.min(cellGap, Math.max(0, (Math.min(item.gridWidth, item.gridHeight) * cellSize) / 2 - 4)); const value = item.counterValue ?? 0; const atMin = item.type === "counter" && counterMinimumReached(value, item.counterMin); const atMax = item.type === "counter" && item.counterMax !== undefined && value === item.counterMax;
  const borderColor = atMax && item.counterMaxColorEnabled ? item.counterMaxColor : item.type === "counter" && atMin && item.counterMinColorEnabled ? item.counterMinColor : item.borderColor ?? DEFAULT_ITEM_BORDER_COLOR;
  const stopControl = (event: React.SyntheticEvent) => event.stopPropagation();
  const latestItem = useRef(item); const latestTaskToggle = useRef(onTaskToggle); latestItem.current = item; latestTaskToggle.current = onTaskToggle;
  const handleTaskToggle = useCallback((line: number) => latestTaskToggle.current(latestItem.current, line), []);
  const textScale = item.type === "text" && item.fillBlock !== false ? textFillScale(item.gridWidth, item.textBaselineWidth ?? item.gridWidth) : 1;
  const width = Math.max(8, item.gridWidth * cellSize - inset * 2); const editLabel = editPresence && `Edit: ${editPresence.playerName}`; const editLabelFontSize = editLabel ? Math.max(5, Math.min(8, (width - 8) / Math.max(1, editLabel.length * 0.58))) : undefined;
  return <article className={`boardItem ${item.type} ${selected ? "selected" : ""} ${editPresence ? "editingPresence" : ""} ${item.type === "counter" && value === 0 && item.counterDimAtZero !== false ? "zeroDim" : ""}`} style={{ left: item.gridX * cellSize + inset, top: item.gridY * cellSize + inset, width, height: Math.max(8, item.gridHeight * cellSize - inset * 2), borderColor, "--edit-presence-font-size": editLabelFontSize && `${editLabelFontSize}px` } as CSSProperties} onMouseDown={(event) => { if (event.detail === 2) { event.stopPropagation(); onDoubleClick(item); } }} onDoubleClick={(event) => { event.stopPropagation(); onDoubleClick(item); }}>
    {editLabel && <span className="editPresenceLabel" role="status" title={editLabel}><span className="editPresencePrefix">Edit:</span> <strong className="editPresencePlayer">{editPresence!.playerName}</strong></span>}
    {item.type === "image" && item.imageUrl ? <img src={item.imageUrl} alt="Board item" style={{ objectFit: item.imageFit ?? "cover" }} /> : item.type === "counter" ? <>{!readOnly && <button className="counterControl" aria-label="Decrease counter" disabled={atMin} onPointerDown={stopControl} onMouseDown={stopControl} onDoubleClick={stopControl} onClick={(event) => { stopControl(event); void onCounterChange(item, -1); }}><Minus size={16} /></button>}<div className={`counterContent ${item.counterLabelPosition ?? "top-center"}`}>{item.counterLabel && <span className="counterLabel" title={item.counterLabel}>{item.counterLabel}</span>}<div className="counterNumbers"><strong>{value}</strong>{item.counterMax !== undefined && <span>/ {item.counterMax}</span>}</div></div>{!readOnly && <button className="counterControl" aria-label="Increase counter" disabled={atMax} onPointerDown={stopControl} onMouseDown={stopControl} onDoubleClick={stopControl} onClick={(event) => { stopControl(event); void onCounterChange(item, 1); }}><Plus size={16} /></button>}</> : <div className={`textPreview textAlign-${item.textVerticalAlignment ?? "top"}`} style={{ "--text-scale": textScale, "--text-font-size": `${item.fontSize ?? 16}px`, color: item.textColor ?? "#ffffff" } as CSSProperties}><div className="textScaleContent"><MarkdownView value={item.text || ""} onTaskToggle={readOnly ? undefined : handleTaskToggle} /></div></div>}
    {!readOnly && <button className="itemResizeHandle" title="Resize item" onPointerDown={(event) => onResizePointerDown(event, item)}><Maximize2 size={13} /></button>}
  </article>;
}
