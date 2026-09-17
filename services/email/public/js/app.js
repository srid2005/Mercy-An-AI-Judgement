const token = localStorage.getItem('eml_token');
if (!token) {
  window.location.href = '/index.html';
}

const authHeaders = { Authorization: `Bearer ${token}` };
const mainEl = document.getElementById('mail-main');

let me = null;
let contacts = [];
let starred = JSON.parse(localStorage.getItem('eml_starred') || '{}');
let seededStarKeys = JSON.parse(localStorage.getItem('eml_seeded_stars') || '{}');
let editingDraftId = null;

// Pre-starred-by-Meera items (server-side, seed data) get merged into local
// starred state exactly once per key, so the player sees them starred by
// default but can still unstar/restar freely afterward without the server
// value re-overriding their choice on every reload.
function seedStarred(items) {
  let changed = false;
  items.forEach((item) => {
    if (item.starred && !(item.key in seededStarKeys)) {
      starred[item.key] = true;
      seededStarKeys[item.key] = true;
      changed = true;
    }
  });
  if (changed) {
    localStorage.setItem('eml_starred', JSON.stringify(starred));
    localStorage.setItem('eml_seeded_stars', JSON.stringify(seededStarKeys));
  }
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function timeAgo(iso) {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  const units = [
    ['y', 31536000],
    ['w', 604800],
    ['d', 86400],
    ['h', 3600],
    ['m', 60],
  ];
  for (const [label, secs] of units) {
    const val = Math.floor(seconds / secs);
    if (val >= 1) return `${val}${label}`;
  }
  return 'now';
}

function fullDate(iso) {
  return new Date(iso).toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

let toastTimer = null;
function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

async function api(path, opts = {}) {
  const res = await fetch(path, { ...opts, headers: { ...(opts.headers || {}), ...authHeaders } });
  if (res.status === 401) {
    localStorage.removeItem('eml_token');
    window.location.href = '/index.html';
    throw new Error('unauthorized');
  }
  return res;
}

function starBtnHtml(key) {
  const on = !!starred[key];
  return `<button class="star-btn ${on ? 'on' : ''}" data-star="${key}" title="Star">
    <svg viewBox="0 0 24 24" fill="${on ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
  </button>`;
}

function wireStarButtons(root) {
  root.querySelectorAll('[data-star]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const key = btn.dataset.star;
      starred[key] = !starred[key];
      if (!starred[key]) delete starred[key];
      localStorage.setItem('eml_starred', JSON.stringify(starred));
      btn.classList.toggle('on', !!starred[key]);
      btn.querySelector('svg').setAttribute('fill', starred[key] ? 'currentColor' : 'none');
    });
  });
}

// ---------------------------------------------------------------------
// folders
// ---------------------------------------------------------------------

function setActiveFolder(folder) {
  document.querySelectorAll('.folder-item').forEach((el) => el.classList.toggle('active', el.dataset.folder === folder));
}

async function renderInbox() {
  setActiveFolder('inbox');
  mainEl.innerHTML = '<div class="loading">Loading…</div>';
  const { inbox } = await api('/api/inbox').then((r) => r.json());
  document.getElementById('count-inbox').textContent = inbox.length || '';
  seedStarred(inbox);

  if (!inbox.length) {
    mainEl.innerHTML = '<div class="empty">No mail yet.</div>';
    return;
  }

  mainEl.innerHTML = `<div class="inbox-list">${inbox.map((item) => inboxRowHtml(item, item.key)).join('')}</div>`;
  wireRows(inbox.map((i) => i.key));
}

const paperclipSvg = '<svg class="attach-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>';

function inboxRowHtml(item, key) {
  const spamBadge = item.filler_kind === 'spam' ? '<span class="spam-badge">SPAM</span>' : '';
  const countBadge = item.message_count > 1 ? `<span class="count-badge">${item.message_count}</span>` : '';
  const attachBadge = item.has_attachment ? paperclipSvg : '';
  const fromName = item.other ? item.other.display_name : 'Unknown';
  return `
    <div class="inbox-row" data-key="${key}">
      ${starBtnHtml(key)}
      <img src="${item.last_sender_is_me && me ? me.avatar_url : (item.other?.avatar_url || '')}" alt="" />
      <div class="from">${item.last_sender_is_me ? 'You' : escapeHtml(fromName)}</div>
      <div class="subject-preview">
        <span class="subj">${escapeHtml(item.subject)}${countBadge}${spamBadge}${attachBadge}</span>
        <span class="prev">${escapeHtml((item.preview || '').replace(/\s+/g, ' '))}</span>
      </div>
      <div class="time">${timeAgo(item.last_sent_at)}</div>
    </div>`;
}

