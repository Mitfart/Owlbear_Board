# Shared scene boards use hidden scene data items

Shared scene boards are stored in a versioned, namespaced hidden Owlbear scene data item rather than scene metadata. They belong to the active scene, so storing them as scene data avoids orphaned room-level records when scenes change or are removed. The extension selects the valid record with the highest board revision; shared edits remain last-write-wins and are discovered through polling.
