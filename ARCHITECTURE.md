# MERCY: AI Judgement -- system architecture

Each in-game "app" is a real, independently deployable service: its own
container, its own database, its own REST API, its own small web UI. Nothing
is faked in a single shared frontend -- the player's "virtual laptop" is a
shell that talks to these services over HTTP, the same way a real desktop
would talk to real backends.

## Services

| Service        | Status      | Port | Owns                                   |
|----------------|-------------|------|-----------------------------------------|
| `social-media` | implemented | 4001 | posts, comments, tags, DMs             |
| `email`        | implemented | 4002 | inbox, threads, the case-warning emails |
| `whatsapp`     | implemented | 4003 | direct + group chats, delayed notification |
| `notes`        | planned     | 4004 | notes app content, the first password  |
| `photos`       | planned     | 4005 | photo library + trash/recently-deleted |
| `case-files`   | built (PDF, no container) | -- | father's death police file, 5 pages, password 1708RoseCafe |
| `video-diary`  | planned     | 4007 | the laptop's local copies of early recordings |
| `haven`        | implemented | 4008 | Haven -- cloud video diary: every backed-up recording, transcripts, the final reveal |
| `smartwatch`   | planned     | 4009 | SOS event, GPS/movement log            |
| `mercy-engine` | planned     | 4010 | aggregates evidence, computes guilt %  |
| `city-map`     | implemented | 4011 | MERCY's 3D blueprint of the city; the police tower, the caves, real lat/lng |
| `desktop-shell`| implemented | 3000 | Meera's laptop: lock screen (PIN 1708), Orbit browser (Loop/Wisp/Haven only via it), Quill as an app, PulseFit SOS, Explorer with the case PDF |

Every planned service has a stub folder under `services/<name>/` with a
`README.md` describing what it owns and which evidence it's responsible for.
They are intentionally left out of `docker-compose.yml` until built, so
`docker compose up` stays green.

## The evidence contract

Every fact the player can discover -- a post, an email, a message, a diary
entry, a GPS ping -- is one **evidence record**. Every service that produces
evidence exposes it the same way, so `mercy-engine` (and nothing else) can
read across all of them without service-specific logic:

```
GET /api/evidence            (all evidence this service owns)
GET /api/evidence/:id        (one record)
```

protected by a shared secret header:

```
x-mercy-key: <MERCY_API_KEY>
```

Shape of one evidence record:

```json
{
  "evidence_id": "SOC-014",
  "service": "social-media",
  "type": "post",
  "timestamp": "2023-05-06T21:00:00+05:30",
  "summary": "Back with the oldest troublemaker in my life 😂 @Rahul",
  "involves": ["meera", "rahul"],
  "content": { "...": "type-specific fields" }
}
```

### Evidence id prefixes

| Prefix | Service        |
|--------|----------------|
| `SOC-` | social-media   |
| `EML-` | email          |
| `WA-`  | whatsapp       |
| `NOT-` | notes          |
| `PHO-` | photos         |
| `CASE-`| case-files     |
| `VID-` | video-diary    |
| `HAV-` | haven (cloud)  |
| `SW-`  | smartwatch     |
| `MAP-` | city-map (reserved; the model exposes no evidence of its own) |

IDs are zero-padded three-digit sequences per service (`SOC-001`, `SOC-002`,
...), assigned in narrative order so the sequence itself is readable.

## Player auth vs. service auth

These are two unrelated concerns, both real:

- **Player auth** (`POST /api/auth/login` on each app) is the narrative lock
  screen -- the password Arjun derives from another app's clues. It returns a
  short-lived JWT scoped to that one service. Not every app needs one: a
  messaging app that's already logged in on the device (like WhatsApp Web)
  is just open, no separate account screen -- `whatsapp` has no player auth
  at all, matching how that kind of app actually behaves.
- **Service auth** (`x-mercy-key` header) is how `mercy-engine` reads evidence
  regardless of whether the player has unlocked the app yet (or whether the
  app has a lock screen in the first place). MERCY already "has" everything;
  the player's unlocking is the game, not a data restriction.

## Real evidence vs. feed/DM filler