function wireRows(keys) {
  mainEl.querySelectorAll('.inbox-row').forEach((el) => {
    el.addEventListener('click', () => (window.location.hash = `#/thread/${el.dataset.key}`));
  });
  wireStarButtons(mainEl);
}

async function renderSent() {
  setActiveFolder('sent');
  mainEl.innerHTML = '<div class="loading">Loading…</div>';
  const { sent } = await api('/api/sent').then((r) => r.json());

  if (!sent.length) {
    mainEl.innerHTML = '<div class="empty">Nothing sent yet.</div>';
    return;
  }

  mainEl.innerHTML = `<div class="inbox-list">${sent
    .map((item) => `
    <div class="inbox-row" data-key="${item.key}">
      ${starBtnHtml(item.evidence_id)}
      <img src="${item.other.avatar_url}" alt="" />
      <div class="from">To: ${escapeHtml(item.other.display_name)}</div>
      <div class="subject-preview">
        <span class="subj">${escapeHtml(item.subject)}</span>
        <span class="prev">${escapeHtml(item.preview.replace(/\s+/g, ' '))}</span>
      </div>
      <div class="time">${timeAgo(item.last_sent_at)}</div>
    </div>`)
    .join('')}</div>`;
  wireRows();
}

async function renderDrafts() {
  setActiveFolder('drafts');
  mainEl.innerHTML = '<div class="loading">Loading…</div>';
  const { drafts } = await api('/api/drafts').then((r) => r.json());
  document.getElementById('count-drafts').textContent = drafts.length || '';

  if (!drafts.length) {
    mainEl.innerHTML = '<div class="empty">No drafts.</div>';
    return;
  }

  mainEl.innerHTML = `<div class="inbox-list">${drafts
    .map((d) => {
      const evidenceBadge = d.evidence_id ? `<span class="evidence-badge">${d.evidence_id}</span>` : '';
      return `
    <div class="inbox-row" data-draft="${d.id}">
      <img src="${d.to?.avatar_url || ''}" alt="" />
      <div class="from">${d.to ? escapeHtml(d.to.display_name) : '(no recipient)'}</div>
      <div class="subject-preview">
        <span class="subj" style="color:var(--danger);">Draft</span>${evidenceBadge}
        <span class="prev">${escapeHtml(d.subject || '(no subject)')} - ${escapeHtml(d.body.replace(/\s+/g, ' ').slice(0, 80))}</span>
      </div>
      <div class="time">${timeAgo(d.updated_at)}</div>
    </div>`;
    })
    .join('')}</div>`;

  mainEl.querySelectorAll('[data-draft]').forEach((el) => {
    el.addEventListener('click', async () => {
      const { drafts } = await api('/api/drafts').then((r) => r.json());
      const d = drafts.find((x) => String(x.id) === el.dataset.draft);
      if (!d) {
        showToast('This draft no longer exists.');
        renderDrafts();
        return;
      }
      openCompose({
        draftId: d.id,
        to: d.to?.username,
        subject: d.subject,
        body: d.body,
        readOnly: d.source === 'seed',
        evidenceId: d.evidence_id,
      });
    });
  });
}

