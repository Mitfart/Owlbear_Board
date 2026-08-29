import { beforeEach, describe, expect, it, vi } from "vitest";
import { PRIVATE_ROOM_STATE_KEY } from "./constants";
import { clearAllBoardData, deleteBoard, getSceneKey, loadAllVisibleBoards, loadPrivateBoardState, loadSharedBoardState, movePrivateRoomBoardToScene, normalizeBoardState, saveBoard, savePrivateBoardState, saveSharedBoardState } from "./storage";

let playerMetadata: Record<string, unknown>;
let roomMetadata: Record<string, unknown>;
let sceneMetadata: Record<string, unknown>;
const obr = vi.hoisted(() => ({
  isAvailable: true,
  scene: { getMetadata: vi.fn(), setMetadata: vi.fn(), isReady: vi.fn(), items: { getItems: vi.fn(), addItems: vi.fn(), updateItems: vi.fn(), deleteItems: vi.fn() } },
  room: { getMetadata: vi.fn(), setMetadata: vi.fn() },
  player: { getMetadata: vi.fn(), setMetadata: vi.fn(), getId: vi.fn() },
  broadcast: { sendMessage: vi.fn() },
  party: { getPlayers: vi.fn() },
}));
vi.mock("@owlbear-rodeo/sdk", () => ({ default: obr }));

const empty = { version: 1 as const, boards: [] };
const board = (overrides: Record<string, unknown> = {}) => ({ id: "board", name: "Board", scope: "room" as const, visibility: "private" as const, revision: 1, cellSizePx: 72, cellGapPx: 2, items: [], updatedAt: "2026-01-01T00:00:00.000Z", ...overrides });

