# mercy-lobby (implemented)

The event's front door, on `:3030`. Not one of Meera's apps and not part of
the story: it is how fifty participants get into the same mystery at once
without seeing each other's game, how long they get, and how the room is run.
The design it follows is [/MULTIPLAYER.md](../../MULTIPLAYER.md); the
mechanics of isolation (one Postgres schema per participant in every stateful
service, the `mercy_sid` cookie every port of the host receives) live in
`tenant.js`, of which this folder carries the same copy as every game service.

Two faces:

* **`/`** -- the participant's way in. One page, in fullscreen, four stages:
  the Zinnia ID, the intro film, the stone angel (hover it and the name draws
  itself out: MERCY · AI JUDGEMENT), the briefing with its rules. "Accept &
  continue" starts their clock and sends them to the console in the same tab.
  `/done` is their result and the leaderboard; `/leaderboard` is the projector
  view.
* **`/admin`** -- the desk. Participants (add one, paste fifty, restart one,
  delete one), their live state (time left, guilt, checkpoints, evidence,
  searches, the chase), the leaderboard, the stack's resources (host,
  containers, each service's database), and the event's controls: prepare the
  templates, reset every game, restart the app containers.

The lobby owns one small database of its own (`players`, `admin_events`).
Unlike the game services it is **not** split per participant: the whole event
shares it, and `server.js` uses the raw pool. It reaches the six stateful
services through their `/api/internal/*` endpoints with `x-internal-key`, and
the clock lives in mercy-engine: the lobby asks it to start and is told the
outcome.

## The flow

```
ticket ──▶ POST /api/login ──▶ provision in all six services ──▶ Set-Cookie mercy_sid
            │                    (idempotent; the 'template' schema is seeded on first use)
            │  + hidden iframes: http://<host>:{3000,3020,4001,4002,4003,4008,4011}/reset.html
            ▼
   intro.mp4 ──▶ the angel ──▶ story.mp4 if present, else MERCY's typed briefing ──▶ the rules
                                                                                       │
        POST /api/start ──▶ mercy-engine POST /api/internal/players/:id/start ◀────────┘
                            { minutes: GAME_MINUTES } -> { started_at, deadline }
                            location.href = http://<host>:3020/
                                        ...the game...
   mercy-engine ──▶ POST /api/internal/outcome { id, outcome, guilt_percent, checkpoints_hit, points, elapsed_s }
   the console ──▶ /done
```

* A Zinnia ID is `ZIN26-0158` (`^ZIN\d{2}-\d{4}$`, upper-cased); there is no
  password -- the ID is the ticket, and only IDs the admin has added get in.
* A participant whose game is over may log in again and lands on `/done`;
  their game is not rebuilt. One whose clock is already running skips the
  film and goes straight back to the console.
* Outcomes: `solved` (the rescue closed the case), `timeout`, `left`. The
  first report the engine makes stands, except that `solved` overrides an
  earlier one.
* Every URL the lobby hands a participant is another port of **the host they
  reached the lobby on** (the `Host` header), so `http://<lan-ip>:3030/` works
  from other machines with nothing configured.

## Endpoints

Participant (the `mercy_sid` cookie, or 401):

| | |
|---|---|
| `POST /api/login` `{ zinnia_id }` | 400 malformed, 404 not on the list, 502 a service could not provision (`failed: [names]`); else sets the cookie, `{ id, name, status: new\|playing\|finished, minutes }` |
| `POST /api/start` | starts the clock (idempotent) -> `{ started_at, deadline, console_url }`; 409 when the game is over |
| `GET /api/me` | `{ id, name, status, started_at, deadline, ended_at, outcome, elapsed_s, guilt_percent, final_guilt, checkpoints_hit, checkpoints_total, restarts, rank, players, console_url }` -- `guilt_percent` is the final standing once the file is closed, else the engine's live number, else null |
| `GET /api/leaderboard` | `{ rows: [{ rank, zinnia_id, name, outcome, elapsed_s, final_guilt, checkpoints_hit, points, started_at }] }` -- no cookie needed; solved first, then the points left on a closed file desc, then a solver's time asc, then everyone by guilt asc and checkpoints desc. A game still running is ranked on neither of the first two -- it still holds its starting 100 -- so the participants at the desk trail at the bottom as before |
| `POST /api/logout` | clears the cookie |

Internal (`x-internal-key`):

