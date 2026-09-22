# mercy-engine (planned)

The judge. Polls `/api/evidence` from every other service (using
`x-mercy-key`), maintains the running guilt-probability score shown to the
player, and issues the final verdict.

- Not player-facing directly -- `desktop-shell` displays its output.
- Needs read access to every other service's evidence endpoint, so it must
  come up after them in `docker-compose.yml`.
- Scoring is a scripted sequence of checkpoints (`db/init.sql`), each fired
  by the participant arguing coherently with its `required_ids`, strictly in
  order: the alibi (WA-199 + SOC-050, 96.8 -> 90) -> the gate timeline (82)
  -> the carabiner (70) -> the motive (42) -> Named (22, releases the SOS
  trail) -> Not Rahul (SW-06, 8) -> Located (the drone find, 3, closed).
  Nothing raises the meter yet. The LLM adapter (`llm/`) decides coherence;
  the stub accepts any 12+ character argument that attaches evidence.
- The end of the game is not an argument but a rescue. `POST /api/rescue
  {evidence_id: 'MAP-<id>'}` -- called by the console when the map posts
  `mercy:case-solved` after the rescue footage -- concludes the case:
  `{concluded: true, guilt_percent: 0, reply: <MERCY's closing line>,
  checkpoint_hit: 'located'}`. 400 unless that evidence is a city-map search
  whose `content.found` is true; idempotent once concluded (the current
  state comes back, no new transcript turn).
- Live-database migrations for a running game live in `scripts/`.

## The event: one schema per participant, and the clock

`tenant.js` (identical in every stateful service; see `/MULTIPLAYER.md`)
picks the participant's schema from the `mercy_sid` cookie, or from
`x-mercy-player` on a call that also carries `x-mercy-key` /
`x-internal-key`. Every table here is the participant's own (`staticTables`
is empty: `evidence_cache` included, since MAP-/SOC-/EML- ids repeat across
participants with different content). Every outbound fetch to an owning
service carries `x-mercy-key` and `x-mercy-player`, so the owner answers
from the same participant's schema. Without a participant an `/api/*` call
is a 401 unless `MERCY_SINGLE_PLAYER=1`.

The clock lives in `case_state` (`started_at`, `deadline`, `outcome`,
`reported_at`; `scripts/migrate_live_clock.sql` for a live database). The
deadline is applied lazily -- the next `GET /api/state`, `GET /api/me`,
`POST /api/argue`, `POST /api/rescue`, `POST /api/leave` or internal summary
past it closes the file as `timeout`. Each outcome (`solved` | `timeout` |
`left`) is reported to the lobby once: `POST {LOBBY_URL}/api/internal/outcome
{id, outcome, guilt_percent, checkpoints_hit, elapsed_s}` with
`x-internal-key`; a report the lobby did not take is retried on the next
read of `/api/me` or `/api/state`.

### Endpoints

Participant (cookie), CORS with credentials for the console:

- `GET /api/me` -> `{id, name: null, started_at, deadline, time_left_s,
  expired, concluded, outcome, guilt_percent}`. `started_at`/`deadline` are
  null until the lobby starts the clock; `time_left_s` is null until then, 0
  once the clock has run out, and frozen at the moment a file closed.
  `expired` is the clock having run out on an open file.
- `POST /api/leave` -> `{outcome: 'left', guilt_percent}`. Closes an open
  file where it stands, with MERCY's line in the transcript; idempotent (a
  closed file answers with how it closed).
- `GET /api/state` -- as before, plus `outcome`, `started_at`, `deadline`,
  `time_left_s`, `expired`.
- `POST /api/argue` -- 409 `time is up` past the deadline, 409 `the case is
  closed` once concluded. The last checkpoint sets `outcome = 'solved'`.
- `POST /api/rescue` -- as before, and sets `outcome = 'solved'`.
- `GET /api/transcript`, `GET /api/discovered`, `POST /api/discovered`,
  `GET /api/evidence/:id`, `GET /api/case`, `GET /api/health` -- unchanged.

Internal (`x-internal-key`; the lobby):

- `POST /api/internal/players/:id/start {minutes}` (default `GAME_MINUTES`)
  -> `{started_at, deadline}`. Idempotent: a running clock is not restarted.
  404 until the participant is provisioned.
- `POST /api/internal/players {id}`, `DELETE /api/internal/players/:id`,
  `GET /api/internal/players`, `POST /api/internal/template`,
  `POST /api/internal/reset`, `GET /api/internal/stats` -- `tenant.js`.
- `GET /api/internal/players/:id/summary` -> `{id, provisioned,
  guilt_percent, concluded, outcome, started_at, deadline, time_left_s,
  expired, checkpoints_hit, checkpoints_total, discovered, transcript_turns,
  last_activity}`.

### Environment

- `MERCY_SESSION_SECRET` -- signs `mercy_sid`; the same in every service.
- `MERCY_SINGLE_PLAYER` -- `1` for the old single-player behaviour on
  `public` (no cookie needed; outcomes are not reported).
- `INTERNAL_API_KEY` -- `x-internal-key` on the lobby's calls in, and on
  the outcome report out.
- `LOBBY_URL` -- where the outcome report goes (default
  `http://mercy-lobby:3030`).
- `GAME_MINUTES` -- the length of a game when the lobby's start does not
  say (default 25).
- `MERCY_API_KEY`, `DATABASE_URL`, `MERCY_LLM_PROVIDER`, the `*_URL` and
  `*_PUBLIC_URL` pairs -- as before.

## MERCY's brain

`MERCY_LLM_PROVIDER` picks the model behind the hearing: `stub` (default --
canned replies, no key, deterministic) or `vertex` -- Gemini through Google
Cloud Vertex AI (`llm/vertex.js`, `@google/genai`; `GOOGLE_CLOUD_PROJECT`,
`GOOGLE_CLOUD_LOCATION=global`, `VERTEX_MODEL=gemini-2.5-flash`; Application
Default Credentials, i.e. the VM's service account or a mounted key file).
Every turn the model gets MERCY's persona, the participant's words, the
attached evidence, the last eight turns and the beats the file has already
accepted -- never the hidden truth -- and answers as JSON `{ reply, coherent }`.
`coherent` is what gates the accepted set (and so the checkpoints), exactly as
with the stub. A failure of any kind falls back to the stub's reply, so the
hearing never stalls. See /DEPLOY_GCP.md.