Every app should seed more than just plot-relevant content. A single
"important" thread or post is a dead giveaway; a real feed/inbox is mostly
noise. The established pattern (see social-media's `feed_filler` /
`dm_filler_threads` and whatsapp's `filler_threads`):

- **Real evidence**: tied to an actual `users` row, gets a real `evidence_id`,
  returned by `/api/evidence`. This includes deliberately mundane content
  (dog photos, "pizza tonight?" texts) that exists purely so the plot-critical
  evidence doesn't stand out by being the only real thing in the room.
- **Filler**: ads, memes, bank/delivery/promo bots, wrong-number strangers.
  Lives in its own table(s), never tied to `users`, no `evidence_id`, never
  appears in `/api/evidence`. It's algorithmic/random noise, not anything
  from Meera's actual life -- MERCY should never see it.

## UI conventions

The player-facing UI is styled after mainstream social apps (light theme,
top nav + stories + feed + right rail, Instagram-style profile grids) but
under an original name/wordmark ("Loop") rather than reproducing a real
product's branding. Every app should follow this pattern: light theme,
functional nav (create-post, profile, account menu), not a static mockup.

## Social-media service (implemented)

- `services/social-media/` -- Node/Express + PostgreSQL, own container +
  own DB container (`social-media-db`).
- Schema: `users`, `posts`, `tags`, `comments`, `messages`, `app_config`.
- Seed data (in `db/init.sql`) reproduces the story's Social Media beats:
  family photos, dog photos, the childhood cave (with lat/lng used later by
  the rescue puzzle -- `12.951181, 77.501304`, the cave on Kettle Hill in
  `city-map`), college photos (quietly tagging Nikhil before he
  matters), the reunion thread with Rahul, and the `meera-rahul` DM thread
  that leaks the `NeverForget+Year` password pattern.
- Images are SVG placeholders generated by
  `services/social-media/scripts/generate-placeholder-images.js`. Replace any
  file under `public/images/**` with an AI-generated image of the same name
  -- no code or DB changes needed. If you generate a `.png`/`.jpg` instead,
  update the matching `image_url` / `avatar_url` value in `db/init.sql`
  (extension included) and re-run `docker compose up --build`.

## Whatsapp service (implemented)

- `services/whatsapp/` -- Node/Express + PostgreSQL, own container + own DB
  container (`whatsapp-db`). App name in-UI is "Wisp" (original branding,
  distinct coral accent -- not WhatsApp's name/logo/green).
- No player auth (see above) -- `/api` is open directly to the frontend.
- Schema: `users`, `threads` (`direct` | `group`), `thread_participants`,
  `messages`, plus `filler_threads` / `filler_messages` for noise.
- Seed data reproduces the story's WhatsApp beat: Nikhil's delayed
  notification ("You regularly post status... why don't you post anything?")
  lands as the newest message in an otherwise unremarkable thread, alongside
  ordinary threads with Arjun, Rahul, Priya, and a "College Batch" group chat
  -- plus a bank OTP alert, a delivery bot, a promo broadcast, and a
  wrong-number stranger, none of which are evidence.
- Images: `services/whatsapp/scripts/generate-placeholder-images.js`, same
  swap-in-place convention as social-media.

## Email service (implemented)

- `services/email/` -- Node/Express + PostgreSQL, own container + own DB
  container (`email-db`). App name in-UI is "Quill" (original branding,
  distinct indigo accent -- Gmail-inspired UX, not Gmail's name/logo).
- Has its own player-auth lock screen (unlike whatsapp) -- this is where the
  story's deepest secrets live, so it's gated separately. Password is her
  husband's name (`Arjun`, case-insensitive) -- an easy, personal choice,
  with a riddle-style hint ("My father-in-law's son's name.") rather than
  spelling it out directly.
- Schema: `users`, `email_threads`, `emails`, plus `filler_emails` for noise
  (newsletters, receipts, job-site notifications, spam).
- Seed data reproduces the story's Email beat: emails "too risky for
  WhatsApp," including the critical exchange -- Nikhil's "you need to stop
  digging into this," Meera's "I can't, something about Dad's case doesn't
  make sense," and his "we shouldn't talk about this here" -- alongside
  ordinary threads with Priya, Arjun, and Rahul, and filler mail (a shipping
  notice, a subscription receipt, a job-site digest, a grocery newsletter,
  and an obvious lottery-scam spam email), none of which are evidence.
- Images: `services/email/scripts/generate-placeholder-images.js`, same
  swap-in-place convention as the other services.

## Haven service (implemented)

- `services/haven/` -- Node/Express + PostgreSQL, own container + DB
  container (`haven-db`). The cloud video diary from the story, under its
  in-world name (the same "Haven" whose registration email is starred in
  Quill). Supersedes the planned `cloud` stub; `video-diary` (the laptop's
  local copies) is still planned.
- No password at all -- Haven "can't recover your password", so sign-in is
  real account recovery, in two steps: a one-time code delivered as a real
  email into Quill (via the same `x-internal-key` delivery endpoint the
  social-media reset uses), then three security questions. The questions
  are the story's three password beats (`1708RoseCafe`, `14/10/2018`,
  `NeverForget2018`), so the whole cross-app chain has to be solved.
  Each step issues a stage-scoped JWT; the diary is only reachable with the
  final one. (The questions were later changed to three personal facts --
  birthplace `Bengaluru`, the dog `Bruno`, favourite person `Arjun` -- each
  findable in the other apps.)
- Schema: `users`, `entries` (recording + transcript + mood + tags + backup
  time), `security_questions`, `login_codes`, `app_config`.
- Seed data: 31 recordings, `HAV-001..031`, Nov 2018 -> the night she
  disappeared. Mostly ordinary (the dog, work, the wedding, the affair
  half-admitted); the father's-death investigation only takes over in the
  last month, mixed with normal days. Two backup timestamps are pinned to
  the "Your entry has been saved" emails in Quill (EML-035/036). The final
  entry names Rahul and is backed up from her phone minutes before she's
  taken. The cave line ("one place nobody could find me") sits in an
  ordinary 2023 reunion entry, per the story.
- Videos are sample placeholders, one file per entry named by date
  (`public/videos/<date>.mp4`, poster `public/images/posters/<date>.svg`) --
  swap in the real recording at the same path. See the service README.

## City-map service (implemented)

- `services/city-map/` -- Node/Express + PostgreSQL, own container + DB
  container (`city-map-db`). This one is **not** one of Meera's apps: it is
  MERCY's own console, the 3D model of the city the engine reasons over
  when evidence carries a location. Dark UI, no player-auth lock.
- The city is fictional -- **Meridian**, 13 km across, centred on
  `13.0000 N, 77.5000 E` -- but every geometry is real WGS84 lat/lng. A
  radial plan: the **City Police Headquarters** tower (280 m, red beacon) at
  the exact centre of Central Plaza, ringed by City Hall, the High Court,
  Central Station and the Museum; four ring roads, eight avenues, ten
  districts, ~2,200 buildings; four lakes, parks and forests; and a ring of
  mountains on the border (Northern Wall, Eastern Scarp, Southern Hills,
  Western Tors).
- One view: a 3D **blueprint** (Three.js from the npm package, offline).
  Dark blue ground grid, terrain as a wireframe with 50 m contour rings,
  every building as cyan wire edges over a translucent fill, roads as
  lines, monospace labels; camera presets for the city core and the whole
  basin. Elevation is `900 m + sum of Gaussian peaks`, computed identically
  in the generator, the server and the browser.
- The caves: three in the hills at the map's edge, one real. The cave on
  the north face of Kettle Hill (`12.951181 N, 77.501304 E`) is a footpath
  past the Southgate terminus, the last stop of bus route 7 from Central
  Station; it carries the same coordinates as the childhood photos in
  `social-media` (SOC-006/009). Quarry cave and Hermit's cave are decoys.
- Schema: `districts`, `roads`, `water`, `parks`, `mountains`, `landmarks`
  (the important places -- the only things that get a label), `buildings`,
  `towers` + `power_lines` (pylons on a 132 kV ring main, cell masts, water
  towers, radio relays, substations), `cctv_cameras` (45 cameras drawn as
  wedges; none within 900 m of the flat, and the map labels that gap),
  `trees` (~9,800 wire canopies and bushes, thick around the caves) and `props` (~5,000: lamps, parked cars,
  boats, cranes, fountain, shelters), `searches`, `app_config`. Buildings
  are houses with gabled roofs or blocks, with shader-drawn facades
  (floors, lit windows, doors, hatched roofs). Live traffic -- cars on the
  street graph, buses on route 7 -- runs client-side. The model is MERCY's tool, not a
  source of evidence: `/api/evidence` is empty.
- The drone search: the model never shows where Meera is. Her watch's SOS
  fix (±300 m, the smartwatch service's beat) lands in a hamlet of ~100
  structures at the foot of Kettle Hill, 254 m from the cave; the player
  brings the coordinates here, or right-clicks a building. Four drones lift
  off the Police HQ roof and thread between the buildings (A* on a 10 m
  obstacle grid, client-side) with the camera behind them, sweep the building
  four ways (base ring, roof ring, spiral down, spiral up) -- or, at a cave,
  two outside and two flying the tunnel -- and report. Civic
  landmarks -- library, theatre, temple, university, stadium, auditorium,
  schools, churches, market hall, fire station, veterinary hospital -- have
  their own edge-drawn shapes; the Eco-Park has a pond, loops, turbines, a
  solar field and a lookout.
  `POST /api/search` decides server-side: a find only within 60 m of the
  `truth_landmark` in `app_config`, never sent to the browser.
- Seed: `db/01_schema.sql` plus `db/02_city.sql`, generated in full by
  `scripts/generate-city.js` with a seeded PRNG. Change the plan in the
  script, not in the SQL. The DB container mounts the whole `db/` folder.

## Running it

```bash
docker compose up --build
```

- `http://localhost:4001` -- Meera's Social Media (lock screen; local test
  password `14102018`).
- `http://localhost:4002` -- Quill (lock screen; local test password
  `Arjun`).
- `http://localhost:4003` -- Wisp (no lock screen, opens directly).
- `http://localhost:4008` -- Haven (no password: emailed code via Quill, then
  three security questions -- `Bengaluru`, `Bruno`, `Arjun`).
- `http://localhost:4011` -- MERCY City Model (3D blueprint; MERCY's
  console, no lock screen).