async function renderStarred() {
  setActiveFolder('starred');
  mainEl.innerHTML = '<div class="loading">Loading…</div>';
  const [{ inbox }, { sent }] = await Promise.all([
    api('/api/inbox').then((r) => r.json()),
    api('/api/sent').then((r) => r.json()),
  ]);
  seedStarred(inbox);
  // Each item keeps starKey (what the star toggle/localStorage uses) separate
  // from navKey (the thread to open on click) -- inbox rows use the thread
  // key for both, sent rows star by evidence_id but still navigate to the
  // thread they belong to.
  const items = [
    ...inbox.filter((i) => starred[i.key]).map((i) => ({ ...i, starKey: i.key, navKey: i.key })),
    ...sent.filter((s) => starred[s.evidence_id]).map((s) => ({ ...s, starKey: s.evidence_id, navKey: s.key })),
  ];

  if (!items.length) {
    mainEl.innerHTML = '<div class="empty">No starred conversations.</div>';
    return;
  }

  mainEl.innerHTML = `<div class="inbox-list">${items.map((item) => inboxRowHtml(item, item.starKey)).join('')}</div>`;
  mainEl.querySelectorAll('.inbox-row').forEach((el, i) => {
    el.addEventListener('click', () => (window.location.hash = `#/thread/${items[i].navKey}`));
  });
  wireStarButtons(mainEl);
}

async function renderTrash() {
  setActiveFolder('trash');
  mainEl.innerHTML = '<div class="loading">Loading…</div>';
  const { trash } = await api('/api/trash').then((r) => r.json());

  if (!trash.length) {
    mainEl.innerHTML = '<div class="empty">No conversations in Trash.</div>';
    return;
  }

  mainEl.innerHTML = `<div class="inbox-list">${trash.map((item) => inboxRowHtml(item, item.key)).join('')}</div>`;
  wireRows();
}

// ---------------------------------------------------------------------
// thread
// ---------------------------------------------------------------------

