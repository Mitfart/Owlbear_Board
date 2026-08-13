# Owlbear action-popover compatibility

**Scope:** official Owlbear Rodeo documentation only; assessed against the SDK 3.1.0 API requested. The repository declares `^3.1.0`, which permits later 3.x releases, so it is not an exact SDK pin.

## Findings

| Area | Current documented behavior / requirement | Repository comparison |
| --- | --- | --- |
| Manifest action popover | An extension action is declared in the manifest's `action` object. Its `popover` is the URL loaded when the action is opened; action `title`, `icon`, `width`, and `height` configure the action/popover. URLs must be publicly reachable HTTPS extension assets. [Manifest](https://docs.owlbear.rodeo/extensions/manifest/) | `manifest.json` declares the action and a HTTPS GitHub Pages popover URL with title, icon, width, and height. This is compatible, assuming that deployed URL remains publicly reachable. |
| SDK availability and readiness | Load the SDK in the extension page and wait for `OBR.onReady()` before using Owlbear APIs. `OBR.isAvailable` distinguishes an Owlbear embed from a normal browser preview. [Getting started](https://docs.owlbear.rodeo/extensions/getting-started/) | `App.tsx` gates its Owlbear initialization behind `OBR.onReady()` and uses `OBR.isAvailable` for its standalone preview/local fallback. Compatible. |
| Action popover | The SDK action API controls the manifest action/popover, including width, height, title/icon, badge, and open state; it is intended for the action's popover page. [SDK](https://docs.owlbear.rodeo/extensions/sdk/) | `src/owlbear.ts` calls `OBR.action.setWidth()` and `setHeight()` after readiness via the app flow. This appropriately changes the open action popover dimensions; the manifest dimensions remain the initial configuration. |
| Player metadata | Player metadata belongs to the current player and is the appropriate per-user store. Read it with `OBR.player.getMetadata()` and update with `OBR.player.setMetadata()`. [SDK](https://docs.owlbear.rodeo/extensions/sdk/) | `storage.ts` uses player metadata for private boards, preferences, viewports, and per-player open order. That matches per-user data. |
| Room metadata | Room metadata is shared room-level state, available through `OBR.room.getMetadata()` / `setMetadata()`. Use namespaced keys to avoid collisions with other extensions. [SDK](https://docs.owlbear.rodeo/extensions/sdk/) | Shared room boards and the owner marker use room metadata. Compatible; the constants should retain an extension-specific namespace. |
| Scene metadata | Scene metadata is state for the currently loaded scene, available through `OBR.scene.getMetadata()` / `setMetadata()`. A scene may be unavailable/not ready, so check `OBR.scene.isReady()` where scene state is required. [SDK](https://docs.owlbear.rodeo/extensions/sdk/) | `storage.ts` checks `OBR.scene.isReady()` before deriving/writing its scene key, and keeps shared scene boards in scene metadata. Compatible. It reads existing metadata before setting the scene key, so it does not discard existing entries. |
| Asset chooser | `OBR.assets.downloadImages(multiple?, defaultSearch?, typeHint?)` opens Owlbear's image-selection/download flow and resolves selected image downloads. `multiple: false` selects one image; the selected image supplies a URL and dimensions. [SDK](https://docs.owlbear.rodeo/extensions/sdk/) | `App.tsx` calls `OBR.assets.downloadImages(false, undefined, "NOTE")`, uses the first result, and passes its URL/width/height to `addImage`. This is the correct single-image chooser pattern. It is disabled outside Owlbear. |

## Notes

- Metadata is not a substitute for access control: room and scene metadata is shared state. Keep private data in player metadata.
- The documented API names above match the code paths inspected: `OBR.onReady`, `OBR.isAvailable`, `OBR.action`, `OBR.player`, `OBR.room`, `OBR.scene`, and `OBR.assets.downloadImages`.

## Official sources

- [Owlbear Rodeo Extensions: Getting started](https://docs.owlbear.rodeo/extensions/getting-started/)
- [Owlbear Rodeo Extensions: Manifest](https://docs.owlbear.rodeo/extensions/manifest/)
- [Owlbear Rodeo Extensions: SDK](https://docs.owlbear.rodeo/extensions/sdk/)
