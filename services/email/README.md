# email (implemented)

"Quill" in-UI -- Meera's email client. Owns the emails too risky for
WhatsApp: the affair with Nikhil confirmed in more serious detail, and
critically the exchange where Nikhil warns her to stop investigating her
father's case.

- Evidence prefix: `EML-`
- Own DB (`email-db`): `users`, `email_threads`, `emails`, plus
  `filler_emails` for non-evidence noise (newsletters, receipts, job-site
  notifications, spam).
- Has a player-auth lock screen (unlike whatsapp) -- password is her
  husband's name (`Arjun`, case-insensitive).
- REST API + `/api/evidence` gated by `x-mercy-key`, same shape as
  social-media/whatsapp. See `/ARCHITECTURE.md` for the full contract.

Run via the root `docker compose up --build`; served at
`http://localhost:4002`.