async function renderThread(key) {
  setActiveFolder(null);
  mainEl.innerHTML = '<div class="loading">Loading…</div>';
  const data = await api(`/api/threads/${key}`).then((r) => r.json());
  const { subject, emails, is_trashed } = data;
  const isFiller = key.startsWith('filler-');
  const isSpam = isFiller && emails[0]?.source === 'filler' && subject.toLowerCase().includes('won');

  const trashBtnHtml = isFiller
    ? ''
    : is_trashed
    ? '<button class="back-btn" id="restore-btn" title="Restore to Inbox" style="margin-left:auto;">↩ Restore</button>'
    : '<button class="back-btn" id="trash-btn" title="Move to Trash" style="margin-left:auto;">🗑</button>';

  mainEl.innerHTML = `
    <div class="thread-view">
      <div class="thread-toolbar">
        <button class="back-btn" id="back-btn" title="Back">←</button>
        <div class="thread-subject">${escapeHtml(subject)}</div>
        ${trashBtnHtml}
      </div>
      <div class="thread-body">
        ${isSpam ? '<div class="spam-warning">This message looks like spam. Never share bank details or personal information over email.</div>' : ''}
        ${is_trashed ? '<div class="spam-warning" style="color:var(--text-dim); background:var(--bg); border-color:var(--border);">This conversation is in Trash.</div>' : ''}
        ${emails.map(msgCardHtml).join('')}
        ${isFiller ? '' : replyBoxHtml()}
      </div>
    </div>
  `;

  document.getElementById('back-btn').addEventListener('click', () => window.history.back());

  const trashBtn = document.getElementById('trash-btn');
  if (trashBtn) {
    trashBtn.addEventListener('click', async () => {
      await api(`/api/threads/${key}/trash`, { method: 'POST' });
      showToast('Moved to Trash');
      window.location.hash = '#/';
    });
  }
  const restoreBtn = document.getElementById('restore-btn');
  if (restoreBtn) {
    restoreBtn.addEventListener('click', async () => {
      await api(`/api/threads/${key}/restore`, { method: 'POST' });
      showToast('Restored to Inbox');
      window.location.hash = '#/';
    });
  }

  if (!isFiller) {
    const textarea = document.getElementById('reply-textarea');
    const sendBtn = document.getElementById('reply-send');
    textarea.addEventListener('input', () => (sendBtn.disabled = !textarea.value.trim()));
    document.getElementById('reply-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = textarea.value.trim();
      if (!body) return;
      sendBtn.disabled = true;
      try {
        const res = await api(`/api/threads/${key}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ body }),
        });
        const newEmail = await res.json();
        document.querySelector('.reply-box').insertAdjacentHTML('beforebegin', msgCardHtml(newEmail));
        textarea.value = '';
        showToast(`Sent -- evidence ${newEmail.evidence_id}`);
      } finally {
        sendBtn.disabled = !textarea.value.trim();
      }
    });
  }
}

const fileIconSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5z"/><path d="M14 2v6h6"/></svg>';

function attachmentsHtml(attachments) {
  if (!attachments || !attachments.length) return '';
  const chips = attachments.map((a) => {
    const isImage = (a.content_type || '').startsWith('image/');
    const thumb = isImage
      ? `<img class="attach-thumb" src="${a.url}" alt="${escapeHtml(a.filename)}" />`
      : `<div class="attach-thumb attach-file-icon">${fileIconSvg}</div>`;
    return `
      <a class="attachment-chip" href="${a.url}" target="_blank" rel="noopener">
        ${thumb}
        <div class="attach-meta">
          <div class="attach-name">${escapeHtml(a.filename)}</div>
          <div class="attach-size">${escapeHtml(a.size_label || '')}</div>
        </div>
      </a>`;
  }).join('');
  return `<div class="attachments-row">${chips}</div>`;
}

function msgCardHtml(e) {
  const mine = e.sender.username === me.username;
  const playerBadge = e.source === 'player' ? '<span class="player-badge">New</span>' : '';
  const evidenceBadge = e.evidence_id ? `<span class="evidence-badge">${e.evidence_id}</span>` : '';

  const toLine = e.recipient
    ? e.recipient.username === me.username
      ? 'to me'
      : `to ${escapeHtml(e.recipient.display_name)} &lt;${escapeHtml(e.recipient.email_address)}&gt;`
    : '';

  return `
    <div class="msg-card">
      <div class="msg-head">
        <img src="${e.sender.avatar_url}" alt="" />
        <div class="who">
          <div class="from-line">
            <span class="hdr-label">From:</span>
            <span class="name">${mine ? 'You' : escapeHtml(e.sender.display_name)}</span>
            <span class="addr">&lt;${escapeHtml(e.sender.email_address)}&gt;</span>
          </div>
          ${toLine ? `<div class="to-line"><span class="hdr-label">To:</span> ${toLine}</div>` : ''}
        </div>
        <div class="when">${fullDate(e.sent_at)}</div>
      </div>
      <div class="msg-content">${escapeHtml(e.body)}</div>
      ${attachmentsHtml(e.attachments)}
      <div class="msg-meta-row">${playerBadge}${evidenceBadge}</div>
    </div>
  `;
}

function replyBoxHtml() {
  return `
    <form class="reply-box" id="reply-form">
      <textarea id="reply-textarea" placeholder="Write a reply..."></textarea>
      <div class="reply-actions">
        <button type="submit" id="reply-send" disabled>Send</button>
      </div>
    </form>
  `;
}

// ---------------------------------------------------------------------
// compose
// ---------------------------------------------------------------------

let composeReadOnly = false;

function openCompose({ draftId = null, to = '', subject = '', body = '', readOnly = false, evidenceId = null } = {}) {
  editingDraftId = draftId;
  composeReadOnly = readOnly;
  const modal = document.getElementById('compose-modal');
  const toSelect = document.getElementById('compose-to');
  const subjectInput = document.getElementById('compose-subject');
  const textarea = document.getElementById('compose-textarea');
  const sendBtn = document.getElementById('compose-send');
  const composeBody = document.querySelector('.compose-body');
  const banner = document.getElementById('read-only-banner');
  const badge = document.getElementById('read-only-evidence-badge');
  const title = document.getElementById('compose-title');
  const actions = document.getElementById('compose-actions');

  toSelect.innerHTML = '<option value="">To</option>' + contacts.map((c) => `<option value="${c.username}">${escapeHtml(c.display_name)} &lt;${escapeHtml(c.email_address || '')}&gt;</option>`).join('');
  toSelect.value = to || '';
  subjectInput.value = subject || '';
  textarea.value = body || '';

  title.textContent = readOnly ? 'Draft' : 'New Message';
  banner.hidden = !readOnly;
  if (readOnly) badge.textContent = evidenceId || '';
  toSelect.disabled = readOnly;
  subjectInput.disabled = readOnly;
  textarea.readOnly = readOnly;
  composeBody.toggleAttribute('data-readonly', readOnly);
  actions.hidden = readOnly;
  sendBtn.disabled = readOnly || !(toSelect.value && textarea.value.trim());

  modal.hidden = false;
}

async function closeComposeAndSaveDraft() {
  const modal = document.getElementById('compose-modal');

  if (composeReadOnly) {
    // Read-only evidence: just close, no save/delete calls at all.
    modal.hidden = true;
    editingDraftId = null;
    composeReadOnly = false;
    return;
  }

  const to = document.getElementById('compose-to').value;
  const subject = document.getElementById('compose-subject').value;
  const body = document.getElementById('compose-textarea').value;

  modal.hidden = true;

  if (!to && !subject.trim() && !body.trim()) {
    if (editingDraftId) await api(`/api/drafts/${editingDraftId}`, { method: 'DELETE' });
    editingDraftId = null;
    return;
  }

  if (editingDraftId) {
    await api(`/api/drafts/${editingDraftId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to, subject, body }),
    });
  } else {
    await api('/api/drafts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to, subject, body }),
    });
  }
  showToast('Saved to Drafts');
  editingDraftId = null;
  if (!window.location.hash || window.location.hash === '#/drafts') renderDrafts();
}

