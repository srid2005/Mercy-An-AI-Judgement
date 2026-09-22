// The participant's result: how their file ended (or that it is still
// open, with the way back to the console), their numbers, and the board
// under them. The fullscreen the lobby asked for is released here -- the
// run is over, they may want their browser back.
(function () {
  'use strict';

  const CONSOLE_PORT = 3020;
  const B = window.MercyBoard;
  const el = (id) => document.getElementById(id);
  let me = null;

  try {
    if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {});
  } catch (e) { /* not in fullscreen, or not offered */ }

  async function api(path, body) {
    const r = await fetch(path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'same-origin', cache: 'no-store',
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) { const err = new Error(data.error || `request failed (${r.status})`); err.status = r.status; throw err; }
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

  // The headline is the outcome; the subtitle says what it means for the
  // file. Still open: the time left runs down live, and the button goes
  // back to the console.
  const SUB = {
    solved: 'Meera Kapoor recovered. The file against you is closed.',
    timeout: 'The clock ran out. The file stands where it was.',
    left: 'You left the file. It stands where you left it.',
  };
  function render() {
    el('me-name').textContent = me.name;
    el('me-id').textContent = me.id;
    const title = el('title');
    title.textContent = B.outcomeLabel(me.outcome);
    title.classList.toggle('calm', me.outcome === 'solved');
    el('sub').textContent = me.outcome ? SUB[me.outcome] : (me.started_at ? 'Your clock is running. The console is waiting for you.' : 'You have not accepted the file yet. Go back to the lobby to begin.');
    el('st-guilt').textContent = B.fmtGuilt(me.guilt_percent);
    el('st-guilt-box').classList.toggle('calm', me.outcome === 'solved');
    el('st-cp').textContent = me.checkpoints_hit == null ? '-' : me.checkpoints_hit;
    el('st-cp-total').textContent = me.checkpoints_total || 7;
    el('st-rank').textContent = me.rank == null ? '-' : me.rank;
    el('st-players').textContent = me.players == null ? '-' : me.players;
    const back = el('back-btn');
    back.hidden = !!me.outcome;
    back.href = me.started_at ? (me.console_url || `http://${location.hostname}:${CONSOLE_PORT}/`) : '/';
    back.textContent = me.started_at ? 'BACK TO THE CONSOLE' : 'BACK TO THE LOBBY';
    tickTime();
  }
  // time taken once it is over; time left while it runs; nothing before it starts
  function tickTime() {
    const node = el('st-time');
    if (me.outcome) { node.textContent = B.fmtTime(me.elapsed_s); return; }
    if (!me.deadline) { node.textContent = '--:--'; return; }
    const left = Math.max(0, (new Date(me.deadline).getTime() - Date.now()) / 1000);
    node.textContent = B.fmtTime(left);
    node.parentNode.querySelector('.l').textContent = 'TIME LEFT';
  }

  async function loadMe() {
    try {
      me = await api('/api/me');
      render();
    } catch (e) {
      if (e.status === 401 || e.status === 404) { location.href = '/'; return; }
      showToast(e.message, true);
    }
  }
  async function loadBoard() {
    try {
      const { rows } = await api('/api/leaderboard');
      B.renderRows(el('board'), rows, { me: me && me.id, total: me && me.checkpoints_total });
    } catch (e) {
      el('board-note').textContent = 'board unavailable';
    }
  }

  el('logout-btn').addEventListener('click', async () => {
    try { await api('/api/logout', {}); } catch (e) { /* the cookie is gone either way */ }
    location.href = '/';
  });

  (async () => {
    await loadMe();
    await loadBoard();
    // an open file settles while they sit here: the outcome comes in from the engine
    setInterval(async () => { await loadMe(); await loadBoard(); }, 10000);
    setInterval(() => { if (me) tickTime(); }, 1000);
  })();
})();
