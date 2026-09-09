import { describe, expect, it } from "vitest";
import { contextItemWithBorder, paletteForSlots } from "./App";

describe("paletteForSlots", () => {
  it("loads slot palettes from the private palette store", () => {
    expect(paletteForSlots(["-", "#123456"])).toEqual(["#1a6aff", "#123456"]);
    expect(paletteForSlots(["#123456"])).toEqual(["#123456"]);
    expect(paletteForSlots()).toEqual(expect.arrayContaining(["#1a6aff", "#ff7433"]));
  });
});

describe("contextItemWithBorder", () => {
  it("updates the item held by an open context menu", () => {
    const capturedItem = { id: "item-1", borderColor: "#1a6aff" };

    expect(contextItemWithBorder({ x: 0, y: 0, item: capturedItem }, "#ff7433")).toEqual({ x: 0, y: 0, item: { id: "item-1", borderColor: "#ff7433" } });
  });
});
