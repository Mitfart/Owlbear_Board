import { describe, expect, it } from "vitest";
import { renderMarkdown } from "./markdown";

describe("renderMarkdown", () => {
  it("renders alignment markers and escaped Markdown punctuation", () => {
    expect(renderMarkdown("^1 **Centered**\n^2 - Right\n\\*literal*")).toContain('<p class="align-1"><strong>Centered</strong></p><ul><li class="align-2">Right</li></ul><p>*literal*</p>');
  });

  it("renders visible blocks for headings, lists, and links", () => {
    const html = renderMarkdown("# Heading\n- Item\n[Open](https://example.com)");
    expect(html).toContain("<h1>Heading</h1>");
    expect(html).toContain("<ul><li>Item</li></ul>");
    expect(html).toContain('href="https://example.com/"');
  });

  it("renders ordered lists and supported inline styles", () => {
    const html = renderMarkdown("1. Item\n\n**bold** *italic* ~~strike~~ `code`\n\n> quote\n\n```\nblock\n```");
    expect(html).toContain("<ol><li>Item</li></ol>");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<em>italic</em>");
    expect(html).toContain("<s>strike</s>");
    expect(html).toContain("<code>code</code>");
    expect(html).toContain("<blockquote>quote</blockquote>");
    expect(html).toContain("<pre><code>block\n</code></pre>");
  });

  it("renders custom task controls for unchecked and marked items", () => {
    const html = renderMarkdown("- [ ] Todo\n- [*] Done");
    expect(html).toContain('<button type="button" class="taskToggle" role="checkbox" aria-checked="false" data-task-line="0" aria-label="Toggle task"></button>Todo');
    expect(html).toContain('<button type="button" class="taskToggle" role="checkbox" aria-checked="true" data-task-line="1" aria-label="Toggle task">');
    expect(html).toContain("taskCheckIcon");
  });
});
