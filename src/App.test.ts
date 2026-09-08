import { describe, expect, it } from "vitest";
import { paletteForPreferences } from "./App";

describe("paletteForPreferences", () => {
  it("loads an unmarked slot palette while ignoring the prior raw-color format", () => {
    expect(paletteForPreferences({ colorPalette: ["-", "#123456"] } as never)).toEqual(["#1a6aff", "#123456"]);
    expect(paletteForPreferences({ colorPalette: ["#123456"] } as never)).toEqual(expect.arrayContaining(["#1a6aff", "#ff7433"]));
    expect(paletteForPreferences({ colorPaletteFormat: 2, colorPalette: ["#123456"] } as never)).toEqual(["#123456"]);
  });
});
