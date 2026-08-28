# Live updates use Owlbear refresh signals and polling

Board state is refreshed after Owlbear scene readiness, on relevant scene-item changes, on board broadcast messages, and through conservative polling. Polling and event refreshes are skipped during active editing or dragging to avoid stomping local interactions. No pre-switch scene-item API is assumed; room state is carried only after the destination scene is ready.
