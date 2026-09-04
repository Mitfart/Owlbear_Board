import React from "react";
const taskCheckIcon = "<svg class=\"taskToggleIcon\" xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\" aria-hidden=\"true\"><g fill=\"none\" stroke=\"currentColor\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><rect x=\"1.5\" y=\"1.5\" width=\"21\" height=\"21\" rx=\"5\" ry=\"5\" stroke-width=\"3\"></rect><polyline points=\"7 10 12 16 22 2\" stroke-width=\"4\"></polyline></g></svg>";

function escapeHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;").replace(/'/g, "&#39;");
}

function safeHref(href: string) {
  try {
    const url = new URL(href, window.location.href);
    return ["http:", "https:", "mailto:"].includes(url.protocol) ? url.href : undefined;
  } catch {
    return undefined;
  }
}

function inlineMarkdown(text: string) {
  const escaped: string[] = [];
  let html = escapeHtml(text.replace(/\\(.)/g, (_match, character: string) => `\uE000${escaped.push(character) - 1}\uE001`));
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  html = html.replace(/~~([^~]+)~~/g, "<s>$1</s>");
  html = html.replace(/\[([^\]]+)]\(([^)]+)\)/g, (_match, label: string, href: string) => {
    const safe = safeHref(href.trim());
    return safe ? `<a href="${escapeHtml(safe)}" target="_blank" rel="noreferrer">${label}</a>` : label;
  });
  return html.replace(/\uE000(\d+)\uE001/g, (_match, index: string) => escapeHtml(escaped[Number(index)]));
}

function aligned(line: string) {
  const match = line.match(/^\^([1-3])\s+/);
  return { align: match?.[1], text: match ? line.slice(match[0].length) : line };
}

function className(align?: string) {
  return align ? ` class="align-${align}"` : "";
}

export function renderMarkdown(markdown: string, taskInputsDisabled = false) {
  const lines = markdown.split(/\r?\n/);
  const html: string[] = [];
  let listType: "ul" | "ol" | undefined;
  let inCode = false;
  let codeAlign: string | undefined;

  for (const [lineIndex, source] of lines.entries()) {
    const { align, text: line } = aligned(source);
    if (line.trim().startsWith("```")) {
      if (inCode) html.push("</code></pre>");
      else { codeAlign = align; html.push(`<pre${className(codeAlign)}><code>`); }
      inCode = !inCode;
      continue;
    }
    if (inCode) {
      html.push(`${escapeHtml(source)}\n`);
      continue;
    }

    const listItem = line.match(/^\s*(?:[-*]|(\d+)\.)\s+(.+)/);
    if (listItem) {
      const nextListType = listItem[1] ? "ol" : "ul";
      if (listType !== nextListType) {
        if (listType) html.push(`</${listType}>`);
        html.push(`<${nextListType}>`);
        listType = nextListType;
      }
      const task = listItem[2].match(/^\[([ *xX])\]\s+(.+)/);
      const complete = task?.[1] !== " ";
      const classes = task ? ` class="taskItem${complete ? " complete" : ""}${align ? ` align-${align}` : ""}"` : className(align);
      const content = task ? `<label class="taskToggle"><input type="checkbox" data-task-line="${lineIndex}" aria-label="Toggle task"${complete ? " checked" : ""}${taskInputsDisabled ? " disabled" : ""} /><span class="taskToggleVisual">${complete ? taskCheckIcon : ""}</span></label>${inlineMarkdown(task[2])}` : inlineMarkdown(listItem[2]);
      html.push(`<li${classes}>${content}</li>`);
      continue;
    }
    if (listType) {
      html.push(`</${listType}>`);
      listType = undefined;
    }

    const heading = line.match(/^(#{1,3})\s+(.+)/);
    if (heading) {
      const level = heading[1].length;
      html.push(`<h${level}${className(align)}>${inlineMarkdown(heading[2])}</h${level}>`);
    } else if (line.startsWith("> ")) {
      html.push(`<blockquote${className(align)}>${inlineMarkdown(line.slice(2))}</blockquote>`);
    } else if (line.trim()) {
      html.push(`<p${className(align)}>${inlineMarkdown(line)}</p>`);
    } else {
      html.push("<br />");
    }
  }
  if (listType) html.push(`</${listType}>`);
  if (inCode) html.push("</code></pre>");
  return html.join("");
}

export function MarkdownView({ value, onTaskToggle }: { value: string; onTaskToggle?: (line: number) => void }) {
  const taskToggle = (target: EventTarget | null) => target instanceof Element ? target.closest(".taskToggle") : null;
  return <div className="markdown" onPointerDown={(event) => { if (taskToggle(event.target)) event.stopPropagation(); }} onDoubleClick={(event) => { if (taskToggle(event.target)) event.stopPropagation(); }} onChange={(event) => {
    const target = event.target;
    if (onTaskToggle && target instanceof HTMLInputElement && target.dataset.taskLine) onTaskToggle(Number(target.dataset.taskLine));
  }} dangerouslySetInnerHTML={{ __html: renderMarkdown(value, !onTaskToggle) }} />;
}
