# Board records use Owlbear Scene Data Items

Each Board is stored as one extension-owned hidden, locked, non-hittable Scene Data Item. The item metadata holds the complete board record.

Room metadata is a compact registry of Room Board IDs, source scene IDs, revisions, update times, and deletion tombstones; it never contains complete board data. Room Boards are copied into a ready scene from their latest available source. If no current client has the source record, the UI asks the user to open the source scene or ask a relevant client to join.

The SDK publishes no per-item custom-data limit. Do not treat an asset-storage quota as a board-data quota. Shared edits remain last-write-wins.
