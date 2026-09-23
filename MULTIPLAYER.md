# MERCY -- the event build: many participants, one stack

_How fifty people play the same mystery at once without seeing each other's game, how they get in, how long they have, and how the event is run. This is the design every service follows; the per-service READMEs say what each one does with it._

## The shape of it

One docker compose stack. Every service keeps its own database and its own seeded content; what changes is that the **participant's progress** -- drone searches, the chase, the judge's state, login codes, drafts, likes, delivered mail -- lives in a **Postgres schema per participant** inside each service's database, and every request picks that schema from a cookie. Content stays where it is. Nothing a participant does can reach another participant's tables, because the other tables are never on their search path.

```
browser ── mercy_sid cookie ──▶ any service  ──▶  SET search_path TO p_zin26_0158, template
                                                     │
                                                     ├── p_zin26_0158.searches        (theirs)
                                                     ├── p_zin26_0158.case_state      (theirs)
                                                     └── template.buildings           (everyone's, read-only)
```

* **template** is the pristine seed: each service's `db/*.sql` replayed once into a schema of that name (so the play state that may have accumulated in `public` during development never becomes anyone's starting point).
* **p_&lt;zinnia id&gt;** is created on first login by copying every non-static table from `template` (`CREATE TABLE ... (LIKE template.t INCLUDING ALL)` + `INSERT ... SELECT`), then the service's own hook runs -- city-map redraws `truth_stop`, so each participant's Meera is at her own random stop.
* A participant's schema is dropped and rebuilt to **restart their game**; every schema is dropped to **reset the event**.

## Identity

* A participant is a **Zinnia ID**, `ZIN26-0158` (`^ZIN\d{2}-\d{4}$`, stored upper-case; schema name `p_zin26_0158`). The admin creates them with a display name; there is no password -- the ID is the ticket.
* **`mercy_sid`** is the session cookie: `<id>.<issued>.<hmac-sha256>` signed with `MERCY_SESSION_SECRET` (the same secret in every service), `HttpOnly; SameSite=Lax; Path=/`, host-only -- so every service on the host (any port) receives it. The lobby sets it at login; every stateful service verifies it (`tenant.js`).
* Service-to-service calls carry **`x-mercy-player: <id>`** next to their existing `x-mercy-key` / `x-internal-key`; the header is honoured only when the key is.
* No cookie and no header: API routes answer **401** (static files are always served) -- unless the service runs with `MERCY_SINGLE_PLAYER=1`, the old single-player behaviour on `public` for development.

## The clock

* The lobby's "Accept & continue" starts the game: mercy-engine writes `started_at` and `deadline = started_at + GAME_MINUTES` (60) into the participant's `case_state`; the console shows the countdown from `GET /api/me`.
* At the deadline `/api/argue` refuses (`409 time is up`), `/api/state` reports `expired`, the console shows TIME EXPIRED and sends the participant to the lobby's result page.
* **Leave the case** (console) → `POST /api/leave`: the file stands at the current guilt; the participant goes to their result page.
* Outcomes: `solved` (the rescue closed the case), `timeout`, `left`. mercy-engine reports each to the lobby (`POST /api/internal/outcome`, which carries the hint budget they finished with), which keeps the leaderboard: solved first, then points left descending, then the clock.

## The lobby (`mercy-lobby`, :3030)

One service, one small database (`players`, `admin_events`), two faces:

* **`/`** -- the participant's way in, one page in fullscreen: Zinnia ID → the intro film (`public/media/intro.mp4`) → the angel (`public/media/angel.png`; hovering it reveals **MERCY · AI JUDGEMENT**) → Continue → the briefing (`public/media/story.mp4` if present, else the built-in narrated briefing: why they are here, what they must do, the 60 minutes) → Accept & continue → the console. `/done` shows their result and the leaderboard; `/leaderboard` is the projector view.
* **`/admin`** (password `ADMIN_PASSWORD`) -- participants (create one, paste many, restart one, delete), live status per participant (time left, guilt, points left, checkpoints, evidence, searches, outcome), the leaderboard, event controls (reset every game, restart the app containers through the Docker socket when it is mounted), and resources (host CPU/memory/disk, per-container CPU/memory, each service's database size, connections and request rates).

## What every stateful service gains

`tenant.js` (identical in mercy-engine, city-map, haven, email, whatsapp, social-media):

* the cookie/header middleware and an `AsyncLocalStorage` that carries the participant through the request;
* the `db.js` pool proxy: `query()` checks out a client, `SET search_path TO <schema>, template`, runs the query; `connect()` hands back a client already on that path;
* `POST /api/internal/players` `{id}` (provision, idempotent), `DELETE /api/internal/players/:id`, `GET /api/internal/players/:id/summary`, `GET /api/internal/stats`, all behind `x-internal-key`;
* a `STATIC_TABLES` list (the big read-only tables that stay in `template`) and an `afterProvision(client, schema)` hook.

## Reaching it from other devices

Nothing in a front-end names `localhost` any more: the console, the laptop and the lobby derive every other service's URL from `location.hostname`, so participants open `http://<host-ip>:3030/` and everything that follows is on the same host. Evidence URLs the engine absolutises with `localhost` are rewritten by the console at render time.
