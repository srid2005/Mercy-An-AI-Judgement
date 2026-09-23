# mercy-engine (planned)

The judge. Polls `/api/evidence` from every other service (using
`x-mercy-key`), maintains the running guilt-probability score shown to the
player, and issues the final verdict.

- Not player-facing directly -- `desktop-shell` displays its output.
- Needs read access to every other service's evidence endpoint, so it must
  come up after them in `docker-compose.yml`.
- The meter is MERCY's. Every turn of `/api/argue` she returns a verdict
  (`advanced` | `partial` | `rejected` | `contradicted`) and a delta, and the
  standing moves by it, down when the accused gains ground and up when a
  piece turns on him. The model is not trusted with it: the server clamps the
  delta to [-12, +6], refuses a negative one on a turn with nothing attached,
  caps anything but `contradicted` at +3, and holds a floor of 2.0 until she
  has actually been found -- nobody talks their way to zero.
- The checkpoints in `db/init.sql` are the story's beats, not the meter: the
  alibi (WA-199 + SOC-050) -> the gate timeline -> the carabiner -> the
  motive -> Named (releases the SOS trail) -> Not Rahul (SW-06) -> Located
  (the drone find, which closes the file at 0.0). Every un-hit beat is tested
  on every turn against the whole accepted set, so evidence argued out of
  order still lands its beat. A beat opens its gates, says its line, and
  records the standing it fired at (`guilt_at_hit`).
- Hints (`POST /api/hint`) are priced, not budgeted: 5 for the app or the
  part of the city, 10 for what to look for there, 20 for the piece by name,
  every one of them added to a bill (`case_state.hint_cost`) that has no
  ceiling and is never refused. The bill ranks the leaderboard under
  `solved`, lowest first. The target is where the participant is actually
  stuck, not their choice, and a tier already paid for comes back free.
- The desk answers two questions. Without a `context` it answers the beat, as
  above. With one -- a screen key the console reports from the laptop and the
  map (`laptop-lock`, `laptop-app` + the app's name, `map-search`, ...) -- it
  answers that screen instead, from `context_hints`: the next step of that
  chain the participant does not already own, so pressing the button again
  escalates. Steps are priced like the tiers (5/10/20) and charged in their
  own half of the ledger (`context_hints_taken`). A chain that has been spent
  falls through to the beat, so the button never runs out of things to say.
- A hint informs and does nothing else: no tab is switched, nothing is opened
  or revealed for them, and no step states a PIN, a password, a date or a
  security answer. The deepest step of a gate chain names the place the answer
  is written down -- the screen, the panel, the line -- and the participant
  goes and reads it.
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
{id, outcome, guilt_percent, checkpoints_hit, hint_cost, hints_used, elapsed_s}` with
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
  `time_left_s`, `expired`, `hint_cost`, `hints_used`. A hit beat's
  `guilt_after` is what the meter actually read when it fired.
- `POST /api/argue` -> `{reply, guilt_percent, delta, verdict, accepted_ids,
  hint_cost, checkpoint_hit, concluded}`. `delta` is signed and is the move the
  meter actually made, after the guards; `accepted_ids` is the subset of what
  was attached that carried the claim, and only that subset joins the
  accepted set. 409 `time is up` past the deadline, 409 `the case is closed`
  once concluded. The `located` beat sets `outcome = 'solved'` at 0.0.
- `POST /api/hint {context?, detail?, tier?}` -> `{hint, tier, cost,
  hint_cost, points_left, target, step, steps_total, kind}`. `hint_cost` is
  the bill after this purchase; `points_left` is the same number under the
  field's old name, kept for one release so a console built against v4 still
  reads a number. `kind` is `context`
  when a chain for `context`/`detail` answered and `beat` otherwise; `step` of
  `steps_total` is where in that chain the words came from. The response
  carries words and a price and nothing the console is meant to act on.
  `target` is a console label -- `the_alibi/tier2` for a
  beat, `laptop-app:wisp/step2` for a chain -- and `cost` is 0 when those words
  have already been bought. `tier` is optional: sent, it means exactly what it
  meant before (that tier of that beat, context ignored); left out, the desk
  picks the next unbought step itself, which is what the nav button does.
  There is no 402: a hint is never refused for its price. 409 once the file
  is closed or the clock has run out; 400 on a `tier` that is not 1, 2 or 3.
- `GET /api/case` -- plus `hint_cost` and `hints_used`.
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
  guilt_percent, concluded, outcome, hint_cost, hints_used, started_at,
  deadline, time_left_s, expired, checkpoints_hit, checkpoints_total,
  discovered, transcript_turns, last_activity}`.

### Environment

- `MERCY_SESSION_SECRET` -- signs `mercy_sid`; the same in every service.
- `MERCY_SINGLE_PLAYER` -- `1` for the old single-player behaviour on
  `public` (no cookie needed; outcomes are not reported).
- `INTERNAL_API_KEY` -- `x-internal-key` on the lobby's calls in, and on
  the outcome report out.
- `LOBBY_URL` -- where the outcome report goes (default
  `http://mercy-lobby:3030`).
- `GAME_MINUTES` -- the length of a game when the lobby's start does not
  say (default 60).
- `MERCY_API_KEY`, `DATABASE_URL`, `MERCY_LLM_PROVIDER`, the `*_URL` and
  `*_PUBLIC_URL` pairs -- as before.

## MERCY's brain

`MERCY_LLM_PROVIDER` picks the model behind the hearing: `stub` (default --
canned replies, no key, deterministic) or `vertex` -- Gemini through Google
Cloud Vertex AI (`llm/vertex.js`, `@google/genai`; `GOOGLE_CLOUD_PROJECT`,
`GOOGLE_CLOUD_LOCATION=global`, `VERTEX_MODEL=gemini-2.5-flash`; Application
Default Credentials, i.e. the VM's service account or a mounted key file).
Every turn the model gets MERCY's persona, the participant's words, the
attached evidence rendered as a reader would meet it (who wrote it, to whom,
where, when, in the city's own clock, and the text in full), where the
standing stands, the last eight turns with what was attached to each, and the
beats and evidence ids the file has already accepted -- never the hidden
truth. It answers as JSON `{ reply, verdict, delta, accepted_ids, reason }`.
A failure of any kind falls back to the stub, which returns the same shape
with deltas of its own, so the hearing never stalls on the model. See
/DEPLOY_GCP.md.
