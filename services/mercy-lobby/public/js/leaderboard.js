// The projector view: the board, big, refreshed every five seconds, the top
// three lit. No login -- names are public at the event.
(function () {
  'use strict';

  const B = window.MercyBoard;
  const el = (id) => document.getElementById(id);

  async function load() {
    try {
      const r = await fetch('/api/leaderboard', { cache: 'no-store' });
      const { rows } = await r.json();
      B.renderRows(el('board'), rows, { top: 3 });
      el('c-total').textContent = rows.length;
      el('c-solved').textContent = rows.filter((x) => x.outcome === 'solved').length;
      el('c-finished').textContent = rows.filter((x) => x.outcome).length;
      el('c-playing').textContent = rows.filter((x) => !x.outcome && x.started_at).length;
      el('note').textContent = `updated ${new Date().toLocaleTimeString()}`;
    } catch (e) {
      el('note').textContent = 'the lobby did not answer';
    }
  }
  load();
  setInterval(load, 5000);
})();
