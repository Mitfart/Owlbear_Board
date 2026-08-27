export function toggleMarkdownStyle(value: string, selectionStart: number, selectionEnd: number, marker: "*" | "**") {
  const selected = value.slice(selectionStart, selectionEnd);
  const hasInnerMarkers = selected.startsWith(marker) && selected.endsWith(marker) && selected.length >= marker.length * 2;
  const hasOuterMarkers = value.slice(selectionStart - marker.length, selectionStart) === marker && value.slice(selectionEnd, selectionEnd + marker.length) === marker;

  if (hasInnerMarkers) {
    return { value: value.slice(0, selectionStart) + selected.slice(marker.length, -marker.length) + value.slice(selectionEnd), selectionStart, selectionEnd: selectionEnd - marker.length * 2 };
  }
  if (hasOuterMarkers) {
    return { value: value.slice(0, selectionStart - marker.length) + selected + value.slice(selectionEnd + marker.length), selectionStart: selectionStart - marker.length, selectionEnd: selectionEnd - marker.length };
  }
  return { value: value.slice(0, selectionStart) + marker + selected + marker + value.slice(selectionEnd), selectionStart: selectionStart + marker.length, selectionEnd: selectionEnd + marker.length };
}
