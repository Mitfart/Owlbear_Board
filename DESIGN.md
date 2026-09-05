# Board design reference

## Visual tokens and states

Board presentation maps the official OBR.theme palette and text colors into local CSS tokens. Board layout, borders, rounded controls, focus rings, hover, disabled, danger, and selected states remain extension-owned and explicitly styled; no host CSS or browser-default control appearance is used.

## Board Item presentation

Text uses its saved baseline size and fill-block scaling; images use saved fit; counters retain saved value, maximum, and zero/max presentation. The rendered view is derived from the persisted Board record.

## Task List Item semantics

Only Markdown list markers [ ] (incomplete) and [x] (complete) create task controls. Toggling writes the opposite canonical marker. [X], [*], and malformed markers remain ordinary Markdown text and are never migrated.

## Accessibility

Interactive controls have labels, keyboard focus rings, disabled states, and status/error announcements. Task controls expose their state through native checkbox semantics.

## Persistence and display invariants

The extension-owned hidden, locked, non-hittable Scene Data Item is authoritative. Full Board saves use the existing 1 MB guard and report failures in-app and in Debug. Mutations optimistically update the UI only with rollback on failure; successful saves reconcile the returned revision. Saves are serialized and last-write-wins.

## Editing and collaboration

Text drafts save after 500 ms idle and flush on save, outside click, close, and unmount. A failed save keeps the editor and draft open. Shared-Board edit presence is transient, expiring, and never persisted. Private Board presence is not broadcast because the OBR broadcast API cannot target authorized viewers; this prevents disclosing private Board activity or editor identity. Remote updates during local editing retain the draft and display a conflict warning; no locks or merge behavior are introduced.

## Scope boundaries

No host class names, undocumented MUI internals, marker migration, persisted presence, per-item locks, CRDTs, merges, room storage for complete Boards, or unrelated redesign.
