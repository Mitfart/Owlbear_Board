import type { Board } from "./types";

type History = { undo: Board[]; redo: Board[] };
export type BoardMutationCoordinator = {
  observe(board: Board): void;
  current(id: string): Board | undefined;
  mutate(board: Board, pushHistory?: boolean): Promise<Board | undefined>;
  undo(id: string): Promise<Board | undefined>;
  redo(id: string): Promise<Board | undefined>;
  pending(): boolean;
};
export type BoardMutationCoordinatorOptions = {
  save(board: Board, changedItemIds: string[]): Promise<Board>;
  apply(board: Board): void;
  discard(boardId: string): void;
  reportError(error: unknown): void;
  reportDebug(message: string): void;
  maxHistory?: number;
};

export function changedBoardItemIds(previous: Board | undefined, next: Board) {
  const before = new Map(previous?.items.map((item) => [item.id, item]));
  const after = new Map(next.items.map((item) => [item.id, item]));
  return [...new Set([...before.keys(), ...after.keys()].filter((id) => JSON.stringify(before.get(id)) !== JSON.stringify(after.get(id))))];
}

export function createBoardMutationCoordinator(options: BoardMutationCoordinatorOptions): BoardMutationCoordinator {
  const boards = new Map<string, Board>();
  const histories = new Map<string, History>();
  let queue = Promise.resolve();
  let pending = 0;
  const maxHistory = options.maxHistory ?? 20;
  const mutate = (board: Board, pushHistory = true) => {
    pending += 1;
    const run = queue.then(async () => {
      const previous = boards.get(board.id);
      const changed = !!previous && JSON.stringify(previous) !== JSON.stringify(board);
      boards.set(board.id, board); options.apply(board);
      try {
        const saved = await options.save({ ...board, updatedAt: new Date().toISOString() }, changedBoardItemIds(previous, board));
        if (pushHistory && previous && changed) {
          const history = histories.get(board.id) ?? { undo: [], redo: [] };
          histories.set(board.id, { undo: [previous, ...history.undo].slice(0, maxHistory), redo: [] });
        }
        boards.set(saved.id, saved); options.apply(saved); options.reportDebug(`Saved board ${saved.id} at revision ${saved.revision}.`);
        return saved;
      } catch (error) {
        if (previous) { boards.set(previous.id, previous); options.apply(previous); }
        else { boards.delete(board.id); options.discard(board.id); }
        options.reportError(error); options.reportDebug(`Save failed: ${error instanceof Error ? error.message : String(error)}`);
        return undefined;
      }
    });
    const complete = run.then((value) => { pending -= 1; return value; }, (error) => { pending -= 1; throw error; });
    queue = complete.then(() => undefined, () => undefined);
    return complete;
  };
  const restore = (id: string, direction: "undo" | "redo") => {
    const history = histories.get(id); const target = history?.[direction][0]; const current = boards.get(id);
    if (!target || !current) return Promise.resolve(undefined);
    const opposite = direction === "undo" ? "redo" : "undo";
    return mutate(target, false).then((saved) => {
      if (saved) histories.set(id, { ...history, [direction]: history[direction].slice(1), [opposite]: [current, ...history[opposite]].slice(0, maxHistory) });
      return saved;
    });
  };
  return {
    observe(board) { const current = boards.get(board.id); if (!current || board.revision >= current.revision) boards.set(board.id, board); },
    current(id) { return boards.get(id); }, mutate,
    undo(id) { return restore(id, "undo"); }, redo(id) { return restore(id, "redo"); }, pending() { return pending > 0; },
  };
}
