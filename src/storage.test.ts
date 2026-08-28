import { beforeEach, describe, expect, it, vi } from "vitest";
import { PRIVATE_ROOM_STATE_KEY, SHARED_SCENE_STATE_KEY } from "./constants";
import { beginSharedSceneTransition, carrySharedBoardAcrossSceneTransition, clearAllBoardData, clearRoomBoardData, clearSceneBoardData, deleteBoard, getSceneKey, loadAllVisibleBoards, loadGmSharedBoardState, loadPrivateBoardState, loadSharedBoardState, movePrivateRoomBoardToScene, normalizeBoardState, saveBoard, savePrivateBoardState, saveSharedBoardState, trackActiveSharedBoard } from "./storage";
import type { BoardItem } from "./types";

const obr = vi.hoisted(() => ({
  isAvailable: true,
  scene: { getMetadata: vi.fn(), setMetadata: vi.fn(), isReady: vi.fn(), items: { getItems: vi.fn(), addItems: vi.fn(), updateItems: vi.fn(), deleteItems: vi.fn() } },
  room: { getMetadata: vi.fn(), setMetadata: vi.fn() },
  player: { getMetadata: vi.fn(), setMetadata: vi.fn() },
}));

vi.mock("@owlbear-rodeo/sdk", () => ({ default: obr }));

const state = { version: 1 as const, boards: [] };
const privateState = { version: 1 as const, boards: [{ id: "saved", name: "Saved", scope: "room" as const, visibility: "private" as const, revision: 1, cellSizePx: 72, cellGapPx: 2, items: [], updatedAt: "2026-01-01T00:00:00.000Z" }] };
const shareableBoard = { id: "shareable", name: "Shareable", scope: "room" as const, visibility: "private" as const, ownerId: "owner", ownerName: "Owner", revision: 0, cellSizePx: 72, cellGapPx: 2, items: [], updatedAt: "2026-01-01T00:00:00.000Z" };

