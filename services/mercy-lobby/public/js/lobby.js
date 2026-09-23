// MERCY lobby -- the participant's way in. One document, four stages, in
// order: the ticket (Zinnia ID), the intro film, the angel, the briefing
// and its rules; then the console, in this same tab. The stages share the
// document because the film must play with sound and the page must go
// fullscreen, and a browser grants both only on the participant's own
// click -- the one on ENTER.
(function () {
  'use strict';

  const CONSOLE_PORT = 3020;
  // every front-end origin of the stack: each serves /reset.html, which
  // clears its own localStorage/sessionStorage so a shared machine starts clean
  const RESET_PORTS = [3000, 3020, 4001, 4002, 4003, 4008, 4011];
  const REDUCED = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const el = (id) => document.getElementById(id);
  let minutes = 60; // GAME_MINUTES, as the login answer says

  // ------------------------------------------------------------------ api
  async function api(path, body) {
    const r = await fetch(path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'same-origin',
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      const err = new Error(data.error || `request failed (${r.status})`);
      err.status = r.status;
      err.body = data;
      throw err;
    }
    return data;
  }
  function showToast(msg, bad) {
    const t = el('toast');
    t.textContent = msg;
    t.classList.toggle('bad', !!bad);
    t.hidden = false;
    clearTimeout(t._timer);
    t._timer = setTimeout(() => (t.hidden = true), 3600);
  }

  // --------------------------------------------------------------- stages
  function show(name) {
    document.querySelectorAll('.stage').forEach((s) => s.classList.toggle('active', s.id === `stage-${name}`));
    window.scrollTo(0, 0);
  }
  // Fullscreen for the whole run: the console opens in this tab, so what
  // the browser keeps across the navigation, it keeps. A refusal (no
  // gesture, an iframe, a browser that will not) changes nothing.
  function goFullscreen() {
    try {
      const p = document.documentElement.requestFullscreen && document.documentElement.requestFullscreen();
      if (p && p.catch) p.catch(() => {});
    } catch (e) { /* not offered here */ }
  }

  // ---------------------------------------------------------------- login
  const zin = el('zinnia');
  zin.addEventListener('input', () => {
    const at = zin.selectionStart;
    zin.value = zin.value.toUpperCase();
    try { zin.setSelectionRange(at, at); } catch (e) { /* not a text control on this browser */ }
  });
  el('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = el('login-btn'), err = el('login-error');
    err.textContent = '';
    const id = zin.value.trim().toUpperCase();
    if (!/^ZIN\d{2}-\d{4}$/.test(id)) { err.textContent = 'A Zinnia ID looks like ZIN26-0158.'; zin.focus(); return; }
    goFullscreen(); // on the click itself, before any await
    btn.disabled = true;
    btn.textContent = 'OPENING THE FILE…';
    try {
      const me = await api('/api/login', { zinnia_id: id });
      if (me.minutes) minutes = me.minutes;
      const wiped = resetOrigins();
      // a finished or running game leaves this page at once: give the seven
      // frames their moment first (the film covers it on the new path)
      if (me.status === 'finished') { await wiped; location.href = '/done'; return; }
      if (me.status === 'playing') { await wiped; await start(); return; }
      playIntro();
    } catch (ex) {
      err.textContent = ex.message;
      btn.disabled = false;
      btn.textContent = 'ENTER';
      if (ex.status !== 404 && ex.status !== 400) showToast(ex.message, true);
    }
  });
  // The seven front-ends each wipe their own browser storage in a hidden
  // frame; nothing waits for them, and the frames go after five seconds.
  // Resolves when every front-end has said it is clean, or after 1.5 s --
  // whichever comes first; the frames themselves go after five seconds.
  const resetDone = new Set();
  let resetResolve = null;
  function resetOrigins() {
    const box = el('reset-frames');
    resetDone.clear();
    for (const port of RESET_PORTS) {
      const f = document.createElement('iframe');
      f.src = `http://${location.hostname}:${port}/reset.html`;
      f.setAttribute('aria-hidden', 'true');
      f.tabIndex = -1;
      box.appendChild(f);
    }
    setTimeout(() => { box.innerHTML = ''; }, 5000);
    return new Promise((resolve) => { resetResolve = resolve; setTimeout(resolve, 1500); });
  }
  window.addEventListener('message', (e) => {
    if (!e.data || e.data.type !== 'mercy:reset-done') return;
    try { resetDone.add(new URL(e.data.origin).port); } catch (ex) { /* not an origin: ignore */ }
    if (resetResolve && RESET_PORTS.every((p) => resetDone.has(String(p)))) resetResolve();
  });

  // ----------------------------------------------------------------- films
  // The same treatment for the intro and the story: full-viewport, with
  // sound (the click is fresh), a SKIP after three seconds, on to the next
  // stage when it ends -- or at once when the file is missing or broken.
  // A browser that still refuses sound gets a PLAY WITH SOUND button.
  function playFilm(video, playBtn, skipBtn, next) {
    let done = false;
    const finish = () => { if (done) return; done = true; video.pause(); next(); };
    video.hidden = false;
    video.muted = false;
    video.currentTime = 0;
    video.addEventListener('ended', finish);
    video.addEventListener('error', finish);
    skipBtn.hidden = false;
    skipBtn.classList.remove('on');
    skipBtn.onclick = finish;
    setTimeout(() => skipBtn.classList.add('on'), 3000);
    const attempt = video.play();
    if (attempt && attempt.catch) {
      attempt.catch(() => {
        playBtn.hidden = false;
        playBtn.onclick = () => { playBtn.hidden = true; video.muted = false; video.play().catch(finish); };
      });
    }
  }
  function playIntro() {
    show('intro');
    playFilm(el('intro-video'), el('intro-play'), el('intro-skip'), showAngel);
  }

  // ----------------------------------------------------------------- angel
  function showAngel() {
    show('angel');
    const stage = el('stage-angel');
    let lit = false;
    const light = () => {
      if (lit) return;
      lit = true;
      stage.classList.add('lit');
      // the name takes ~2.3 s to draw itself out; the button follows it
      setTimeout(() => stage.classList.add('ready'), REDUCED ? 100 : 2400);
    };
    const img = el('angel');
    img.addEventListener('mouseover', light);
    img.addEventListener('pointerenter', light);
    img.addEventListener('touchstart', light, { passive: true });
    img.addEventListener('click', light);
    // a touch screen, or a participant who does not move: six seconds
    setTimeout(light, 6000);
    el('angel-continue').addEventListener('click', showBriefing, { once: true });
  }

  // -------------------------------------------------------------- briefing
  // MERCY's own words, when there is no story film to say them.
  const CARDS = () => [
    'You are Arjun Kapoor.',
    'Your wife Meera went missing last night at 21:40. The police file says you did it. It stands at 96.8% against you.',
    'I am MERCY, the AI judge. I decide how that number moves.',
    'You told the police you were at your brother Vikram’s house last night, and that your mother was there too. I do not take your word for it. Find the proof and show it to me.',
    'The proof is on Meera’s laptop: her messages (Wisp), her social feed (Loop), her email (Quill), her video diary (Haven), her father’s police case file, and the alerts from her fitness band (PulseFit).',
    'There is also the City Map. It has four drones: give them a place and they search it. Later, when I allow it, the map can follow a car too.',
    'Everything you open is saved as evidence. To argue, attach the evidence to your message and tell me what it proves. Talking without evidence does nothing.',
    'Two things lower the file against you: proof of where you were, and proof of who really did it. Every fact that points to another man is a fact that no longer points to you.',
    `You have ${minutes} minutes. Find her and the file closes. Run out of time and it stays as it is.`,
    'You can leave at any time. The file stays where you left it.',
  ];
  async function showBriefing() {
    show('briefing');
    document.querySelectorAll('.minutes').forEach((n) => (n.textContent = minutes));
    let hasStory = false;
    try {
      const r = await fetch('/media/story.mp4', { method: 'HEAD', cache: 'no-store' });
      hasStory = r.ok;
    } catch (e) { hasStory = false; }
    if (hasStory) {
      const v = el('story-video');
      v.src = '/media/story.mp4';
      playFilm(v, el('story-play'), el('story-skip'), showRules);
    } else {
      runCards(showRules);
    }
  }
  // Each card is typed out, then held; a click anywhere skips the typing
  // first and the hold second. About six seconds a card either way.
  function runCards(next) {
    const cards = CARDS();
    const stage = el('stage-briefing'), card = el('brief-card'), text = el('brief-text'), dots = el('brief-dots');
    card.hidden = false;
    el('brief-tap').hidden = false;
    dots.innerHTML = cards.map(() => '<i></i>').join('');
    let i = 0, typing = null, hold = null;
    const advance = () => {
      clearTimeout(hold);
      if (typing) { typing.skip(); return; }
      i++;
      if (i >= cards.length) { stage.removeEventListener('click', advance); card.hidden = true; el('brief-tap').hidden = true; next(); return; }
      play();
    };
    const play = () => {
      dots.querySelectorAll('i').forEach((d, k) => d.classList.toggle('hit', k <= i));
      typing = typewriter(text, cards[i], () => {
        typing = null;
        hold = setTimeout(advance, Math.max(2200, 6000 - cards[i].length * 28));
      });
    };
    stage.addEventListener('click', advance);
    play();
  }
  function typewriter(node, str, onDone) {
    node.classList.remove('done');
    node.innerHTML = '<span class="t"></span><span class="cursor"></span>';
    const t = node.querySelector('.t');
    let k = 0, timer = null;
    let ended = false;
    const finish = () => { if (ended) return; ended = true; clearTimeout(timer); t.textContent = str; node.classList.add('done'); onDone(); };
    // no typing for reduced motion -- but finish after the caller holds the handle, or the card never advances
    if (REDUCED) { timer = setTimeout(finish, 0); return { skip: finish }; }
    const tick = () => {
      k++;
      t.textContent = str.slice(0, k);
      if (k >= str.length) { finish(); return; }
      // a breath at the punctuation, the way a voice would
      timer = setTimeout(tick, /[.,:;!?]/.test(str[k - 1]) ? 220 : 28);
    };
    timer = setTimeout(tick, 350);
    return { skip: finish };
  }

  // ----------------------------------------------------------------- rules
  function showRules() {
    const stage = el('stage-briefing');
    stage.classList.add('rules');
    el('story-video').hidden = true;
    el('story-skip').hidden = true;
    const form = el('rules-card'), ok = el('rules-ok'), btn = el('accept-btn');
    form.hidden = false;
    ok.addEventListener('change', () => (btn.disabled = !ok.checked));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!ok.checked) return;
      btn.disabled = true;
      btn.textContent = 'STARTING THE CLOCK…';
      try {
        await start();
      } catch (ex) {
        el('accept-error').textContent = ex.message;
        btn.disabled = false;
        btn.textContent = 'ACCEPT & CONTINUE';
      }
    });
  }
  // The clock starts (the engine keeps one already running) and the
  // console takes over this tab. A game that is over goes to its result.
  async function start() {
    let r;
    try {
      r = await api('/api/start', {});
    } catch (ex) {
      if (ex.status === 409) { location.href = '/done'; return; }
      if (ex.status === 401) { location.reload(); return; }
      throw ex;
    }
    location.href = r.console_url || `http://${location.hostname}:${CONSOLE_PORT}/`;
  }

  zin.focus();
})();
