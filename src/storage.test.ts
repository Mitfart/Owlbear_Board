import { beforeEach, describe, expect, it, vi } from "vitest";
import { beginSharedSceneTransition, carrySharedBoardAcrossSceneTransition, getSceneKey, loadAllVisibleBoards, loadGmSharedBoardState, loadPrivateBoardState, movePrivateRoomBoardToScene, normalizeBoardState, saveBoard, savePrivateBoardState, saveSharedBoardState, trackActiveSharedBoard } from "./storage";
import type { BoardItem } from "./types";

const obr = vi.hoisted(() => ({
  isAvailable: true,
  scene: { getMetadata: vi.fn(), setMetadata: vi.fn(), isReady: vi.fn(), items: { getItems: vi.fn(), addItems: vi.fn(), updateItems: vi.fn(), deleteItems: vi.fn() } },
  room: { getMetadata: vi.fn(), setMetadata: vi.fn() },
  player: { getMetadata: vi.fn(), setMetadata: vi.fn() },
}));

vi.mock("@owlbear-rodeo/sdk", () => ({ default: obr }));

const state = { version: 1 as const, boards: [] };
const privateState = { version: 1 as const, boards: [{ id: "saved", name: "Saved", scope: "room" as const, visibility: "private" as const, revision: 1, cellSizePx: 72, cellGapPx: 2, items: [], createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" }] };
const shareableBoard = { id: "shareable", name: "Shareable", scope: "room" as const, visibility: "private" as const, ownerId: "owner", ownerName: "Owner", revision: 0, cellSizePx: 72, cellGapPx: 2, items: [], createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" };

describe("storage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    obr.isAvailable = true;
    let playerMetadata: Record<string, unknown> = {};
    let roomMetadata: Record<string, unknown> = {};
    obr.player.getMetadata.mockImplementation(() => Promise.resolve(playerMetadata));
    obr.player.setMetadata.mockImplementation((value) => { playerMetadata = { ...playerMetadata, ...value }; return Promise.resolve(); });
    obr.room.getMetadata.mockImplementation(() => Promise.resolve(roomMetadata));
    obr.room.setMetadata.mockImplementation((value) => { roomMetadata = value; return Promise.resolve(); });
    obr.scene.items.getItems.mockResolvedValue([]);
    obr.scene.items.addItems.mockResolvedValue([]);
    obr.scene.items.updateItems.mockResolvedValue([]);
    obr.scene.items.deleteItems.mockResolvedValue([]);
  });

  it("persists a shared scene board as a hidden namespaced data item", async () => {
    await saveSharedBoardState("scene", state);

    expect(obr.scene.items.addItems).toHaveBeenCalledWith([expect.objectContaining({
      type: "DATA", visible: false, locked: true, disableHit: true,
      data: expect.objectContaining({ namespace: expect.stringContaining("shared-scene-board"), version: 1, state }),
    })]);
    expect(obr.scene.setMetadata).not.toHaveBeenCalled();
  });

  it("restores a private room board from player metadata", async () => {
    await savePrivateBoardState("room", privateState);

    await expect(loadPrivateBoardState("room")).resolves.toEqual(privateState);
  });

  it("moves a private room board into the current scene", async () => {
    await savePrivateBoardState("room", privateState);

    await movePrivateRoomBoardToScene(privateState.boards[0]);

    await expect(loadPrivateBoardState("room")).resolves.toEqual(state);
    await expect(loadPrivateBoardState("scene")).resolves.toMatchObject({ boards: [{ id: "saved", scope: "scene", revision: 2 }] });
  });

  it("republishes GM sharing with the destination scene when moving a room board", async () => {
    const shared = { ...shareableBoard, showToGM: true };

    await saveBoard(shared);
    await movePrivateRoomBoardToScene(shared);

    await expect(loadGmSharedBoardState()).resolves.toMatchObject({
      boards: [{ id: "shareable", visibility: "gm-shared", scope: "scene", sceneKey: "no-scene" }],
    });
  });

  it("persists default-off sharing and revocation", async () => {

    await saveBoard(shareableBoard);
    await expect(loadGmSharedBoardState()).resolves.toEqual(state);
    await saveBoard({ ...shareableBoard, showToGM: true });
    await expect(loadGmSharedBoardState()).resolves.toMatchObject({ boards: [{ id: "shareable", visibility: "gm-shared" }] });
    await saveBoard({ ...shareableBoard, showToGM: false });
    await expect(loadGmSharedBoardState()).resolves.toEqual(state);
  });

  it("only exposes enabled boards to GMs, not the private GM owner's copy", async () => {
    await saveBoard({ ...shareableBoard, showToGM: true });

    await expect(loadAllVisibleBoards("PLAYER", "other")).resolves.toMatchObject({ gmShared: { boards: [] } });
    await expect(loadAllVisibleBoards("GM", "owner")).resolves.toMatchObject({ gmShared: { boards: [] } });
    await expect(loadAllVisibleBoards("GM", "gm")).resolves.toMatchObject({ gmShared: { boards: [{ id: "shareable" }] } });
  });

  it("persists Fill Block and every vertical alignment through reload", async () => {
    const alignments = ["top", "center", "bottom"] as const;
    const items: BoardItem[] = alignments.flatMap((textVerticalAlignment) => [true, false].map((fillBlock, index) => ({
      id: `${textVerticalAlignment}-${index}`, type: "text" as const, text: "Saved text", textBaselineWidth: 2, fillBlock, textVerticalAlignment,
      gridX: index, gridY: 0, gridWidth: 2, gridHeight: 1,
      createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
    })));

    await saveBoard({ ...shareableBoard, id: "presentation", items });

    await expect(loadPrivateBoardState("room")).resolves.toMatchObject({ boards: [{ id: "presentation", items }] });
  });

  it("normalizes legacy derived occupancy when loading", () => {
    const legacy = { ...shareableBoard, items: [{ id: "item", type: "text" as const, gridX: Infinity, gridY: 3.5, gridWidth: Infinity, gridHeight: -1, occupiedCells: [{ x: 99, y: 99 }], createdAt: "", updatedAt: "" }] };
    const normalized = normalizeBoardState({ version: 1, boards: [legacy] });

    expect(normalized.boards[0].items[0]).toEqual(expect.objectContaining({ gridX: 0, gridY: 3, gridWidth: 1, gridHeight: 1 }));
    expect("occupiedCells" in normalized.boards[0].items[0]).toBe(false);
  });

  it("uses the demo scene key without Owlbear", async () => {
    obr.isAvailable = false;

    await expect(getSceneKey()).resolves.toBe("demo");
  });

  it("carries the tracked board and cleans only its source item when returning", async () => {
    let sceneMetadata: Record<string, unknown> = { "com.owlbear-board.grid/scene-key": "source" };
    obr.scene.isReady.mockResolvedValue(true);
    obr.scene.getMetadata.mockImplementation(() => Promise.resolve(sceneMetadata));
    const boardState = { version: 1 as const, boards: [{ ...shareableBoard, visibility: "shared" as const, scope: "scene" as const, revision: 4 }] };
    obr.scene.items.getItems.mockResolvedValue([
      { id: "source-item", type: "DATA", data: { namespace: "com.owlbear-board.grid/shared-scene-board", version: 1, state: boardState } },
      { id: "untracked-duplicate", type: "DATA", data: { namespace: "com.owlbear-board.grid/shared-scene-board", version: 1, state: boardState } },
    ]);

    await trackActiveSharedBoard(boardState, "source");
    beginSharedSceneTransition();
    sceneMetadata = { "com.owlbear-board.grid/scene-key": "destination" };
    obr.scene.items.getItems.mockResolvedValue([]);
    await carrySharedBoardAcrossSceneTransition();
    expect(obr.scene.items.addItems).toHaveBeenCalledWith([expect.objectContaining({ data: expect.objectContaining({ state: boardState }) })]);

    sceneMetadata = { "com.owlbear-board.grid/scene-key": "source" };
    await carrySharedBoardAcrossSceneTransition();
    expect(obr.scene.items.deleteItems).toHaveBeenCalledWith(["source-item"]);
  });

  it("does not delete the source item when readiness returns without changing scenes", async () => {
    const boardState = { version: 1 as const, boards: [{ ...shareableBoard, visibility: "shared" as const, scope: "scene" as const, revision: 4 }] };
    obr.scene.isReady.mockResolvedValue(true);
    obr.scene.getMetadata.mockResolvedValue({ "com.owlbear-board.grid/scene-key": "source" });
    obr.scene.items.getItems.mockResolvedValue([{ id: "source-item", type: "DATA", data: { namespace: "com.owlbear-board.grid/shared-scene-board", version: 1, state: boardState } }]);

    await trackActiveSharedBoard(boardState, "source");
    beginSharedSceneTransition();
    await carrySharedBoardAcrossSceneTransition();

    expect(obr.scene.items.deleteItems).not.toHaveBeenCalled();
  });
});
