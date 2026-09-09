import { describe, expect, it } from "vitest";
import { paletteForSlots } from "./App";

describe("paletteForSlots", () => {
  it("loads slot palettes from the private palette store", () => {
    expect(paletteForSlots(["-", "#123456"])).toEqual(["#1a6aff", "#123456"]);
    expect(paletteForSlots(["#123456"])).toEqual(["#123456"]);
    expect(paletteForSlots()).toEqual(expect.arrayContaining(["#1a6aff", "#ff7433"]));
  });
});
