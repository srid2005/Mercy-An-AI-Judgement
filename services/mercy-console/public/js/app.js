// MERCY console -- the participant's main screen. Three tabs: this one
// (native), Meera's laptop and the City Map (both iframed on their own
// ports, unchanged). This file is the only thing native to this tab: the
// guilt meter, the argument with MERCY, and the "+ Evidence" picker.
(function () {
  "use strict";

  // Everything this tab talks to lives on the host the participant opened it
  // from: the lobby sent them to http://<host>:3020, and the engine, the
  // laptop, the map and the lobby itself answer on their ports of that same
  // host. Nothing here names localhost, so a participant on another machine
  // reaches the whole stack -- and the exact-origin postMessage checks below
  // keep matching, because the iframes are built from the same HOST.
  const HOST = location.hostname || "localhost";
  const MERCY_API = `http://${HOST}:4010`;
  const LAPTOP_URL = `http://${HOST}:3000`;
  const MAP_URL = `http://${HOST}:4011`;
  const LOBBY_URL = `http://${HOST}:3030`;
  // Evidence records arrive with media URLs the engine absolutised (or the
  // seeds wrote) as http://localhost:<port>/...: right on the machine that
  // runs the stack, dead anywhere else. Rewritten to HOST at render time,
  // wherever a record's URL lands in a src or href.
  const rehost = (u) => (typeof u === "string" ? u.replace(/^http:\/\/localhost(:\d+)?\//i, `http://${HOST}$1/`) : u);

  const SERVICE_LABEL = {
    "social-media": "Loop",
    email: "Quill",
    whatsapp: "Wisp",
    haven: "Haven",
    "city-map": "City Map",
    "case-files": "Case file",
    "desktop-shell": "Laptop",
    smartwatch: "PulseFit", // the band's SOS log and the recovered voice memo (SW-01..06), engine-seeded; PulseFit on the laptop is the UI
  };

  const el = (id) => document.getElementById(id);
  const escapeHtml = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

  let tray = []; // staged evidence for the next message
  const cache = new Map(); // evidence_id -> resolved record, so history renders don't re-fetch
  let picking = false;
  let concluded = false;
  let shownGuilt = null; // last value the HUD digits settled on, for the count-down tween
  let points = null; // hint points left, from the engine; null until it has said
  let hintsUsed = 0; // how many tiers have been bought, from the engine
  let lastState = null; // last /api/state response; its `gates` are pushed to the laptop (see pushGates)
  let turnPending = false; // an /api/argue reply is in hand and will play the move itself
  const GAUGE_ARC = 0.75 * 2 * Math.PI * 19; // 270deg sweep of the r=19 arc in index.html

  // ------------------------------------------------------------------ api
  // The engine is another origin, and the participant is the mercy_sid
  // cookie the lobby set on this host: every call carries credentials. A
  // 401 means the engine no longer knows this browser -- never logged in,
  // restarted or deleted by the admin -- and the lobby is the only way back.
  let leaving = false; // this tab is on its way to the lobby: polls and ticks stand down
  function toLobby(path) {
    if (!leaving) {
      leaving = true;
      location.replace(LOBBY_URL + (path || "/"));
    }
    return new Promise(() => {}); // never settles, so nothing downstream renders on the way out
  }
  async function api(path, opts) {
    const r = await fetch(MERCY_API + path, { credentials: "include", ...opts });
    const body = await r.json().catch(() => ({}));
    if (r.status === 401) return toLobby();
    if (!r.ok) {
      const err = new Error(body.error || `request failed (${r.status})`);
      err.status = r.status;
      err.body = body; // a 402 from the hint desk carries points_left in here
      throw err;
    }
    return body;
  }
  async function resolveCached(id) {
    if (cache.has(id)) return cache.get(id);
    try {
      const record = await api(`/api/evidence/${encodeURIComponent(id)}`);
      cache.set(id, record);
      return record;
    } catch (e) {
      return null;
    }
  }

  // ------------------------------------------------------------- tabs
  function initTabs() {
    document.querySelectorAll(".tab-btn").forEach((btn) => {
      btn.addEventListener("click", () => switchTab(btn.dataset.tab));
    });
  }
  // The small amber dot on the Laptop / Map tab buttons: "something new is
  // waiting there". Lit by an event on another tab, cleared when that tab is
  // opened.
  function tabDot(tab, on) {
    const dot = document.querySelector(`.tab-btn[data-tab="${tab}"] .tab-dot`);
    if (dot) dot.hidden = !on;
  }
  function switchTab(tab) {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
    document.querySelectorAll(".panel").forEach((p) => p.classList.toggle("active", p.id === `panel-${tab}`));
    tabDot(tab, false);
    // the hint has to be aimed at what is actually on screen: this tab is
    // the hearing and says so itself, the other two are whatever their app
    // last reported (nothing yet, on a frame that has not loaded)
    if (tab === "mercy") setContext("console-mercy");
    else context = contextByTab[tab] || { screen: null, detail: null };
    const laptopFrame = el("laptop-frame");
    if (tab === "laptop" && !laptopFrame.src) {
      // the laptop iframe is lazy: replay the gates once it has actually loaded,
      // because anything pushed before that is lost with the blank document
      laptopFrame.addEventListener("load", () => pushGates(laptopFrame));
      laptopFrame.src = LAPTOP_URL;
    }
    const mapFrame = el("map-frame");
    if (tab === "map" && !mapFrame.src) mapFrame.src = MAP_URL;
    if (tab === "mercy") {
      loadState();
      loadEvidenceCount();
      loadTranscript();
      mountPicker(); // FULL / DELTA / VERIFY, decided by what changed while you were away
    } else {
      unmountPicker(); // discoveries made on the other tabs wait for the DELTA pass on return
    }
  }

  // --------------------------------------------------------- full screen
  // The whole case plays full screen, not just the lobby's film. The tabs,
  // the laptop and the map all live inside this document, so one request on
  // the root element covers the game and survives every tab switch -- there
  // is nothing to re-request when they move between them.
  // The API only answers from inside a real gesture, so the first click or
  // keypress of the game is what takes the screen. Escape is the
  // participant's own decision and it is remembered per player: the chamber
  // asks once, and never grabs the screen back from under them.
  const FS_ROOT = document.documentElement;
  const FS_REQ = FS_ROOT.requestFullscreen || FS_ROOT.webkitRequestFullscreen || null;
  const FS_API = !!FS_REQ && document.fullscreenEnabled !== false;
  let FS_KEY = null; // set by loadMe, namespaced per participant like the rest
  const inFullScreen = () => !!(document.fullscreenElement || document.webkitFullscreenElement);
  function fsWanted() {
    try {
      return !FS_KEY || localStorage.getItem(FS_KEY) !== "0";
    } catch (e) {
      return true; // private mode: the first gesture still tries, nothing is remembered
    }
  }
  function rememberFs(on) {
    try {
      if (FS_KEY) localStorage.setItem(FS_KEY, on ? "1" : "0");
    } catch (e) {
      /* private mode: it offers itself again next load, which is the lesser harm */
    }
  }
  function goFullScreen() {
    if (!FS_API || inFullScreen()) return;
    try {
      const p = FS_REQ.call(FS_ROOT, { navigationUI: "hide" });
      if (p && p.catch) p.catch(() => {}); // refused (no gesture, or a policy): the button is the way in
    } catch (e) {
      /* an older prefixed signature that dislikes the options object: the button still works */
    }
  }
  function initFullScreen() {
    const btn = el("fs-btn");
    if (!FS_API || !btn) return; // no API: the control never appears at all
    const sync = () => (btn.hidden = inFullScreen());
    sync();
    btn.addEventListener("click", () => {
      rememberFs(true);
      goFullScreen();
    });
    ["fullscreenchange", "webkitfullscreenchange"].forEach((evt) =>
      document.addEventListener(evt, () => {
        rememberFs(inFullScreen()); // Escape means they want out, and it sticks
        sync();
      })
    );
    // the first gesture of the game takes the screen. Capture, because
    // handlers below stop propagation; once, because asking twice is nagging.
    const arm = () => {
      if (fsWanted()) goFullScreen();
    };
    document.addEventListener("pointerdown", arm, { capture: true, once: true });
    document.addEventListener("keydown", arm, { capture: true, once: true });
  }

  // ------------------------------------------------------- where they are
  // A steer is only worth points if it is aimed: "use the password hint" is
  // no use to someone already inside Quill, and "open Quill" is no use to
  // someone still on the login screen. Every app on the laptop and the map
  // posts the screen it is showing, on every change and once on load; this
  // tab remembers the latest and sends it with every ask. The MERCY tab is
  // this document's own, so it supplies that one itself.
  // The vocabulary is fixed by the contract -- an unknown key is not a new
  // screen, it is a bug somewhere, and it must not be sent to the engine as
  // if it meant something.
  const CONTEXT_LABEL = {
    "console-mercy": "the hearing",
    "laptop-boot": "the laptop, still booting",
    "laptop-lock": "the laptop's login screen",
    "laptop-desktop": "the laptop desktop",
    "laptop-app": "the app you have open",
    "map-idle": "the city map",
    "map-search": "the search you have running",
  };
  let context = { screen: null, detail: null }; // the latest screen reported
  const contextByTab = { laptop: null, map: null }; // replayed when that tab comes back
  function setContext(screen, detail, tab) {
    if (!Object.prototype.hasOwnProperty.call(CONTEXT_LABEL, String(screen))) return;
    const rec = { screen: String(screen), detail: detail == null || detail === "" ? null : String(detail).slice(0, 64) };
    if (tab) contextByTab[tab] = rec;
    // only the tab on screen owns the aim: the laptop's apps keep posting
    // while the map is open (both frames stay loaded), and a hint bought
    // over the map must not be a steer about Quill
    const active = document.querySelector(".tab-btn.active");
    if (!tab || !active || active.dataset.tab === tab) context = rec;
  }

  // ---------------------------------------------------- discovery listener
  // Every app on the laptop, and the City Map, posts this to window.top the
  // moment something with a real evidence id is actually shown on screen.
  // This tab is the top window regardless of how deeply nested the source
  // is (Loop inside Orbit inside the laptop's own window, for instance).
  window.addEventListener("message", (ev) => {
    if (!ev.data) return;
    // The laptop asks for the gates as soon as it boots (its iframe is lazy
    // and may have missed a push); answer only the laptop, only at its origin.
    if (ev.data.type === "mercy:gates?" && ev.origin === LAPTOP_URL) {
      if (ev.source) ev.source.postMessage({ type: "mercy:gates", gates: currentGates() }, LAPTOP_URL);
      return;
    }
    // The map ran the rescue: a drone search at one of Nikhil's stops found
    // her and the sequence has reached its final card. Only the map, only at
    // its origin -- this one closes the case.
    if (ev.data.type === "mercy:case-solved" && ev.origin === MAP_URL) {
      if (ev.data.evidence_id) caseSolved(ev.data.evidence_id);
      return;
    }
    // RETURN TO MERCY on the map's final card: the participant is done there
    if (ev.data.type === "mercy:return" && ev.origin === MAP_URL) {
      switchTab("mercy");
      showEnding();
      return;
    }
    // where they are standing, for the hint desk. Same exact-origin rule as
    // everything else on this channel: only the two frames this tab built.
    if (ev.data.type === "mercy:context") {
      if (ev.origin === LAPTOP_URL) setContext(ev.data.screen, ev.data.detail, "laptop");
      else if (ev.origin === MAP_URL) setContext(ev.data.screen, ev.data.detail, "map");
      return;
    }
    if (ev.data.type !== "mercy:evidence-seen" || !ev.data.evidence_id) return;
    api("/api/discovered", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ evidence_id: ev.data.evidence_id }) })
      .then((record) => {
        cache.set(record.evidence_id, record);
        loadEvidenceCount();
        if (picking) refreshSilently(record); // the open picker files it in place, no scan
        if (record.evidence_id === "SW-06") {
          // the band's voice memo, filed by the map's cave sweep: playing it
          // over there is what unlocks vehicle tracking
          showToast("CITY MAP · BAND MEMO RECOVERED · PLAY IT ON THE MAP");
          tabDot("map", true);
          loadState();
        }
      })
      .catch(() => {}); // not real evidence, or already known -- fine either way
  });

  // ------------------------------------------------------------- gates
  // What the engine has released to the laptop (today: the band's SOS trail,
  // unsealed by the_confession). The laptop never talks to the engine; this
  // tab pushes the flags into its iframe on every state change, replays them
  // when the iframe loads, and answers the laptop's own `mercy:gates?` ask.
  const currentGates = () => (lastState && lastState.gates) || { sos_released: false };
  function pushGates(frame) {
    frame = frame || el("laptop-frame");
    if (!frame || !frame.src || !frame.contentWindow) return; // not opened yet: the load replay covers it
    try {
      frame.contentWindow.postMessage({ type: "mercy:gates", gates: currentGates() }, LAPTOP_URL);
    } catch (e) {
      /* the frame is between documents -- the laptop's handshake will ask again */
    }
  }

  // ----------------------------------------------------------------- HUD
  function tweenDigits(target) {
    const node = el("guilt-percent");
    const from = shownGuilt == null ? target : shownGuilt;
    shownGuilt = target;
    if (from === target) {
      node.textContent = target.toFixed(1);
      return;
    }
    const start = performance.now();
    const dur = 1100;
    (function step(now) {
      const t = Math.min(1, (now - start) / dur);
      const eased = 1 - Math.pow(1 - t, 3);
      node.textContent = (from + (target - from) * eased).toFixed(1);
      if (t < 1) requestAnimationFrame(step);
    })(start);
  }
  function renderGauge(pct) {
    const p = Math.max(0, Math.min(100, pct)) / 100;
    const fill = el("gauge-fill");
    fill.style.strokeDasharray = String(GAUGE_ARC);
    fill.style.strokeDashoffset = String(GAUGE_ARC * (1 - p));
    el("gauge-needle").style.transform = `rotate(${225 + 270 * p}deg)`;
  }
  function renderState(state) {
    const was = shownGuilt; // where the standing stood before this payload
    const changed = shownGuilt != null && shownGuilt !== state.guilt_percent;
    // the clock ran out: the file is as closed as a rescue would make it,
    // only the other way. Checked before `concluded`, because an engine that
    // marks a timed-out case concluded must not raise the rescue's ending.
    const timedOut = isTimedOut(state);
    concluded = !!(state.concluded || timedOut);
    syncClock(state); // a /api/state that carries the deadline re-anchors the chip

    // gates: remember, push to the laptop, and cue the participant on the
    // false -> true flip only (a reload after the release stays quiet)
    const wasReleased = lastState ? !!(lastState.gates && lastState.gates.sos_released) : null;
    lastState = state;
    const released = !!(state.gates && state.gates.sos_released);
    pushGates();
    if (wasReleased === false && released) {
      showToast("PULSEFIT · SOS TRAIL RELEASED · CHECK THE LAPTOP");
      tabDot("laptop", true);
    }

    tweenDigits(state.guilt_percent);
    renderGauge(state.guilt_percent);
    el("pop-pct").textContent = `${state.guilt_percent}%`;
    el("cp-ticks").innerHTML = state.checkpoints.map((c) => `<span class="tick${c.hit ? " hit" : ""}"></span>`).join("");

    const hud = el("hud-guilt");
    hud.classList.toggle("calm", state.guilt_percent <= 10);
    if (changed) {
      hud.classList.remove("bump");
      void hud.offsetWidth; // restart the flicker even when it's already run once
      hud.classList.add("bump");
      // Every move of the standing goes to the middle, not only the ones
      // argued from this tab: the rescue takes it to zero, and a poll can
      // pick up a move made in another tab of the same session. A turn that
      // is about to announce itself carries MERCY's verdict with it, so
      // this one stands aside and lets that one play.
      if (!turnPending) playStanding(was, state.guilt_percent, state.guilt_percent - was, null);
    }

    // Checkpoints are story beats now, not steps on the meter: MERCY moves
    // the standing every turn and the checkpoint's own guilt_after no longer
    // describes anything that happened. The list says which beats have been
    // reached; the live standing is in the head of this same popover.
    el("cp-list").innerHTML = state.checkpoints
      .filter((c) => c.hit)
      .map((c) => `<div class="cp-row"><span>${escapeHtml(c.label)}</span><span class="cp-mark">REACHED</span></div>`)
      .join("");
    el("verdict-concluded").hidden = !concluded;
    el("send-btn").disabled = concluded;
    el("evidence-btn").disabled = concluded;
    // the hint desk rides on the same state: the engine owns the purse
    if (state.hint_target !== undefined) hintTarget = state.hint_target || null;
    if (Number.isFinite(Number(state.hints_used))) hintsUsed = Number(state.hints_used);
    if (Number.isFinite(Number(state.points))) setPoints(Number(state.points));
    else renderTiers(); // hints_used may have moved even where points did not
    el("hint-toggle").disabled = concluded;
    el("hint-btn").disabled = concluded;
    if (concluded) {
      closeHintDesk();
      disarmNav();
    }
    const textEl = el("composer-text");
    textEl.disabled = concluded;
    textEl.placeholder = timedOut ? "Time is up. The file stands." : state.concluded ? "The file is closed." : "Tell MERCY why the file is wrong...";
    setLeaveMode(concluded);
    // the ending plays once, whichever way the case closed -- the rescue on
    // the map, or MAP-FOUND argued here -- and a reload after that stays
    // quiet. A case that is open again was reset: last game's key goes.
    // Time running out has its own card, and a participant who already left
    // (from another tab, say) has a result page waiting.
    if (timedOut) showExpired(state.guilt_percent);
    else if (state.outcome === "left") toLobby("/done");
    else if (state.concluded) showEnding(state.guilt_percent);
    else { endingDismissed = false; try { if (ENDING_KEY) localStorage.removeItem(ENDING_KEY); } catch (e) { /* nothing to forget */ } }
  }
  async function loadState() {
    try {
      renderState(await api("/api/state"));
    } catch (e) {
      /* mercy-engine not reachable yet -- leave the last known state on screen */
    }
  }
  async function loadEvidenceCount() {
    try {
      const n = (await api("/api/discovered?q=")).evidence.length;
      el("evidence-count").textContent = String(n).padStart(2, "0");
    } catch (e) {
      /* same as above */
    }
  }

  // --------------------------------------------------------------- clock
  // Sixty minutes from the lobby's "Accept & continue". The engine
  // owns the deadline (/api/me at the gate, then any /api/me or /api/state
  // that carries it); between polls the chip recomputes from Date.now()
  // every second, so a slow poll never makes it stutter, and every poll
  // re-anchors it. A `time_left_s` beats the ISO deadline when both come,
  // because the participant's laptop clock may be minutes off the server's;
  // the difference is remembered, so a payload with only the deadline still
  // lands on the same second.
  let me = null; // the participant, from /api/me at the gate
  let deadlineMs = null; // local-clock ms at which the file closes; null until the lobby starts the clock
  let skewMs = 0; // the server's clock minus this one, learned where both fields come
  let clockZeroed = false; // the local count hit 0: poll fast until the engine says so too
  let lastPollAt = 0;
  const POLL_MS = 15000;
  const ZERO_POLL_MS = 3000;
  let frozenLeft = null; // the seconds that were left when the file closed: the chip stops there
  function syncClock(payload) {
    if (!payload || typeof payload !== "object" || leaving) return;
    const left = payload.time_left_s == null ? NaN : Number(payload.time_left_s);
    // a closed file (solved, left, timed out) does not count down any more; a
    // reset game (open again, no outcome) starts counting again
    if (payload.concluded || payload.outcome) frozenLeft = Number.isFinite(left) ? Math.max(0, left) : (frozenLeft == null ? 0 : frozenLeft);
    else if (payload.concluded === false && !payload.outcome) frozenLeft = null;
    const at = payload.deadline ? Date.parse(payload.deadline) : NaN;
    if (Number.isFinite(left) && Number.isFinite(at)) skewMs = at - (Date.now() + left * 1000);
    if (Number.isFinite(left)) deadlineMs = Date.now() + Math.max(0, left) * 1000;
    else if (Number.isFinite(at)) deadlineMs = at - skewMs;
    tickClock();
  }
  function tickClock() {
    const node = el("hud-clock");
    if (!node || leaving) return;
    if (deadlineMs == null) {
      node.textContent = "--:--";
      node.classList.remove("low", "up");
      return;
    }
    const left = frozenLeft != null ? Math.ceil(frozenLeft) : Math.max(0, Math.ceil((deadlineMs - Date.now()) / 1000));
    node.classList.toggle("low", left > 0 && left < 300);
    node.classList.toggle("up", left === 0);
    node.textContent = left === 0 ? "TIME'S UP" : `${String(Math.floor(left / 60)).padStart(2, "0")}:${String(left % 60).padStart(2, "0")}`;
    if (frozenLeft != null) return;
    if (left === 0 && !concluded && ready) {
      // the engine decides when the file closes, not this tab's clock: ask
      // it now, then keep asking until the answer is timeout
      if (!clockZeroed || Date.now() - lastPollAt > ZERO_POLL_MS) pollState();
      clockZeroed = true;
    }
  }
  let ready = false; // init has drawn the console: the clock may poll on its own from here
  // Timeout wins over `concluded` (an engine may mark a timed-out file
  // concluded), but never over a rescue that happened to land at the buzzer.
  const isTimedOut = (state) => state.outcome === "timeout" || (!!state.expired && state.outcome !== "solved" && state.outcome !== "left");
  // The gate's record, again: a clock this tab has not seen yet, or a
  // session the engine has since forgotten (401 -> the lobby, from api()).
  async function loadMe() {
    let rec;
    try {
      rec = await api("/api/me");
    } catch (e) {
      return false; // the engine is not reachable: the next poll asks again
    }
    me = rec;
    if (!me.started_at) return toLobby(); // the briefing has not been accepted
    ENDING_KEY = "mercy-ending-shown:" + me.id;
    // the same namespacing for everything this browser remembers about a
    // participant: fifty of them may share one machine at the event
    TOUR_KEY = "mercy-tour-done:" + me.id;
    FS_KEY = "mercy-fullscreen:" + me.id;
    if (HINT_KEY !== "mercy-hints:" + me.id) {
      HINT_KEY = "mercy-hints:" + me.id;
      boughtHints = readHints();
    }
    syncClock(me);
    return true;
  }
  // Both records each time: /api/me is the one that says the clock was
  // taken away (an admin restart puts started_at back to null), and
  // /api/state is the one the hearing is drawn from.
  let polling = false;
  async function pollState() {
    if (polling || leaving) return;
    polling = true;
    lastPollAt = Date.now();
    try {
      await loadMe();
      await loadState();
      verdictFromMe();
    } finally {
      polling = false;
    }
  }
  // /api/me carries the outcome as well: an /api/state that stops short of
  // it still ends the game here, through the same render as everything else
  function verdictFromMe() {
    if (!me || !lastState || concluded) return;
    if (!isTimedOut(me) && me.outcome !== "left") return;
    const pct = Number(me.guilt_percent);
    renderState({ ...lastState, expired: !!me.expired, outcome: me.outcome, guilt_percent: Number.isFinite(pct) ? pct : lastState.guilt_percent });
  }
  function initClock() {
    setInterval(tickClock, 1000);
    setInterval(pollState, POLL_MS);
    // a tab that was in the background missed its ticks and maybe an expiry
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState !== "visible") return;
      tickClock();
      pollState();
    });
  }

  // ------------------------------------------------------------ evidence
  // Content-first: the app name is carried by the picker's subsection header
  // and the tray chip's dot, so the title can be what the thing actually says.
  const clip = (s, n) => (s && s.length > n ? s.slice(0, n).trimEnd() + "…" : s || "");
  function titleOf(record) {
    const c = record.content || {};
    switch (record.service) {
      case "haven":
        return c.title || (record.summary || "").split(":")[0];
      case "social-media":
        if (record.type === "post") return clip(c.caption, 46) || "Post";
        if (record.type === "comment") return clip(c.body, 46) || "Comment";
        return clip(c.body, 46) || "Message";
      case "email":
        return c.subject || "(no subject)";
      case "whatsapp":
        return clip(c.body, 46) || (c.deleted ? "Deleted message" : "Message");
      case "city-map":
        return clip(c.result, 46) || (c.found ? "Drone search -- found" : "Drone search -- no trace");
      case "desktop-shell":
        return clip(c.caption, 46) || "Photo";
      case "case-files":
        return clip(c.caption, 46) || "Case file page";
      case "smartwatch":
        if (record.type === "sos_alert") return `SOS ${c.seq}/5 · ${c.place}`;
        if (record.type === "voice_recording") return 'Band voice memo, 02:15 -- "It\'s Nikhil."';
        return clip(record.summary, 46) || record.evidence_id;
      default:
        return record.evidence_id;
    }
  }
  function badgeHtml(record) {
    const c = record.content || {};
    const thumb = rehost(c.image_url || (record.service === "haven" ? c.poster_url : null));
    if (thumb) return `<div class="pr-badge${record.service === "haven" ? " play" : ""}"><img src="${escapeHtml(thumb)}" alt="" /></div>`;
    const label = SERVICE_LABEL[record.service] ? SERVICE_LABEL[record.service][0] : "?";
    return `<div class="pr-badge src-${escapeHtml(record.service)}">${label}</div>`;
  }
  // A drone search's contact sheet: the frames city-map attached to the
  // search (aerial / thermal / ground / detail), each 16:9 with its kind
  // overlaid and the caption on hover; a click opens the full frame in a new
  // tab. One frame fills the width, two sit side by side, three put the
  // first (the aerial pass) across the top, four make the 2x2. A record
  // filed without a sheet falls back to the single image_url thumb.
  function droneSheetHtml(c) {
    const photos = (Array.isArray(c.photos) ? c.photos : []).filter((p) => p && typeof p.url === "string").slice(0, 4);
    if (!photos.length) return c.image_url ? `<img src="${escapeHtml(rehost(c.image_url))}" alt="" loading="lazy" />` : "";
    const tiles = photos
      .map((p) => {
        const kind = String(p.kind || "frame").toLowerCase();
        const cap = escapeHtml(p.caption || "");
        const url = escapeHtml(rehost(p.url));
        return `<a class="ds-tile" href="${url}" target="_blank" rel="noopener" title="${cap}"><img src="${url}" alt="${cap}" loading="lazy" /><span class="ds-kind k-${escapeHtml(kind)}">${escapeHtml(kind.toUpperCase())}</span></a>`;
      })
      .join("");
    return `<div class="drone-sheet n${photos.length}">${tiles}</div>`;
  }
  function evidenceCardHtml(record) {
    const c = record.content || {};
    let media = "";
    let audio = ""; // the band memo: sits inside the body, the transcript printed under it
    let text = record.summary || "";
    if (record.service === "smartwatch") {
      if (c.image_url) media = `<img src="${escapeHtml(rehost(c.image_url))}" alt="" loading="lazy" />`;
      if (c.audio_url) audio = `<audio controls preload="metadata" src="${escapeHtml(rehost(c.audio_url))}"></audio>`;
      text = c.transcript || `${c.time_label} -- ${c.place} · ${c.lat}, ${c.lng} (±${c.accuracy_m} m)`;
    } else if (record.service === "haven") {
      media = c.video_url ? `<video controls preload="metadata"${c.poster_url ? ` poster="${escapeHtml(rehost(c.poster_url))}"` : ""} src="${escapeHtml(rehost(c.video_url))}"></video>` : "";
      text = c.transcript || text;
    } else if (record.service === "social-media") {
      if (c.image_url) media = `<img src="${escapeHtml(rehost(c.image_url))}" alt="" loading="lazy" />`;
      text = c.caption || c.body || text;
    } else if (record.service === "whatsapp") {
      text = c.body || text;
    } else if (record.service === "email") {
      text = (c.subject ? c.subject + " -- " : "") + (c.body || "");
    } else if (record.service === "city-map") {
      media = droneSheetHtml(c);
      text = c.result || text;
    } else if (record.service === "case-files" || record.service === "desktop-shell") {
      if (c.image_url) media = `<img src="${escapeHtml(rehost(c.image_url))}" alt="" loading="lazy" />`;
      text = c.body ? (c.caption ? c.caption + "\n" : "") + c.body : c.caption || text;
    }
    const link = c.url && record.type === "document" ? `<a class="evi-link" href="${escapeHtml(rehost(c.url))}" target="_blank" rel="noopener">Open the document</a>` : "";
    return `<div class="evi-card" data-id="${escapeHtml(record.evidence_id)}">${media}<div class="evi-body"><span class="evi-source src-${escapeHtml(record.service)}">${SERVICE_LABEL[record.service] || escapeHtml(record.service)}</span>${audio}<div class="evi-text">${escapeHtml(text)}</div>${link}<div class="evi-id">${escapeHtml(record.evidence_id)}</div></div></div>`;
  }

  // -------------------------------------------------------------- picker
  // MERCY's picker behaves like a triage suite over the seized devices. On
  // the first open of a page-load it MOUNTs the sources the participant has
  // actually produced evidence from, ENUMERATEs each with a real count while
  // a scanline crosses a stage of source tiles, INDEXes the set (a real
  // digest), CATEGORISEs it, then lifts to reveal a section tree with a
  // per-app subsection inside every section. Every number on screen comes
  // from the /api/discovered response; only the pacing is theatre.
  //   - re-open, nothing changed  -> instant tree + a 360ms VERIFY line
  //   - re-open, set grew         -> short DELTA pass naming only what grew
  //   - typing                    -> instant client filter; one beam per query
  //   - a discovery while open    -> one "+ ID INDEXED" line, never a scan
  // Sources with zero discovered records are never named or tiled, so the
  // mechanism cannot hint at where undiscovered evidence lives.
  const SOURCE_ORDER = ["desktop-shell", "smartwatch", "social-media", "whatsapp", "email", "haven", "case-files", "city-map"];
  const SOURCE_HUD = { "desktop-shell": "LAPTOP", smartwatch: "PULSEFIT", "social-media": "LOOP", whatsapp: "WISP", email: "QUILL", haven: "HAVEN", "case-files": "CASE FILE", "city-map": "CITY MAP" };
  const SECTION_ORDER = ["photos", "video", "messages", "files", "searches", "other"];
  const SECTION_LABEL = { photos: "PHOTOS", video: "VIDEO", messages: "MESSAGES", files: "FILES", searches: "SEARCHES", other: "OTHER" };
  const SECTION_ICON = {
    photos: '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="1.5" y="2.5" width="13" height="11" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M3 11l3.2-3.4 2.4 2.4 1.8-1.8L13 11" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><circle cx="10.8" cy="5.8" r="1.1" fill="currentColor"/></svg>',
    video: '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="1.5" y="2.5" width="13" height="11" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M6.5 5.5v5l4-2.5z" fill="currentColor"/></svg>',
    messages: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 3.5A1.5 1.5 0 0 1 3.5 2h9A1.5 1.5 0 0 1 14 3.5v6A1.5 1.5 0 0 1 12.5 11H7l-3.5 3v-3H3.5A1.5 1.5 0 0 1 2 9.5z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>',
    files: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 1.5h6l3 3v10h-9z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M9.5 1.5v3h3M5.5 8h5M5.5 11h5" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>',
    searches: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="4.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M8 1v2.5M8 12.5V15M1 8h2.5M12.5 8H15" stroke="currentColor" stroke-width="1.8"/></svg>',
    other: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M6 6.2a2 2 0 1 1 2.8 1.8c-.6.3-.8.7-.8 1.3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="8" cy="11.6" r=".9" fill="currentColor"/></svg>',
  };
  const REDUCED = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const MS = { mount: 320, mountDelta: 240, enum: 120, index: 260, indexDelta: 200, categorise: 220, lift: 120, verify: 360, lookup: 320, refreshHold: 1800, slow: 1400, dead: 4000, debounce: 240 };
  if (REDUCED) ["mount", "mountDelta", "enum", "index", "indexDelta", "categorise", "lift", "verify", "lookup"].forEach((k) => (MS[k] = 0));

  const pk = {
    all: [], // the full q='' set, newest discovery first
    q: "", // the last settled query (lowercased)
    filter: "all",
    lastDigest: null,
    lastCounts: {},
    indexTotal: 0,
    seq: 0, // fetch ordering guard: a response older than the latest request is dropped
    token: 0, // bumped on open/close/fail; every timer and continuation checks it
    scanning: false,
    pendingRefresh: null,
    pendingSettle: null,
    newIds: new Set(),
    renderedIds: new Set(),
    lastSweptQ: null,
    lastSweepAt: 0,
    openedAt: 0,
    burst: 0,
    holdT: null,
    timers: [],
    raf: 0,
  };
  const STALE = Symbol("stale");
  let searchTimer = null;

  const hhmmss = () => new Date().toTimeString().slice(0, 8);
  const clip24 = (q) => (q.length > 24 ? q.slice(0, 24) + "…" : q);
  const fmtDur = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "S"}`;
  const hud = (s) => SOURCE_HUD[s] || String(s).toUpperCase();
  const countsOf = (records) => records.reduce((m, r) => ((m[r.service] = (m[r.service] || 0) + 1), m), {});
  const sourcesOf = (counts) => SOURCE_ORDER.filter((s) => counts[s]).concat(Object.keys(counts).filter((s) => !SOURCE_ORDER.includes(s)).sort());
  const idsOf = (records) => records.map((r) => r.evidence_id).join("\n");

  function wait(ms) {
    const tok = pk.token;
    return new Promise((resolve) => {
      const t = setTimeout(() => resolve(tok === pk.token), ms);
      pk.timers.push(t);
    });
  }
  function cancelAll() {
    pk.token++;
    pk.seq++;
    pk.timers.forEach(clearTimeout);
    pk.timers = [];
    cancelAnimationFrame(pk.raf);
    clearTimeout(searchTimer);
    stage.hideNow();
    peek.hideNow();
    const b = el("picker-sweep");
    b.hidden = true;
    b.className = "";
    el("picker-index").classList.remove("scanning", "two");
    pk.scanning = false;
    pk.pendingRefresh = null;
    pk.pendingSettle = null;
    pk.burst = 0;
  }

  // ---- classification
  function sectionOf(r) {
    const c = r.content || {};
    if (r.type === "photo" || (r.service === "social-media" && r.type === "post" && c.image_url)) return "photos";
    if (r.type === "video_entry") return "video";
    if (r.type === "message" || r.type === "comment" || r.type === "email" || r.type === "draft" || (r.service === "social-media" && r.type === "post")) return "messages";
    if (r.type === "document_page" || r.type === "document") return "files";
    if (r.type === "drone_search" || r.type === "sos_alert") return "searches"; // a band fix is a place to sweep
    if (r.type === "voice_recording") return "messages"; // the band memo is her last message
    return "other";
  }
  function tagsOf(r, attached, isNew) {
    const c = r.content || {};
    const tags = [];
    if (r.service === "whatsapp") {
      if (c.deleted) tags.push(["DELETED", "deleted"]);
      else if (c.thread_kind === "group") tags.push(["GROUP"]);
    } else if (r.service === "social-media") {
      if (r.type === "message") tags.push(["DM"]);
      else if (r.type === "comment") tags.push(["COMMENT"]);
      else if (!c.image_url) tags.push(["POST"]);
    } else if (r.service === "email") {
      if (r.type === "draft") tags.push(["DRAFT"]);
      else if ((c.attachments || []).length) tags.push([`ATT·${c.attachments.length}`]);
    } else if (r.service === "haven") {
      tags.push([Number.isFinite(c.duration_seconds) && c.duration_seconds > 0 ? fmtDur(c.duration_seconds) : "ENTRY"]);
    } else if (r.service === "case-files") {
      tags.push([Number.isFinite(c.page) ? `PAGE ${c.page}` : "PAGE"]);
    } else if (r.service === "city-map") {
      // four outcomes since the SOS trail; records filed before `outcome`
      // existed carry only `found`
      const outcome = c.outcome || (c.found === true ? "found" : "clear");
      if (outcome === "found") tags.push(["FOUND", "hot"]);
      else if (outcome === "trace") tags.push(["TRACE", "hot"]);
      else if (outcome === "clue") tags.push(["CLUE", "hot"]);
      else tags.push(["NO TRACE"]);
    } else if (r.service === "smartwatch") {
      if (r.type === "sos_alert") tags.push([`SOS ${c.seq}/5`, "hot"]);
      else if (r.type === "voice_recording") tags.push(["VOICE", "hot"]);
    } else if (r.type === "document") {
      tags.push([c.url ? "PDF" : "TEXT"]);
    } else if (sectionOf(r) === "other") {
      tags.push(["FILE"]);
    }
    if (isNew) tags.push(["NEW", "hot"]);
    if (attached) tags.push(["ATTACHED", "hot"]);
    return tags;
  }
  // Mirrors the engine's predicate (evidence_id ILIKE '%q%' OR summary ILIKE
  // '%q%'). % and _ are wildcards there but literals here; the settle refetch
  // reconciles, server wins.
  const clientFilter = (records, ql) => (ql ? records.filter((r) => r.evidence_id.toLowerCase().includes(ql) || (r.summary || "").toLowerCase().includes(ql)) : records);
  function groupRecords(records) {
    const bySec = {};
    records.forEach((r) => {
      const s = sectionOf(r);
      (bySec[s] = bySec[s] || []).push(r);
    });
    return SECTION_ORDER.filter((k) => bySec[k]).map((k) => {
      const byService = {};
      bySec[k].forEach((r) => (byService[r.service] = byService[r.service] || []).push(r));
      const services = sourcesOf(byService);
      return { key: k, label: SECTION_LABEL[k], count: bySec[k].length, subs: services.map((s) => ({ service: s, label: SERVICE_LABEL[s] || s, count: byService[s].length, rows: byService[s] })) };
    });
  }
  async function digestOf(records) {
    const s = JSON.stringify(records.map((r) => [r.evidence_id, r.summary]).sort());
    if (window.isSecureContext && window.crypto && crypto.subtle) {
      try {
        const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
        return { hex8: Array.from(new Uint8Array(buf)).slice(0, 4).map((b) => b.toString(16).padStart(2, "0")).join(""), algo: "SHA-256" };
      } catch (e) {
        /* fall through */
      }
    }
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
    return { hex8: h.toString(16).padStart(8, "0"), algo: "INDEX" };
  }

  // ---- rendering
  function highlight(text, ql) {
    text = String(text == null ? "" : text);
    if (!ql) return escapeHtml(text);
    const lower = text.toLowerCase();
    const out = [];
    let i = 0;
    for (;;) {
      const j = lower.indexOf(ql, i);
      if (j < 0) break;
      out.push(escapeHtml(text.slice(i, j)), `<mark class="pk-hit">${escapeHtml(text.slice(j, j + ql.length))}</mark>`);
      i = j + ql.length;
    }
    out.push(escapeHtml(text.slice(i)));
    return out.join("");
  }
  function rowHtml(r, ql, inTray) {
    const attached = inTray.has(r.evidence_id);
    const tags = tagsOf(r, attached, pk.newIds.has(r.evidence_id))
      .map(([t, cls]) => `<span class="pr-tag${cls ? " " + cls : ""}">${escapeHtml(t)}</span>`)
      .join("");
    return `<div class="picker-row${attached ? " in-tray" : ""}" data-id="${escapeHtml(r.evidence_id)}" tabindex="-1" role="option" aria-selected="${attached}">${badgeHtml(r)}<div class="pr-main"><div class="pr-title">${highlight(titleOf(r), ql)}</div><div class="pr-snippet">${highlight(r.summary || "", ql)}</div></div><div class="pr-meta"><span class="pr-tags">${tags}</span><span class="pr-id">${highlight(r.evidence_id, ql)}</span></div></div>`;
  }
  function emptyBlock(kind, q) {
    if (kind === "none")
      return `<div class="picker-empty"><span class="pe-hud">NOTHING INDEXED YET</span>You haven't found anything to attach yet. Open something on Meera's laptop, or run a search on the City Map. Whatever you actually look at gets filed here.<div><button type="button" class="pe-btn" data-go="laptop">OPEN THE LAPTOP</button><button type="button" class="pe-btn" data-go="map">OPEN THE MAP</button></div></div>`;
    if (kind === "nomatch")
      return `<div class="picker-empty"><span class="pe-hud">NO MATCH · "${escapeHtml(clip24(q))}"</span>MERCY only searches what you've found. Try a word from the text, or an evidence id.<div><button type="button" class="pe-btn" data-act="clear">CLEAR</button></div></div>`;
    return `<div class="picker-empty"><span class="pe-hud">INDEX UNREACHABLE</span>MERCY couldn't reach the evidence index. Your discoveries are safe; try again in a moment.<div><button type="button" class="pe-btn" data-act="retry">RETRY</button></div></div>`;
  }
  // records: the set to draw. prefiltered=true means it is already the hit
  // list (a server response); otherwise the client predicate is applied.
  function renderTree(records, qRaw, animate, prefiltered) {
    const ql = (qRaw || "").trim().toLowerCase();
    const visible = prefiltered ? records : clientFilter(records, ql);
    const groups = groupRecords(visible);
    const box = el("picker-results");
    peek.hideNow(); // the rows it was aligned to are about to be replaced
    box.classList.toggle("no-anim", !animate);
    if (pk.filter !== "all" && !groups.some((g) => g.key === pk.filter)) pk.filter = "all";
    if (!pk.all.length && !visible.length) box.innerHTML = emptyBlock("none");
    else if (!visible.length) box.innerHTML = emptyBlock("nomatch", ql);
    else {
      const inTray = new Set(tray.map((t) => t.evidence_id));
      box.innerHTML = groups
        .map(
          (g, gi) =>
            `<section class="pk-sec" data-sec="${g.key}" style="--i:${gi}"${pk.filter !== "all" && pk.filter !== g.key ? " hidden" : ""}><div class="pk-sec-h">${SECTION_ICON[g.key]}<span>${g.label}</span><span class="rule"></span><span class="n">${g.count}</span></div>${g.subs
              .map((s) => `<div class="pk-sub"><div class="pk-sub-h"><span class="dot src-${escapeHtml(s.service)}"></span>${escapeHtml(s.label)}<span class="n">· ${s.count}</span></div>${s.rows.map((r) => rowHtml(r, ql, inTray)).join("")}</div>`)
              .join("")}</section>`,
        )
        .join("");
    }
    pk.renderedIds = new Set(visible.map((r) => r.evidence_id));
    renderChips(groups, visible.length);
    return groups;
  }
  function renderChips(groups, total) {
    const counts = {};
    groups.forEach((g) => (counts[g.key] = g.count));
    const chips = [["all", "ALL", total]].concat(SECTION_ORDER.filter((k) => k !== "other" || counts.other).map((k) => [k, SECTION_LABEL[k], counts[k] || 0]));
    el("picker-filters").innerHTML = chips
      .map(([k, label, n]) => `<button type="button" class="pk-chip${n === 0 ? " is-zero" : ""}" role="tab" data-sec="${k}" aria-pressed="${pk.filter === k}" tabindex="${pk.filter === k ? 0 : -1}">${label} ${n}</button>`)
      .join("");
  }
  function applyFilter(key) {
    pk.filter = key;
    el("picker-filters").querySelectorAll(".pk-chip").forEach((c) => {
      const on = c.dataset.sec === key;
      c.setAttribute("aria-pressed", String(on));
      c.tabIndex = on ? 0 : -1;
    });
    el("picker-results").querySelectorAll(".pk-sec").forEach((s) => (s.hidden = key !== "all" && s.dataset.sec !== key));
    el("picker-results").scrollTop = 0;
  }
  function syncRowsWithTray() {
    const inTray = new Set(tray.map((t) => t.evidence_id));
    const ql = el("picker-search").value.trim().toLowerCase();
    el("picker-results").querySelectorAll(".picker-row").forEach((row) => {
      const r = cache.get(row.dataset.id);
      const was = row.classList.contains("in-tray");
      if (r && was !== inTray.has(r.evidence_id)) {
        const active = row.classList.contains("is-active");
        row.outerHTML = rowHtml(r, ql, inTray);
        const fresh = el("picker-results").querySelector(`.picker-row[data-id="${CSS.escape(r.evidence_id)}"]`);
        if (fresh && active) fresh.classList.add("is-active");
        if (fresh && peek.id === r.evidence_id) peek.row = fresh; // the peek follows the re-rendered row
      }
    });
  }

  // ---- the strip
  const strip = {
    box: () => el("picker-index"),
    lines: () => el("picker-index").querySelector(".idx-lines"),
    bar: () => el("picker-index").querySelector(".idx-bar"),
    clear() {
      this.lines().innerHTML = "";
    },
    line(text, cls) {
      const L = this.lines();
      L.querySelectorAll(".idx-line.active").forEach((n) => n.classList.remove("active"));
      const d = document.createElement("div");
      d.className = "idx-line " + (cls || "active");
      d.innerHTML = `<span class="idx-t">${hhmmss()}</span><span class="idx-x"></span>`;
      d.querySelector(".idx-x").textContent = text;
      L.appendChild(d);
      L.scrollTop = L.scrollHeight;
      return d;
    },
    set(node, text, cls) {
      node.querySelector(".idx-x").textContent = text;
      if (cls) node.className = "idx-line " + cls;
    },
    setBar(v) {
      const b = this.bar();
      const i = b.querySelector("i");
      b.classList.remove("sweep", "done");
      i.style.transition = "";
      if (v === "sweep") b.classList.add("sweep");
      else if (v === "done") {
        b.classList.add("done");
        b.style.setProperty("--p", "100%");
      } else b.style.setProperty("--p", v + "%");
    },
    summary(text, cls) {
      this.box().classList.remove("scanning", "two");
      this.clear();
      this.setBar(0);
      return this.line(text, cls || "sum");
    },
    tick(line, n, ms, fmt) {
      const start = performance.now();
      const tok = pk.token;
      const x = line.querySelector(".idx-x");
      (function step(now) {
        if (tok !== pk.token || !line.classList.contains("active")) return;
        const t = ms ? Math.min(1, (now - start) / ms) : 1;
        x.textContent = fmt(Math.round(n * (1 - Math.pow(1 - t, 3))));
        if (t < 1) requestAnimationFrame(step);
      })(start);
    },
  };
  function indexSummary() {
    const k = sourcesOf(pk.lastCounts).length;
    return k ? `INDEX ${pk.lastDigest} · ${plural(pk.indexTotal, "ARTIFACT")} · ${plural(k, "SOURCE")} · ${hhmmss()}` : "INDEX EMPTY · 0 ARTIFACTS · NOTHING MOUNTED";
  }

  // ---- the stage
  const stage = {
    node: () => el("picker-scan"),
    show() {
      const n = this.node();
      n.classList.remove("out");
      n.querySelector(".scan-tiles").innerHTML = "";
      n.hidden = false;
      const t0 = performance.now();
      const clock = n.querySelector(".scan-clock");
      clock.textContent = "0.000s";
      const tick = () => {
        if (n.hidden) return;
        clock.textContent = ((performance.now() - t0) / 1000).toFixed(3) + "s";
        pk.raf = requestAnimationFrame(tick);
      };
      pk.raf = requestAnimationFrame(tick);
    },
    tiles(services) {
      this.node().querySelector(".scan-tiles").innerHTML = services
        .map((s, i) => `<div class="scan-tile" data-service="${escapeHtml(s)}" style="--i:${i}"><span class="st-label">${escapeHtml(hud(s))}</span><span class="st-count pending">··</span></div>`)
        .join("");
    },
    light(service, n) {
      const t = this.node().querySelector(`.scan-tile[data-service="${CSS.escape(service)}"]`);
      if (!t) return;
      t.classList.add("lit");
      const c = t.querySelector(".st-count");
      c.classList.remove("pending");
      c.textContent = String(n).padStart(2, "0");
    },
    freeze() {
      cancelAnimationFrame(pk.raf);
    },
    hide() {
      const n = this.node();
      this.freeze();
      n.classList.add("out");
      const t = setTimeout(() => {
        n.hidden = true;
        n.classList.remove("out");
      }, MS.lift);
      pk.timers.push(t);
    },
    hideNow() {
      const n = this.node();
      this.freeze();
      n.hidden = true;
      n.classList.remove("out");
    },
  };
  function beam(cls, ms) {
    if (REDUCED) return;
    const b = el("picker-sweep");
    const body = el("picker-body");
    body.style.setProperty("--sweep-h", body.clientHeight + "px");
    b.className = "";
    b.hidden = false;
    void b.offsetWidth;
    if (ms) b.style.setProperty("--beam-ms", ms + "ms");
    b.classList.add(cls);
    const done = () => {
      b.hidden = true;
      b.className = "";
      b.removeEventListener("animationend", done);
    };
    b.addEventListener("animationend", done);
  }

  // ---- fetching
  async function fetchDiscovered(q) {
    const mySeq = ++pk.seq;
    const res = await api(`/api/discovered?q=${encodeURIComponent(q)}`);
    if (mySeq !== pk.seq) throw STALE;
    const records = res.evidence.slice().reverse(); // engine returns discovered_at ASC; newest first here
    records.forEach((r) => cache.set(r.evidence_id, r));
    return records;
  }

  // ---- mount / unmount
  // The index is a permanent panel beside the hearing on wide screens and a
  // slide-over on narrow ones. It "mounts" whenever the MERCY tab is shown:
  // the pass that plays (FULL / DELTA / VERIFY) is decided by the response.
  const isNarrow = () => window.matchMedia("(max-width: 880px)").matches;
  function mountPicker() {
    if (concluded) return;
    if (isNarrow() && !el("evidence-panel").classList.contains("open")) return;
    cancelAll();
    picking = true;
    pk.q = ""; // the strip re-narrates from the index; the typed query stays and filters the tree that lands
    if (pk.all.length) renderTree(pk.all, el("picker-search").value, false); // stale-while-revalidate: instant
    else {
      el("picker-results").innerHTML = "";
      el("picker-filters").innerHTML = "";
    }
    startOpenFetch();
  }
  function unmountPicker() {
    cancelAll();
    picking = false;
  }
  function openPicker() {
    // narrow screens: the + Evidence button raises the slide-over
    if (isNarrow()) {
      el("evidence-panel").classList.add("open");
      mountPicker();
      el("picker-search").focus();
      return;
    }
    // wide screens: the panel is already there -- draw the eye to it
    const panel = el("picker");
    panel.classList.remove("attn");
    void panel.offsetWidth;
    panel.classList.add("attn");
    el("picker-search").focus();
  }
  function startOpenFetch() {
    const tok = pk.token;
    pk.openedAt = performance.now();
    strip.box().classList.remove("scanning", "two");
    strip.clear();
    const mount = strip.line("MOUNTING SEIZED SOURCES");
    strip.setBar("sweep");
    const slowT = setTimeout(() => tok === pk.token && strip.set(mount, "HOLDING · INDEX SLOW"), MS.slow);
    const deadT = setTimeout(() => tok === pk.token && failOpen(), MS.dead);
    pk.timers.push(slowT, deadT);
    fetchDiscovered("")
      .then((records) => {
        if (tok !== pk.token) return;
        clearTimeout(slowT);
        clearTimeout(deadT);
        return runOpenPass(records, mount);
      })
      .catch((e) => {
        if (e === STALE || tok !== pk.token) return;
        clearTimeout(slowT);
        clearTimeout(deadT);
        failOpen();
      });
  }
  function closePicker() {
    if (!isNarrow()) return; // the panel is part of the screen on wide layouts
    unmountPicker();
    el("evidence-panel").classList.remove("open");
    pk.newIds.clear();
  }
  function failOpen() {
    cancelAll();
    strip.summary("INDEX UNAVAILABLE · ENGINE NOT REACHABLE", "err");
    if (!pk.all.length) {
      el("picker-filters").innerHTML = "";
      el("picker-results").innerHTML = emptyBlock("error");
    } else {
      const tok = pk.token;
      pk.timers.push(setTimeout(() => tok === pk.token && strip.summary(indexSummary()), 3000));
    }
  }

  // ---- the passes
  async function runOpenPass(records, mount) {
    const tok = pk.token;
    const dg = await digestOf(records);
    if (tok !== pk.token) return;
    const counts = countsOf(records);
    const present = sourcesOf(counts);
    if (pk.lastDigest !== null && dg.hex8 === pk.lastDigest) return playVerify(records, dg, present, mount);
    const delta = pk.lastDigest !== null;
    const grown = delta ? present.filter((s) => counts[s] > (pk.lastCounts[s] || 0)) : present;
    return playPass(delta, records, dg, present, counts, grown, mount);
  }
  async function playPass(delta, records, dg, present, counts, grown, mount) {
    const tok = pk.token;
    const live = () => tok === pk.token;
    pk.scanning = true;
    peek.hideNow(); // a peek opened during the fetch must not outlive the tree the stage covers
    strip.box().classList.add("scanning");
    stage.show();
    const minMount = delta ? MS.mountDelta : MS.mount;
    const elapsed = performance.now() - pk.openedAt;
    if (elapsed < minMount && !(await wait(minMount - elapsed))) return;
    if (!live()) return;
    const k = present.length;
    strip.set(mount, `MOUNTED · ${plural(k, "SOURCE")}`, "ok");
    const list = delta ? grown : present;
    stage.tiles(list);

    if (list.length) {
      beam("pass1", Math.max(360, MS.enum * list.length));
      for (let i = 0; i < list.length; i++) {
        const s = list[i];
        const n = counts[s];
        const line = strip.line(`${hud(s)} · 0`);
        strip.tick(line, n, MS.enum, (v) => `${hud(s)} · ${v}`);
        if (!(await wait(MS.enum))) return;
        const d = n - (pk.lastCounts[s] || 0);
        strip.set(line, delta ? `${hud(s)} · +${d} NEW · ${plural(n, "ARTIFACT")}` : `${hud(s)} · ${plural(n, "ARTIFACT")}`, "ok");
        stage.light(s, n);
        strip.setBar(Math.round((60 * (i + 1)) / list.length));
      }
    }

    const idx = strip.line(`INDEXING ${plural(records.length, "ARTIFACT")}`);
    beam("pass2", 180);
    if (!(await wait(delta ? MS.indexDelta : MS.index))) return;
    strip.set(idx, `INDEXED · ${plural(records.length, "ARTIFACT")} · ${dg.algo} ${dg.hex8}`, "ok");
    strip.setBar(92);

    const cat = strip.line("CATEGORISING");
    const cnt = {};
    groupRecords(records).forEach((g) => (cnt[g.key] = g.count));
    if (!(await wait(MS.categorise))) return;
    strip.set(cat, `PHOTOS ${cnt.photos || 0} · VIDEO ${cnt.video || 0} · MESSAGES ${cnt.messages || 0} · FILES ${cnt.files || 0} · SEARCHES ${cnt.searches || 0}${cnt.other ? " · OTHER " + cnt.other : ""}`, "ok");
    strip.setBar("done");
    stage.freeze();

    // LIFT: the tree rises as the stage fades
    pk.all = records;
    pk.indexTotal = records.length;
    pk.lastDigest = dg.hex8;
    pk.lastCounts = counts;
    renderTree(pk.all, el("picker-search").value, true);
    el("picker-results").scrollTop = 0;
    stage.hide();
    if (!(await wait(MS.lift))) return;
    finishPass();
  }
  async function playVerify(records, dg, present, mount) {
    const tok = pk.token;
    stage.hideNow();
    strip.set(mount, `VERIFYING INDEX ${dg.hex8}`);
    const bar = strip.bar();
    bar.classList.remove("sweep", "done");
    const fill = bar.querySelector("i");
    fill.style.transition = `width ${MS.verify}ms linear`;
    requestAnimationFrame(() => bar.style.setProperty("--p", "100%"));
    if (idsOf(records) !== idsOf(pk.all)) renderTree(records, el("picker-search").value, false);
    pk.all = records;
    pk.indexTotal = records.length;
    pk.lastCounts = countsOf(records);
    if (!(await wait(MS.verify))) return;
    if (tok !== pk.token) return;
    pk.scanning = false;
    strip.summary(`INDEX ${dg.hex8} · ${plural(records.length, "ARTIFACT")} · ${plural(present.length, "SOURCE")} · UNCHANGED`);
    drainPending();
  }
  function finishPass() {
    pk.scanning = false;
    strip.summary(indexSummary());
    drainPending();
  }
  function drainPending() {
    if (pk.pendingRefresh) {
      const r = pk.pendingRefresh;
      pk.pendingRefresh = null;
      refreshSilently(r);
    }
    if (pk.pendingSettle != null) {
      const q = pk.pendingSettle;
      pk.pendingSettle = null;
      settleQuery(q);
    }
  }

  // ---- typing
  function onSearchInput(qRaw) {
    renderTree(pk.all, qRaw, false); // instant, client-side
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => settleQuery(qRaw), MS.debounce);
  }
  async function settleQuery(qRaw) {
    const q = qRaw.trim().toLowerCase();
    if (pk.scanning) {
      pk.pendingSettle = qRaw;
      return;
    }
    if (q === pk.q) return;
    pk.q = q;
    if (!q) {
      strip.summary(pk.lastDigest ? indexSummary() : "INDEX EMPTY · 0 ARTIFACTS · NOTHING MOUNTED");
      return;
    }
    const tok = pk.token;
    strip.summary(`QUERY "${clip24(q)}" · SCANNING ${plural(pk.indexTotal, "ARTIFACT")}`, "active");
    strip.setBar("sweep");
    const visible = clientFilter(pk.all, q);
    const now = performance.now();
    if (visible.length && q !== pk.lastSweptQ && now - pk.lastSweepAt >= 1000) {
      beam("query", MS.lookup);
      pk.lastSweptQ = q;
      pk.lastSweepAt = now;
    }
    let records = null;
    try {
      [records] = await Promise.all([fetchDiscovered(q), wait(MS.lookup)]);
    } catch (e) {
      if (e === STALE) return;
    }
    if (tok !== pk.token || pk.q !== q) return;
    if (records && idsOf(records) !== idsOf(visible)) renderTree(records, q, false, true);
    const m = records ? records.length : visible.length;
    strip.summary(`QUERY "${clip24(q)}" · ${plural(m, "HIT")} IN ${plural(pk.indexTotal, "ARTIFACT")}`);
  }

  // ---- a discovery while the picker is open
  async function refreshSilently(record) {
    if (pk.scanning) {
      pk.pendingRefresh = record;
      return;
    }
    const tok = pk.token;
    let records;
    try {
      records = await fetchDiscovered("");
    } catch (e) {
      return;
    }
    if (tok !== pk.token) return;
    const dg = await digestOf(records);
    if (tok !== pk.token) return;
    const before = pk.renderedIds;
    pk.newIds.add(record.evidence_id);
    pk.all = records;
    pk.indexTotal = records.length;
    pk.lastCounts = countsOf(records);
    pk.lastDigest = dg.hex8; // so the next open VERIFYs instead of re-announcing this
    const box = el("picker-results");
    const st = box.scrollTop;
    const qRaw = el("picker-search").value;
    renderTree(pk.all, qRaw, false);
    box.scrollTop = st;
    box.querySelectorAll(".picker-row").forEach((row) => {
      if (!before.has(row.dataset.id)) row.classList.add("pr-new");
    });
    const chip = el("picker-filters").querySelector(`.pk-chip[data-sec="${sectionOf(record)}"]`);
    if (chip) {
      chip.classList.remove("pulse");
      void chip.offsetWidth;
      chip.classList.add("pulse");
    }
    // the strip grows to two lines for a moment, then collapses to the new summary
    const inQuery = !pk.q || clientFilter([record], pk.q).length > 0;
    pk.burst++;
    const L = strip.lines();
    if (!pk.q) {
      L.innerHTML = "";
      strip.line(indexSummary(), "sum");
    }
    L.querySelectorAll(".idx-line.plus").forEach((n) => n.remove());
    strip.line(pk.burst > 3 ? `+ ${pk.burst} MORE INDEXED` : `+ ${record.evidence_id} · ${hud(record.service)} · INDEXED${inQuery ? "" : " · NOT IN QUERY"}`, "plus");
    strip.box().classList.add("two");
    if (pk.holdT) clearTimeout(pk.holdT);
    pk.holdT = setTimeout(() => {
      if (tok !== pk.token) return;
      pk.burst = 0;
      L.querySelectorAll(".idx-line.plus").forEach((n) => n.remove());
      strip.box().classList.remove("two");
    }, MS.refreshHold);
    pk.timers.push(pk.holdT);
  }

  // ---- the peek
  // A floating preview beside the index of whatever row the pointer (or the
  // keyboard) is resting on: the photo at full width, the mail laid out as
  // mail, the Haven entry actually playing. One element (#peek, at the end
  // of #panel-mercy), reused; the HTML is built once per record and
  // memoised; pointer-events: none so the row underneath still takes the
  // click. Never on the slide-over (<= 880px), never while a pass is running.
  const PEEK = { open: 220, grace: 60, gap: 14, pad: 12, transcript: 240 };
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const num = (v) => (v == null || v === "" ? NaN : Number(v));
  const p2 = (n) => String(n).padStart(2, "0");
  // "17 Sep, 22:41" (withYear: "17 Sep 2024, 22:41"); an unparseable stamp is shown as it came
  function stampOf(ts, withYear) {
    if (!ts) return "";
    const d = new Date(ts);
    if (isNaN(d.getTime())) return String(ts);
    return `${d.getDate()} ${MON[d.getMonth()]}${withYear ? " " + d.getFullYear() : ""}, ${p2(d.getHours())}:${p2(d.getMinutes())}`;
  }
  function fileNameOf(url) {
    const last = String(url || "").split(/[?#]/)[0].split("/").pop() || "";
    try {
      return decodeURIComponent(last);
    } catch (e) {
      return last;
    }
  }
  const peekHtmlCache = new Map(); // evidence_id -> { record, html }; the record identity is the invalidation key
  function peekHtml(record) {
    const hit = peekHtmlCache.get(record.evidence_id);
    if (hit && hit.record === record) return hit.html;
    const html = `<div class="peek-head"><span class="peek-src src-${escapeHtml(record.service)}">${escapeHtml(SERVICE_LABEL[record.service] || record.service)}</span><span class="peek-id">${escapeHtml(record.evidence_id)}</span><span class="peek-when">${escapeHtml(stampOf(record.timestamp))}</span></div><div class="peek-body">${peekBodyHtml(record)}</div>`;
    peekHtmlCache.set(record.evidence_id, { record, html });
    return html;
  }
  // Every string from a record goes through escapeHtml; media urls are
  // rehosted, then attribute-escaped. Markup literals here are the only
  // unescaped text.
  function peekBodyHtml(r) {
    const c = r.content || {};
    const who = (Array.isArray(r.involves) ? r.involves : []).filter(Boolean).map(String);
    const at = (u) => `@${escapeHtml(u)}`;
    const tag = (t, cls) => `<span class="peek-tag${cls ? " " + cls : ""}">${escapeHtml(t)}</span>`;
    const summary = r.summary ? `<p class="peek-sum">${escapeHtml(r.summary)}</p>` : "";
    const cap = c.caption ? `<p class="peek-cap">${escapeHtml(c.caption)}</p>` : "";
    const src = (url) => escapeHtml(rehost(url));
    const photo = (url, alt) => `<div class="peek-photo"><img src="${src(url)}" alt="${escapeHtml(alt || "")}" decoding="async" /></div>`;
    const list = (items) => {
      const rows = (Array.isArray(items) ? items : []).map((i) => (typeof i === "string" ? i : i && (i.label || i.name || i.caption)) || "").filter(Boolean);
      return rows.length ? `<ul class="peek-items">${rows.map((i) => `<li>${escapeHtml(i)}</li>`).join("")}</ul>` : "";
    };
    const dur = Number.isFinite(num(c.duration_seconds)) && num(c.duration_seconds) > 0 ? tag(fmtDur(Math.round(num(c.duration_seconds)))) : "";

    // a photograph: a laptop photo, a case-file page, a Loop post with a picture
    const isPhoto = r.type === "photo" || r.type === "document_page" || (r.service === "social-media" && r.type === "post" && c.image_url);
    if (isPhoto && c.image_url) {
      let meta = "";
      if (r.type === "document_page") meta = `<div class="peek-meta">${tag(Number.isFinite(num(c.page)) ? `PAGE ${num(c.page)}` : "PAGE")}${Number.isFinite(num(c.exhibit)) ? tag(`EXHIBIT ${num(c.exhibit)}`) : ""}</div>`;
      else if (r.service === "social-media") meta = `<div class="peek-meta"><b class="peek-who">${at(who[0] || "?")}</b>${tag("POST")}</div>`;
      return `${photo(c.image_url, c.caption)}<div class="peek-text">${meta}${cap}${summary}</div>`;
    }

    switch (r.service) {
      case "social-media": {
        const kind = r.type === "comment" ? "COMMENT" : r.type === "message" ? "DM" : "POST";
        const ref = r.type === "comment" && c.parent_evidence_id ? `<span class="peek-ref">on ${escapeHtml(c.parent_evidence_id)}</span>` : "";
        return `<div class="peek-text"><div class="peek-meta"><b class="peek-who">${at(who[0] || "?")}</b>${tag(kind)}${ref}</div><div class="peek-bubble loop">${escapeHtml(c.caption || c.body || r.summary || "")}</div></div>`;
      }
      case "whatsapp": {
        const group = c.thread_kind === "group";
        const line = who.length ? who.map(at).join(group ? ", " : " &harr; ") : "";
        const strip = c.deleted ? `<div class="peek-strip">DELETED &mdash; RECOVERED</div>` : "";
        return `<div class="peek-text"><div class="peek-meta"><span class="peek-who">${line}</span>${tag(group ? "GROUP" : "DM")}</div>${strip}<div class="peek-bubble wisp">${escapeHtml(c.body || r.summary || "")}</div></div>`;
      }
      case "email": {
        const draft = r.type === "draft" || c.sent === false;
        const atts = (Array.isArray(c.attachments) ? c.attachments : []).filter((a) => a && (a.filename || a.name || a.url));
        const chips = atts.map((a) => `<span class="peek-att">${escapeHtml(a.filename || a.name || fileNameOf(a.url))}${a.size_label ? `<i>${escapeHtml(a.size_label)}</i>` : ""}</span>`).join("");
        const date = `${escapeHtml(stampOf(r.timestamp, true))}${draft ? `<em class="peek-draft">Draft &mdash; never sent</em>` : ""}`;
        return `<div class="peek-text peek-mail"><div class="peek-subject">${escapeHtml(c.subject || "(no subject)")}</div><dl class="peek-hdr"><dt>From</dt><dd>${who[0] ? at(who[0]) : "&mdash;"}</dd><dt>To</dt><dd>${who[1] ? at(who[1]) : "&mdash;"}</dd><dt>Date</dt><dd>${date}</dd></dl><hr class="peek-rule" /><div class="peek-mailbody">${escapeHtml(c.body || r.summary || "")}</div>${chips ? `<div class="peek-atts">${chips}</div>` : ""}</div>`;
      }
      case "haven": {
        if (r.type !== "video_entry") break;
        // src is set only when the peek opens (see peek.show) and cleared on close
        const media = c.video_url
          ? `<div class="peek-video"><video muted playsinline loop autoplay preload="none"${c.poster_url ? ` poster="${src(c.poster_url)}"` : ""} data-src="${src(c.video_url)}"></video></div>`
          : c.poster_url
            ? photo(c.poster_url, c.title)
            : "";
        const mood = c.mood ? tag(String(c.mood).toUpperCase(), "mood") : "";
        const device = c.device ? `<span class="peek-ref">${escapeHtml(c.device)}</span>` : "";
        const text = c.transcript ? `<p class="peek-transcript">${escapeHtml(clip(c.transcript, PEEK.transcript))}</p>` : summary;
        return `${media}<div class="peek-text"><b class="peek-title">${escapeHtml(c.title || r.summary || "Entry")}</b><div class="peek-meta">${mood}${dur}${device}</div>${text}</div>`;
      }
      case "city-map": {
        const outcome = c.outcome || (c.found === true ? "found" : "clear");
        const label = { found: "FOUND", trace: "TRACE", clue: "CLUE" }[outcome] || "NO TRACE";
        const photos = (Array.isArray(c.photos) ? c.photos : []).filter((p) => p && typeof p.url === "string").slice(0, 4);
        const tiles = photos
          .map((p) => {
            const kind = String(p.kind || "frame").toLowerCase();
            return `<div class="peek-tile"><img src="${src(p.url)}" alt="${escapeHtml(p.caption || "")}" decoding="async" /><span class="ds-kind k-${escapeHtml(kind)}">${escapeHtml(kind.toUpperCase())}</span></div>`;
          })
          .join("");
        const sheet = photos.length ? `<div class="peek-sheet n${photos.length}">${tiles}</div>` : c.image_url ? photo(c.image_url) : "";
        const lat = num(c.lat);
        const lng = num(c.lng);
        const coords = Number.isFinite(lat) && Number.isFinite(lng) ? `<span class="peek-coords">${lat.toFixed(6)}, ${lng.toFixed(6)}</span>` : "";
        return `<div class="peek-text"><div class="peek-meta">${tag(label, label === "NO TRACE" ? "" : "hot")}${coords}</div></div>${sheet}<div class="peek-text"><p class="peek-cap">${escapeHtml(c.result || r.summary || "")}</p>${list(c.items)}</div>`;
      }
      case "smartwatch": {
        if (r.type === "sos_alert") {
          const seq = num(c.seq);
          const of = num(c.of);
          const lat = num(c.lat);
          const lng = num(c.lng);
          const acc = num(c.accuracy_m);
          const hr = num(c.hr);
          const bat = num(c.battery);
          const fix = Number.isFinite(lat) && Number.isFinite(lng) ? `<div class="peek-coords">${lat.toFixed(6)}, ${lng.toFixed(6)}${Number.isFinite(acc) ? ` &plusmn;${acc} m` : ""}</div>` : "";
          const stat = (label, v, unit) => `<div class="peek-stat"><span>${label}</span><b>${Number.isFinite(v) ? v : "--"}</b><i>${unit}</i></div>`;
          return `<div class="peek-text"><div class="peek-band"><div class="peek-band-h"><span class="peek-sos">SOS ${Number.isFinite(seq) ? seq : "?"}/${Number.isFinite(of) ? of : 5}</span><span class="peek-band-t">${escapeHtml(c.time_label || "")}${c.next_day ? "<i>+1 day</i>" : ""}</span></div><div class="peek-band-place">${escapeHtml(c.place || "")}${c.district ? `<span> &middot; ${escapeHtml(c.district)}</span>` : ""}</div>${fix}<div class="peek-stats">${stat("HEART RATE", hr, "bpm")}${stat("BATTERY", bat, "%")}</div>${c.prior ? `<span class="peek-ref">prior &middot; ${escapeHtml(c.prior)}</span>` : ""}</div>${summary}</div>`;
        }
        if (r.type === "voice_recording") {
          const audio = c.audio_url ? `<audio controls preload="none" src="${src(c.audio_url)}"></audio>` : ""; // never autoplays
          const quote = c.transcript ? `<blockquote class="peek-quote">${escapeHtml(c.transcript)}</blockquote>` : summary;
          const items = list(c.items);
          return `${c.image_url ? photo(c.image_url, c.caption) : ""}<div class="peek-text"><div class="peek-meta">${tag("VOICE", "hot")}${c.time_label ? tag(c.time_label) : ""}${dur}</div>${audio}${quote}${cap}${items ? `<div class="peek-sub">FOUND WITH IT</div>${items}` : ""}</div>`;
        }
        break;
      }
      case "desktop-shell": {
        if (r.type !== "document") break;
        if (c.body) return `<div class="peek-text">${cap}<pre class="peek-mono">${escapeHtml(c.body)}</pre></div>`;
        const name = c.url ? `<span class="peek-ref">${escapeHtml(fileNameOf(c.url))}</span>` : "";
        return `<div class="peek-text">${cap}<div class="peek-meta">${tag("PDF")}<span class="peek-ref">PDF on the laptop</span>${name}</div>${summary}</div>`;
      }
    }
    return `<div class="peek-text">${summary || `<p class="peek-sum">${escapeHtml(r.evidence_id)}</p>`}</div>`;
  }

  const peek = {
    id: null, // evidence_id the peek is showing, or counting down to
    row: null, // its .picker-row (re-pointed when the tree re-renders that row)
    on: false, // visible
    viaKey: false, // opened by ArrowUp/Down: it follows the row on scroll instead of hiding
    snooze: null, // an id dismissed with Escape: not re-armed until the pointer leaves that row
    openT: null,
    hideT: null,
    raf: 0,
    node: () => el("peek"),
    ok() {
      return picking && !pk.scanning && !isNarrow();
    },
    // the pointer (or the keyboard) landed on a row: show it after `delay` ms
    arm(row, delay, viaKey) {
      if (!row || !this.ok()) return;
      const id = row.dataset.id;
      if (!id || (id === this.snooze && !viaKey)) return;
      clearTimeout(this.hideT);
      this.hideT = null;
      this.row = row;
      this.viaKey = !!viaKey;
      if (this.on && this.node()._id === id) {
        clearTimeout(this.openT); // back on the row it already shows: drop any retarget in flight
        this.openT = null;
        this.id = id;
        return;
      }
      if (id === this.id && this.openT && delay) return; // already counting down for it
      clearTimeout(this.openT);
      this.openT = null;
      this.id = id;
      if (delay) {
        this.openT = setTimeout(() => {
          this.openT = null;
          this.show();
        }, delay);
      } else this.show();
    },
    show() {
      const row = this.row;
      const record = row && row.isConnected && this.id ? cache.get(this.id) : null;
      if (!record || !this.ok()) return this.hideNow();
      const n = this.node();
      if (n._rec !== record) {
        this.stopMedia();
        n.innerHTML = peekHtml(record);
        n._id = record.evidence_id;
        n._rec = record;
        n.scrollTop = 0;
        const v = n.querySelector("video[data-src]");
        if (v) {
          v.muted = true;
          v.src = v.dataset.src;
          const p = v.play();
          if (p && typeof p.catch === "function") p.catch(() => {});
        }
      }
      n.hidden = false;
      this.on = true;
      this.refit();
    },
    refit() {
      cancelAnimationFrame(this.raf);
      this.raf = requestAnimationFrame(() => this.place());
    },
    // just right of the index, aligned to the row's top, kept inside #panel-mercy
    place() {
      const n = this.node();
      const row = this.row;
      if (!this.on) return;
      if (!row || !row.isConnected) return this.hideNow();
      const panel = el("panel-mercy").getBoundingClientRect();
      const side = el("evidence-panel").getBoundingClientRect();
      const box = el("picker-results").getBoundingClientRect();
      const rr = row.getBoundingClientRect();
      if (rr.bottom <= box.top || rr.top >= box.bottom) return this.hideNow(); // the row scrolled out of the tree
      const left = side.right - panel.left + PEEK.gap;
      n.style.left = `${Math.round(left)}px`;
      // floor: the tray/composer the participant types into; ceiling: the HUD
      // chips when the peek's column runs under them (narrow layouts)
      const trayEl = el("tray");
      const floorEl = trayEl && trayEl.children.length ? trayEl : el("composer");
      const floor = floorEl.getBoundingClientRect().top - panel.top - PEEK.pad;
      const hud = el("hud-left").getBoundingClientRect();
      const ceiling = hud.right - panel.left > left ? hud.bottom - panel.top + PEEK.pad : PEEK.pad;
      n.style.maxHeight = `${Math.max(160, Math.floor(floor - ceiling))}px`;
      const h = n.offsetHeight;
      const top = Math.max(ceiling, Math.min(rr.top - panel.top, floor - h));
      n.style.top = `${Math.round(top)}px`;
      n.classList.add("is-on");
    },
    onScroll() {
      if (this.on && this.viaKey) return this.refit();
      this.hideNow();
    },
    // mouseleave: `delay` is the grace so moving between rows does not flicker
    hide(delay) {
      clearTimeout(this.openT);
      clearTimeout(this.hideT);
      this.openT = this.hideT = null;
      if (!this.on) {
        this.id = null;
        this.row = null;
        return;
      }
      if (delay) this.hideT = setTimeout(() => this.hideNow(), delay);
      else this.hideNow();
    },
    hideNow(snooze) {
      clearTimeout(this.openT);
      clearTimeout(this.hideT);
      this.openT = this.hideT = null;
      cancelAnimationFrame(this.raf);
      this.snooze = snooze ? this.id : null;
      this.id = null;
      this.row = null;
      this.viaKey = false;
      this.on = false;
      const n = this.node();
      if (!n || (n.hidden && !n._rec)) return;
      this.stopMedia(); // pause and drop the src so nothing decodes behind a hidden peek
      n.classList.remove("is-on");
      n.hidden = true;
      n.innerHTML = "";
      n._id = null;
      n._rec = null;
    },
    stopMedia() {
      const n = this.node();
      if (!n) return;
      n.querySelectorAll("video, audio").forEach((m) => {
        try {
          m.pause();
          m.removeAttribute("src");
          m.load();
        } catch (e) {
          /* already gone */
        }
      });
    },
  };

  // ---- interaction
  function visibleRows() {
    return Array.from(el("picker-results").querySelectorAll(".pk-sec:not([hidden]) .picker-row"));
  }
  function setActiveRow(row) {
    el("picker-results").querySelectorAll(".picker-row.is-active").forEach((r) => r !== row && r.classList.remove("is-active"));
    if (row) row.classList.add("is-active");
  }
  function toggleRow(row) {
    const record = cache.get(row.dataset.id);
    if (!record) return;
    if (tray.some((t) => t.evidence_id === record.evidence_id)) removeFromTray(record.evidence_id);
    else addToTray(record);
  }
  function initPicker() {
    el("evidence-btn").addEventListener("click", () => (isNarrow() && el("evidence-panel").classList.contains("open") ? closePicker() : openPicker()));
    el("picker-close").addEventListener("click", closePicker);
    // crossing the breakpoint: the slide-over closes, the panel mounts (or the reverse)
    window.matchMedia("(max-width: 880px)").addEventListener("change", () => {
      el("evidence-panel").classList.remove("open");
      if (el("panel-mercy").classList.contains("active")) mountPicker();
    });
    el("picker-search").addEventListener("input", (e) => onSearchInput(e.target.value));
    const results = el("picker-results");
    results.addEventListener("click", (e) => {
      const go = e.target.closest("[data-go]");
      if (go) {
        closePicker();
        switchTab(go.dataset.go);
        return;
      }
      const act = e.target.closest("[data-act]");
      if (act) {
        if (act.dataset.act === "clear") {
          el("picker-search").value = "";
          onSearchInput("");
          el("picker-search").focus();
        } else if (act.dataset.act === "retry") {
          pk.token++;
          startOpenFetch();
        }
        return;
      }
      const row = e.target.closest(".picker-row");
      if (row) {
        setActiveRow(row);
        toggleRow(row);
      }
    });
    // Chrome re-dispatches mouseover/mouseout for whatever slides under a
    // parked pointer when the list scrolls (keyboard navigation), with the
    // last real coordinates and no mousemove. While the keyboard owns the
    // peek those replays must not hide or retarget it.
    let ptr = { x: NaN, y: NaN };
    const moved = (e) => {
      const m = e.clientX !== ptr.x || e.clientY !== ptr.y;
      ptr = { x: e.clientX, y: e.clientY };
      return m;
    };
    results.addEventListener("mousemove", (e) => {
      if (!moved(e)) return;
      const row = e.target.closest(".picker-row");
      if (!row) return;
      if (!row.classList.contains("is-active")) setActiveRow(row);
      peek.arm(row, PEEK.open); // also catches a tree re-rendered under a resting pointer (no mouseover fires)
    });
    // the peek: delegated, no listeners per row
    results.addEventListener("mouseover", (e) => {
      if (peek.viaKey && !moved(e)) return;
      const row = e.target.closest(".picker-row");
      if (row) peek.arm(row, PEEK.open);
    });
    results.addEventListener("mouseout", (e) => {
      if (peek.viaKey && !moved(e)) return;
      const row = e.target.closest(".picker-row");
      if (!row) return;
      if (e.relatedTarget && row.contains(e.relatedTarget)) return; // moved within the row
      peek.snooze = null;
      peek.hide(PEEK.grace);
    });
    // a keyboard-opened peek belongs to the focused row: drop it when focus leaves the index
    el("picker").addEventListener("focusout", (e) => {
      if (peek.viaKey && (!e.relatedTarget || !el("picker").contains(e.relatedTarget))) peek.hideNow();
    });
    results.addEventListener("scroll", () => peek.onScroll(), { passive: true });
    window.addEventListener("resize", () => peek.hideNow());
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") peek.hideNow(true); // wherever focus is; the row is not re-armed until the pointer leaves it
    });
    // an image or video that arrives after the first placement changes the height: re-clamp
    ["load", "loadedmetadata"].forEach((ev) => el("peek").addEventListener(ev, () => peek.on && peek.refit(), true));
    el("picker-filters").addEventListener("click", (e) => {
      const chip = e.target.closest(".pk-chip");
      if (chip) applyFilter(chip.dataset.sec);
    });
    el("picker").addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        if (isNarrow()) {
          closePicker();
          el("composer-text").focus();
        } else if (el("picker-search").value) {
          el("picker-search").value = "";
          onSearchInput("");
        } else {
          el("composer-text").focus();
        }
        return;
      }
      const chip = e.target.closest && e.target.closest(".pk-chip");
      if (chip && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
        e.preventDefault();
        const chips = Array.from(el("picker-filters").querySelectorAll(".pk-chip:not(.is-zero), .pk-chip[aria-pressed='true']"));
        const i = chips.indexOf(chip);
        const next = chips[(i + (e.key === "ArrowRight" ? 1 : chips.length - 1)) % chips.length];
        if (next) {
          applyFilter(next.dataset.sec);
          next.focus();
        }
        return;
      }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const rows = visibleRows();
        if (!rows.length) return;
        const cur = rows.findIndex((r) => r.classList.contains("is-active"));
        const next = e.key === "ArrowDown" ? Math.min(rows.length - 1, cur + 1) : Math.max(0, cur < 0 ? 0 : cur - 1);
        setActiveRow(rows[next]);
        rows[next].scrollIntoView({ block: "nearest" });
        peek.arm(rows[next], 0, true); // the keyboard opens it at once; Enter still toggles the row
        return;
      }
      if (e.key === "Enter" && e.target.id === "picker-search") {
        const active = el("picker-results").querySelector(".picker-row.is-active");
        if (active) {
          e.preventDefault();
          toggleRow(active);
        }
      }
    });
  }

  // ---------------------------------------------------------------- tray
  function addToTray(record) {
    if (tray.some((t) => t.evidence_id === record.evidence_id)) return;
    tray.push(record);
    renderTray();
  }
  function removeFromTray(id) {
    tray = tray.filter((t) => t.evidence_id !== id);
    renderTray();
  }
  function renderTray() {
    el("tray").innerHTML = tray
      .map((r) => `<div class="tray-chip"><span class="dot src-${escapeHtml(r.service)}"></span>${escapeHtml(titleOf(r))}<button type="button" data-id="${escapeHtml(r.evidence_id)}">&times;</button></div>`)
      .join("");
    el("tray").querySelectorAll("button").forEach((b) => b.addEventListener("click", () => removeFromTray(b.dataset.id)));
    if (picking) syncRowsWithTray();
  }

  // -------------------------------------------------------------- chat
  // MERCY's four verdicts, in the participant's words: the turn's own
  // feedback, so a rejected argument is not just a percentage that did not
  // move. `verdict` comes off the /api/argue response, nothing else.
  const VERDICT = {
    advanced: ["ADVANCED", "the file moved your way"],
    partial: ["PARTIAL", "some of it landed"],
    rejected: ["REJECTED", "nothing in that turn shifted the file"],
    contradicted: ["CONTRADICTED", "your own evidence worked against you"],
  };
  // `judgement` is whatever carries this turn's verdict and delta -- the
  // /api/argue response for a live turn, the transcript row for a replayed
  // one. Both spell them the same way, so both go in here unchanged.
  function turnNode(role, body, records, checkpointHit, judgement) {
    const wrap = document.createElement("div");
    wrap.className = `turn ${role === "mercy" ? "mercy" : "you"}${checkpointHit ? " checkpoint" : ""}`;
    const label = document.createElement("div");
    label.className = "turn-label";
    label.innerHTML = `<span class="dot"></span>${role === "mercy" ? "MERCY" : "YOU"}`;
    const verdict = judgement && judgement.verdict;
    if (role === "mercy" && VERDICT[verdict]) {
      const badge = document.createElement("span");
      badge.className = `verdict-badge v-${verdict}`;
      badge.textContent = VERDICT[verdict][0];
      badge.title = VERDICT[verdict][1];
      label.appendChild(badge);
    }
    // the move itself, beside the verdict: reading back the hearing shows
    // what each turn actually did to the standing, not just what it was told
    const moved = judgement ? Number(judgement.delta) : NaN;
    if (role === "mercy" && Number.isFinite(moved) && moved !== 0) {
      const mark = document.createElement("span");
      mark.className = `turn-delta ${moved > 0 ? "up" : "down"}`;
      mark.textContent = `${moved > 0 ? "+" : "-"}${Math.abs(moved).toFixed(1)}`;
      label.appendChild(mark);
    }
    wrap.appendChild(label);
    if (body) {
      const bubble = document.createElement("div");
      bubble.className = "bubble";
      if (role === "mercy") {
        // one <p> per blank-line-separated paragraph, so a checkpoint's
        // reaction (appended by the engine after "\n\n") reads as its own line
        const paras = String(body)
          .split(/\n\s*\n/)
          .filter((para) => para.trim());
        if (!paras.length) bubble.textContent = body;
        paras.forEach((para) => {
          const p = document.createElement("p");
          p.textContent = para;
          bubble.appendChild(p);
        });
      } else {
        bubble.textContent = body;
      }
      wrap.appendChild(bubble);
    }
    if (records && records.length) {
      const cards = document.createElement("div");
      cards.className = "turn-cards";
      cards.innerHTML = records.map(evidenceCardHtml).join("");
      wrap.appendChild(cards);
    }
    return wrap;
  }
  async function loadTranscript() {
    let turns;
    try {
      turns = (await api("/api/transcript")).transcript;
    } catch (e) {
      return;
    }
    const log = el("chat-log");
    log.innerHTML = turns.length
      ? ""
      : `<div class="empty-log"><b>The file stands at <em>96.8%</em>.</b>MERCY is waiting to hear why that's wrong. Find something on the laptop or the map, attach it, and say why it matters.</div>`;
    for (const t of turns) {
      const records = await Promise.all((t.evidence_ids || []).map(resolveCached));
      log.appendChild(turnNode(t.role, t.body, records.filter(Boolean), t.checkpoint_hit, t));
    }
    // The hints this participant paid for, replayed from their own store:
    // /api/transcript is MERCY's record of the hearing and carries none of
    // them, so a reload would otherwise lose what the points bought. The
    // accepted marks do go: MERCY's row files no evidence_ids, so only the
    // live turn knows which of the attachments she leaned on.
    boughtHints.forEach((h) => log.appendChild(hintNode(h)));
    log.scrollTop = log.scrollHeight;
  }

  async function sendArgument() {
    const textEl = el("composer-text");
    const text = textEl.value.trim();
    const ids = tray.map((t) => t.evidence_id);
    if (!text && !ids.length) return;

    el("send-btn").disabled = true;
    const log = el("chat-log");
    const emptyNotice = log.querySelector(".empty-log");
    if (emptyNotice) emptyNotice.remove();
    const yours = turnNode("you", text, tray, null);
    log.appendChild(yours);
    log.scrollTop = log.scrollHeight;
    textEl.value = "";
    textEl.style.height = "";
    textEl.classList.remove("tall");
    tray = [];
    renderTray();
    closePicker();

    try {
      const res = await api("/api/argue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, evidence_ids: ids }),
      });
      log.appendChild(turnNode("mercy", res.reply, null, res.checkpoint_hit, res));
      markAccepted(yours, res.accepted_ids);
      log.scrollTop = log.scrollHeight;
      if (Number.isFinite(Number(res.points))) setPoints(Number(res.points));
      // where the standing was BEFORE the engine's new one lands, because
      // that is what the centred meter counts away from
      const before = shownGuilt;
      turnPending = true; // this move is ours to play: renderState leaves it alone
      await loadState(); // the standing is the engine's, always -- the delta only says how far it moved
      announceTurn(res, before);
    } catch (e) {
      showToast(e.message || "MERCY did not respond.");
    } finally {
      turnPending = false; // a turn that never landed must not silence the next move
      el("send-btn").disabled = concluded;
    }
  }

  function showToast(msg) {
    const t = el("toast");
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(t._timer);
    t._timer = setTimeout(() => (t.hidden = true), 3200);
  }

  // ---------------------------------------------------------- the ending
  // The map found her and ran the rescue; the engine closes the case from
  // that search directly (no MAP-FOUND argument needed) and hands back
  // MERCY's closing line, which lands in the hearing the way a checkpoint
  // reply does after an argue. An engine that says the case is already
  // closed (the map replaying the message after a reload) is not an error:
  // the state is what it is, and the ending still shows if it hasn't.
  async function caseSolved(evidenceId) {
    let res = null;
    try {
      res = await api("/api/rescue", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ evidence_id: evidenceId }) });
    } catch (e) {
      if (!/closed|concluded|\(409\)/i.test(e.message || "")) {
        showToast(e.message || "MERCY did not respond.");
        return;
      }
    }
    if (res && res.reply) {
      const log = el("chat-log");
      const emptyNotice = log.querySelector(".empty-log");
      if (emptyNotice) emptyNotice.remove();
      log.appendChild(turnNode("mercy", res.reply, null, res.checkpoint_hit));
      log.scrollTop = log.scrollHeight;
    }
    await loadState(); // 0.0, calm, concluded -- and the ending, from renderState
    loadEvidenceCount();
    // a find that landed after the buzzer closed the file as a timeout: the
    // timeout branch of renderState has spoken, not this one
    if (lastState && lastState.outcome && lastState.outcome !== "solved") return;
    showToast("CASE CLOSED · MEERA RECOVERED");
    showEnding(res ? res.guilt_percent : undefined);
  }
  // Shown once. The key is written when the participant dismisses it, not
  // when it is raised, so a reload mid-fade shows it again rather than
  // losing the ending to a refresh. Namespaced by participant at the gate
  // (mercy-ending-shown:<id>): fifty people may share a machine, and one
  // participant's dismissed ending must not silence the next one's.
  let ENDING_KEY = null; // set by loadMe; null means nothing to read or write
  let endingDismissed = false; // this session, even where localStorage is off
  let endingPct = null;
  function endingShown() {
    try {
      return !!ENDING_KEY && localStorage.getItem(ENDING_KEY) === "1";
    } catch (e) {
      return false;
    }
  }
  function markEndingShown() {
    endingDismissed = true;
    try {
      if (ENDING_KEY) localStorage.setItem(ENDING_KEY, "1");
    } catch (e) {
      /* private mode: it will show again next load, which is the lesser harm */
    }
  }
  function raiseCard(variant, pct) {
    const card = el("case-closed");
    card.dataset.variant = variant;
    el("closed-title").textContent = variant === "expired" ? "TIME EXPIRED" : "CASE CLOSED";
    el("closed-file").textContent = variant === "expired" ? "FILE UDR 0412/2018 · STANDS" : "FILE UDR 0412/2018 · CLOSED";
    el("closed-pct").textContent = pct.toFixed(1);
    el("expired-pct").textContent = pct.toFixed(1);
    card.hidden = false;
    void card.offsetWidth; // the fade is a transition from the hidden state: force the first frame
    card.classList.add("on");
    const btn = el(variant === "expired" ? "closed-leaderboard" : "closed-transcript");
    if (btn) btn.focus({ preventScroll: true });
  }
  function showEnding(pct) {
    const card = el("case-closed");
    if (Number.isFinite(Number(pct))) endingPct = Number(pct);
    if (!card || !card.hidden || endingDismissed || endingShown()) return;
    // the map's own CASE SOLVED card is still up on the map tab: this one
    // waits until the participant comes back (switchTab -> loadState -> here)
    const active = document.querySelector(".tab-btn.active");
    if (active && active.dataset.tab === "map") return;
    raiseCard("solved", endingPct == null ? 0 : endingPct);
  }
  // The clock ran out. The same card, the other verdict: no once-key and no
  // waiting for a tab, because there is nothing left to do here but read
  // the standing and go to the result page.
  function showExpired(pct) {
    const card = el("case-closed");
    if (!card) return;
    const n = Number(pct);
    if (!card.hidden) {
      if (card.dataset.variant === "expired" && Number.isFinite(n)) el("expired-pct").textContent = n.toFixed(1);
      return;
    }
    closeLeave(); // a confirm left open at the buzzer has nothing to confirm
    raiseCard("expired", Number.isFinite(n) ? n : shownGuilt == null ? 0 : shownGuilt);
  }
  function hideEnding() {
    const card = el("case-closed");
    if (!card) return;
    markEndingShown();
    card.classList.remove("on");
    card.hidden = true;
    switchTab("mercy");
  }
  function initEnding() {
    el("closed-transcript").addEventListener("click", hideEnding);
    // the result page and the leaderboard live on the lobby; a solved case
    // is marked read on the way out so coming back lands on the transcript
    el("closed-leaderboard").addEventListener("click", () => {
      if (el("case-closed").dataset.variant !== "expired") markEndingShown();
      location.assign(LOBBY_URL + "/done");
    });
  }

  // --------------------------------------------------------------- leave
  // LEAVE THE CASE: the file stands at whatever the guilt is now, the
  // engine records the outcome, and the participant goes to their result
  // page. Once the case is closed either way the same button only points at
  // the leaderboard -- there is nothing left to leave.
  function setLeaveMode(closed) {
    const btn = el("leave-btn");
    if (!btn) return;
    btn.dataset.mode = closed ? "board" : "leave";
    btn.textContent = closed ? "SEE THE LEADERBOARD" : "LEAVE THE CASE";
  }
  function openLeave() {
    const pct = lastState ? Number(lastState.guilt_percent) : me ? Number(me.guilt_percent) : NaN;
    el("leave-pct").textContent = (Number.isFinite(pct) ? pct : shownGuilt == null ? 96.8 : shownGuilt).toFixed(1);
    const dlg = el("leave-confirm");
    dlg.hidden = false;
    el("leave-stay").focus({ preventScroll: true });
  }
  function closeLeave() {
    const dlg = el("leave-confirm");
    if (dlg) dlg.hidden = true;
  }
  async function leaveCase() {
    const go = el("leave-go");
    go.disabled = true;
    go.textContent = "LEAVING…";
    try {
      await api("/api/leave", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    } catch (e) {
      // a file the engine already closed (solved, timed out, left before) is
      // not an error: the result page has the answer either way
      if (e.status !== 409) {
        showToast(e.message || "MERCY did not respond.");
        go.disabled = false;
        go.textContent = "LEAVE";
        return;
      }
    }
    toLobby("/done");
  }
  function initLeave() {
    const btn = el("leave-btn");
    btn.addEventListener("click", () => {
      if (btn.dataset.mode === "board") location.assign(LOBBY_URL + "/done");
      else openLeave();
    });
    el("leave-stay").addEventListener("click", closeLeave);
    el("leave-go").addEventListener("click", leaveCase);
    el("leave-confirm").addEventListener("click", (e) => {
      if (e.target === e.currentTarget) closeLeave(); // the veil, not the card
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !el("leave-confirm").hidden) closeLeave();
    });
  }

  // ------------------------------------------------------------- meter
  function initMeter() {
    const pairs = [
      [el("meter-toggle"), el("meter-popover")],
      [el("victim-toggle"), el("victim-popover")],
      [el("hint-toggle"), el("hint-popover")],
    ];
    // closing the hint desk disarms whatever was waiting on a confirm: a
    // tier must never stay one stray click away from spending points
    const shut = (popover) => {
      popover.hidden = true;
      if (popover.id === "hint-popover") disarmHint();
    };
    pairs.forEach(([toggle, popover]) => {
      toggle.addEventListener("click", (e) => {
        e.stopPropagation();
        const open = popover.hidden;
        pairs.forEach(([, p]) => shut(p)); // one HUD panel at a time
        popover.hidden = !open;
        if (open && popover.id === "hint-popover") openHintDesk();
      });
    });
    document.addEventListener("click", (e) => {
      pairs.forEach(([toggle, popover]) => {
        if (!popover.hidden && e.target.isConnected && !popover.contains(e.target) && !toggle.contains(e.target)) shut(popover);
      });
    });
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      pairs.forEach(([, popover]) => {
        if (!popover.hidden) shut(popover);
      });
    });
  }

  // ------------------------------------------------------------- victim
  // Dates on the victim card come from the engine, because every app's seed
  // is re-anchored to "she was taken the night before seeding" -- a constant
  // here would disagree with what Haven and Wisp show.
  const VICTIM_DOB = new Date("1998-03-12T00:00:00+05:30");
  const DAY_MS = 86400000;
  const longDate = (d) => d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  const shortDate = (d) => d.toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" }).replace(/\//g, "-");
  async function loadCase() {
    let since, kase;
    try {
      kase = await api("/api/case");
      since = new Date(kase.missing_since);
    } catch (e) {
      return;
    }
    // the engine puts the hint budget on /api/case for exactly this moment:
    // the header is drawn before anything has asked for the state, and a
    // points counter that starts blank and then jumps reads as a fault
    if (Number.isFinite(Number(kase.hints_used))) hintsUsed = Number(kase.hints_used);
    if (Number.isFinite(Number(kase.points))) setPoints(Number(kase.points));
    const reported = new Date(since.getTime() + DAY_MS);
    let age = since.getFullYear() - VICTIM_DOB.getFullYear();
    if (since < new Date(since.getFullYear(), VICTIM_DOB.getMonth(), VICTIM_DOB.getDate())) age -= 1;
    document.querySelectorAll(".victim-age").forEach((n) => (n.textContent = String(age)));
    el("victim-since").textContent = shortDate(since);
    const days = Math.max(1, Math.round((Date.now() - since) / DAY_MS));
    el("victim-days").textContent = `${days} DAY${days === 1 ? "" : "S"}`;
    el("victim-lastseen").textContent = longDate(since);
    el("victim-reported").textContent = longDate(reported);
    // `since` is when the final recording began; Haven pins its backup 18 min later
    const hhmm = (d) => d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
    el("victim-lasttime").textContent = hhmm(new Date(Math.round(since.getTime() / 1800000) * 1800000));
    el("victim-backup").textContent = hhmm(new Date(since.getTime() + 18 * 60000));
  }

  // --------------------------------------------------------- the meter
  // The standing moves every turn now, so the turn's own contribution has
  // to be legible: a signed number floated once under the gauge, coloured
  // for direction. DOWN is the accused gaining ground, so down is the green
  // one -- the opposite of the reflex, which is why it is never unlabelled.
  function showDelta(delta) {
    const d = Number(delta);
    const node = el("guilt-delta");
    if (!node || !Number.isFinite(d) || d === 0) return;
    node.textContent = `${d > 0 ? "+" : "-"}${Math.abs(d).toFixed(1)}`;
    node.classList.toggle("up", d > 0);
    node.classList.toggle("down", d < 0);
    node.hidden = false;
    node.classList.remove("on");
    void node.offsetWidth; // restart the float even when it just ran
    node.classList.add("on");
    clearTimeout(node._timer);
    node._timer = setTimeout(() => {
      node.hidden = true;
      node.classList.remove("on");
    }, 2600);
  }
  // ----------------------------------------------- the standing, centred
  // MERCY moves the file every turn and that move IS the game, so the meter
  // does not just tick in the corner: it leaves its slot, flies to the
  // middle, grows, plays the character of what was just decided, and goes
  // back already settled on the new number.
  //   - the DIRECTION is the whole point: down is the accused gaining
  //     ground and reads green; up is the file closing on them and has to
  //     land as bad news, so it recoils rather than blooms
  //   - the MAGNITUDE decides how hard: a six-point drop gets the shockwave
  //     and a second bloom, a half-point drop gets a nudge
  //   - a VERDICT of contradicted is their own evidence turned around, so
  //     it is struck twice
  // The stage is its own element rather than the real chip, so a second
  // turn landing mid-flight can simply take it over -- the corner is never
  // left empty or half-scaled. It is pointer-events: none all the way down:
  // the participant can keep typing straight through it.
  const MS_STAGE = { fly: 520, dwell: 1500, back: 460, count: 1150 };
  let msToken = 0; // the turn that owns the stage; an older one stops where it is
  let msTimers = [];
  function msStop() {
    msTimers.forEach(clearTimeout);
    msTimers = [];
  }
  const msLater = (fn, ms) => msTimers.push(setTimeout(fn, ms));
  function msGauge(pct) {
    const p = Math.max(0, Math.min(100, pct)) / 100;
    const fill = el("ms-fill");
    fill.style.strokeDasharray = String(GAUGE_ARC); // the same r=19 arc as the HUD chip
    fill.style.strokeDashoffset = String(GAUGE_ARC * (1 - p));
    el("ms-needle").style.transform = `rotate(${225 + 270 * p}deg)`;
  }
  function msCount(from, to, dur, token) {
    const node = el("ms-percent");
    const t0 = performance.now();
    (function step(now) {
      if (token !== msToken) return; // a newer turn owns the digits
      const t = dur <= 0 ? 1 : Math.min(1, (now - t0) / dur);
      const eased = 1 - Math.pow(1 - t, 3);
      node.textContent = (from + (to - from) * eased).toFixed(1);
      if (t < 1) requestAnimationFrame(step);
    })(t0);
  }
  // Where the card has to stand to be sitting exactly on top of the real
  // chip. Recomputed for the flight home, because the layout may have moved
  // under it (the clock widening at TIME'S UP, a resize, a tab switch).
  function msChipTransform() {
    const chip = el("meter-toggle");
    const card = el("ms-card");
    const r = chip ? chip.getBoundingClientRect() : null;
    if (!r || !r.width || !card.offsetWidth) return null; // the chip is not on screen: no flight to fly
    const dx = r.left + r.width / 2 - window.innerWidth / 2;
    const dy = r.top + r.height / 2 - window.innerHeight * 0.46; // 46%: where the card sits in the CSS
    return `translate(calc(-50% + ${Math.round(dx)}px), calc(-50% + ${Math.round(dy)}px)) scale(${(r.width / card.offsetWidth).toFixed(3)})`;
  }
  const CENTRE = "translate(-50%, -50%) scale(1)";
  function playStanding(from, to, delta, verdict) {
    const stage = el("meter-stage");
    const card = el("ms-card");
    if (!stage || !card || !Number.isFinite(Number(to))) return false;
    const target = Number(to);
    const start = Number.isFinite(Number(from)) ? Number(from) : target;
    const d = Number.isFinite(Number(delta)) ? Number(delta) : target - start;
    const token = ++msToken;
    msStop();

    const size = Math.abs(d);
    stage.dataset.dir = d <= -0.05 ? "down" : d >= 0.05 ? "up" : "flat";
    stage.dataset.force = size >= 6 ? "hard" : size >= 2 ? "firm" : "soft";
    stage.dataset.verdict = VERDICT[verdict] ? verdict : "";
    el("ms-verdict").textContent = VERDICT[verdict] ? VERDICT[verdict][0] : "";
    el("ms-delta").textContent = size >= 0.05 ? `${d > 0 ? "+" : "-"}${size.toFixed(1)}` : "";
    el("ms-percent").textContent = start.toFixed(1);
    stage.classList.remove("hold", "going");
    msGauge(start); // set while the stage is still display:none, so nothing tweens into place

    // the flight needs the card measured, which needs it laid out: show it
    // first, transparent, and only then work out where the chip is
    stage.hidden = false;
    const home = REDUCED ? null : msChipTransform();
    stage.classList.add("instant");
    card.style.transform = home || CENTRE; // no chip to fly from: it simply arrives in the middle
    void card.offsetWidth; // the flight starts in the corner, not in the middle
    stage.classList.remove("instant");

    const fly = home ? MS_STAGE.fly : 0;
    const dwell = REDUCED ? 900 : MS_STAGE.dwell;
    requestAnimationFrame(() => {
      if (token !== msToken) return;
      stage.classList.add("lit");
      card.style.transform = CENTRE;
      el("hud-guilt").classList.add("flown"); // the corner stands down while its card is away
      msGauge(target);
      msCount(start, target, REDUCED ? 500 : MS_STAGE.count, token);
    });
    // the character lands as it arrives, not while it is still crossing
    msLater(() => token === msToken && stage.classList.add("hold"), Math.round(fly * 0.55));
    msLater(() => {
      if (token !== msToken) return;
      stage.classList.remove("hold", "lit"); // the scrim lifts; `going` keeps the card visible
      stage.classList.add("going");
      if (home) card.style.transform = msChipTransform() || home;
      el("hud-guilt").classList.remove("flown"); // already tweened onto the new number by loadState
      showDelta(d); // and the corner marks the move as its card lands back on it
      msLater(() => {
        if (token !== msToken) return;
        stage.classList.remove("going");
        stage.hidden = true;
      }, home ? MS_STAGE.back : 220);
    }, fly + dwell);
    return true;
  }
  // The turn's result. The standing itself is the engine's and loadState has
  // already tweened the corner onto it; this plays what the turn DID.
  function announceTurn(res, before) {
    const to = Number.isFinite(Number(res.guilt_percent)) ? Number(res.guilt_percent) : shownGuilt;
    if (!playStanding(before, to, res.delta, res.verdict)) showDelta(res.delta); // no stage: the corner float still says what moved
  }

  // Which of the attached ids MERCY actually leaned on. Applied to the
  // participant's own turn after the reply lands, because that turn is drawn
  // the moment they hit Submit -- before there is anything to say about it.
  function markAccepted(turn, acceptedIds) {
    if (!turn || !Array.isArray(acceptedIds)) return;
    const kept = new Set(acceptedIds);
    turn.querySelectorAll(".evi-card[data-id]").forEach((card) => {
      const used = kept.has(card.dataset.id);
      card.classList.add(used ? "is-accepted" : "not-accepted");
      const flag = document.createElement("div");
      flag.className = `acc-flag${used ? " yes" : ""}`;
      flag.textContent = used ? "ACCEPTED" : "NOT USED";
      card.appendChild(flag);
    });
  }

  // ---------------------------------------------------------- the hints
  // A hundred points per participant, spent in three depths. The engine
  // owns the purse and the wording; this side only prices the click, asks
  // once, and puts what comes back into the record. What a tier buys is
  // spelled out before it is bought, because a hint the participant did not
  // want is a hint they paid for anyway.
  const HINT_TIERS = [
    { tier: 1, cost: 5, title: "WHERE TO LOOK", blurb: "the app or the corner of the case the next thing is sitting in" },
    { tier: 2, cost: 10, title: "WHAT TO LOOK FOR", blurb: "what kind of thing it is, and what makes it matter to the file" },
    { tier: 3, cost: 20, title: "THE PIECE ITSELF", blurb: "names the exact record -- what it is and where it is" },
  ];
  // What a step costs, by step, exactly as the engine prices them. This
  // side only ever uses it to say what the NEXT press will cost before it
  // is pressed -- the receipt afterwards is always the engine's own `cost`.
  const STEP_COST = [5, 10, 20];
  let HINT_KEY = null; // set by loadMe; null means nothing to read or write
  let boughtHints = []; // {tier, step, steps_total, cost, hint, target, context}, this participant's own
  let hintTarget = null; // the beat /api/state says a hint would be bought against
  // The engine's own label for a purchase, "<beat>/tier<n>". Null until the
  // state has been read -- and an unknown target is never counted as owned, so
  // the worst case is asking the engine and being told it costs nothing.
  const targetKey = (tier) => (hintTarget ? `${hintTarget}/tier${tier}` : null);
  let armedTier = null; // a tier one click from spending; cleared by anything else
  let buying = false; // a POST in flight: the desk stops taking clicks
  function readHints() {
    try {
      const raw = HINT_KEY && localStorage.getItem(HINT_KEY);
      const list = raw ? JSON.parse(raw) : [];
      // a record is either a tier bought at the desk or a step bought from
      // the nav button; the older builds only ever wrote the first kind
      return Array.isArray(list) ? list.filter((h) => h && typeof h.hint === "string" && (Number.isFinite(Number(h.tier)) || Number.isFinite(Number(h.step)))) : [];
    } catch (e) {
      return []; // private mode, or a key written by an older build
    }
  }
  function writeHints() {
    try {
      if (HINT_KEY) localStorage.setItem(HINT_KEY, JSON.stringify(boughtHints));
    } catch (e) {
      /* private mode: the desk still works, a reload just re-asks the engine */
    }
  }
  function setPoints(n) {
    const v = Number(n);
    if (!Number.isFinite(v)) return;
    points = Math.max(0, v); // the engine clamps too; a negative purse is never drawn
    el("points-value").textContent = String(points);
    el("hint-left").textContent = `${points} PTS LEFT`;
    renderTiers();
  }
  function hintMsg(text, kind) {
    const node = el("hint-msg");
    if (!node) return;
    node.textContent = text || "";
    node.className = kind ? `is-${kind}` : "";
    node.hidden = !text;
  }
  function disarmHint() {
    if (armedTier == null) return;
    armedTier = null;
    hintMsg("");
    renderTiers();
  }
  function closeHintDesk() {
    const pop = el("hint-popover");
    if (pop && !pop.hidden) pop.hidden = true;
    disarmHint();
  }
  function openHintDesk() {
    hintMsg("");
    renderTiers();
  }
  function renderTiers() {
    const box = el("hint-tiers");
    if (!box) return;
    const purse = points == null ? Infinity : points;
    box.innerHTML = HINT_TIERS.map((t) => {
      const known = boughtHints.some((h) => Number(h.tier) === t.tier && h.target === targetKey(t.tier));
      const armed = armedTier === t.tier;
      const dear = !known && purse < t.cost;
      const act = known ? "KNOWN" : armed ? "CONFIRM" : dear ? "TOO DEAR" : `SPEND ${t.cost}`;
      const cls = ["hint-tier", known && "known", armed && "armed", dear && "dear"].filter(Boolean).join(" ");
      return `<button type="button" class="${cls}" data-tier="${t.tier}"${buying || concluded ? " disabled" : ""}><span class="ht-cost">${known ? "0" : t.cost}</span><span class="ht-main"><b>${t.title}</b><i>${escapeHtml(t.blurb)}</i></span><span class="ht-act">${act}</span></button>`;
    }).join("");
    const used = el("hint-used");
    if (used) {
      used.textContent = `HINTS TAKEN \u00b7 ${hintsUsed}`;
      used.hidden = !hintsUsed;
    }
  }
  // How a bought hint names itself. The desk sells depths and says so; the
  // nav button walks a chain and says how far along it is.
  function hintKicker(h) {
    const step = Number(h.step);
    const total = Number(h.steps_total);
    if (Number.isFinite(step) && Number.isFinite(total) && total > 0) return `HINT ${step} OF ${total}`;
    return `HINT · TIER ${Number(h.tier) || 1}`;
  }
  // The hint in the record: it sits in the transcript because that is where
  // the participant is looking, but it is not a bubble and it is not MERCY.
  function hintNode(h) {
    const wrap = document.createElement("div");
    wrap.className = "hint-note";
    const head = document.createElement("div");
    head.className = "hint-note-h";
    head.innerHTML = `<span class="hn-kicker">${escapeHtml(hintKicker(h))}</span><span class="hn-cost">${Number(h.cost) > 0 ? `-${Number(h.cost)} PTS` : "NOTHING SPENT"}</span>`;
    wrap.appendChild(head);
    const body = document.createElement("p");
    body.className = "hint-note-b";
    body.textContent = h.hint;
    wrap.appendChild(body);
    if (h.target) {
      const ref = document.createElement("div");
      ref.className = "hint-note-ref";
      ref.textContent = h.target;
      wrap.appendChild(ref);
    }
    return wrap;
  }
  function appendHint(h) {
    const log = el("chat-log");
    const emptyNotice = log.querySelector(".empty-log");
    if (emptyNotice) emptyNotice.remove();
    log.appendChild(hintNode(h));
    log.scrollTop = log.scrollHeight;
  }
  // The one place anything is spent. The desk and the nav button send
  // different bodies and report back in different places -- `say` is
  // whichever of the two is on screen -- but the purse, the ledger and the
  // record are the same for both. Returns the record, or null if the engine
  // refused, having already said why where the caller asked for it.
  async function postHint(body, say) {
    if (buying) return null;
    buying = true;
    el("hud-hint").classList.add("busy");
    say("ASKING\u2026", "warn");
    renderTiers();
    let res;
    try {
      res = await api("/api/hint", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    } catch (e) {
      // the engine's own number wins wherever it sends one: the purse may
      // have moved since this desk last read it
      const left = e.body ? Number(e.body.points_left) : NaN;
      if (Number.isFinite(left)) setPoints(left);
      buying = false;
      el("hud-hint").classList.remove("busy");
      if (e.status === 402) say(`NOT ENOUGH POINTS \u00b7 YOU HAVE ${Number.isFinite(left) ? left : points}`, "bad");
      else if (e.status === 409) say(String((e.body && e.body.error) || "the file is closed").toUpperCase(), "bad");
      else say((e.message || "THE HINT DESK DID NOT ANSWER").toUpperCase(), "bad");
      renderTiers();
      return null;
    }
    buying = false;
    el("hud-hint").classList.remove("busy");
    const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
    const rec = {
      tier: num(res.tier),
      step: num(res.step),
      steps_total: num(res.steps_total),
      cost: Number(res.cost) || 0,
      hint: String(res.hint || ""),
      target: res.target || "",
      context: body.context || null,
    };
    // filed against the engine's own target, so the same step is never
    // written (or read back as owned) twice. Nulls are normalised because a
    // record written by an older build has no step at all.
    const same = (a, b) => a.target === b.target && (a.tier || null) === (b.tier || null) && (a.step || null) === (b.step || null);
    if (!boughtHints.some((h) => same(h, rec))) {
      boughtHints.push(rec);
      writeHints();
    }
    if (Number.isFinite(Number(res.points_left))) setPoints(Number(res.points_left));
    appendHint(rec); // the hearing keeps the record whichever tab they are on
    renderTiers();
    loadState(); // hints_used, and a standing that may have moved while this was open
    return { rec, res };
  }
  async function buyHint(tier) {
    const t = HINT_TIERS.find((x) => x.tier === tier);
    if (!t || buying) return;
    armedTier = null;
    // the context rides along on every ask, as the contract says; a tier
    // named explicitly is still v2 and still buys exactly that depth
    const out = await postHint({ tier, context: context.screen || undefined, detail: context.detail || undefined }, hintMsg);
    if (!out) return;
    const rec = out.rec;
    hintMsg(rec.cost > 0 ? `TIER ${tier} BOUGHT \u00b7 ${rec.cost} POINTS SPENT` : `TIER ${tier} WAS ALREADY YOURS \u00b7 NOTHING SPENT`, "ok");
    setStepBadge(rec);
    if (out.res.goto) revealGoto(out.res.goto);
  }

  // ------------------------------------------------- the progressive ask
  // The nav button is the whole hint desk for someone who is simply stuck:
  // one press asks for the next step of help FOR THE SCREEN THEY ARE ON,
  // pressing again escalates, and a later step may take them to the thing
  // that answers it. It spends points, so it arms first and buys second.
  let navArmed = false;
  let navTimer = null;
  // What the next press will cost, from this participant's own ledger: the
  // engine prices by step and hands its step number back with every hint,
  // so the highest step already bought against this screen plus one is the
  // next one. It is a quote, not a charge -- the receipt is the engine's.
  function nextStep() {
    const key = context.screen || null;
    let n = 0;
    boughtHints.forEach((h) => {
      if ((h.context || null) === key && Number.isFinite(Number(h.step))) n = Math.max(n, Number(h.step));
    });
    return n + 1;
  }
  const stepCost = (step) => STEP_COST[Math.max(0, Math.min(STEP_COST.length, step) - 1)];
  function setStepBadge(rec) {
    const badge = el("hint-step");
    if (!badge) return;
    const step = Number(rec && rec.step);
    const total = Number(rec && rec.steps_total);
    badge.hidden = !(Number.isFinite(step) && Number.isFinite(total) && total > 0);
    if (!badge.hidden) badge.textContent = `${step} OF ${total}`;
  }
  function armNav() {
    const step = nextStep();
    const cost = stepCost(step);
    const short = points != null && points < cost;
    navArmed = true;
    el("hud-hint").classList.add("armed");
    const where = CONTEXT_LABEL[context.screen] || "the file";
    flash({
      kicker: step > 1 ? `HINT \u00b7 STEP ${step}` : "HINT",
      body: `The next steer for ${where}${context.detail ? ` \u2014 ${context.detail}` : ""}.`,
      note: short ? `THIS SPENDS ${cost} POINTS \u00b7 YOU HAVE ${points}` : `THIS SPENDS ${cost} POINTS${points == null ? "" : ` \u00b7 ${points} LEFT`}`,
      noteKind: short ? "bad" : "warn",
      confirm: true,
      armed: true,
    });
    clearTimeout(navTimer);
    navTimer = setTimeout(disarmNav, 12000); // an ask that was not meant never stays one stray click from spending
  }
  // `keepCard` is the confirm itself: the ask becomes the answer in place,
  // so the card stays up and says ASKING where the price used to be.
  function disarmNav(keepCard) {
    clearTimeout(navTimer);
    if (!navArmed) return;
    navArmed = false;
    el("hud-hint").classList.remove("armed");
    const card = el("hint-flash");
    if (!card) return;
    card.classList.remove("armed");
    el("hf-go").hidden = true;
    if (!keepCard && !card.hidden) closeFlash(); // it was only ever the question
  }
  async function askNextHint() {
    if (buying || concluded) return;
    if (!navArmed) return armNav(); // one press asks, the next one pays
    disarmNav(true);
    const out = await postHint({ context: context.screen || undefined, detail: context.detail || undefined }, flashNote);
    if (!out) return;
    const rec = out.rec;
    setStepBadge(rec);
    const sent = out.res.goto ? revealGoto(out.res.goto) : null;
    flash({
      kicker: hintKicker(rec),
      body: rec.hint,
      note:
        (rec.cost > 0 ? `-${rec.cost} PTS` : "NOTHING SPENT") +
        (points == null ? "" : ` \u00b7 ${points} LEFT`) +
        (sent ? ` \u00b7 TAKING YOU TO ${sent}` : ""),
      noteKind: "ok",
    });
  }

  // ------------------------------------------------------- the hint card
  // The steer has to be readable over the laptop and the map, which are
  // other origins: it is a card in this document rather than a line in the
  // hearing. The hearing gets its own copy for the record either way.
  function flash(o) {
    const card = el("hint-flash");
    if (!card) return;
    el("hf-kicker").textContent = o.kicker || "HINT";
    el("hf-body").textContent = o.body || "";
    flashNote(o.note || "", o.noteKind);
    el("hf-go").hidden = !o.confirm;
    card.classList.toggle("armed", !!o.armed);
    card.hidden = false;
  }
  function flashNote(text, kind) {
    const node = el("hf-note");
    if (!node) return;
    node.textContent = text || "";
    node.className = kind ? `is-${kind}` : "";
  }
  function closeFlash() {
    const card = el("hint-flash");
    if (!card) return;
    card.hidden = true;
    card.classList.remove("armed");
  }

  // Where a steer sends them. The engine names a tab and, sometimes, the
  // thing on it that answers the question -- a hint that says "her
  // particulars are in the console" and leaves them on the laptop has not
  // actually helped. Aliases, because the engine writes about the game and
  // this side knows what the game's elements are called. Returns the name
  // of the tab they were sent to, for the card, or null if it went nowhere.
  const TAB_LABEL = { mercy: "MERCY", laptop: "MEERA'S LAPTOP", map: "THE CITY MAP" };
  const GOTO_ALIAS = {
    victim: "victim-toggle", "victim-info": "victim-toggle", "victim-card": "victim-toggle", "victim-popover": "victim-toggle",
    guilt: "meter-toggle", meter: "meter-toggle", standing: "meter-toggle",
    evidence: "picker", index: "picker", "evidence-index": "picker", "evidence-panel": "picker",
    argue: "composer-text", composer: "composer-text", hearing: "composer-text", chat: "composer-text",
    clock: "hud-clock", hint: "hud-hint", hints: "hud-hint",
  };
  function revealGoto(go) {
    if (!go || !go.tab) return null;
    const tab = String(go.tab);
    const tabBtn = document.querySelector(`.tab-btn[data-tab="${tab}"]`);
    if (!tabBtn) return null; // a tab this build does not have
    switchTab(tab);
    // one HUD panel at a time, the same rule the chips themselves keep
    ["hint-popover", "victim-popover", "meter-popover"].forEach((p) => (el(p).hidden = true));
    const raw = go.focus == null ? "" : String(go.focus).trim().toLowerCase();
    const id = GOTO_ALIAS[raw] || (go.focus ? String(go.focus) : "");
    let node = id ? el(id) : null;
    // the named panels only exist once they are open, and a ring around a
    // closed one teaches nothing
    if (node && node.id === "victim-toggle") el("victim-popover").hidden = false;
    else if (node && node.id === "meter-toggle") el("meter-popover").hidden = false;
    else if (node && node.id === "composer-text") node.focus({ preventScroll: true });
    else if (node && node.id === "picker") {
      openPicker(); // the index draws the eye to itself on open; a second ring over its own is noise
      return TAB_LABEL[tab] || tab.toUpperCase();
    }
    // inside the laptop and the map it is their frame and their origin: the
    // most this side can do is put them on the right tab and ring the tab
    if (!node) node = tabBtn;
    node.classList.remove("goto-flash");
    void node.offsetWidth; // restart the ring even when the last steer lit the same thing
    node.classList.add("goto-flash");
    clearTimeout(node._gotoTimer);
    node._gotoTimer = setTimeout(() => node.classList.remove("goto-flash"), 3600);
    return TAB_LABEL[tab] || tab.toUpperCase();
  }

  function initHints() {
    renderTiers();
    el("hint-btn").addEventListener("click", (e) => {
      e.stopPropagation(); // the desk's outside-click handler must not read this as a click away
      askNextHint();
    });
    el("hf-go").addEventListener("click", (e) => {
      e.stopPropagation();
      askNextHint();
    });
    el("hf-close").addEventListener("click", () => {
      disarmNav();
      closeFlash();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      disarmNav();
      closeFlash();
    });
    el("hint-tiers").addEventListener("click", (e) => {
      const btn = e.target.closest(".hint-tier");
      if (!btn || btn.disabled) return;
      // renderTiers() below replaces the very row that was clicked, and a
      // detached node is inside nothing: left to bubble, the outside-click
      // handler would read every purchase as a click away from the desk
      e.stopPropagation();
      const tier = Number(btn.dataset.tier);
      const t = HINT_TIERS.find((x) => x.tier === tier);
      if (!t) return;
      // already bought FOR THIS BEAT: the engine hands it back free and this
      // side has the words, so replay them without spending. The beat matters:
      // the same tier against a later beat is a different hint and a real
      // charge, so an unknown target always goes to the engine and asks.
      const known = boughtHints.find((h) => Number(h.tier) === tier && h.target === targetKey(tier));
      if (known) {
        disarmHint();
        appendHint({ ...known, cost: 0 });
        hintMsg(`TIER ${tier} IS ALREADY YOURS \u00b7 NOTHING SPENT`, "ok");
        return;
      }
      if (points != null && points < t.cost) {
        armedTier = null;
        hintMsg(`NOT ENOUGH POINTS \u00b7 TIER ${tier} COSTS ${t.cost}, YOU HAVE ${points}`, "bad");
        renderTiers();
        return;
      }
      if (armedTier !== tier) {
        // it spends points: one confirm, and only for the tier just clicked
        armedTier = tier;
        hintMsg(`THIS SPENDS ${t.cost} POINTS \u00b7 CLICK CONFIRM`, "warn");
        renderTiers();
        return;
      }
      buyHint(tier);
    });
  }

  // ----------------------------------------------------------- the tour
  // First run per participant, and the TOUR button replays it. Each step
  // spotlights a real element -- the chamber dims, a hole is cut over the
  // thing being named -- and the caption says what that element is FOR in
  // the game, not what it is called. Next / Back / Skip, Escape anywhere.
  const TOUR = [
    { at: "tabbar", title: "THE APPS", body: "Meera's laptop and the City Map are the case: her messages, her photos, her diary, and a drone you can send anywhere in the city. Anything you actually open is filed as evidence.", place: "below" },
    { at: "picker", title: "THE EVIDENCE INDEX", body: "Everything you have surfaced lands here, sorted by what it is. Search it with a word from the text or with an evidence id. It only ever holds what you have already seen.", place: "right", before: openIndexForTour },
    { at: "evidence-btn", title: "ATTACHING IT", body: "Click a row in the index to stage it. Staged pieces sit as chips just above this box and travel with your next message -- MERCY weighs nothing you have not attached.", place: "above" },
    { at: "composer-text", title: "THE ARGUMENT", body: "Say why the file is wrong. Evidence on its own proves nothing: MERCY judges the claim you make about it, and tells you each turn whether the claim landed.", place: "above" },
    { at: "hud-guilt", title: "THE STANDING", body: "The file starts at 96.8% against you. Every turn moves it now -- down when the argument lands, up when it does not. Only finding her takes it to zero.", place: "below" },
    { at: "hud-hint", title: "THE HINT", body: "Stuck anywhere -- here, the laptop, the map -- press HINT and it steers you on the screen you are actually looking at. Press it again for a deeper one. A hundred points; a steer costs 5, 10 or 20, and the leaderboard counts what you have left.", place: "below" },
    { at: "hud-clock", title: "THE CLOCK", body: "Sixty minutes on the file. When it runs out, whatever the standing is at that second is the verdict -- so spend the time on what moves it.", place: "below" },
  ];
  let TOUR_KEY = null; // set by loadMe, namespaced like the ending's key
  let tourStep = -1; // -1 means the tour is not running
  function tourDone() {
    try {
      return !!TOUR_KEY && localStorage.getItem(TOUR_KEY) === "1";
    } catch (e) {
      return false;
    }
  }
  function markTourDone() {
    try {
      if (TOUR_KEY) localStorage.setItem(TOUR_KEY, "1");
    } catch (e) {
      /* private mode: it offers itself again next load, which is the lesser harm */
    }
  }
  // the index is a slide-over on narrow screens: there is nothing to
  // spotlight until it is open
  function openIndexForTour() {
    if (!isNarrow() || el("evidence-panel").classList.contains("open")) return;
    el("evidence-panel").classList.add("open");
    mountPicker();
  }
  function startTour() {
    if (!el("tour") || tourStep >= 0) return;
    const active = document.querySelector(".tab-btn.active");
    if (!active || active.dataset.tab !== "mercy") switchTab("mercy");
    closeHintDesk();
    el("meter-popover").hidden = true;
    el("victim-popover").hidden = true;
    el("tour").hidden = false;
    // placed cold for the first step: the hole and the card have no position
    // yet, and a transition from the corner reads as a bug
    el("tour-hole").style.transition = "none";
    el("tour-card").style.transition = "none";
    tourStep = -1;
    tourGo(1);
    el("tour-next").focus({ preventScroll: true });
  }
  function endTour() {
    if (tourStep < 0) return;
    markTourDone();
    tourStep = -1;
    el("tour").hidden = true;
  }
  function tourGo(dir) {
    const next = tourStep + dir;
    if (next < 0) return;
    if (next >= TOUR.length) return endTour();
    tourStep = next;
    const step = TOUR[tourStep];
    if (step.before) step.before();
    el("tour-step").textContent = `STEP ${tourStep + 1} / ${TOUR.length}`;
    el("tour-title").textContent = step.title;
    el("tour-body").textContent = step.body;
    el("tour-back").disabled = tourStep === 0;
    el("tour-next").textContent = tourStep === TOUR.length - 1 ? "DONE" : "NEXT";
    el("tour-dots").innerHTML = TOUR.map((_, i) => `<i${i === tourStep ? ' class="on"' : ""}></i>`).join("");
    requestAnimationFrame(tourPlace); // the caption needs its own height first
  }
  // The hole is a fixed box with a viewport-sized shadow around it, so the
  // dim and the cut-out are the same element and they can never drift apart.
  function tourPlace() {
    if (tourStep < 0) return;
    const step = TOUR[tourStep];
    const target = el(step.at);
    const hole = el("tour-hole");
    const card = el("tour-card");
    if (!target || !hole || !card) return endTour(); // an element this build does not have
    const r = target.getBoundingClientRect();
    const pad = 8;
    const x = Math.max(0, r.left - pad);
    const y = Math.max(0, r.top - pad);
    const w = Math.max(24, Math.min(window.innerWidth - x, r.width + pad * 2));
    const h = Math.max(24, Math.min(window.innerHeight - y, r.height + pad * 2));
    hole.style.left = `${Math.round(x)}px`;
    hole.style.top = `${Math.round(y)}px`;
    hole.style.width = `${Math.round(w)}px`;
    hole.style.height = `${Math.round(h)}px`;
    const cw = card.offsetWidth;
    const ch = card.offsetHeight;
    const gap = 14;
    let left;
    let top;
    if (step.place === "right" && x + w + gap + cw < window.innerWidth - 12) {
      left = x + w + gap;
      top = y + h / 2 - ch / 2; // a tall target: beside it, on its middle
    } else {
      left = x;
      const below = y + h + gap;
      top = step.place === "above" || below + ch > window.innerHeight - 12 ? y - ch - gap : below;
      if (top < 12) top = below; // no room above either: take what is below and clamp
    }
    card.style.left = `${Math.round(Math.max(12, Math.min(left, window.innerWidth - cw - 12)))}px`;
    card.style.top = `${Math.round(Math.max(12, Math.min(top, window.innerHeight - ch - 12)))}px`;
    if (hole.style.transition === "none") {
      requestAnimationFrame(() => {
        hole.style.transition = "";
        card.style.transition = "";
      });
    }
  }
  function initTour() {
    el("tour-btn").addEventListener("click", startTour);
    el("tour-next").addEventListener("click", () => tourGo(1));
    el("tour-back").addEventListener("click", () => tourGo(-1));
    el("tour-skip").addEventListener("click", endTour);
    document.addEventListener("keydown", (e) => {
      if (tourStep < 0) return;
      const go = { Escape: endTour, ArrowRight: () => tourGo(1), ArrowLeft: () => tourGo(-1) }[e.key];
      if (!go) return;
      e.preventDefault();
      go();
    });
    // the spotlight is measured from the live layout: anything that moves it
    // (a resize, the clock widening at TIME'S UP) has to move the hole too
    window.addEventListener("resize", tourPlace);
  }

  // -------------------------------------------------------------- init
  // The gate first: no session, or a session whose clock the lobby has not
  // started (the briefing not accepted), goes back to the lobby before a
  // single pixel of the case is drawn. An engine that cannot be reached is
  // not a verdict -- the console opens as before and the poll asks again.
  async function init() {
    // the chamber stays hidden until the engine has said whose file this is;
    // an engine that is not up yet is asked again rather than skipped
    while (!(await loadMe())) {
      if (leaving) return;
      document.body.dataset.gated = "connecting";
      await new Promise((r) => setTimeout(r, 3000));
    }
    if (leaving) return;
    delete document.body.dataset.gated;
    tickClock();
    initTabs();
    initFullScreen();
    setContext("console-mercy"); // the hearing is what is on screen at the gate
    initMeter();
    initEnding();
    initLeave();
    initHints();
    initTour();
    loadCase();
    initPicker();
    el("composer").addEventListener("submit", (e) => {
      e.preventDefault();
      sendArgument();
    });
    const textEl = el("composer-text");
    textEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendArgument();
      }
    });
    const autogrow = () => {
      textEl.style.height = "auto";
      const max = 150;
      textEl.style.height = Math.min(max, textEl.scrollHeight) + "px";
      textEl.classList.toggle("tall", textEl.scrollHeight > max);
    };
    textEl.addEventListener("input", autogrow);
    textEl.addEventListener("focus", autogrow);
    await loadState();
    verdictFromMe(); // a reload after the buzzer: /api/me already knows
    loadEvidenceCount();
    loadTranscript();
    mountPicker();
    ready = true;
    initClock();
    tickClock(); // a clock already at zero polls from here on
    // the walkthrough, once per participant per browser. It waits for the
    // index to finish mounting, and it never opens over an ending.
    if (!tourDone()) setTimeout(() => {
      if (!concluded && !leaving && el("case-closed").hidden) startTour();
    }, 900);
  }
  init();
})();
