import { describe, expect, it } from "vitest";
import { toggleMarkdownStyle } from "./textFormatting";

describe("toggleMarkdownStyle", () => {
  it("wraps and then unwraps a repeated selection", () => {
    const wrapped = toggleMarkdownStyle("hello world", 6, 11, "**");
    expect(wrapped).toEqual({ value: "hello **world**", selectionStart: 8, selectionEnd: 13 });
    expect(toggleMarkdownStyle(wrapped.value, wrapped.selectionStart, wrapped.selectionEnd, "**")).toEqual({ value: "hello world", selectionStart: 6, selectionEnd: 11 });
  });

  it("unwraps markers immediately surrounding the selection", () => {
    expect(toggleMarkdownStyle("hello **world**", 8, 13, "**")).toEqual({ value: "hello world", selectionStart: 6, selectionEnd: 11 });
  });

  it("unwraps markers included in the selection", () => {
    expect(toggleMarkdownStyle("hello **world**", 6, 15, "**")).toEqual({ value: "hello world", selectionStart: 6, selectionEnd: 11 });
  });

  it("removes nested pairs when included and surrounding the selection", () => {
    expect(toggleMarkdownStyle("hello ****world****", 8, 17, "**")).toEqual({ value: "hello world", selectionStart: 6, selectionEnd: 11 });
  });

  it("does not treat bold markers as italic markers", () => {
    expect(toggleMarkdownStyle("hello **world**", 8, 13, "*")).toEqual({ value: "hello ***world***", selectionStart: 9, selectionEnd: 14 });
  });

  it("toggles every single and double marker combination", () => {
    expect(toggleMarkdownStyle("hello *world*", 7, 12, "*")).toEqual({ value: "hello world", selectionStart: 6, selectionEnd: 11 });
    expect(toggleMarkdownStyle("hello **world**", 8, 13, "**")).toEqual({ value: "hello world", selectionStart: 6, selectionEnd: 11 });
    expect(toggleMarkdownStyle("hello ***world***", 9, 14, "*")).toEqual({ value: "hello **world**", selectionStart: 8, selectionEnd: 13 });
    expect(toggleMarkdownStyle("hello ***world***", 9, 14, "**")).toEqual({ value: "hello *world*", selectionStart: 7, selectionEnd: 12 });
    expect(toggleMarkdownStyle("hello *world*", 7, 12, "**")).toEqual({ value: "hello ***world***", selectionStart: 9, selectionEnd: 14 });
  });
});
