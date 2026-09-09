import { describe, expect, it, vi } from "vitest";
import { changedBoardItemIds, createBoardMutationCoordinator } from "./boardCoordinator";
import type { Board } from "./types";

const board = (id: string, items: Board["items"] = []): Board => ({ id, name: id, scope: "scene", visibility: "private", revision: 0, cellSizePx: 72, cellGapPx: 2, items, updatedAt: "2026-01-01T00:00:00.000Z" });

describe("board mutation coordinator", () => {
  it("reports deleted items as changed", () => {
    const item = { id: "item", type: "text" as const, gridX: 0, gridY: 0, gridWidth: 1, gridHeight: 1, text: "draft", updatedAt: "now" };
    expect(changedBoardItemIds(board("board", [item]), board("board"))).toEqual(["item"]);
  });

  it("serializes saves, reconciles revisions, rolls back failures, and owns history", async () => {
    const applied: string[] = []; const errors: unknown[] = [];
    const save = vi.fn(async (value: Board) => { if (value.id === "bad") throw new Error("nope"); return { ...value, revision: value.revision + 1 }; });
    const coordinator = createBoardMutationCoordinator({ save, apply: (next) => applied.push(`${next.id}:${next.revision}`), discard: vi.fn(), reportError: (error) => errors.push(error), reportDebug: vi.fn() });
    coordinator.observe(board("one")); coordinator.observe(board("bad"));
    await Promise.all([coordinator.mutate({ ...board("one"), items: [{ id: "one-item", type: "text", gridX: 0, gridY: 0, gridWidth: 1, gridHeight: 1, updatedAt: "now" }] }), coordinator.mutate(board("bad"))]);
    expect(save).toHaveBeenCalledTimes(2); expect(coordinator.current("one")?.revision).toBe(1); expect(coordinator.current("bad")?.revision).toBe(0); expect(errors).toHaveLength(1); expect(applied).toEqual(["one:0", "one:1", "bad:0", "bad:0"]);
    await coordinator.undo("one");
    expect(coordinator.current("one")?.items).toEqual([]);
  });

  it("removes an optimistic new board when its first save fails", async () => {
    const discarded: string[] = [];
    const coordinator = createBoardMutationCoordinator({ save: vi.fn(async () => { throw new Error("nope"); }), apply: vi.fn(), discard: (id) => discarded.push(id), reportError: vi.fn(), reportDebug: vi.fn() });
    await coordinator.mutate(board("new"));
    expect(coordinator.current("new")).toBeUndefined();
    expect(discarded).toEqual(["new"]);
  });
});
