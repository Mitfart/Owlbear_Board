# Shared board states use scene data items

Shared scene and room board states are stored in extension-owned, versioned Owlbear scene `DATA` items. Items are hidden, locked, and non-hittable. Scene board state belongs to the active scene. Room state is copied from the active in-memory record into the next active scene; this keeps room state available without room metadata or browser storage.

When duplicate valid records exist, the record with the highest board revision is authoritative. Shared edits remain last-write-wins.
