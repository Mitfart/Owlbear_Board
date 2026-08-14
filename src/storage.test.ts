import { beforeEach, describe, expect, it, vi } from "vitest";
import { SHARED_SCENE_STATE_KEY } from "./constants";
import { getSceneKey, saveSharedBoardState } from "./storage";

const obr = vi.hoisted(() => ({
  isAvailable: true,
  scene: { getMetadata: vi.fn(), setMetadata: vi.fn(), isReady: vi.fn() },
  room: { getMetadata: vi.fn(), setMetadata: vi.fn() },
  player: { getMetadata: vi.fn(), setMetadata: vi.fn() },
}));

vi.mock("@owlbear-rodeo/sdk", () => ({ default: obr }));

const state = { version: 1 as const, boards: [] };

describe("storage", () => {
  beforeEach(() => vi.clearAllMocks());

  it("preserves unrelated scene metadata when saving a shared scene board", async () => {
    obr.isAvailable = true;
    obr.scene.getMetadata.mockResolvedValue({ "other-extension/key": "keep" });

    await saveSharedBoardState("scene", state);

    expect(obr.scene.setMetadata).toHaveBeenCalledWith({
      "other-extension/key": "keep",
      [SHARED_SCENE_STATE_KEY]: state,
    });
  });

  it("uses the demo scene key without Owlbear", async () => {
    obr.isAvailable = false;

    await expect(getSceneKey()).resolves.toBe("demo");
  });
});