describe("storage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
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

  it("updates the existing shared scene data item contents", async () => {
    const previous = { version: 1 as const, boards: [{ ...shareableBoard, visibility: "shared" as const, scope: "scene" as const, revision: 1 }] };
    const next = { version: 1 as const, boards: [{ ...shareableBoard, name: "Updated", visibility: "shared" as const, scope: "scene" as const, revision: 2 }] };
    let items = [{ id: "shared-item", type: "DATA", data: { namespace: "com.owlbear-board.grid/shared-scene-board", version: 1, state: previous } }];
    obr.scene.items.getItems.mockImplementation(() => Promise.resolve(items));
    obr.scene.items.updateItems.mockImplementation(async (ids, update) => {
      const drafts = items.filter((item) => item.id && ids.includes(item.id)).map((item) => ({ ...item }));
      update(drafts);
      items = items.map((item) => drafts.find((draft) => draft.id === item.id) ?? item);
    });

    await saveSharedBoardState("scene", next);

    await expect(loadSharedBoardState("scene")).resolves.toEqual(next);
    expect(obr.scene.items.addItems).not.toHaveBeenCalled();
  });

  it("stores only non-default board fields and restores them on load", async () => {
    const board = { ...privateState.boards[0], items: [{ id: "counter", type: "counter" as const, gridX: 0, gridY: 0, gridWidth: 1, gridHeight: 1, updatedAt: "2026-01-01T00:00:00.000Z", counterValue: 0, counterLabelPosition: "top-center" as const, counterDimAtZero: true, borderColor: "#bb99ff", counterZeroColor: "#ff6b8a", counterMaxColor: "#ffd166" }] };
    await savePrivateBoardState("room", { version: 1, boards: [board] });

    expect(obr.player.setMetadata).toHaveBeenLastCalledWith({ [PRIVATE_ROOM_STATE_KEY]: { version: 1, boards: [{ id: "saved", name: "Saved", scope: "room", visibility: "private", revision: 1, items: [{ id: "counter", type: "counter", gridX: 0, gridY: 0, gridWidth: 1, gridHeight: 1, updatedAt: "2026-01-01T00:00:00.000Z" }], updatedAt: "2026-01-01T00:00:00.000Z" }] } });
    await expect(loadPrivateBoardState("room")).resolves.toMatchObject({ boards: [{ cellSizePx: 72, cellGapPx: 2, items: [{ counterValue: 0, counterLabelPosition: "top-center", counterDimAtZero: true, borderColor: "#bb99ff", counterZeroColor: "#ff6b8a", counterMaxColor: "#ffd166" }] }] });
  });

  it("restores a scene board saved before scene readiness after reload", async () => {
    const existing = { ...privateState, boards: [{ ...privateState.boards[0], id: "existing", scope: "scene" as const }] };
    const saved = { ...privateState, boards: [{ ...privateState.boards[0], scope: "scene" as const }] };
    obr.scene.getMetadata.mockResolvedValue({ "com.owlbear-board.grid/scene-key": "active-scene" });
    obr.scene.isReady.mockResolvedValueOnce(true).mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    await savePrivateBoardState("scene", existing);
    await savePrivateBoardState("scene", saved);

    await expect(loadPrivateBoardState("scene")).resolves.toEqual({ version: 1, boards: [...existing.boards, ...saved.boards] });
  });

  it("restores a private board from its browser backup when Owlbear metadata disappears", async () => {
    await savePrivateBoardState("room", privateState);
    obr.player.getMetadata.mockResolvedValue({});

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
      updatedAt: "2026-01-01T00:00:00.000Z",
    })));

    await saveBoard({ ...shareableBoard, id: "presentation", items });

    await expect(loadPrivateBoardState("room")).resolves.toMatchObject({ boards: [{ id: "presentation", items }] });
  });

  it("normalizes legacy derived occupancy when loading", () => {
    const legacy = { ...shareableBoard, items: [{ id: "item", type: "text" as const, gridX: Infinity, gridY: 3.5, gridWidth: Infinity, gridHeight: -1, occupiedCells: [{ x: 99, y: 99 }], updatedAt: "" }] };
    const normalized = normalizeBoardState({ version: 1, boards: [legacy] });

    expect(normalized.boards[0].items[0]).toEqual(expect.objectContaining({ gridX: 0, gridY: 3, gridWidth: 1, gridHeight: 1 }));
    expect("occupiedCells" in normalized.boards[0].items[0]).toBe(false);
  });

  it("uses the demo scene key without Owlbear", async () => {
    obr.isAvailable = false;

    await expect(getSceneKey()).resolves.toBe("demo");
  });

  it("copies a shared room board into the destination scene data item", async () => {
    let sceneMetadata: Record<string, unknown> = { "com.owlbear-board.grid/scene-key": "source" };
    obr.scene.isReady.mockResolvedValue(true);
    obr.scene.getMetadata.mockImplementation(() => Promise.resolve(sceneMetadata));
    const boardState = { version: 1 as const, boards: [{ ...shareableBoard, visibility: "shared" as const, scope: "room" as const, revision: 4 }] };
    const sceneBoard = { ...shareableBoard, id: "scene-board", visibility: "shared" as const, scope: "scene" as const, revision: 9 };
    obr.scene.items.getItems.mockResolvedValue([
      { id: "room-item", type: "DATA", data: { namespace: "com.owlbear-board.grid/shared-scene-board", version: 1, state: boardState } },
      { id: "scene-item", type: "DATA", data: { namespace: "com.owlbear-board.grid/shared-scene-board", version: 1, state: { version: 1, boards: [sceneBoard] } } },
    ]);

    await trackActiveSharedBoard(boardState, "source");
    expect(obr.scene.items.getItems).toHaveBeenCalledTimes(1);
    beginSharedSceneTransition();
    sceneMetadata = { "com.owlbear-board.grid/scene-key": "destination" };
    obr.scene.items.getItems.mockResolvedValue([]);
    await carrySharedBoardAcrossSceneTransition();
    expect(obr.room.setMetadata).toHaveBeenCalledWith(expect.objectContaining({
      "com.owlbear-board.grid/shared-room-state": expect.objectContaining({ boards: [expect.objectContaining({ id: "shareable" })] }),
    }));
    expect(obr.scene.items.addItems).toHaveBeenCalledWith([expect.objectContaining({
      data: expect.objectContaining({ state: expect.objectContaining({ boards: [expect.objectContaining({ id: "shareable" })] }) }),
    })]);

    sceneMetadata = { "com.owlbear-board.grid/scene-key": "source" };
    await carrySharedBoardAcrossSceneTransition();
    expect(obr.scene.items.deleteItems).toHaveBeenCalledWith(["room-item"]);
  });

  it("preserves the destination room board when transition revisions are equal", async () => {
    const sourceBoard = { ...shareableBoard, name: "Source", visibility: "shared" as const, scope: "room" as const, revision: 4 };
    const destinationBoard = { ...shareableBoard, name: "Destination", visibility: "shared" as const, scope: "room" as const, revision: 4 };
    obr.scene.isReady.mockResolvedValue(true);
    let sceneMetadata: Record<string, unknown> = { "com.owlbear-board.grid/scene-key": "source" };
    obr.scene.getMetadata.mockImplementation(() => Promise.resolve(sceneMetadata));
    obr.scene.items.getItems.mockResolvedValue([{ id: "source-room-item", type: "DATA", data: { namespace: "com.owlbear-board.grid/shared-scene-board", version: 1, state: { version: 1, boards: [sourceBoard] } } }]);
    obr.room.getMetadata.mockResolvedValue({ "com.owlbear-board.grid/shared-room-state": { version: 1, boards: [destinationBoard] } });

    await trackActiveSharedBoard({ version: 1, boards: [sourceBoard] }, "source");
    beginSharedSceneTransition();
    sceneMetadata = { "com.owlbear-board.grid/scene-key": "destination" };
    await carrySharedBoardAcrossSceneTransition();

    expect(obr.room.setMetadata).not.toHaveBeenCalled();
    await expect(loadSharedBoardState("room")).resolves.toEqual({ version: 1, boards: [destinationBoard] });
  });

  it("migrates legacy shared scene metadata once and clears its source", async () => {
    const legacy = { version: 1 as const, boards: [{ ...shareableBoard, visibility: "shared" as const, scope: "scene" as const, revision: 3 }] };
    let metadata: Record<string, unknown> = { [SHARED_SCENE_STATE_KEY]: legacy };
    let items: Array<Record<string, unknown>> = [];
    obr.scene.getMetadata.mockImplementation(() => Promise.resolve(metadata));
    obr.scene.setMetadata.mockImplementation((value) => { metadata = { ...metadata, ...value }; return Promise.resolve(); });
    obr.scene.items.getItems.mockImplementation(() => Promise.resolve(items));
    obr.scene.items.addItems.mockImplementation(async (drafts) => { items = drafts.map((item: Record<string, unknown>) => ({ ...item, id: "migrated-item" })); });

    await expect(loadSharedBoardState("scene")).resolves.toEqual(legacy);
    expect(obr.scene.items.addItems).toHaveBeenCalledTimes(1);
    expect(obr.scene.setMetadata).toHaveBeenCalledWith({ [SHARED_SCENE_STATE_KEY]: undefined });

    vi.clearAllMocks();
    await expect(loadSharedBoardState("scene")).resolves.toEqual(legacy);
    expect(obr.scene.items.addItems).not.toHaveBeenCalled();
    expect(metadata[SHARED_SCENE_STATE_KEY]).toBeUndefined();
  });

  it("deletes one shared scene board while preserving its siblings", async () => {
    const requested = { ...shareableBoard, id: "requested", visibility: "shared" as const, scope: "scene" as const, revision: 1 };
    const sibling = { ...shareableBoard, id: "sibling", visibility: "shared" as const, scope: "scene" as const, revision: 1 };
    const item = { id: "shared-item", type: "DATA", data: { namespace: "com.owlbear-board.grid/shared-scene-board", version: 1, state: { version: 1 as const, boards: [requested, sibling] } } };
    let drafts: Record<string, unknown>[] = [];
    obr.scene.items.getItems.mockResolvedValue([item]);
    obr.scene.items.updateItems.mockImplementation(async (_ids, update) => {
      drafts = [{ ...item }];
      update(drafts as never);
    });

    await deleteBoard(requested);

    expect(obr.scene.items.updateItems).toHaveBeenCalledWith(["shared-item"], expect.any(Function));
    expect(drafts[0]).toEqual(expect.objectContaining({ data: expect.objectContaining({ state: expect.objectContaining({ version: 1, boards: [expect.objectContaining({ id: "sibling" })] }) }) }));
    expect(obr.scene.items.deleteItems).not.toHaveBeenCalled();
  });

  it("deletes the requested shared scene board record, not a newer duplicate", async () => {
    const requested = { ...shareableBoard, id: "requested", visibility: "shared" as const, scope: "scene" as const, revision: 1 };
    const newer = { ...shareableBoard, id: "newer", visibility: "shared" as const, scope: "scene" as const, revision: 2 };
    obr.scene.items.getItems.mockResolvedValue([
      { id: "requested-item", type: "DATA", data: { namespace: "com.owlbear-board.grid/shared-scene-board", version: 1, state: { version: 1, boards: [requested] } } },
      { id: "newer-item", type: "DATA", data: { namespace: "com.owlbear-board.grid/shared-scene-board", version: 1, state: { version: 1, boards: [newer] } } },
    ]);

    await deleteBoard(requested);

    expect(obr.scene.items.deleteItems).toHaveBeenCalledWith(["requested-item"]);
  });

  it("replaces a pending transition with the latest active room board", async () => {
    const boardA = { ...shareableBoard, id: "room-a", visibility: "shared" as const, scope: "room" as const, revision: 1 };
    const boardB = { ...shareableBoard, id: "room-b", visibility: "shared" as const, scope: "room" as const, revision: 2 };
    obr.scene.isReady.mockResolvedValue(true);
    let sceneMetadata: Record<string, unknown> = { "com.owlbear-board.grid/scene-key": "a" };
    obr.scene.getMetadata.mockImplementation(() => Promise.resolve(sceneMetadata));
    obr.scene.items.getItems.mockResolvedValue([{ id: "a-room-item", type: "DATA", data: { namespace: "com.owlbear-board.grid/shared-scene-board", version: 1, state: { version: 1, boards: [boardA] } } }]);

    await trackActiveSharedBoard({ version: 1, boards: [boardA] }, "a");
    beginSharedSceneTransition();
    sceneMetadata = { "com.owlbear-board.grid/scene-key": "b" };
    await carrySharedBoardAcrossSceneTransition();

    obr.scene.items.getItems.mockResolvedValue([{ id: "b-room-item", type: "DATA", data: { namespace: "com.owlbear-board.grid/shared-scene-board", version: 1, state: { version: 1, boards: [boardB] } } }]);
    await trackActiveSharedBoard({ version: 1, boards: [boardB] }, "b");
    beginSharedSceneTransition();
    sceneMetadata = { "com.owlbear-board.grid/scene-key": "c" };
    await carrySharedBoardAcrossSceneTransition();

    expect(obr.room.setMetadata).toHaveBeenLastCalledWith(expect.objectContaining({ "com.owlbear-board.grid/shared-room-state": expect.objectContaining({ version: 1, boards: [expect.objectContaining({ id: "room-b" })] }) }));
    sceneMetadata = { "com.owlbear-board.grid/scene-key": "b" };
    await carrySharedBoardAcrossSceneTransition();
    expect(obr.scene.items.deleteItems).toHaveBeenCalledWith(["b-room-item"]);
    expect(obr.scene.items.deleteItems).not.toHaveBeenCalledWith(["a-room-item"]);
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
  it("clears only Owlbear Board data for the current scene and room", async () => {
    obr.scene.isReady.mockResolvedValue(true);
    obr.scene.getMetadata.mockResolvedValue({ "com.owlbear-board.grid/scene-key": "active-scene" });
    await savePrivateBoardState("scene", { ...privateState, boards: [{ ...privateState.boards[0], scope: "scene" as const }] });
    await savePrivateBoardState("room", privateState);

    await clearAllBoardData();

    await expect(loadPrivateBoardState("scene")).resolves.toEqual(state);
    await expect(loadPrivateBoardState("room")).resolves.toEqual(state);
    expect(obr.scene.setMetadata).toHaveBeenCalledWith({ "com.owlbear-board.grid/shared-scene-state": undefined });
    expect(obr.room.setMetadata).toHaveBeenCalledWith(expect.objectContaining({ "com.owlbear-board.grid/shared-room-state": state }));
  });

  it("loads private boards when a legacy DATA item makes scene item reads fail", async () => {
    const privateScene = { ...privateState, boards: [{ ...privateState.boards[0], scope: "scene" as const }] };
    obr.scene.isReady.mockResolvedValue(true);
    obr.scene.getMetadata.mockResolvedValue({ "com.owlbear-board.grid/scene-key": "active-scene", [SHARED_SCENE_STATE_KEY]: state });
    await savePrivateBoardState("scene", privateScene);
    obr.scene.items.getItems.mockRejectedValue({ error: { name: "ValidationError", message: "items[0].id is required" } });

    await expect(loadAllVisibleBoards()).resolves.toMatchObject({ privateScene });
  });

});
