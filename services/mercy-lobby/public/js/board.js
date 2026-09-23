// The leaderboard rows, drawn the same way on the result page, the
// projector and the admin panel -- one place for the labels and the
// formats, so the three never disagree about what "left" is called.
(function () {
  'use strict';

  const escapeHtml = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const OUTCOME = { solved: 'CASE SOLVED', timeout: 'TIME EXPIRED', left: 'FILE LEFT STANDING' };
  const PILL = { solved: 'SOLVED', timeout: 'TIMEOUT', left: 'LEFT', playing: 'PLAYING', new: 'NOT STARTED' };

  // mm:ss from seconds; "--:--" when there is nothing to say
  function fmtTime(s) {
    if (s == null || !Number.isFinite(Number(s))) return '--:--';
    const n = Math.max(0, Math.round(Number(s)));
    const m = Math.floor(n / 60), r = n % 60;
    return `${m}:${String(r).padStart(2, '0')}`;
  }
  const fmtGuilt = (v) => (v == null || !Number.isFinite(Number(v)) ? '--' : Number(v).toFixed(1));
  // the row's state: the outcome once there is one, else whether the clock runs
  const stateOf = (row) => row.outcome || (row.started_at ? 'playing' : 'new');
  const pill = (state) => `<span class="pill ${escapeHtml(state)}">${PILL[state] || escapeHtml(state).toUpperCase()}</span>`;
  const outcomeLabel = (o) => OUTCOME[o] || 'STILL OPEN';

  // rows: GET /api/leaderboard's; opts.me highlights one id; opts.top how
  // many rows are lit (3 on the projector); opts.total the checkpoint count.
  // Points, like the time and the standing, are only shown once the file is
  // closed: until the engine reports the outcome the register still holds
  // the starting 100, and the board does not rank on it either.
  function renderRows(tbody, rows, opts) {
    const o = opts || {};
    const total = o.total || 7;
    if (!rows || !rows.length) {
      tbody.innerHTML = '<tr class="empty"><td colspan="8">nobody on the board yet</td></tr>';
      return;
    }
    tbody.innerHTML = rows.map((r) => {
      const state = stateOf(r);
      const cls = [r.rank <= (o.top == null ? 3 : o.top) && r.outcome ? `top top-${r.rank}` : '', o.me && r.zinnia_id === o.me ? 'me' : ''].filter(Boolean).join(' ');
      return `<tr class="${cls}">
        <td class="rank">${r.rank}</td>
        <td class="name">${escapeHtml(r.name)}</td>
        <td class="id">${escapeHtml(r.zinnia_id)}</td>
        <td>${pill(state)}</td>
        <td class="num">${r.outcome ? fmtTime(r.elapsed_s) : '--:--'}</td>
        <td class="num guilt">${r.final_guilt == null ? '--' : fmtGuilt(r.final_guilt) + '%'}</td>
        <td class="num">${r.outcome && r.points != null ? r.points : '--'}</td>
        <td class="num">${r.checkpoints_hit == null ? '--' : `${r.checkpoints_hit}/${total}`}</td>
      </tr>`;
    }).join('');
  }

  window.MercyBoard = { escapeHtml, fmtTime, fmtGuilt, stateOf, pill, outcomeLabel, renderRows };
})();
