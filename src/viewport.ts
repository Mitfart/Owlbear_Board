export function zoomPanToCursor(pan: { x: number; y: number }, zoom: number, nextZoom: number, cursor: { x: number; y: number }) {
  return { x: cursor.x - ((cursor.x - pan.x) / zoom) * nextZoom, y: cursor.y - ((cursor.y - pan.y) / zoom) * nextZoom };
}
