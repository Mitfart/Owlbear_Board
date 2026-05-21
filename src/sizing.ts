const AUTO_SIZE = "auto";

export type ItemSizeDraft = number | typeof AUTO_SIZE;

export function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function parseItemSize(value: string): ItemSizeDraft {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed || trimmed === AUTO_SIZE) return AUTO_SIZE;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? clampNumber(Math.round(parsed), 1, 24) : AUTO_SIZE;
}

export function autoTextSize(text: string, preferredWidth?: number) {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  const normalizedLines = lines.length ? lines : ["New note"];
  const textLength = normalizedLines.reduce((sum, line) => sum + line.trim().length, 0);
  const longestWord = normalizedLines.reduce((max, line) => {
    const lineMax = line.split(/\s+/).reduce((wordMax, word) => Math.max(wordMax, word.length), 0);
    return Math.max(max, lineMax);
  }, 0);
  const longestLine = normalizedLines.reduce((max, line) => Math.max(max, line.trim().length), 0);

  const width =
    preferredWidth ??
    clampNumber(
      Math.max(Math.ceil(longestWord / 12), Math.ceil(longestLine / 24), Math.ceil(Math.sqrt(textLength / 8))),
      2,
      8,
    );
  const charsPerLine = Math.max(12, width * 14);
  const wrappedLines = normalizedLines.reduce(
    (sum, line) => sum + Math.max(1, Math.ceil(line.trim().length / charsPerLine)),
    0,
  );

  return {
    width,
    height: clampNumber(Math.ceil(wrappedLines / 2), 1, 6),
  };
}

export function autoImageSize(
  width?: number,
  height?: number,
  preferredWidth?: number,
  preferredHeight?: number,
  cellSizePx?: number,
) {
  if (!width || !height) {
    return { width: preferredWidth ?? 3, height: preferredHeight ?? 2 };
  }

  const aspect = width / height;
  if (preferredWidth && !preferredHeight) {
    return { width: preferredWidth, height: clampNumber(Math.round(preferredWidth / aspect), 1, 8) };
  }
  if (preferredHeight && !preferredWidth) {
    return { width: clampNumber(Math.round(preferredHeight * aspect), 1, 8), height: preferredHeight };
  }

  if (cellSizePx) {
    return {
      width: clampNumber(Math.ceil(width / cellSizePx), 1, 24),
      height: clampNumber(Math.ceil(height / cellSizePx), 1, 24),
    };
  }

  if (aspect >= 1) {
    const gridWidth = clampNumber(Math.round(aspect * 3), 2, 8);
    return { width: gridWidth, height: clampNumber(Math.round(gridWidth / aspect), 1, 8) };
  }

  const gridHeight = clampNumber(Math.round((1 / aspect) * 2), 2, 8);
  return { width: clampNumber(Math.round(gridHeight * aspect), 1, 8), height: gridHeight };
}
