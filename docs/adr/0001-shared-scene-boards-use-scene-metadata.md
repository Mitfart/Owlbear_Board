# Shared board states use Owlbear metadata

Shared scene board state is stored under the extension-owned scene metadata key. Shared room board state is stored under the extension-owned room metadata key, so it remains available across scene changes without copying scene items. Private board state stays in player metadata.

The Owlbear API merges partial metadata updates, and shared edits remain last-write-wins.
