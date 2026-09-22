# smartwatch (folded in -- not a service)

The band's story lives in two places instead of a container:

- **Evidence** `SW-01..SW-05` (the five SOS alerts) and `SW-06` (the voice
  memo recovered with her jacket from the cave) are seeded straight into
  `services/mercy-engine/db/init.sql`, like the `CASE-` and `LAP-` rows.
- **UI** is the laptop's PulseFit app (`services/desktop-shell`,
  `src/utils/sos.js` + `apps/pulsefit.jsx`), gated on the console's
  `mercy:gates` message; the alerts' places are story spots on the City Map
  (`services/city-map/db/03_story.sql`).
