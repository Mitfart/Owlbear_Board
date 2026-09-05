import type { Board } from "./types";

export type BoardMutationOptions = {
  board: Board;
  save(board: Board): Promise<Board>;
  apply(board: Board): void;
  rollback(board: Board): void;
  reportError(error: unknown): void;
};

let queue = Promise.resolve();

export function mutateBoard(options: BoardMutationOptions): Promise<Board | undefined> {
  const run = queue.then(async () => {
    const previous = options.board;
    options.apply(previous);
    try {
      const saved = await options.save({ ...previous, updatedAt: new Date().toISOString() });
      options.apply(saved);
      return saved;
    } catch (error) {
      options.rollback(previous);
      options.reportError(error);
      return undefined;
    }
  });
  queue = run.then(() => undefined, () => undefined);
  return run;
}

export function resetMutationQueue() { queue = Promise.resolve(); }