describe("storage", () => {
  beforeEach(() => {
    vi.clearAllMocks(); localStorage.clear(); obr.isAvailable = true;
    playerMetadata = {}; roomMetadata = {}; sceneMetadata = { "com.owlbear-board.grid/scene-key": "scene" };
    obr.player.getMetadata.mockImplementation(async () => playerMetadata);
    obr.player.setMetadata.mockImplementation(async (update) => { playerMetadata = { ...playerMetadata, ...update }; });
    obr.player.getId.mockResolvedValue("player-1");
    obr.room.getMetadata.mockImplementation(async () => roomMetadata);
    obr.room.setMetadata.mockImplementation(async (update) => { roomMetadata = { ...roomMetadata, ...update }; });
    obr.scene.getMetadata.mockImplementation(async () => sceneMetadata);
    obr.scene.setMetadata.mockImplementation(async (update) => { sceneMetadata = { ...sceneMetadata, ...update }; });
    obr.scene.isReady.mockResolvedValue(true); obr.party.getPlayers.mockResolvedValue([]);
  });

  it("stores and reloads shared scene boards in scene metadata", async () => {
    const shared = board({ scope: "scene", visibility: "shared" });
    await saveSharedBoardState("scene", { version: 1, boards: [shared] });
    expect(obr.scene.setMetadata).toHaveBeenCalledWith({ "com.owlbear-board.grid/shared-scene-state": expect.objectContaining({ boards: [expect.objectContaining({ id: "board" })] }) });
    await expect(loadSharedBoardState("scene")).resolves.toMatchObject({ boards: [expect.objectContaining({ id: "board", scope: "scene" })] });
  });

  it("stores room boards in room metadata across scene changes", async () => {
    const shared = board({ visibility: "shared" });
    await saveSharedBoardState("room", { version: 1, boards: [shared] });
    sceneMetadata = { "com.owlbear-board.grid/scene-key": "another-scene" };
    await expect(loadSharedBoardState("room")).resolves.toMatchObject({ boards: [expect.objectContaining({ id: "board" })] });
    expect(obr.room.setMetadata).toHaveBeenCalledWith({ "com.owlbear-board.grid/shared-room-state": expect.any(Object) });
  });

  it("replaces the saved shared board instead of losing its first item", async () => {
    const shared = board({ visibility: "shared", revision: 1, items: [{ id: "first", type: "text", text: "first", gridX: 0, gridY: 0, gridWidth: 1, gridHeight: 1, updatedAt: "2026-01-01T00:00:00.000Z" }] });
    await saveBoard(shared);
    await saveBoard({ ...shared, revision: 2, items: [...shared.items, { id: "second", type: "text", text: "second", gridX: 1, gridY: 0, gridWidth: 1, gridHeight: 1, updatedAt: "2026-01-01T00:00:00.000Z" }] });
    await expect(loadSharedBoardState("room")).resolves.toMatchObject({ boards: [expect.objectContaining({ items: [expect.objectContaining({ id: "first" }), expect.objectContaining({ id: "second" })] })] });
  });

  it("deletes only the requested shared board", async () => {
    const first = board({ id: "first", visibility: "shared" }); const second = board({ id: "second", visibility: "shared" });
    await saveSharedBoardState("room", { version: 1, boards: [first, second] });
    await deleteBoard(first);
    await expect(loadSharedBoardState("room")).resolves.toMatchObject({ boards: [expect.objectContaining({ id: "second" })] });
  });

  it("persists private room boards in player metadata", async () => {
    const privateBoard = board();
    await savePrivateBoardState("room", { version: 1, boards: [privateBoard] });
    expect(playerMetadata[PRIVATE_ROOM_STATE_KEY]).toBeDefined();
    await expect(loadPrivateBoardState("room")).resolves.toMatchObject({ boards: [expect.objectContaining({ id: "board" })] });
  });

  it("persists private scene boards under the active scene key", async () => {
    await savePrivateBoardState("scene", { version: 1, boards: [board({ scope: "scene" })] });
    await expect(loadPrivateBoardState("scene")).resolves.toMatchObject({ boards: [expect.objectContaining({ scope: "scene" })] });
  });

  it("moves a private room board into the active scene", async () => {
    const privateBoard = board(); await savePrivateBoardState("room", { version: 1, boards: [privateBoard] });
    await movePrivateRoomBoardToScene(privateBoard);
    await expect(loadPrivateBoardState("room")).resolves.toEqual(empty);
    await expect(loadPrivateBoardState("scene")).resolves.toMatchObject({ boards: [expect.objectContaining({ id: "board", scope: "scene" })] });
  });

  it("shows GMs every connected player's private boards", async () => {
    obr.party.getPlayers.mockResolvedValue([{ id: "player-2", name: "Player Two", role: "PLAYER", metadata: { [PRIVATE_ROOM_STATE_KEY]: { version: 1, boards: [board()] } } }]);
    await expect(loadAllVisibleBoards("GM", "gm")).resolves.toMatchObject({ boards: [expect.objectContaining({ id: "board", ownerId: "player-2", ownerName: "Player Two" })] });
  });

  it("normalizes legacy occupancy and default board fields", () => {
    const legacy = board({ items: [{ id: "item", type: "text", gridX: Infinity, gridY: 3.5, gridWidth: Infinity, gridHeight: -1, occupiedCells: [{ x: 1, y: 1 }], updatedAt: "" }] }) as unknown as import("./types").Board;
    expect(normalizeBoardState({ version: 1, boards: [legacy] }).boards[0].items[0]).toEqual(expect.objectContaining({ gridX: 0, gridY: 3, gridWidth: 1, gridHeight: 1 }));
  });

  it("clears only this extension's board state", async () => {
    await saveSharedBoardState("scene", { version: 1, boards: [board({ scope: "scene", visibility: "shared" })] });
    await saveSharedBoardState("room", { version: 1, boards: [board({ visibility: "shared" })] });
    await clearAllBoardData();
    await expect(loadSharedBoardState("scene")).resolves.toEqual(empty);
    await expect(loadSharedBoardState("room")).resolves.toEqual(empty);
  });

  it("uses the demo scene key without Owlbear", async () => {
    obr.isAvailable = false; await expect(getSceneKey()).resolves.toBe("demo");
  });
});
