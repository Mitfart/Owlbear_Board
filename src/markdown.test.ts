import { describe, expect, it } from "vitest";
import { renderMarkdown } from "./markdown";

describe("renderMarkdown", () => {
  it("renders alignment markers and escaped Markdown punctuation", () => {
    expect(renderMarkdown("^1 **Centered**\n^2 - Right\n\\*literal*")).toContain('<p class="align-1"><strong>Centered</strong></p><ul><li class="align-2">Right</li></ul><p>*literal*</p>');
  });
});
