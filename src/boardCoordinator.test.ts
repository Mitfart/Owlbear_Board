import { describe, expect, it, vi, beforeEach } from "vitest";
import { mutateBoard, resetMutationQueue } from "./boardCoordinator";
import type { Board } from "./types";

const board = (id: string): Board => ({ id, name: id, scope: "scene", visibility: "private", revision: 0, cellSizePx: 72, cellGapPx: 2, items: [], updatedAt: "2026-01-01T00:00:00.000Z" });

describe("board mutation coordinator", () => {
  beforeEach(resetMutationQueue);
  it("serializes saves and rolls back failed optimistic changes", async () => {
    const applied: string[] = []; const errors: unknown[] = [];
    const save = vi.fn(async (value: Board) => { if (value.id === "bad") throw new Error("nope"); return { ...value, revision: value.revision + 1 }; });
    const run = (value: Board) => mutateBoard({ board: value, save, apply: (next) => applied.push(next.id), rollback: (old) => applied.push(`rollback:${old.id}`), reportError: (error) => errors.push(error) });
    await Promise.all([run(board("one")), run(board("bad"))]);
    expect(save).toHaveBeenCalledTimes(2); expect(applied).toEqual(["one", "one", "bad", "rollback:bad"]); expect(errors).toHaveLength(1);
  });
});
