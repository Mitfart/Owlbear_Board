import { beforeEach, describe, expect, it, vi } from "vitest";
import { BOARD_EVENT_CHANNEL, BOARD_STATE_KEY, ROOM_BOARD_STATE_KEY } from "./constants";
import { carryRoomBoardsToCurrentScene, clearAllBoardData, deleteBoard, loadAllVisibleBoards, normalizeBoardState, saveBoard } from "./storage";

let playerMetadata: Record<string, unknown>;
let roomMetadata: Record<string, unknown>;
let sceneMetadata: Record<string, unknown>;
const obr = vi.hoisted(() => ({
  isAvailable: true,
  scene: { getMetadata: vi.fn(), setMetadata: vi.fn(), isReady: vi.fn() },
  room: { getMetadata: vi.fn(), setMetadata: vi.fn() },
  player: { getMetadata: vi.fn(), setMetadata: vi.fn(), getId: vi.fn(), getRole: vi.fn() },
  broadcast: { sendMessage: vi.fn() },
}));
vi.mock("@owlbear-rodeo/sdk", () => ({ default: obr }));

const board = (overrides: Record<string, unknown> = {}) => ({
  id: "board", name: "Board", scope: "scene" as const, visibility: "private" as const,
  ownerId: "owner", allowedUserIds: ["owner"], revision: 0, cellSizePx: 72, cellGapPx: 2,
  items: [], updatedAt: "2026-01-01T00:00:00.000Z", ...overrides,
});

describe("board storage", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    playerMetadata = {}; roomMetadata = {}; sceneMetadata = { "com.owlbear-board.grid/scene-key": "scene" };
    obr.player.getMetadata.mockImplementation(async () => playerMetadata);
    obr.player.setMetadata.mockImplementation(async (update) => { playerMetadata = { ...playerMetadata, ...update }; });
    obr.player.getId.mockResolvedValue("owner"); obr.player.getRole.mockResolvedValue("GM");
    obr.room.getMetadata.mockImplementation(async () => roomMetadata);
    obr.room.setMetadata.mockImplementation(async (update) => { roomMetadata = { ...roomMetadata, ...update }; });
    obr.scene.getMetadata.mockImplementation(async () => sceneMetadata);
    obr.scene.setMetadata.mockImplementation(async (update) => { sceneMetadata = { ...sceneMetadata, ...update }; });
    obr.scene.isReady.mockResolvedValue(true); obr.broadcast.sendMessage.mockResolvedValue(undefined);
    await clearAllBoardData();
    vi.clearAllMocks();
  });

  it("reloads private boards from scene metadata after player metadata is lost", async () => {
    await saveBoard(board());
    playerMetadata = {}; // Owlbear rebuilds the player object on extension reload.
    await expect(loadAllVisibleBoards("PLAYER", "owner")).resolves.toMatchObject({ boards: [expect.objectContaining({ id: "board" })] });
    await expect(loadAllVisibleBoards("PLAYER", "other")).resolves.toMatchObject({ boards: [] });
    expect(sceneMetadata[BOARD_STATE_KEY]).toBeDefined();
  });

  it("uses room metadata as the Room Board registry and prunes stale scene copies", async () => {
    const roomBoard = await saveBoard(board({ scope: "room", updatedAt: "2026-01-02T00:00:00.000Z" }));
    expect(roomMetadata[ROOM_BOARD_STATE_KEY]).toMatchObject({ boards: [expect.objectContaining({ id: "board" })] });

    sceneMetadata = { "com.owlbear-board.grid/scene-key": "next", [BOARD_STATE_KEY]: { version: 1, boards: [board({ id: "stale", scope: "room" })] } };
    await carryRoomBoardsToCurrentScene();
    expect((sceneMetadata[BOARD_STATE_KEY] as { boards: Array<{ id: string }> }).boards).toEqual([expect.objectContaining({ id: "board" })]);

    await deleteBoard(roomBoard);
    expect(roomMetadata[ROOM_BOARD_STATE_KEY]).toMatchObject({ boards: [] });
    expect((sceneMetadata[BOARD_STATE_KEY] as { boards: Array<{ id: string }> }).boards).toEqual([]);
  });

  it("broadcasts creates and deletes so other Manage Boards views refresh immediately", async () => {
    const saved = await saveBoard(board());
    await deleteBoard(saved);
    expect(obr.broadcast.sendMessage).toHaveBeenNthCalledWith(1, BOARD_EVENT_CHANNEL, { action: "save", boardId: "board" }, { destination: "REMOTE" });
    expect(obr.broadcast.sendMessage).toHaveBeenNthCalledWith(2, BOARD_EVENT_CHANNEL, { action: "delete", boardId: "board" }, { destination: "REMOTE" });
  });

  it("rejects deletion by a non-owner player", async () => {
    const saved = await saveBoard(board());
    obr.player.getRole.mockResolvedValue("PLAYER"); obr.player.getId.mockResolvedValue("other");
    await expect(deleteBoard(saved)).rejects.toThrow("Only the board creator or a GM");
  });

  it("normalizes legacy occupancy and defaults", () => {
    const legacy = board({ items: [{ id: "item", type: "text", gridX: Infinity, gridY: 3.5, gridWidth: Infinity, gridHeight: -1, occupiedCells: [{ x: 1, y: 1 }], updatedAt: "" }] }) as unknown as import("./types").Board;
    expect(normalizeBoardState({ version: 1, boards: [legacy] }).boards[0].items[0]).toEqual(expect.objectContaining({ gridX: 0, gridY: 3, gridWidth: 1, gridHeight: 1 }));
  });
});
