import OBR, { type BoundingBox, type Item } from "@owlbear-rodeo/sdk";
import { createId } from "./ids";

export async function selectedSceneItems() {
  const selection = await OBR.player.getSelection();
  if (!selection?.length) return [];
  return OBR.scene.items.getItems((item) => selection.includes(item.id));
}

export async function itemBounds(itemIds: string[]): Promise<BoundingBox | undefined> {
  if (!itemIds.length) return undefined;
  return OBR.scene.items.getItemBounds(itemIds);
}

export async function addSnapshotToScene(snapshot: Item) {
  const viewportPosition = await OBR.viewport.getPosition();
  const copy = structuredClone(snapshot) as Item;
  Object.assign(copy, {
    id: createId("scene_item"),
    position: viewportPosition,
    attachedTo: undefined,
    locked: false,
  });

  await OBR.scene.items.addItems([copy]);
}

export async function resizeAction(width: number, height: number) {
  if (!OBR.isAvailable) return;
  await Promise.all([OBR.action.setWidth(width), OBR.action.setHeight(height)]);
}
