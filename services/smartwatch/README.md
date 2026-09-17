# smartwatch (planned)

Owns: the SOS alert and the movement/GPS log after it. The first GPS fix is
real but stale -- Rahul moved Meera after the SOS fired -- so the log itself
(timestamped movement events) is the evidence, not just a single coordinate.

- Evidence prefix: `SW-`
- Own DB: sos_events, movement_log (timestamp, lat, lng)
- Player-auth lock: password = Meera's birthday (already known to the player
  via `social-media`'s seeded profile/posts once that data is added there).
- Follows the same shape as `services/social-media`.

Not implemented yet.
