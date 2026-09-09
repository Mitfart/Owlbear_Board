import { beforeEach, describe, expect, it, vi } from "vitest";
import { BOARD_EVENT_CHANNEL, BOARD_STATE_KEY, PALETTE_STATE_KEY, ROOM_BOARD_STATE_KEY } from "./constants";
import { carryRoomBoardsToCurrentScene, clearAllBoardData, clearColorPaletteData, deleteBoard, getColorPaletteSceneData, loadAllVisibleBoards, loadColorPalette, loadPreferences, normalizeBoardState, saveBoard, saveColorPalette, savePreferences } from "./storage";

let playerMetadata: Record<string, unknown>;
let roomMetadata: Record<string, unknown>;
let sceneMetadata: Record<string, unknown>;
let sceneItems: Array<{ id: string; metadata: Record<string, unknown> }>;
const buildShape = vi.hoisted(() => vi.fn());
const obr = vi.hoisted(() => ({
  isAvailable: true,
  scene: { getMetadata: vi.fn(), setMetadata: vi.fn(), isReady: vi.fn(), items: { getItems: vi.fn(), addItems: vi.fn(), updateItems: vi.fn(), deleteItems: vi.fn() } },
  room: { getMetadata: vi.fn(), setMetadata: vi.fn() },
  player: { getMetadata: vi.fn(), setMetadata: vi.fn(), getId: vi.fn(), getRole: vi.fn() },
  broadcast: { sendMessage: vi.fn() },
}));
vi.mock("@owlbear-rodeo/sdk", () => ({ default: obr, buildShape }));

const board = (overrides: Record<string, unknown> = {}) => ({
  id: "board", name: "Board", scope: "scene" as const, visibility: "private" as const,
  ownerId: "owner", allowedUserIds: ["owner"], revision: 0, cellSizePx: 72, cellGapPx: 2,
  items: [], updatedAt: "2026-01-01T00:00:00.000Z", ...overrides,
});

