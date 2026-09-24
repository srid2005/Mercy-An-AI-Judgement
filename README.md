# MERCY: An AI Judgement

A playable adaptation of the MERCY story: the player (Arjun) works through
Meera's real, separately-containerized apps to prove his innocence and find
her. See [ARCHITECTURE.md](./ARCHITECTURE.md) for the full service list and
the evidence contract every app follows.

## Quick start

```bash
docker compose up --build
```

**The event** (the way participants play): open the desk at
http://localhost:3030/admin (password `mercy-admin`, env `ADMIN_PASSWORD`),
add the participants by Zinnia ID (`ZIN26-0158, Name`, one per line), press
PREPARE TEMPLATES, and share http://<this machine's IP>:3030/ -- a
participant enters their ID, watches the intro, meets MERCY, reads the
briefing, accepts, and has 60 minutes (`GAME_MINUTES`) in the console.
Every participant gets an isolated game in every service (a Postgres schema
each, picked by the `mercy_sid` cookie -- see MULTIPLAYER.md); the desk
watches them live, restarts one, resets the event, restarts the containers,
reads the stack's resources, and keeps the leaderboard
(http://localhost:3030/leaderboard for a projector). Without a session the
game APIs answer 401; for single-player development set
`MERCY_SINGLE_PLAYER=1` in the environment and the old `public` schema is
used, with the addresses below opening directly.

- http://localhost:3030 -- **the lobby** (start here at an event): Zinnia ID
  login, the films, the briefing; `/done` is a participant's result,
  `/leaderboard` the board, `/admin` the desk.
- http://localhost:3020 -- **MERCY's console**: the judge, the laptop and the
  city map in tabs, the clock, LEAVE THE CASE.
- http://localhost:3000 -- **Meera's laptop** (start here in single-player). Lock screen PIN
  `1998` (her birth year -- the hint is on the lock screen). Quill is an app on the desktop; Loop, Wisp and Haven open only
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

`social-media`, `whatsapp`, `email`, `haven`, `city-map`, `desktop-shell`, `mercy-engine`, `mercy-console` and `mercy-lobby` are implemented; `case-files` is a generated PDF. Everything else
under `services/` is a stub `README.md` describing what it will own -- see
ARCHITECTURE.md for the build order and shared conventions before adding the
next one.

The console's HINT button is paid, escalating help seeded in
`services/mercy-engine/db/init.sql` (`hints`: 7 story beats, 3 tiers each;
`context_hints`: 16 screens, up to 3 steps each; `discover_hints`: how to find and open each app; `inside_hints`: what each app holds for the case and why). Every body is written
plainly -- which app, tab, folder or button to open, which item to read, and
what to tell MERCY -- and the only thing a hint never states is a gate secret
(the laptop PIN, the Documents/Dad password, Loop's date, Haven's answers);
it says exactly where that answer is written instead. A running event takes
the current bodies without a rebuild (apply each `scripts/migrate_live_v*.sql` it has not had yet, in version order; the newest is):

```bash
docker compose exec -T mercy-engine-db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < services/mercy-engine/scripts/migrate_live_v11_hints_relative_dates.sql
```

## Replacing placeholder images

Each implemented service's `public/images/**` are auto-generated SVG
placeholders (`npm run gen:images` inside that service to regenerate). Drop
in an AI-generated image with the same filename and it's picked up
automatically; if you change the extension, update the matching
`image_url`/`avatar_url`/`account_avatar` value in that service's
`db/init.sql`.
