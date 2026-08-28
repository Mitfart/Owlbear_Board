# AGENTS.md

## Development

- This is a React/TypeScript Owlbear Rodeo extension. Do not run build commands; validate with `npm test` and `npx tsc --noEmit`.
- Before changing behavior, read root `CONTEXT.md` and relevant `docs/adr/`. Owlbear scene data items/metadata are authoritative; shared edits are last-write-wins and live updates use polling.
- Main entry points: `src/App.tsx` (UI), `src/styles.css` (layout), `src/storage.ts` and `src/owlbear.ts` (persistence/SDK), and focused `*.test.ts` files.
- For visual defects, trace the DOM and CSS layout chain before changing styles. In the text editor, keep the textarea and preview as equal-height panes; Markdown help toggles from `?`, closes on outside click or Escape, and scrolls inside its single dashed border.
- Keep product commits free of generated `.pi/fabric/mesh/state.json`.

## Agent skills

### Issue tracker

Issues are tracked in this repository's GitHub Issues. See `docs/agents/issue-tracker.md`.

### Triage labels

Uses the default canonical triage labels. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout: root `CONTEXT.md` and `docs/adr/`. See `docs/agents/domain.md`.
