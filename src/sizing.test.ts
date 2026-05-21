import { describe, expect, it } from "vitest";
import { autoImageSize, autoTextSize, parseItemSize } from "./sizing";

describe("item auto sizing", () => {
  it("treats blank and invalid dimensions as auto", () => {
    expect(parseItemSize("")).toBe("auto");
    expect(parseItemSize("auto")).toBe("auto");
    expect(parseItemSize("abc")).toBe("auto");
  });

  it("clamps numeric dimensions to the supported grid range", () => {
    expect(parseItemSize("0")).toBe(1);
    expect(parseItemSize("25")).toBe(24);
    expect(parseItemSize("3.6")).toBe(4);
  });

  it("gives long text more space than a short note", () => {
    const short = autoTextSize("Door clue");
    const long = autoTextSize(
      "The locked cabinet contains three letters, a broken signet ring, and a map with fresh annotations.",
    );

    expect(long.width).toBeGreaterThan(short.width);
    expect(long.height).toBeGreaterThanOrEqual(short.height);
  });

  it("accounts for explicit line breaks", () => {
    expect(autoTextSize("One\nTwo\nThree\nFour\nFive").height).toBeGreaterThan(1);
  });

  it("widens for long unbroken words", () => {
    expect(autoTextSize("Counterspell").width).toBeLessThan(autoTextSize("Antidisestablishmentarianism").width);
  });

  it("uses manual text width when calculating automatic height", () => {
    const narrow = autoTextSize("A compact but still fairly wordy note for the board.", 2);
    const wide = autoTextSize("A compact but still fairly wordy note for the board.", 6);

    expect(narrow.width).toBe(2);
    expect(wide.width).toBe(6);
    expect(narrow.height).toBeGreaterThanOrEqual(wide.height);
  });

  it("preserves image aspect ratio when one dimension is manual", () => {
    expect(autoImageSize(1600, 800, 4)).toEqual({ width: 4, height: 2 });
    expect(autoImageSize(800, 1600, undefined, 4)).toEqual({ width: 2, height: 4 });
  });

  it("maps image pixels to cells when both dimensions are automatic", () => {
    expect(autoImageSize(145, 73, undefined, undefined, 72)).toEqual({ width: 3, height: 2 });
  });
});
