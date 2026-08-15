import { describe, expect, it } from "vitest";
import { zoomPanToCursor } from "./viewport";

describe("zoomPanToCursor", () => {
  it("keeps the board coordinate below the cursor fixed", () => {
    expect(zoomPanToCursor({ x: 100, y: 50 }, 0.5, 1, { x: 300, y: 150 })).toEqual({ x: -100, y: -50 });
  });
});
