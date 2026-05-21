import type { Item } from "@owlbear-rodeo/sdk";
import type { CSSProperties } from "react";

type MaybeImage = Item & {
  image?: { url?: string; width?: number; height?: number };
};

type MaybeText = Item & {
  text?: { plainText?: string; style?: { fillColor?: string; fontFamily?: string } };
};

type MaybeShape = Item & {
  width?: number;
  height?: number;
  style?: { fillColor?: string; strokeColor?: string; fillOpacity?: number };
};

export function previewKind(item: Item) {
  if (item.type === "IMAGE" && (item as MaybeImage).image?.url) return "image";
  if (item.type === "TEXT" || (item as MaybeText).text?.plainText) return "text";
  if (item.type === "SHAPE") return "shape";
  return "generic";
}

export function previewText(item: Item) {
  const text = (item as MaybeText).text?.plainText?.trim();
  return text || item.name || item.type;
}

export function previewImageUrl(item: Item) {
  return (item as MaybeImage).image?.url;
}

export function shapeStyle(item: Item): CSSProperties {
  const shape = item as MaybeShape;
  return {
    backgroundColor: shape.style?.fillColor ?? "#d5e4ff",
    opacity: shape.style?.fillOpacity ?? 0.9,
    borderColor: shape.style?.strokeColor ?? "#2b5cff",
  };
}
