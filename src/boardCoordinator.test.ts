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

  it("does not add failed mutations to undo history", async () => {
    const coordinator = createBoardMutationCoordinator({ save: vi.fn(async () => { throw new Error("nope"); }), apply: vi.fn(), discard: vi.fn(), reportError: vi.fn(), reportDebug: vi.fn() });
    coordinator.observe(board("existing"));
    await coordinator.mutate({ ...board("existing"), name: "changed" });
    await expect(coordinator.undo("existing")).resolves.toBeUndefined();
  });

  it("retains undo and redo history when restoring them fails", async () => {
    let fail = false;
    const coordinator = createBoardMutationCoordinator({ save: vi.fn(async (value: Board) => { if (fail) throw new Error("nope"); return { ...value, revision: value.revision + 1 }; }), apply: vi.fn(), discard: vi.fn(), reportError: vi.fn(), reportDebug: vi.fn() });
    coordinator.observe(board("existing"));
    await coordinator.mutate({ ...board("existing"), name: "changed" });
    fail = true;
    await expect(coordinator.undo("existing")).resolves.toBeUndefined();
    fail = false;
    await expect(coordinator.undo("existing")).resolves.toMatchObject({ name: "existing" });
    fail = true;
    await expect(coordinator.redo("existing")).resolves.toBeUndefined();
    fail = false;
    await expect(coordinator.redo("existing")).resolves.toMatchObject({ name: "changed" });
  });

  it("serializes rapid undo and redo actions against the latest history", async () => {
    const coordinator = createBoardMutationCoordinator({ save: vi.fn(async (value: Board) => ({ ...value, revision: value.revision + 1 })), apply: vi.fn(), discard: vi.fn(), reportError: vi.fn(), reportDebug: vi.fn() });
    coordinator.observe(board("existing"));
    await coordinator.mutate({ ...board("existing"), name: "first" });
    await coordinator.mutate({ ...board("existing"), name: "second" });
    await Promise.all([coordinator.undo("existing"), coordinator.undo("existing")]);
    expect(coordinator.current("existing")?.name).toBe("existing");
    await Promise.all([coordinator.redo("existing"), coordinator.redo("existing")]);
    expect(coordinator.current("existing")?.name).toBe("second");
  });

  it("applies queued editor updates to the latest board state", async () => {
    const item = { id: "item", type: "counter" as const, gridX: 0, gridY: 0, gridWidth: 1, gridHeight: 1, counterLabel: "Old", counterValue: 1, updatedAt: "now" };
    const coordinator = createBoardMutationCoordinator({ save: vi.fn(async (value: Board) => ({ ...value, revision: value.revision + 1 })), apply: vi.fn(), discard: vi.fn(), reportError: vi.fn(), reportDebug: vi.fn() });
    coordinator.observe(board("existing", [item]));

    await Promise.all([
      coordinator.mutate({ boardId: "existing", update: (current) => ({ ...current, items: current.items.map((candidate) => candidate.id === "item" ? { ...candidate, counterLabel: "Initiative" } : candidate) }) }),
      coordinator.mutate({ boardId: "existing", update: (current) => ({ ...current, items: current.items.map((candidate) => candidate.id === "item" ? { ...candidate, counterValue: 9 } : candidate) }) }),
    ]);

    expect(coordinator.current("existing")?.items[0]).toMatchObject({ counterLabel: "Initiative", counterValue: 9 });
  });
});
