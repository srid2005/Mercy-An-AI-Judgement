# MERCY: An AI Judgement

A playable adaptation of the MERCY story: the player (Arjun) works through
Meera's real, separately-containerized apps to prove his innocence and find
her. See [ARCHITECTURE.md](./ARCHITECTURE.md) for the full service list and
the evidence contract every app follows.

## Quick start

```bash
docker compose up --build
```

- http://localhost:3000 -- **Meera's laptop** (start here). Lock screen PIN
  `1708`. Quill is an app on the desktop; Loop, Wisp and Haven open only
  inside the Orbit browser (bookmarks bar); the case file PDF is in
  Documents; the PulseFit alert carries the SOS coordinates.
- http://localhost:4001 -- Meera's Social Media, password-locked. Local test
  password: `14102018`.
- http://localhost:4002 -- Quill (Gmail-style email), password-locked. Local
  test password: `Arjun`.
- http://localhost:4003 -- Wisp (WhatsApp-style messaging), no lock screen,
  opens directly.
- http://localhost:4008 -- Haven (cloud video diary). No password: it emails
  a sign-in code into Quill, then asks three security questions. Local test
  answers: `Bengaluru`, `Bruno`, `Arjun`.
- http://localhost:4011 -- MERCY City Model (3D blueprint of the fictional
  city: the police tower at the centre, the caves in the hills at the edge).
  MERCY's own console, no lock screen.

## Status

`social-media`, `whatsapp`, `email`, `haven`, `city-map` and `desktop-shell` are implemented; `case-files` is a generated PDF. Everything else
under `services/` is a stub `README.md` describing what it will own -- see
ARCHITECTURE.md for the build order and shared conventions before adding the
next one.

## Replacing placeholder images

Each implemented service's `public/images/**` are auto-generated SVG
placeholders (`npm run gen:images` inside that service to regenerate). Drop
in an AI-generated image with the same filename and it's picked up
automatically; if you change the extension, update the matching
`image_url`/`avatar_url`/`account_avatar` value in that service's
`db/init.sql`.