function initCompose() {
  document.getElementById('compose-btn').addEventListener('click', () => openCompose());
  document.getElementById('compose-close').addEventListener('click', closeComposeAndSaveDraft);

  const toSelect = document.getElementById('compose-to');
  const subjectInput = document.getElementById('compose-subject');
  const textarea = document.getElementById('compose-textarea');
  const sendBtn = document.getElementById('compose-send');
  const updateSendState = () => (sendBtn.disabled = composeReadOnly || !(toSelect.value && textarea.value.trim()));
  toSelect.addEventListener('change', updateSendState);
  textarea.addEventListener('input', updateSendState);
  subjectInput.addEventListener('input', updateSendState);

  sendBtn.addEventListener('click', async () => {
    if (composeReadOnly) return;
    const to = toSelect.value;
    const subject = subjectInput.value;
    const body = textarea.value;
    if (!to || !body.trim()) return;
    sendBtn.disabled = true;
    try {
      const res = await api('/api/compose', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to, subject, body, draftId: editingDraftId }),
      });
      const created = await res.json();
      document.getElementById('compose-modal').hidden = true;
      editingDraftId = null;
      showToast(`Sent -- evidence ${created.evidence_id}`);
      window.location.hash = `#/thread/${created.thread_key}`;
    } finally {
      sendBtn.disabled = false;
    }
  });
}

// ---------------------------------------------------------------------
// routing
// ---------------------------------------------------------------------

function route() {
  const hash = window.location.hash || '#/';
  const threadMatch = hash.match(/^#\/thread\/(.+)$/);
  if (threadMatch) return renderThread(threadMatch[1]);
  if (hash === '#/sent') return renderSent();
  if (hash === '#/drafts') return renderDrafts();
  if (hash === '#/starred') return renderStarred();
  if (hash === '#/trash') return renderTrash();
  return renderInbox();
}

(async function init() {
  me = await api('/api/me').then((r) => r.json());
  document.getElementById('nav-avatar').src = me.avatar_url;
  document.getElementById('nav-avatar').addEventListener('click', () => {
    localStorage.removeItem('eml_token');
    window.location.href = '/index.html';
  });
  document.getElementById('home-link').addEventListener('click', () => (window.location.hash = '#/'));
  document.getElementById('menu-btn').addEventListener('click', () => {
    document.getElementById('sidebar').classList.toggle('collapsed');
  });

  document.querySelectorAll('.folder-item').forEach((el) => {
    el.addEventListener('click', () => {
      const folder = el.dataset.folder;
      window.location.hash = folder === 'inbox' ? '#/' : `#/${folder}`;
    });
  });

  contacts = (await api('/api/contacts').then((r) => r.json())).contacts;
  initCompose();

  window.addEventListener('hashchange', route);
  route();
})();
