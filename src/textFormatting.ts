function markerRun(value: string, end: number, direction: -1 | 1) {
  let length = 0;
  while (value[end + length * direction] === "*") length += 1;
  return length;
}

function canRemovePair(run: number, marker: "*" | "**") {
  return marker === "*" ? run % 2 === 1 : run >= 2;
}

export function toggleMarkdownStyle(value: string, selectionStart: number, selectionEnd: number, marker: "*" | "**") {
  const selected = value.slice(selectionStart, selectionEnd);
  let innerPairs = 0;
  while (selected.length > innerPairs * marker.length * 2) {
    const start = innerPairs * marker.length;
    const end = selected.length - start;
    const leftRun = markerRun(selected, start, 1);
    const rightRun = markerRun(selected, end - 1, -1);
    if (!canRemovePair(leftRun, marker) || !canRemovePair(rightRun, marker)) break;
    innerPairs += 1;
  }

  let outerPairs = 0;
  while (true) {
    const leftRun = markerRun(value, selectionStart - outerPairs * marker.length - 1, -1);
    const rightRun = markerRun(value, selectionEnd + outerPairs * marker.length, 1);
    if (!canRemovePair(leftRun, marker) || !canRemovePair(rightRun, marker)) break;
    outerPairs += 1;
    if (marker === "*" || leftRun < (outerPairs + 1) * marker.length || rightRun < (outerPairs + 1) * marker.length) break;
  }

  if (innerPairs || outerPairs) {
    const content = selected.slice(innerPairs * marker.length, selected.length - innerPairs * marker.length);
    const start = selectionStart - outerPairs * marker.length;
    return { value: value.slice(0, start) + content + value.slice(selectionEnd + outerPairs * marker.length), selectionStart: start, selectionEnd: start + content.length };
  }
  return { value: value.slice(0, selectionStart) + marker + selected + marker + value.slice(selectionEnd), selectionStart: selectionStart + marker.length, selectionEnd: selectionEnd + marker.length };
}
