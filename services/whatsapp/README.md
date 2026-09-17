# whatsapp (implemented)

"Wisp" in-UI -- Meera's messaging app. Owns direct + group chats, and
specifically the delayed notification from Nikhil ("You regularly post
status... why don't you post anything?") that nudges the player back to
Social Media.

- Evidence prefix: `WA-`
- Own DB (`whatsapp-db`): `users`, `threads` (direct/group), `messages`,
  plus `filler_threads`/`filler_messages` for non-evidence noise (bank OTP,
  delivery bot, promo broadcast, wrong-number stranger).
- No player-auth lock screen -- like real WhatsApp Web, it's just open once
  the device is unlocked, not a separate account.
- REST API + `/api/evidence` gated by `x-mercy-key`, same shape as
  social-media. See `/ARCHITECTURE.md` for the full contract.

Run via the root `docker compose up --build`; served at
`http://localhost:4003`.
