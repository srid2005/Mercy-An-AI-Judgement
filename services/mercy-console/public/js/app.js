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
  let lastState = null; // last /api/state response; its `gates` are pushed to the laptop (see pushGates)
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
    }

    const hit = state.checkpoints.filter((c) => c.hit);
    el("cp-list").innerHTML = hit
      .map((c, i) => `<div class="cp-row"><span>${escapeHtml(c.label)}</span><span class="cp-pct">${state.concluded && i === hit.length - 1 ? state.guilt_percent : c.guilt_after}%</span></div>`)
      .join("");
    el("verdict-concluded").hidden = !concluded;
    el("send-btn").disabled = concluded;
    el("evidence-btn").disabled = concluded;
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
  // Twenty-five minutes from the lobby's "Accept & continue". The engine
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
    return `<div class="evi-card">${media}<div class="evi-body"><span class="evi-source src-${escapeHtml(record.service)}">${SERVICE_LABEL[record.service] || escapeHtml(record.service)}</span>${audio}<div class="evi-text">${escapeHtml(text)}</div>${link}<div class="evi-id">${escapeHtml(record.evidence_id)}</div></div></div>`;
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
  function turnNode(role, body, records, checkpointHit) {
    const wrap = document.createElement("div");
    wrap.className = `turn ${role === "mercy" ? "mercy" : "you"}${checkpointHit ? " checkpoint" : ""}`;
    const label = document.createElement("div");
    label.className = "turn-label";
    label.innerHTML = `<span class="dot"></span>${role === "mercy" ? "MERCY" : "YOU"}`;
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
    if (!turns.length) {
      log.innerHTML = `<div class="empty-log"><b>The file stands at <em>96.8%</em>.</b>MERCY is waiting to hear why that's wrong. Find something on the laptop or the map, attach it, and say why it matters.</div>`;
      return;
    }
    log.innerHTML = "";
    for (const t of turns) {
      const records = await Promise.all((t.evidence_ids || []).map(resolveCached));
      log.appendChild(turnNode(t.role, t.body, records.filter(Boolean), t.checkpoint_hit));
    }
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
    log.appendChild(turnNode("you", text, tray, null));
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
      log.appendChild(turnNode("mercy", res.reply, null, res.checkpoint_hit));
      log.scrollTop = log.scrollHeight;
      await loadState();
    } catch (e) {
      showToast(e.message || "MERCY did not respond.");
    } finally {
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
    ];
    pairs.forEach(([toggle, popover]) => {
      toggle.addEventListener("click", (e) => {
        e.stopPropagation();
        const open = popover.hidden;
        pairs.forEach(([, p]) => (p.hidden = true)); // one HUD panel at a time
        popover.hidden = !open;
      });
    });
    document.addEventListener("click", (e) => {
      pairs.forEach(([toggle, popover]) => {
        if (!popover.hidden && !popover.contains(e.target) && !toggle.contains(e.target)) popover.hidden = true;
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
    let since;
    try {
      since = new Date((await api("/api/case")).missing_since);
    } catch (e) {
      return;
    }
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
    initMeter();
    initEnding();
    initLeave();
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
  }
  init();
})();
