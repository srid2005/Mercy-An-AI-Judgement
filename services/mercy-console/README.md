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
and the exact-origin `postMessage` checks (the laptop's `mercy:gates?` and
`mercy:coords`, the map's `mercy:case-solved` / `mercy:return`) keep
matching whatever that host is. The one thing that still says `localhost` is the evidence: the
engine absolutises media URLs with `http://localhost:<port>/`, and the seeds
carry laptop photos and PDFs that way. `rehost()` in `app.js` rewrites those
to the current host at render time -- the evidence cards in the hearing, the
index badges, the drone contact sheets, the peek preview, the band memo's
audio, the "Open the document" links.

## The loader

`#boot` is static markup in `index.html`, styled from an inline `<style>` in
the head, so it is painted before `style.css` or a byte of `app.js` has
arrived and the chamber never shows half-built underneath it. It carries
"OPENING THE FILE", then "CONNECTING TO MERCY..." while the engine is not
answering, and `app.js` fades and removes it the moment the gate below
lifts. `nginx.conf` sends the text assets gzipped (`app.js` and `style.css`
are a fifth of a megabyte between them raw) and lets the browser keep the
two pictures for a week -- their URLs carry a `?v=` that changes with them.
Justice, the hearing's background, is `preload`ed from the head rather than
discovered from the stylesheet.

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
and `mercy-hints:<id>` (the hints this participant has bought, oldest
first: the hint log is drawn from it, and a tier already bought is shown as
already known instead of being asked for again). `/reset.html` clears this origin's `localStorage`
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
- `#meter-stage` takes the chip to the centre of the screen for the move:
  it flies out of its corner, grows, counts from the old number to the new
  one, plays the character of the verdict (a bloom for down, a jolt for up,
  two for CONTRADICTED, a still dim for nothing moved) and flies back
  already settled. Green for down and red for up -- down is the accused
  gaining ground. No signed number rides on it: the needle, the count and
  the colour are the whole cue;
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

`#hud-hint` in the tab bar, so it is one click from the laptop and the map
as well: **HINT** (the progressive ask), the **log** button, and the running
**HINT COST** with a caret that opens the three-depth desk. There is no
purse and no refusal: every steer adds its price -- 5 for the app or area,
10 for what to look for, 20 for the piece itself -- to `hint_cost`, which
the engine owns, and among the files that find her the leaderboard ranks
the lowest cost first. The price is still said before anything is bought,
and every buy needs a second click (CONFIRM on the card, or on the tier),
because a hint the participant did not want still counts against them.

`POST /api/hint` with `{context, detail}` from the nav button, or `{tier,
context, detail}` from the desk. The engine's `hint_cost` in the reply
overrides whatever the header last read (`points_left` is read as the same
number for one release, and until either has arrived the local ledger's sum
stands in); `/api/state` and `/api/case` carry it too.

- **200** -- the hint goes into the **hint log** (`#hint-drawer`), never the
  hearing: the transcript is MERCY and the participant only. The drawer
  lists every hint bought this game, newest first -- SCREEN or BEAT, "HINT
  2 OF 2", the cost, the screen it was asked for, the text, the engine's
  `target` label -- opens itself when a hint lands with the new one lit, and
  stays up while they work. The log button, the desk's own "SEE THE HINTS
  TAKEN" line, the X and Escape open and close it.
- **200, `cost: 0`** -- a step already bought. The console usually answers
  this one itself, from its own store, by opening the log on that hint
  without a request at all.
- **409** -- the file is closed; there is nothing left to point at. The
  buttons are disabled and the desk shut whenever the case concludes anyway.

## Coordinates to the map

PulseFit's SEND TO MAP posts `{type: "mercy:coords", lat, lng, label}` to
`window.top`. The console, on receipt from the laptop's origin only,
switches to the City Map tab and forwards a rebuilt copy of the same message
to the map iframe at `MAP_URL`, waiting for the frame's `load` if the map
has not been opened yet (anything posted at a frame between documents is
lost). The map fills its own `#lat` / `#lng` and flashes them; the flight
stays the participant's click, over there.

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
