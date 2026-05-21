import OBR from "@owlbear-rodeo/sdk";

export async function resizeAction(width: number, height: number) {
  if (!OBR.isAvailable) return;
  await Promise.all([OBR.action.setWidth(width), OBR.action.setHeight(height)]);
}
