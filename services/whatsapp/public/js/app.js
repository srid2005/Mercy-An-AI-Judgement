const shell = document.getElementById('app-shell');
const chatListEl = document.getElementById('chat-list');
const threadPane = document.getElementById('chat-thread-pane');

let me = null;
let activeKey = null;
let chatsCache = [];

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

let toastTimer = null;
function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

async function api(path, opts = {}) {
  const res = await fetch(path, opts);
  return res;
}

// ---------------------------------------------------------------------
// chat list
// ---------------------------------------------------------------------

async function loadChats() {
  const { chats } = await api('/api/chats').then((r) => r.json());
  chatsCache = chats;
  renderChatList();
}

function renderChatList() {
  if (!chatsCache.length) {
    chatListEl.innerHTML = '<div class="empty">No chats yet.</div>';
    return;
  }
  chatListEl.innerHTML = chatsCache
    .map(
      (c) => `
    <div class="chat-row ${c.key === activeKey ? 'active' : ''}" data-key="${c.key}">
      <img src="${c.avatar_url}" alt="" />
      <div class="meta">
        <div class="top-line">
          <span class="name">${escapeHtml(c.display_name)}</span>
          <span class="time">${timeAgo(c.last_sent_at)}</span>
        </div>
        <div class="preview">${c.last_sender_is_me ? 'You: ' : ''}${escapeHtml(c.last_body)}</div>
      </div>
    </div>`
    )
    .join('');

  chatListEl.querySelectorAll('.chat-row').forEach((el) => {
    el.addEventListener('click', () => openChat(el.dataset.key));
  });
}

// ---------------------------------------------------------------------
// thread
// ---------------------------------------------------------------------

async function openChat(key) {
  activeKey = key;
  shell.classList.add('chat-open');
  renderChatList();

  threadPane.innerHTML = '<div class="loading">Loading…</div>';
  const { contact, thread } = await api(`/api/chats/${key}`).then((r) => r.json());

  const sub =
    contact.kind === 'group'
      ? contact.participants.map((p) => p.display_name).join(', ')
      : contact.kind === 'filler'
      ? 'Business account'
      : 'online';

  threadPane.innerHTML = `
    <div class="thread-header">
      <button class="back-btn" id="back-btn" title="Back">←</button>
      <img src="${contact.avatar_url}" alt="" />
      <div>
        <div class="name">${escapeHtml(contact.display_name)}</div>
        <div class="sub">${escapeHtml(sub)}</div>
      </div>
    </div>
    <div class="thread-messages" id="thread-messages">
      ${thread.map((m) => bubbleHtml(m, contact.kind === 'group')).join('')}
    </div>
    <form class="composer" id="composer">
      <input type="text" id="msg-input" placeholder="Type a message" autocomplete="off" />
      <button type="submit" id="msg-send" title="Send">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></svg>
      </button>
    </form>
  `;

  document.getElementById('back-btn').addEventListener('click', () => {
    shell.classList.remove('chat-open');
  });

  const messagesEl = document.getElementById('thread-messages');
  messagesEl.scrollTop = messagesEl.scrollHeight;

  const input = document.getElementById('msg-input');
  document.getElementById('composer').addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = input.value.trim();
    if (!body) return;
    input.disabled = true;
    try {
      const res = await api(`/api/chats/${key}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body }),
      });
      const message = await res.json();
      messagesEl.insertAdjacentHTML('beforeend', bubbleHtml(message, contact.kind === 'group'));
      messagesEl.scrollTop = messagesEl.scrollHeight;
      input.value = '';
      showToast(message.evidence_id ? `Sent -- evidence ${message.evidence_id}` : 'Sent');
      loadChats();
    } finally {
      input.disabled = false;
      input.focus();
    }
  });
}

function bubbleHtml(m, showSenderName) {
  const mine = m.sender === me.username;
  const playerBadge = m.source === 'player' ? '<span class="player-badge">New</span>' : '';
  const evidenceBadge = m.evidence_id ? `<span class="evidence-badge">${m.evidence_id}</span>` : '';
  const senderLabel = !mine && showSenderName ? `<div class="bubble-sender">${escapeHtml(m.sender_display_name)}</div>` : '';
  const deletedIcon = m.deleted
    ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:13px;height:13px;flex-shrink:0;"><path d="M4.93 4.93 19.07 19.07"/><circle cx="12" cy="12" r="9"/></svg>'
    : '';
  const bodyHtml = m.deleted
    ? `${deletedIcon}<span>This message was deleted</span>`
    : `${escapeHtml(m.body)}${playerBadge}`;
  return `
    <div class="bubble-row ${mine ? 'mine' : 'theirs'}">
      ${senderLabel}
      <div class="bubble ${m.deleted ? 'deleted' : ''}">
        ${bodyHtml}
        <div class="bubble-meta"><span>${timeAgo(m.sent_at)}</span>${evidenceBadge}</div>
      </div>
    </div>
  `;
}

(async function init() {
  me = await api('/api/me').then((r) => r.json());
  await loadChats();
})();