describe("board storage", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    playerMetadata = {}; roomMetadata = {}; sceneMetadata = { "com.owlbear-board.grid/scene-key": "scene" }; sceneItems = [];
    obr.player.getMetadata.mockImplementation(async () => playerMetadata);
    obr.player.setMetadata.mockImplementation(async (update) => { playerMetadata = { ...playerMetadata, ...update }; });
    localStorage.clear();
    obr.player.getId.mockResolvedValue("owner"); obr.player.getRole.mockResolvedValue("GM");
    obr.room.getMetadata.mockImplementation(async () => roomMetadata);
    obr.room.setMetadata.mockImplementation(async (update) => { roomMetadata = { ...roomMetadata, ...update }; });
    obr.scene.getMetadata.mockImplementation(async () => sceneMetadata);
    obr.scene.setMetadata.mockImplementation(async (update) => { sceneMetadata = { ...sceneMetadata, ...update }; });
    let builtMetadata: Record<string, unknown> = {}; let itemCount = 0;
    const builder = { id: vi.fn(), name: vi.fn(), metadata: vi.fn((metadata) => { builtMetadata = metadata; return builder; }), locked: vi.fn(), visible: vi.fn(), disableHit: vi.fn(), layer: vi.fn(), width: vi.fn(), height: vi.fn(), shapeType: vi.fn(), style: vi.fn(), build: vi.fn(() => ({ id: `item-${++itemCount}`, metadata: builtMetadata })) };
    Object.values(builder).forEach((value) => { if (typeof value === "function" && value !== builder.build && value !== builder.metadata) (value as ReturnType<typeof vi.fn>).mockReturnValue(builder); });
    buildShape.mockReturnValue(builder);
    obr.scene.isReady.mockResolvedValue(true); obr.scene.items.getItems.mockImplementation(async () => sceneItems); obr.scene.items.addItems.mockImplementation(async (items) => { sceneItems.push(...items); }); obr.scene.items.updateItems.mockImplementation(async (targets, update) => { const items = targets.map((target: string | { id: string }) => typeof target === "string" ? sceneItems.find((item) => item.id === target) : target).filter(Boolean); update(items); }); obr.scene.items.deleteItems.mockImplementation(async (ids) => { sceneItems = sceneItems.filter((item) => !ids.includes(item.id)); }); obr.broadcast.sendMessage.mockResolvedValue(undefined);
    await clearAllBoardData();
    vi.clearAllMocks();
  });

  it("saves each board in an extension-owned Scene Data Item", async () => {
    await saveBoard(board());
    expect(obr.scene.items.addItems).toHaveBeenCalledOnce();
    expect(sceneMetadata[BOARD_STATE_KEY]).toBeUndefined();
  });

  it("reloads private boards from scene metadata after player metadata is lost", async () => {
    await saveBoard(board());
    playerMetadata = {}; // Owlbear rebuilds the player object on extension reload.
    await expect(loadAllVisibleBoards("PLAYER", "owner")).resolves.toMatchObject({ boards: [expect.objectContaining({ id: "board" })] });
    await expect(loadAllVisibleBoards("PLAYER", "other")).resolves.toMatchObject({ boards: [] });
    expect(sceneItems).toEqual([expect.objectContaining({ metadata: expect.objectContaining({ [BOARD_STATE_KEY]: expect.objectContaining({ id: "board" }) }) })]);
  });

  it("uses room metadata as the Room Board registry and prunes stale scene copies", async () => {
    const roomBoard = await saveBoard(board({ scope: "room", updatedAt: "2026-01-02T00:00:00.000Z" }));
    expect(roomMetadata[ROOM_BOARD_STATE_KEY]).toMatchObject({ boards: [expect.objectContaining({ id: "board" })] });

    sceneMetadata = { "com.owlbear-board.grid/scene-key": "next", [BOARD_STATE_KEY]: { version: 1, boards: [board({ id: "stale", scope: "room" })] } };
    await carryRoomBoardsToCurrentScene();
    expect(sceneItems.map((item) => (item.metadata[BOARD_STATE_KEY] as { id: string }).id)).toEqual(["board"]);

    await deleteBoard(roomBoard);
    expect(roomMetadata[ROOM_BOARD_STATE_KEY]).toMatchObject({ boards: [] });
    expect(sceneItems).toEqual([]);
  });


  it("broadcasts creates and deletes so other Manage Boards views refresh immediately", async () => {
    const saved = await saveBoard(board());
    await deleteBoard(saved);
    expect(obr.broadcast.sendMessage).toHaveBeenNthCalledWith(1, BOARD_EVENT_CHANNEL, { action: "save", boardId: "board", itemIds: [] }, { destination: "REMOTE" });
    expect(obr.broadcast.sendMessage).toHaveBeenNthCalledWith(2, BOARD_EVENT_CHANNEL, { action: "delete", boardId: "board", itemIds: undefined }, { destination: "REMOTE" });
  });

  it("rejects deletion by a non-owner player", async () => {
    const saved = await saveBoard(board());
    obr.player.getRole.mockResolvedValue("PLAYER"); obr.player.getId.mockResolvedValue("other");
    await expect(deleteBoard(saved)).rejects.toThrow("Only the board creator or a GM");
  });

  it("normalizes invalid grid values and applies current defaults", () => {
    const current = board({ items: [{ id: "item", type: "text", gridX: Infinity, gridY: 3.5, gridWidth: Infinity, gridHeight: -1, updatedAt: "" }] }) as unknown as import("./types").Board;
    expect(normalizeBoardState({ version: 1, boards: [current] }).boards[0].items[0]).toEqual(expect.objectContaining({ gridX: 0, gridY: 3, gridWidth: 1, gridHeight: 1, fontSize: 16, textColor: "#ffffff" }));
  });

  it("retains an editable color palette when a stale preference save follows it", async () => {
    const preferences = await loadPreferences();
    await savePreferences({ ...preferences, colorPalette: ["#123456"] });
    await savePreferences({ ...preferences, textAlignment: 2 });

    await expect(loadPreferences()).resolves.toEqual(expect.objectContaining({ colorPalette: ["#123456"], textAlignment: 2 }));
  });

  it("keeps the scene palette after player metadata is lost", async () => {
    await saveColorPalette(["-", "#123456"]);
    playerMetadata = {};
    localStorage.clear();

    expect(sceneItems).toEqual([expect.objectContaining({ metadata: { [PALETTE_STATE_KEY]: { format: 3, slots: ["-", "#123456"] } } })]);
    await expect(loadColorPalette()).resolves.toEqual(["-", "#123456"]);
    await expect(getColorPaletteSceneData()).resolves.toEqual(expect.objectContaining({ scope: "scene-data-item", bytes: expect.any(Number), limitBytes: 1_000_000 }));
    expect(obr.player.setMetadata).not.toHaveBeenCalled();
  });

  it("ignores a palette from an unsupported storage format", async () => {
    sceneItems = [{ id: "palette", metadata: { [PALETTE_STATE_KEY]: { format: 2, slots: ["#123456"] } } }];

    await expect(loadColorPalette()).resolves.toBeUndefined();
  });

  it("removes current and legacy palette data when clearing all data", async () => {
    const preferences = await loadPreferences();
    await savePreferences({ ...preferences, colorPalette: ["-", "#123456"], colorPaletteFormat: 2, customColors: ["#abcdef"] });
    await saveColorPalette(["-", "#123456"]);

    await clearAllBoardData();

    await expect(loadColorPalette()).resolves.toBeUndefined();
    expect(sceneItems).not.toEqual(expect.arrayContaining([expect.objectContaining({ metadata: expect.objectContaining({ [PALETTE_STATE_KEY]: expect.anything() }) })]));
    await expect(loadPreferences()).resolves.not.toHaveProperty("colorPalette");
    await expect(loadPreferences()).resolves.not.toHaveProperty("colorPaletteFormat");
    await expect(loadPreferences()).resolves.not.toHaveProperty("customColors");
  });

  it("clears only the palette Scene Data Item", async () => {
    await saveBoard(board());
    await saveColorPalette(["#123456"]);

    await clearColorPaletteData();

    expect(sceneItems).toEqual([expect.objectContaining({ metadata: expect.objectContaining({ [BOARD_STATE_KEY]: expect.anything() }) })]);
  });
});
