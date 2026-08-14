import { beforeEach, describe, expect, it, vi } from "vitest";
import { SHARED_SCENE_STATE_KEY } from "./constants";
import { getSceneKey, loadPrivateBoardState, movePrivateRoomBoardToScene, savePrivateBoardState, saveSharedBoardState } from "./storage";

const obr = vi.hoisted(() => ({
  isAvailable: true,
  scene: { getMetadata: vi.fn(), setMetadata: vi.fn(), isReady: vi.fn() },
  room: { getMetadata: vi.fn(), setMetadata: vi.fn() },
  player: { getMetadata: vi.fn(), setMetadata: vi.fn() },
}));

vi.mock("@owlbear-rodeo/sdk", () => ({ default: obr }));

const state = { version: 1 as const, boards: [] };
const privateState = { version: 1 as const, boards: [{ id: "saved", name: "Saved", scope: "room" as const, visibility: "private" as const, revision: 1, cellSizePx: 72, cellGapPx: 2, items: [], createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" }] };

describe("storage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    obr.isAvailable = true;
    obr.player.getMetadata.mockResolvedValue({});
  });

  it("preserves unrelated scene metadata when saving a shared scene board", async () => {
    obr.isAvailable = true;
    obr.scene.getMetadata.mockResolvedValue({ "other-extension/key": "keep" });

    await saveSharedBoardState("scene", state);

    expect(obr.scene.setMetadata).toHaveBeenCalledWith({
      "other-extension/key": "keep",
      [SHARED_SCENE_STATE_KEY]: state,
    });
  });

  it("restores a private room board from the local backup when Owlbear returns no player metadata", async () => {
    await savePrivateBoardState("room", privateState);

    await expect(loadPrivateBoardState("room")).resolves.toEqual(privateState);
  });

  it("moves a private room board into the current scene", async () => {
    obr.isAvailable = false;
    await savePrivateBoardState("room", privateState);

    await movePrivateRoomBoardToScene(privateState.boards[0]);

    await expect(loadPrivateBoardState("room")).resolves.toEqual(state);
    await expect(loadPrivateBoardState("scene")).resolves.toMatchObject({ boards: [{ id: "saved", scope: "scene", revision: 2 }] });
  });

  it("uses the demo scene key without Owlbear", async () => {
    obr.isAvailable = false;

    await expect(getSceneKey()).resolves.toBe("demo");
  });
});
