export function toggleMarkdownStyle(value: string, selectionStart: number, selectionEnd: number, marker: "*" | "**") {
  const selected = value.slice(selectionStart, selectionEnd);
  let innerPairs = 0;
  while (selected.slice(innerPairs * marker.length, selected.length - innerPairs * marker.length).startsWith(marker) && selected.slice(innerPairs * marker.length, selected.length - innerPairs * marker.length).endsWith(marker)) innerPairs += 1;
  let outerPairs = 0;
  while (value.slice(selectionStart - (outerPairs + 1) * marker.length, selectionStart - outerPairs * marker.length) === marker && value.slice(selectionEnd + outerPairs * marker.length, selectionEnd + (outerPairs + 1) * marker.length) === marker) outerPairs += 1;

  if (innerPairs || outerPairs) {
    const content = selected.slice(innerPairs * marker.length, selected.length - innerPairs * marker.length);
    const start = selectionStart - outerPairs * marker.length;
    return { value: value.slice(0, start) + content + value.slice(selectionEnd + outerPairs * marker.length), selectionStart: start, selectionEnd: start + content.length };
  }
  return { value: value.slice(0, selectionStart) + marker + selected + marker + value.slice(selectionEnd), selectionStart: selectionStart + marker.length, selectionEnd: selectionEnd + marker.length };
}
