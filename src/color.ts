export type HsvColor = { hue: number; saturation: number; value: number };

export function clampColorValue(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function hsvToHex({ hue, saturation, value }: HsvColor) {
  const h = ((hue % 360) + 360) % 360;
  const s = clampColorValue(saturation, 0, 100) / 100;
  const v = clampColorValue(value, 0, 100) / 100;
  const chroma = v * s;
  const second = chroma * (1 - Math.abs((h / 60) % 2 - 1));
  const match = v - chroma;
  const [red, green, blue] = h < 60 ? [chroma, second, 0] : h < 120 ? [second, chroma, 0] : h < 180 ? [0, chroma, second] : h < 240 ? [0, second, chroma] : h < 300 ? [second, 0, chroma] : [chroma, 0, second];
  return `#${[red, green, blue].map((channel) => Math.round((channel + match) * 255).toString(16).padStart(2, "0")).join("")}`;
}

export function hexToHsv(value: string): HsvColor | undefined {
  const match = value.trim().match(/^#?([\da-f]{6})$/i);
  if (!match) return undefined;
  const [red, green, blue] = [0, 2, 4].map((index) => Number.parseInt(match[1].slice(index, index + 2), 16) / 255);
  const maximum = Math.max(red, green, blue);
  const minimum = Math.min(red, green, blue);
  const chroma = maximum - minimum;
  const hue = chroma === 0 ? 0 : maximum === red ? 60 * (((green - blue) / chroma + 6) % 6) : maximum === green ? 60 * ((blue - red) / chroma + 2) : 60 * ((red - green) / chroma + 4);
  return { hue, saturation: maximum === 0 ? 0 : chroma / maximum * 100, value: maximum * 100 };
}
