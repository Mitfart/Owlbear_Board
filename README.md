# Owl-Boards

<p align="center">
  <strong>Custom infinite boards for Owlbear Rodeo</strong><br />
  Build a lightweight Kanban board, character sheet, session dashboard, or anything your table needs.
</p>

<p align="center">
  <a href="https://www.owlbear.rodeo/"><img src="https://shieldcn.dev/badge/Owlbear%20Rodeo-Extension-bb99ff.svg" alt="Owlbear Rodeo extension" /></a>
  <img src="https://shieldcn.dev/badge/Status-Beta-f59e0b.svg" alt="Beta" />
  <img src="https://shieldcn.dev/badge/Built%20with-React%20%2B%20TypeScript-3178c6.svg" alt="Built with React and TypeScript" />
</p>

<p align="center">
  <a href="https://raw.githubusercontent.com/Mitfart/Owlbear_Board/refs/heads/main/manifest.json">Install beta</a> ·
  <a href="https://github.com/Mitfart/Owlbear_Board/issues">Feedback &amp; feature requests</a> ·
  <a href="README_RU.md">Русская версия</a>
</p>

![Owl-Boards with text, images, and counters](./_images/layout_filled.png)

> **Beta project.** Owl-Boards is actively being tested. Please report problems, suggest features, and contribute improvements through [GitHub Issues](https://github.com/Mitfart/Owlbear_Board/issues).

## What’s new in 0.2

- **Reliable board persistence** — Scene Boards are saved with their scene; Room Boards use a room-level registry and follow the table across scene changes.
- **Clear board access** — private boards can be shared with selected players; GMs can always access them, while only the creator or a GM can delete a board.
- **Live board lists** — board saves, edits, and deletions refresh the board menu and Manage Boards view across connected clients.
- **Refined editing** — improved Markdown help and formatting, responsive text items, safer numeric inputs, and stronger board placement and resize handling.

## Install the beta

1. In Owlbear Rodeo, add a custom extension from its manifest URL.
2. Paste the URL below:

   ```text
   https://raw.githubusercontent.com/Mitfart/Owlbear_Board/refs/heads/main/manifest.json
   ```

3. Open a room and select the **Board** action in the top-left toolbar.

The extension is loaded from its `manifest.json`, the standard Owlbear Rodeo extension entry point.

## What you can build

- **Infinite boards** — pan and zoom a grid with no fixed edges; resize the extension window and arrange it around your workflow.
- **Text items** — write session notes, stat blocks, checklists, and character details with Markdown formatting.
- **Image items** — add image URLs, choose cover or contain fit, then drag and resize them freely.
- **Counters** — track HP, resources, turns, ammunition, or any non-negative value; optional maximums and visual states keep important values visible.
- **Private boards** — keep personal prep and player notes private, either per scene or for the whole room.
- **Shared boards** — build one shared scene board or room board for the entire table. Everyone in the room can update it.
- **Board workflow** — keep several boards open in tabs, use undo/redo, and return to the saved pan and zoom for each board.

## Built for tabletop play

Use Owl-Boards as a compact **Kanban board**, a reusable **character sheet**, a GM reference panel, a party resource tracker, or a visual session dashboard. Board items are independent of Owlbear scene objects, so the board stays focused on the information your group needs.

Board data is stored in Owlbear metadata: Scene Boards, including private boards, are stored in scene metadata. Room Boards use room metadata as their authoritative registry and are carried into ready scenes. Player metadata retains only the current player’s active Room Board IDs. Local storage provides a fallback outside Owlbear Rodeo. Shared edits use the latest saved version, so coordinate with your table when editing the same item at once.

## Screenshots

| Infinite grid | Board picker |
| --- | --- |
| ![Empty Owl-Boards grid](./_images/layout_empty.png) | ![Board picker with shared and private boards](./_images/menu_boards_dropdown.png) |

| Add items | Resize items |
| --- | --- |
| ![Add item menu](./_images/menu_add_item.png) | ![Resize an item](./_images/layout_resize.png) |

| Counter editor | Image editor |
| --- | --- |
| ![Counter editor](./_images/menu_edit_counter.png) | ![Image editor](./_images/menu_edit_image.png) |

| Markdown text editor | Item actions |
| --- | --- |
| ![Text editor with Markdown preview](./_images/menu_edit_text.png) | ![Context menu for board items](./_images/right_click_menu.png) |

## Development

```bash
npm install
npm run dev
```

Run the focused test suite with:

```bash
npm test
```

## Help shape the project

This is an alpha/beta extension, and feedback directly shapes it. Open an [issue](https://github.com/Mitfart/Owlbear_Board/issues) for bugs, feature requests, or ideas; pull requests are welcome too.
