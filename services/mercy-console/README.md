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

Per-participant browser state (the ending already shown) is keyed
`mercy-ending-shown:<id>`, because fifty people may take turns on one
machine. `/reset.html` clears this origin's `localStorage` and
`sessionStorage` outright and posts `mercy:reset-done` to its parent; the
lobby loads it in a hidden iframe at login.

## The clock

`#hud-clock` in the topbar counts down from the engine's `deadline` (25
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
