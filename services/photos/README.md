# photos (planned)

Owns: the photo library, and critically a "Trash / Recently Deleted" view
containing the deleted intimate photos of Meera and Nikhil -- the evidence
that first spikes MERCY's guilt probability against Arjun.

- Evidence prefix: `PHO-`
- Own DB: photos (album, deleted_at nullable, restored_at nullable)
- No player-auth lock, but the Trash view is a distinct route so it can be
  gated/highlighted separately from the main library.
- Follows the same shape as `services/social-media`.

Not implemented yet.
