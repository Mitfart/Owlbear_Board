# Shared board conflicts use last write wins

Shared board edits use last-write-wins conflict behavior for the initial collaborative model. This keeps the Owlbear metadata-based implementation simple for v1, accepting that simultaneous edits to the same board may overwrite earlier changes rather than introducing locking or item-level merge logic.
