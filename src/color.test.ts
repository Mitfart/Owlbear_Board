import { describe, expect, it } from "vitest";
import { hexToHsv, hsvToHex } from "./color";

describe("custom Color Picker conversions", () => {
  it("converts hue, saturation, and value to a hex color", () => {
    expect(hsvToHex({ hue: 47.35294117647058, saturation: 80, value: 100 })).toBe("#ffd433");
  });

  it("parses a hex color for the interactive picker", () => {
    expect(hexToHsv("#ffd433")).toEqual(expect.objectContaining({ hue: expect.closeTo(47.35, 2), saturation: expect.closeTo(80, 2), value: 100 }));
    expect(hexToHsv("not-a-color")).toBeUndefined();
  });
});