| | |
|---|---|
| `POST /api/internal/outcome` `{ id, outcome, guilt_percent, checkpoints_hit, points, elapsed_s }` | 404 unknown id; `{ ok, outcome, kept }`. `points` is the hint budget left, floored at 0; omit it and the row keeps what it had |

Admin (the `mercy_admin` cookie from `POST /api/admin/login { password }`, or 401):

| | |
|---|---|
| `GET /api/admin/players` | every row, each with `live: { guilt_percent, points, concluded, outcome, time_left_s, checkpoints_hit, checkpoints_total, discovered, transcript_turns, last_activity, searches, sos_swept, trace, stops_searched, found }` from the engine's and city-map's summaries (2 s timeout each; null where a service did not answer) |
| `POST /api/admin/players` `{ zinnia_id, name }` or `{ bulk }` | one per line, id then name (comma, tab or space); known ids get their name updated -> `{ created, updated, rejected: [{ line, reason }] }`. Nothing is provisioned here. |
| `POST /api/admin/players/:id/restart` | drop + rebuild their schema in every service, clear the clock and the outcome, give the 100 points back, `restarts + 1`; 502 with `failed` if a service did not answer |
| `DELETE /api/admin/players/:id` | drop their schemas, delete the row |
| `POST /api/admin/prepare` | `POST /api/internal/template` on all six -- seed the templates before the doors open |
| `POST /api/admin/reset-event` `{ confirm: 'RESET' }` | `POST /api/internal/reset` on all six (every participant schema and the templates go, so the seeds' story clock re-anchors to the day of the next provision) and every row's game columns are cleared; the rows stay |
| `POST /api/admin/restart-services` `{ names? }` | restart the app containers through the Docker socket (never a database, never the lobby); 503 when the socket is not mounted |
| `GET /api/admin/resources` | `{ host: { cpu_count, load, mem_total, mem_free, uptime_s, disk }, containers: [{ name, service, state, status, cpu_pct, mem_usage, mem_limit }], services: [each app's /api/internal/stats or { service, error }], players: { total, playing, finished, solved } }` |
| `GET /api/admin/events` | the last 200 `admin_events` |

Every admin action and every outcome is a row in `admin_events`.

## Environment

| | |
|---|---|
| `PORT` | 3030 |
| `DATABASE_URL` | the lobby's own Postgres (`lobby-db` in compose; `db/init.sql` runs on its first start, and `server.js` replays it if the tables are missing). A volume that predates a column is brought up by hand -- `players.points` with `scripts/migrate_live_points.sql` -- because initdb never runs twice |
| `MERCY_SESSION_SECRET` | signs `mercy_sid` -- **the same value in every service** -- and `mercy_admin` |
| `INTERNAL_API_KEY` | `x-internal-key`, sent to the services and expected on `/api/internal/outcome` |
| `ADMIN_PASSWORD` | the desk's password (default `mercy-admin`; change it for the event) |
| `GAME_MINUTES` | the clock, 60 |
| `SERVICE_URLS` | `name=url,...` -- the six stateful services as the lobby reaches them inside the network |
| `CONSOLE_PORT` | 3020, the port participants are sent to |
| `COMPOSE_PROJECT` | the compose project name, to find the stack's containers (`com.docker.compose.project`); when it matches nothing, any container with a compose service label counts |
| `/var/run/docker.sock` | mount it for the resources page and "restart services"; without it the page shows no containers and the button answers 503 |

The lobby front-ends never name `localhost`: the console URL comes from the
request's host, the reset frames and the projector's share URL from
`location.hostname`.

## The films

* `public/media/intro.mp4` -- the intro, played full-viewport with sound
  right after the participant's click on ENTER (the click is what lets it
  play unmuted and lets the page go fullscreen). SKIP appears after 3 s.
* `public/media/angel.png` -- the stone angel, transparent background.
* `public/media/story.mp4` -- **optional.** Drop a film here and the
  briefing plays it instead of the built-in one; the lobby checks with a
  `HEAD` request at that moment, so no restart is needed. Without it, MERCY's
  seven typed cards run (each on a click or after about six seconds), then
  the rules card. The rules card and "Accept & continue" follow either way.

## Running it

`docker compose up mercy-lobby` brings up `lobby-db` with it. Locally,
`npm install && DATABASE_URL=... node server.js` -- with no `SERVICE_URLS` it
looks for the services on `localhost` at their compose ports.
