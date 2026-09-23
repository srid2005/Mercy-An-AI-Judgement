# mercy-console (implemented)

The participant's main screen, on `:3020`. Three tabs: **MERCY AI Judge**
(native: the guilt meter, the hearing, the evidence index), **Meera's
Laptop** (`desktop-shell`, iframed from `:3000`) and the **City Map**
(`city-map`, iframed from `:4011`). Plain HTML/CSS/JS behind nginx, no build
step and no backend of its own: everything it knows it asks `mercy-engine`
(`:4010`) for, from the browser.

## No configuration

The console takes no environment at all. Every other origin is derived at
load from `location.hostname` -- the engine on `:4010`, the laptop on
`:3000`, the map on `:4011`, the lobby on `:3030` -- so a participant who
opened `http://<host-ip>:3030/` is talking to the same host on every tab,
and the exact-origin `postMessage` checks (the laptop's `mercy:gates?`, the
map's `mercy:case-solved` / `mercy:return`) keep matching whatever that
host is. The one thing that still says `localhost` is the evidence: the
engine absolutises media URLs with `http://localhost:<port>/`, and the seeds
carry laptop photos and PDFs that way. `rehost()` in `app.js` rewrites those
to the current host at render time -- the evidence cards in the hearing, the
index badges, the drone contact sheets, the peek preview, the band memo's
audio, the "Open the document" links.

## The gate

Every call to the engine carries the `mercy_sid` cookie the lobby set
(`fetch` with `credentials: 'include'`). Before the console draws anything
it asks `GET /api/me`:

- **401** -- no session, or one the engine has since forgotten (the admin
  restarted or deleted the participant): `location.replace` to the lobby.
  The same rule applies to a 401 from any call at any time.
- **`started_at` null** -- the briefing has not been accepted, so the clock
  has not started: back to the lobby.
- otherwise the record is kept as `me` and the console opens.

Per-participant browser state is namespaced by `me.id`, because fifty
people may take turns on one machine: `mercy-ending-shown:<id>` (the ending
has been dismissed), `mercy-tour-done:<id>` (the walkthrough has been taken)
and `mercy-hints:<id>` (the hints this participant has paid for, so a reload
reads them back and a tier already bought is shown as already known instead
of being asked for again). `/reset.html` clears this origin's `localStorage`
and `sessionStorage` outright -- all three keys with it -- and posts
`mercy:reset-done` to its parent; the lobby loads it in a hidden iframe at
login.

## The clock

`#hud-clock` in the topbar counts down from the engine's `deadline` (60
minutes from the lobby's "Accept & continue"): amber, red and pulsing under
five minutes, `TIME'S UP` at zero. It recomputes from `Date.now()` every
second and is re-anchored by every `/api/me` or `/api/state` that carries
the deadline; a `time_left_s` in the payload wins over the ISO deadline, so
a participant's laptop clock being minutes off the server's does not show.
`/api/state` is polled every 15 s and on `visibilitychange`, so an expiry
or an admin restart is noticed without a reload:

- `outcome: 'timeout'` (or `expired`) raises the **TIME EXPIRED** card --
  the ending's own markup in its other variant: "The file stands." /
  "Standing: <guilt>%" / "MERCY's verdict is entered." -- with one button,
  **SEE THE LEADERBOARD**, to the lobby's `/done`. It wins over `concluded`,
  so an engine that marks a timed-out file concluded does not play the
  rescue's ending.
- the rescue's **CASE CLOSED** card keeps **READ THE TRANSCRIPT** and gains
  **SEE THE LEADERBOARD** beside it.
- **LEAVE THE CASE** (`#leave-btn`, in the topbar) asks once -- "Leave the
  file as it stands at <guilt>%? You cannot come back to it." -- then
  `POST /api/leave` and `location.replace` to `/done`. Once the case is
  closed either way, the same button reads **SEE THE LEADERBOARD**.

## The meter

The standing moves every turn now -- MERCY owns the number, and checkpoints
only tell the story -- so the console has to make each turn's contribution
legible rather than leaving a percentage that quietly slid:

- the digits tween and the gauge sweeps to the new value, as before;
- `#guilt-delta` floats the turn's signed `delta` once under the gauge,
  green for down and red for up. Down is the accused gaining ground, which
  is the opposite of the reflex, so it is never shown unlabelled;
- MERCY's turn carries a `verdict` badge -- ADVANCED / PARTIAL / REJECTED /
  CONTRADICTED -- and the same signed number beside it. Both are read back
  from `/api/transcript`, which files them per row, so a reload replays the
  hearing exactly as it was watched;
- the participant's own turn has its cards stamped from `accepted_ids`:
  ACCEPTED on the ones MERCY leaned on, NOT USED on the rest. This one is
  live-only -- MERCY's transcript row files no `evidence_ids`, so a reload
  cannot say which of an old turn's attachments landed;
- `#cp-list` in the meter popover lists the checkpoints reached, without a
  percentage: a checkpoint's `guilt_after` no longer describes anything that
  happened to the standing.

## The hint desk

`#hud-hint` in the left HUD: a chip carrying the points left (a hundred to
start) and, behind it, the only place they are spent. Three tiers -- 5 for
the app or area, 10 for what to look for, 20 for the piece itself -- each
priced and described before it is bought, and each needing a second click on
CONFIRM, because the leaderboard counts what is not spent. `POST /api/hint`
with `{tier}`; the engine owns the purse and the wording, and its
`points_left` overrides whatever the chip last read:

- **200** -- the hint goes into the hearing as a `.hint-note`: dashed, warm,
  centred, plainly not one of MERCY's bubbles, with the cost and the
  engine's `target` label on it.
- **200, `cost: 0`** -- a tier already bought. Shown as already known, with
  nothing spent. The console usually answers this one itself, from its own
  store, without a request at all.
- **402** -- "NOT ENOUGH POINTS · TIER n COSTS c, YOU HAVE k", with the
  purse corrected from the body's `points_left`. A tier the console already
  knows is out of reach says so without spending a request on it.
- **409** -- the file is closed; there is nothing left to point at. The chip
  is disabled and the desk shut whenever the case concludes anyway.

## The walkthrough

`#tour`: seven steps over the real console, once per participant and then
whenever the **TOUR** button in the topbar is pressed. Each step cuts a hole
over the element it is naming -- one fixed box with a viewport-sized shadow
around it, so the dim and the cut-out can never drift apart -- and the
caption says what that element is *for* in the game: the apps, the evidence
index, attaching, the argument, the standing, the hint desk, the clock. The
overlay takes the clicks, so nothing underneath is live while it is up;
Next / Back / Skip, arrow keys, and Escape ends it from anywhere. On narrow
screens the index step opens the slide-over first, since there is nothing to
spotlight until it is.
