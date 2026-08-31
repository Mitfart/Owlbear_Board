import { beforeEach, describe, expect, it, vi } from "vitest";
import { BOARD_STATE_KEY } from "./constants";
import { carryRoomBoardsToCurrentScene, clearAllBoardData, loadAllVisibleBoards, normalizeBoardState, saveBoard } from "./storage";

let playerMetadata: Record<string, unknown>;
let sceneMetadata: Record<string, unknown>;
const obr = vi.hoisted(() => ({
  isAvailable: true,
  scene: { getMetadata: vi.fn(), setMetadata: vi.fn(), isReady: vi.fn(), items: { getItems: vi.fn(), deleteItems: vi.fn() } },
  room: { getMetadata: vi.fn(), setMetadata: vi.fn() },
  player: { getMetadata: vi.fn(), setMetadata: vi.fn(), getId: vi.fn() },
  broadcast: { sendMessage: vi.fn() },
}));
vi.mock("@owlbear-rodeo/sdk", () => ({ default: obr }));

const board = (overrides: Record<string, unknown> = {}) => ({
  id: "board", name: "Board", scope: "scene" as const, visibility: "private" as const,
  ownerId: "owner", allowedUserIds: ["owner"], revision: 0, cellSizePx: 72, cellGapPx: 2,
  items: [], updatedAt: "2026-01-01T00:00:00.000Z", ...overrides,
});

describe("scene board storage", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    playerMetadata = {};
    sceneMetadata = { "com.owlbear-board.grid/scene-key": "scene" };
    obr.player.getMetadata.mockImplementation(async () => playerMetadata);
    obr.player.setMetadata.mockImplementation(async (update) => { playerMetadata = { ...playerMetadata, ...update }; });
    obr.scene.getMetadata.mockImplementation(async () => sceneMetadata);
    obr.scene.setMetadata.mockImplementation(async (update) => { sceneMetadata = { ...sceneMetadata, ...update }; });
    obr.scene.isReady.mockResolvedValue(true);
    obr.broadcast.sendMessage.mockResolvedValue(undefined);
    await clearAllBoardData();
    vi.clearAllMocks();
  });

  it("reloads private boards from scene metadata after player metadata is lost", async () => {
    await saveBoard(board());
    playerMetadata = {}; // Simulates Owlbear rebuilding the player object on extension reload.
    await expect(loadAllVisibleBoards("PLAYER", "owner")).resolves.toMatchObject({ boards: [expect.objectContaining({ id: "board" })] });
    await expect(loadAllVisibleBoards("PLAYER", "other")).resolves.toMatchObject({ boards: [] });
    await expect(loadAllVisibleBoards("GM", "gm")).resolves.toMatchObject({ boards: [expect.objectContaining({ id: "board" })] });
    expect(sceneMetadata[BOARD_STATE_KEY]).toBeDefined();
  });

  it("copies the newest room board into the next scene", async () => {
    await saveBoard(board({ scope: "room", updatedAt: "2026-01-02T00:00:00.000Z" }));
    sceneMetadata = { "com.owlbear-board.grid/scene-key": "next" };
    await carryRoomBoardsToCurrentScene();
    const copied = (sceneMetadata[BOARD_STATE_KEY] as { boards: Array<{ id: string }> }).boards;
    expect(copied).toEqual([expect.objectContaining({ id: "board", scope: "room" })]);

    sceneMetadata[BOARD_STATE_KEY] = { version: 1, boards: [board({ scope: "room", name: "Newer", updatedAt: "2026-01-03T00:00:00.000Z" })] };
    await carryRoomBoardsToCurrentScene();
    expect((sceneMetadata[BOARD_STATE_KEY] as { boards: Array<{ name: string }> }).boards[0].name).toBe("Newer");
  });

  it("clears scene-backed board data", async () => {
    await saveBoard(board());
    await clearAllBoardData();
    await expect(loadAllVisibleBoards("GM", "gm")).resolves.toMatchObject({ boards: [] });
  });

  it("normalizes legacy occupancy and defaults", () => {
    const legacy = board({ items: [{ id: "item", type: "text", gridX: Infinity, gridY: 3.5, gridWidth: Infinity, gridHeight: -1, occupiedCells: [{ x: 1, y: 1 }], updatedAt: "" }] }) as unknown as import("./types").Board;
    expect(normalizeBoardState({ version: 1, boards: [legacy] }).boards[0].items[0]).toEqual(expect.objectContaining({ gridX: 0, gridY: 3, gridWidth: 1, gridHeight: 1 }));
  });
});
