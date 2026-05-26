# Live updates use metadata polling

Board live updates use conservative periodic metadata refresh instead of custom WebSockets. Owlbear metadata remains the source of truth, polling keeps private and shared boards best-effort synchronized across open extension instances, and refreshes are skipped during active editing or dragging to avoid stomping local interactions.
