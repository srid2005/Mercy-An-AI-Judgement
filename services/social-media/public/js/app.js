const token = localStorage.getItem('sm_token');
if (!token) {
  window.location.href = '/index.html';
}

const authHeaders = { Authorization: `Bearer ${token}` };
const mainCol = document.getElementById('main-col');
const rightRail = document.getElementById('right-rail');

let me = null; // logged-in account profile, fetched once
let likedLocal = JSON.parse(localStorage.getItem('sm_liked') || '{}');
let savedLocal = JSON.parse(localStorage.getItem('sm_saved') || '{}');
const postsByEvidence = {}; // evidence_id -> live post object, shared across every rendered copy

function pluralize(n, word) {
  return `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`;
}

// ---------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Intrinsic pixel size of a seeded photo, handed down by /api/feed from the
// image manifest. Putting it on the <img> lets the browser reserve the box
// before the bytes land, so a page of posts stops reflowing under the reader
// as each one arrives. Player uploads are data: URLs with no manifest entry --
// they come back without a size and size themselves, exactly as before.
function imgSize(item) {
  return item.image_width && item.image_height
    ? ` width="${item.image_width}" height="${item.image_height}"`
    : '';
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
  return 'just now';
}

function fullDate(iso) {
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
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
  const res = await fetch(path, {
    ...opts,
    headers: { ...(opts.headers || {}), ...authHeaders },
  });
  if (res.status === 401) {
    localStorage.removeItem('sm_token');
    window.location.href = '/index.html';
    throw new Error('unauthorized');
  }
  return res;
}

// ---------------------------------------------------------------------
// nav / account menu
// ---------------------------------------------------------------------

async function initNav() {
  me = await api('/api/me').then((r) => r.json());
  document.getElementById('nav-avatar').src = me.avatar_url;

  document.getElementById('home-link').addEventListener('click', () => (window.location.hash = '#/'));
  document.getElementById('home-btn').addEventListener('click', () => (window.location.hash = '#/'));
  document.getElementById('messages-btn').addEventListener('click', () => (window.location.hash = '#/messages'));
  document.getElementById('notifications-btn').addEventListener('click', () => showToast('No new notifications.'));
  document.getElementById('new-post-btn').addEventListener('click', openCreatePostModal);

  const dropdown = document.getElementById('account-dropdown');
  document.getElementById('account-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    dropdown.hidden = !dropdown.hidden;
  });
  document.addEventListener('click', () => (dropdown.hidden = true));

  document.getElementById('menu-profile').addEventListener('click', () => {
    dropdown.hidden = true;
    window.location.hash = `#/profile/${me.username}`;
  });
  document.getElementById('menu-saved').addEventListener('click', () => {
    dropdown.hidden = true;
    showToast('Nothing saved yet.');
  });
  document.getElementById('menu-settings').addEventListener('click', () => {
    dropdown.hidden = true;
    showToast('Settings not available on this device.');
  });
  document.getElementById('menu-logout').addEventListener('click', () => {
    localStorage.removeItem('sm_token');
    window.location.href = '/index.html';
  });
}

// ---------------------------------------------------------------------
// right rail
// ---------------------------------------------------------------------

async function fetchUsers() {
  return api('/api/users').then((r) => r.json()).then((d) => d.users);
}

async function renderRightRail() {
  const users = await fetchUsers();
  const strangers = users.filter((u) => !u.following);

  rightRail.innerHTML = `
    <div class="profile-card">
      <img src="${me.avatar_url}" alt="" />
      <div>
        <div class="name">${escapeHtml(me.username)}</div>
        <div class="handle">${escapeHtml(me.display_name)}</div>
      </div>
    </div>
    ${
      strangers.length
        ? `
    <div class="suggestions-head"><span>Suggested for you</span><span>See All</span></div>
    ${strangers
      .map(
        (u) => `
      <div class="suggestion-row" data-row="${u.username}">
        <img src="${u.avatar_url}" alt="" />
        <div class="meta">
          <div class="u">${escapeHtml(u.username)}</div>
          <div class="sub">${escapeHtml(u.display_name)}</div>
        </div>
        <button data-follow="${u.username}">Follow</button>
      </div>`
      )
      .join('')}`
        : ''
    }
  `;
  rightRail.querySelectorAll('[data-follow]').forEach((btn) =>
    btn.addEventListener('click', async () => {
      const username = btn.dataset.follow;
      btn.disabled = true;
      await api(`/api/users/${username}/follow`, { method: 'POST' });
      showToast(`Now following ${username}`);
      rightRail.querySelector(`[data-row="${username}"]`)?.remove();
    })
  );
}

// ---------------------------------------------------------------------
// stories bar -- only actual connections (people Meera already follows)
// ---------------------------------------------------------------------

async function renderStories() {
  const users = await fetchUsers();
  const bar = document.createElement('div');
  bar.className = 'stories-bar';
  bar.innerHTML = `
    <div class="story" id="your-story">
      <div class="ring seen"><img src="${me.avatar_url}" alt="" /></div>
      <div class="label">Your story</div>
    </div>
    ${users
      .filter((u) => u.following && u.username !== 'ravi_sharma')
      .map(
        (u) => `
      <div class="story" data-username="${u.username}" data-name="${escapeHtml(u.display_name)}" data-avatar="${u.avatar_url}">
        <div class="ring"><img src="${u.avatar_url}" alt="" /></div>
        <div class="label">${escapeHtml(u.username)}</div>
      </div>`
      )
      .join('')}
  `;
  mainCol.appendChild(bar);

  bar.querySelector('#your-story').addEventListener('click', openCreatePostModal);
  bar.querySelectorAll('.story[data-username]').forEach((el) => {
    el.addEventListener('click', () => openStoryViewer(el.dataset.name, el.dataset.avatar));
    el.addEventListener('click', () => el.querySelector('.ring').classList.add('seen'), { once: true });
  });
}

function openStoryViewer(name, avatar) {
  const viewer = document.getElementById('story-viewer');
  const img = document.getElementById('story-viewer-img');
  const bar = document.getElementById('story-progress-bar');
  document.getElementById('story-who-avatar').src = avatar;
  document.getElementById('story-who-name').textContent = name;
  img.src = avatar;
  viewer.hidden = false;
  bar.style.transition = 'none';
  bar.style.width = '0%';
  requestAnimationFrame(() => {
    bar.style.transition = 'width 3.2s linear';
    bar.style.width = '100%';
  });
  const close = () => {
    viewer.hidden = true;
    clearTimeout(timer);
  };
  const timer = setTimeout(close, 3200);
  document.getElementById('story-viewer-close').onclick = close;
  viewer.onclick = (e) => {
    if (e.target === viewer) close();
  };
}

// ---------------------------------------------------------------------
// post rendering (shared between feed + profile lightbox)
// ---------------------------------------------------------------------

// Compact preview used on feed/grid cards: last 2 comments, each with a small
// avatar (matches the richer permalink view instead of plain text-only
// rows). "View all" opens the same full-thread modal used from a profile --
// real Instagram jumps to the post's own comments screen rather than
// expanding inline.
function commentRowHtml(c) {
  const playerBadge = c.source === 'player' ? '<span class="player-badge">New</span>' : '';
  return `<div class="comment"><img class="comment-avatar" src="${c.author.avatar_url}" alt="" width="18" height="18" loading="lazy" decoding="async" /><span class="comment-author">${escapeHtml(c.author.username)}</span><span>${escapeHtml(c.body)}${playerBadge}</span><span class="evidence-badge">${c.evidence_id}</span></div>`;
}

function commentsBlockHtml(post) {
  if (!post.comments.length) {
    return `<div class="comments-block" data-comments-for="${post.evidence_id}"></div>`;
  }
  const preview = post.comments.slice(-2);
  const hasMore = post.comments.length > preview.length;
  return `
    <div class="comments-block" data-comments-for="${post.evidence_id}">
      ${hasMore ? `<button class="view-comments-toggle" data-open-detail="${post.evidence_id}">View all ${pluralize(post.comments.length, 'comment')}</button>` : ''}
      <div class="comments">${preview.map(commentRowHtml).join('')}</div>
    </div>
  `;
}

function refreshComments(evidenceId) {
  const post = postsByEvidence[evidenceId];
  if (!post) return;
  document.querySelectorAll(`[data-comments-for="${evidenceId}"]`).forEach((el) => {
    el.outerHTML = commentsBlockHtml(post);
  });
}

// Full, non-truncated comment thread used only in the post-detail modal
// (opened from a profile grid) -- Instagram's permalink view always shows
// every comment inline with an avatar, rather than the feed's compact
// "last 2 comments" preview.
function fullCommentRowHtml(c) {
  const playerBadge = c.source === 'player' ? '<span class="player-badge">New</span>' : '';
  return `
    <div class="pd-comment">
      <img class="avatar" src="${c.author.avatar_url}" alt="" width="28" height="28" decoding="async" />
      <div class="body">
        <span class="comment-author">${escapeHtml(c.author.username)}</span> ${escapeHtml(c.body)}${playerBadge}
        <div class="meta-row"><span>${timeAgo(c.commented_at)}</span><span class="evidence-badge">${c.evidence_id}</span></div>
      </div>
    </div>`;
}

function fullCommentsHtml(post) {
  const tags = post.tags.length
    ? `<div class="pd-tags">${post.tags.map((t) => `@${escapeHtml(t.username)}`).join('  ')}</div>`
    : '';
  const captionRow = `
    <div class="pd-comment">
      <img class="avatar" src="${post.author.avatar_url}" alt="" width="28" height="28" decoding="async" />
      <div class="body">
        <span class="comment-author">${escapeHtml(post.author.username)}</span> ${escapeHtml(post.caption)}
        ${tags}
        <div class="meta-row"><span>${fullDate(post.posted_at)}</span></div>
      </div>
    </div>`;
  return captionRow + post.comments.map(fullCommentRowHtml).join('');
}

function refreshFullComments(evidenceId) {
  const post = postsByEvidence[evidenceId];
  if (!post) return;
  document.querySelectorAll(`[data-full-comments-for="${evidenceId}"]`).forEach((el) => {
    el.innerHTML = fullCommentsHtml(post);
  });
}

function postDetailHtml(post) {
  postsByEvidence[post.evidence_id] = post;
  const liked = !!likedLocal[post.evidence_id];
  const saved = !!savedLocal[post.evidence_id];
  const likeCount = post.likes_count + (liked ? 1 : 0);
  const playerBadge = post.source === 'player' ? '<span class="player-badge">New</span>' : '';

  return `
    <div data-evidence="${post.evidence_id}" style="display:flex; width:100%; min-height:0;">
      <div class="post-media pd-media">
        <img class="post-image" src="${post.image_url}" alt="post image" data-dbl-like="${post.evidence_id}"${imgSize(post)} decoding="async" />
        <span class="evidence-badge">${post.evidence_id}</span>
        <div class="heart-pop">❤️</div>
      </div>
      <div class="pd-body">
        <div class="pd-header">
          <img class="avatar" src="${post.author.avatar_url}" alt="" width="32" height="32" decoding="async" />
          <div class="author">${escapeHtml(post.author.username)}${playerBadge}</div>
          <button class="modal-close-x" data-close-detail style="margin-left:auto;" title="Close">✕</button>
        </div>
        <div class="pd-comments" data-full-comments-for="${post.evidence_id}">${fullCommentsHtml(post)}</div>
        <div class="post-actions" style="padding:10px 14px 0;">
          <div class="left">
            <button class="icon-btn like-btn ${liked ? 'liked' : ''}" data-like="${post.evidence_id}" title="Like">
              <svg viewBox="0 0 24 24" fill="${liked ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8Z"/></svg>
            </button>
            <button class="icon-btn" title="Comment">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>
            </button>
            <button class="icon-btn" title="Share">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></svg>
            </button>
          </div>
          <button class="icon-btn save save-btn ${saved ? 'saved' : ''}" data-save="${post.evidence_id}" title="Save">
            <svg viewBox="0 0 24 24" fill="${saved ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21 12 16l-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
          </button>
        </div>
        <div class="likes-count" id="likes-${post.evidence_id}" data-base="${post.likes_count}" style="padding:6px 14px;">${pluralize(likeCount, 'like')}</div>
        ${addCommentFormHtml(post)}
      </div>
    </div>
  `;
}

function addCommentFormHtml(post) {
  return `
    <form class="add-comment-form" data-comment-form="${post.evidence_id}">
      <span class="comment-emoji">🙂</span>
      <input type="text" placeholder="Add a comment..." data-comment-input="${post.evidence_id}" autocomplete="off" />
      <button type="submit" data-comment-submit="${post.evidence_id}" disabled>Post</button>
    </form>
  `;
}

// Sponsored posts / meme accounts: feed noise, not evidence. No comments, no
// evidence badge, no detail modal -- just image, caption, decorative
// like/save, and (for ads) a CTA button. Never cached in postsByEvidence.
function fillerCardHtml(item) {
  const key = item.ui_id;
  const liked = !!likedLocal[key];
  const saved = !!savedLocal[key];
  const likeCount = item.likes_count + (liked ? 1 : 0);
  const isAd = item.kind === 'ad';

  const cta = isAd && item.cta_label
    ? `<button class="ad-cta-btn" data-ad-cta>${escapeHtml(item.cta_label)}</button>`
    : '';

  return `
    <article class="post" data-evidence="${key}">
      <div class="post-head">
        <img class="avatar" src="${item.author.avatar_url}" alt="" width="32" height="32" loading="lazy" decoding="async" />
        <div>
          <div class="author">${escapeHtml(item.author.username)}</div>
          ${isAd ? '<div class="meta">Sponsored</div>' : ''}
        </div>
        <div class="post-head-right">${isAd ? '' : `<span class="meta">${timeAgo(item.posted_at)}</span>`}</div>
      </div>
      <div class="post-media">
        <img class="post-image" src="${item.image_url}" alt="" data-dbl-like="${key}"${imgSize(item)} loading="lazy" decoding="async" />
        <div class="heart-pop">❤️</div>
      </div>
      <div class="post-actions">
        <div class="left">
          <button class="icon-btn like-btn ${liked ? 'liked' : ''}" data-like="${key}" title="Like">
            <svg viewBox="0 0 24 24" fill="${liked ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8Z"/></svg>
          </button>
          <button class="icon-btn" title="Share">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></svg>
          </button>
        </div>
        <button class="icon-btn save save-btn ${saved ? 'saved' : ''}" data-save="${key}" title="Save">
          <svg viewBox="0 0 24 24" fill="${saved ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21 12 16l-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
        </button>
      </div>
      <div class="likes-count" id="likes-${key}" data-base="${item.likes_count}">${pluralize(likeCount, 'like')}</div>
      <div class="caption"><span class="cap-author">${escapeHtml(item.author.username)}</span>${escapeHtml(item.caption)}</div>
      ${cta}
    </article>
  `;
}

function postCardHtml(post) {
  if (post.kind && post.kind !== 'post') return fillerCardHtml(post);
  postsByEvidence[post.evidence_id] = post;

  const liked = !!likedLocal[post.evidence_id];
  const saved = !!savedLocal[post.evidence_id];
  const likeCount = post.likes_count + (liked ? 1 : 0);

  const tags = post.tags.length
    ? `<div class="caption"><span style="color:var(--accent);font-size:12px;">${post.tags
        .map((t) => `@${escapeHtml(t.username)}`)
        .join('  ')}</span></div>`
    : '';

  const playerBadge = post.source === 'player' ? '<span class="player-badge">New</span>' : '';

  return `
    <article class="post" data-evidence="${post.evidence_id}">
      <div class="post-head">
        <img class="avatar" src="${post.author.avatar_url}" alt="" width="32" height="32" loading="lazy" decoding="async" />
        <div>
          <div class="author">${escapeHtml(post.author.username)}${playerBadge}</div>
        </div>
        <div class="post-head-right">
          <span class="meta">${timeAgo(post.posted_at)}</span>
        </div>
      </div>
      <div class="post-media">
        <img class="post-image" src="${post.image_url}" alt="post image" data-dbl-like="${post.evidence_id}"${imgSize(post)} loading="lazy" decoding="async" />
        <span class="evidence-badge">${post.evidence_id}</span>
        <div class="heart-pop">❤️</div>
      </div>
      <div class="post-actions">
        <div class="left">
          <button class="icon-btn like-btn ${liked ? 'liked' : ''}" data-like="${post.evidence_id}" title="Like">
            <svg viewBox="0 0 24 24" fill="${liked ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8Z"/></svg>
          </button>
          <button class="icon-btn" title="Comment" data-open-detail="${post.evidence_id}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>
          </button>
          <button class="icon-btn" title="Share">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></svg>
          </button>
        </div>
        <button class="icon-btn save save-btn ${saved ? 'saved' : ''}" data-save="${post.evidence_id}" title="Save">
          <svg viewBox="0 0 24 24" fill="${saved ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21 12 16l-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
        </button>
      </div>
      <div class="likes-count" id="likes-${post.evidence_id}" data-base="${post.likes_count}">${pluralize(likeCount, 'like')}</div>
      <div class="caption"><span class="cap-author">${escapeHtml(post.author.username)}</span>${escapeHtml(post.caption)}</div>
      ${tags}
      ${commentsBlockHtml(post)}
      <div class="post-timestamp">${fullDate(post.posted_at)} · ${post.evidence_id}</div>
      ${addCommentFormHtml(post)}
    </article>
  `;
}

function wirePostInteractions(root) {
  root.querySelectorAll('[data-like]').forEach((btn) => {
    btn.addEventListener('click', () => toggleLike(btn.dataset.like));
  });
  root.querySelectorAll('[data-save]').forEach((btn) => {
    btn.addEventListener('click', () => toggleSave(btn.dataset.save));
  });
  root.querySelectorAll('[data-open-detail]').forEach((el) => {
    el.addEventListener('click', () => openPostDetail(el.dataset.openDetail));
  });
  root.querySelectorAll('[data-comment-form]').forEach((form) => {
    const evidenceId = form.dataset.commentForm;
    const input = form.querySelector('[data-comment-input]');
    const submitBtn = form.querySelector('[data-comment-submit]');
    input.addEventListener('input', () => {
      submitBtn.disabled = !input.value.trim();
    });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = input.value.trim();
      if (!body) return;
      submitBtn.disabled = true;
      try {
        const res = await api(`/api/posts/${evidenceId}/comments`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ body }),
        });
        const comment = await res.json();
        postsByEvidence[evidenceId].comments.push(comment);
        input.value = '';
        refreshComments(evidenceId);
        refreshFullComments(evidenceId);
      } finally {
        submitBtn.disabled = !input.value.trim();
      }
    });
  });
  root.querySelectorAll('[data-dbl-like]').forEach((img) => {
    img.addEventListener('dblclick', () => {
      const id = img.dataset.dblLike;
      if (!likedLocal[id]) toggleLike(id);
      const pop = img.parentElement.querySelector('.heart-pop');
      pop.classList.remove('animate');
      void pop.offsetWidth;
      pop.classList.add('animate');
    });
  });
  root.querySelectorAll('[data-ad-cta]').forEach((btn) => {
    btn.addEventListener('click', () => showToast('This is a placeholder ad -- nothing to buy here.'));
  });
}

function toggleLike(evidenceId) {
  likedLocal[evidenceId] = !likedLocal[evidenceId];
  localStorage.setItem('sm_liked', JSON.stringify(likedLocal));
  document.querySelectorAll(`[data-evidence="${evidenceId}"]`).forEach((card) => {
    const btn = card.querySelector('[data-like]');
    const countEl = card.querySelector(`#likes-${evidenceId}`);
    const baseCount = Number(countEl.dataset.base);
    const liked = likedLocal[evidenceId];
    countEl.textContent = pluralize(baseCount + (liked ? 1 : 0), 'like');
    btn.classList.toggle('liked', liked);
    btn.querySelector('svg').setAttribute('fill', liked ? 'currentColor' : 'none');
  });
}

function toggleSave(evidenceId) {
  savedLocal[evidenceId] = !savedLocal[evidenceId];
  localStorage.setItem('sm_saved', JSON.stringify(savedLocal));
  document.querySelectorAll(`[data-save="${evidenceId}"]`).forEach((btn) => {
    const saved = savedLocal[evidenceId];
    btn.classList.toggle('saved', saved);
    btn.querySelector('svg').setAttribute('fill', saved ? 'currentColor' : 'none');
  });
  showToast(savedLocal[evidenceId] ? 'Saved' : 'Removed');
}

// ---------------------------------------------------------------------
// views
// ---------------------------------------------------------------------

// The feed arrives a page at a time instead of as Meera's whole life in one
// response, and each page is appended as its own block -- so the column paints
// after the first dozen posts rather than after the last, and pulling the next
// page never re-renders (or re-fetches the images of) the cards already up.
const FEED_PAGE_SIZE = 12;
let feedPager = null; // the live observer; only one feed is on screen at a time

async function renderFeedView() {
  feedPager?.disconnect();
  mainCol.innerHTML = '<div class="loading">Loading…</div>';
  await renderRightRail();

  const first = await api(`/api/feed?limit=${FEED_PAGE_SIZE}`).then((r) => r.json());
  mainCol.innerHTML = '';
  await renderStories();

  if (!first.feed.length) {
    mainCol.insertAdjacentHTML('beforeend', '<div class="empty">Nothing here.</div>');
    return;
  }

  const feedEl = document.createElement('div');
  feedEl.className = 'feed-column';
  mainCol.appendChild(feedEl);
  appendFeedPage(feedEl, first.feed);

  let offset = first.next_offset;
  let hasMore = first.has_more;
  if (!hasMore) return;

  // Loads a page ahead of the scroll position, so in practice the next cards
  // are already there by the time the player reaches the bottom of these.
  const sentinel = document.createElement('div');
  sentinel.className = 'feed-sentinel';
  mainCol.appendChild(sentinel);

  let loading = false;
  const pager = new IntersectionObserver(
    async (entries) => {
      if (!entries[0].isIntersecting || loading || !hasMore) return;
      loading = true;
      sentinel.textContent = 'Loading…';
      try {
        const page = await api(`/api/feed?limit=${FEED_PAGE_SIZE}&offset=${offset}`).then((r) => r.json());
        appendFeedPage(feedEl, page.feed);
        offset = page.next_offset;
        hasMore = page.has_more;
      } finally {
        loading = false;
        sentinel.textContent = '';
        if (!hasMore) {
          pager.disconnect();
          sentinel.remove();
        }
      }
    },
    { rootMargin: '600px' }
  );
  pager.observe(sentinel);
  feedPager = pager;
}

// One page of cards in its own container: appending leaves every card already
// on screen untouched, where re-rendering the column would drop and re-request
// each image above the fold.
function appendFeedPage(feedEl, items) {
  const page = document.createElement('div');
  page.className = 'feed-page';
  page.innerHTML = items.map(postCardHtml).join('');
  feedEl.appendChild(page);
  wirePostInteractions(page);
}

async function renderProfileView(username) {
  mainCol.innerHTML = '<div class="loading">Loading…</div>';
  rightRail.innerHTML = '';

  const profile = await api(`/api/users/${username}`).then((r) => r.json());
  const isMe = username === me.username;

  mainCol.innerHTML = `
    <div class="profile-header">
      <img class="big-avatar" src="${profile.avatar_url}" alt="" />
      <div class="info">
        <div class="top-row">
          <div class="username">${escapeHtml(profile.username)}</div>
          ${isMe ? '<button class="settings-btn" id="edit-profile-btn">Edit Profile</button>' : '<button class="settings-btn">Message</button>'}
        </div>
        <div class="profile-stats">
          <span><b>${profile.posts_count}</b> posts</span>
          <span><b>${profile.followers_count.toLocaleString()}</b> followers</span>
          <span><b>${profile.following_count.toLocaleString()}</b> following</span>
        </div>
        <div class="display-name">${escapeHtml(profile.display_name)}</div>
        <div class="bio">${escapeHtml(profile.bio || '')}</div>
      </div>
    </div>
    <div class="post-grid" id="post-grid"></div>
  `;

  if (isMe) {
    document.getElementById('edit-profile-btn').addEventListener('click', () => showToast('Editing isn\'t available on this device.'));
  }

  const grid = document.getElementById('post-grid');
  if (!profile.posts.length) {
    grid.innerHTML = '<div class="empty" style="grid-column: 1 / -1;">No posts yet.</div>';
    return;
  }
  grid.innerHTML = profile.posts
    .map(
      (p) => `
    <div class="grid-item" data-evidence="${p.evidence_id}">
      <img src="${p.image_url}" alt=""${imgSize(p)} loading="lazy" decoding="async" />
      <span class="evidence-badge grid-evidence">${p.evidence_id}</span>
    </div>`
    )
    .join('');

  grid.querySelectorAll('.grid-item').forEach((el) => {
    el.addEventListener('click', () => openPostDetail(el.dataset.evidence));
  });
}

// ---------------------------------------------------------------------
// messages (DMs) -- inbox + thread
// ---------------------------------------------------------------------

async function renderMessagesInboxView() {
  mainCol.innerHTML = '<div class="loading">Loading…</div>';
  rightRail.innerHTML = '';

  const { threads } = await api('/api/messages').then((r) => r.json());

  if (!threads.length) {
    mainCol.innerHTML = '<div class="empty">No messages yet.</div>';
    return;
  }

  mainCol.innerHTML = `
    <div class="dm-inbox">
      ${threads
        .map(
          (t) => `
        <div class="dm-row" data-thread="${t.key}">
          <img src="${t.avatar_url}" alt="" />
          <div class="meta">
            <div class="u">${escapeHtml(t.display_name)}</div>
            <div class="sub">${t.last_sender_is_me ? 'You: ' : ''}${escapeHtml(t.last_body)}</div>
          </div>
          <div class="dm-time">${timeAgo(t.last_sent_at)}</div>
        </div>`
        )
        .join('')}
    </div>
  `;

  mainCol.querySelectorAll('.dm-row').forEach((el) => {
    el.addEventListener('click', () => (window.location.hash = `#/messages/${el.dataset.thread}`));
  });
}

async function renderMessageThreadView(key) {
  mainCol.innerHTML = '<div class="loading">Loading…</div>';
  rightRail.innerHTML = '';

  const { thread, contact } = await api(`/api/messages/${key}`).then((r) => r.json());

  mainCol.innerHTML = `
    <div class="dm-thread">
      <div class="dm-thread-header">
        <button class="modal-close-x" id="dm-back" title="Back to messages">←</button>
        <img src="${contact.avatar_url}" alt="" />
        <div class="author">${escapeHtml(contact.display_name)}</div>
      </div>
      <div class="dm-messages" id="dm-messages">
        ${thread.map((m) => dmBubbleHtml(m)).join('')}
      </div>
      <form class="add-comment-form" id="dm-form">
        <input type="text" placeholder="Message..." id="dm-input" autocomplete="off" />
        <button type="submit" id="dm-submit" disabled>Send</button>
      </form>
    </div>
  `;

  document.getElementById('dm-back').addEventListener('click', () => (window.location.hash = '#/messages'));

  const messagesEl = document.getElementById('dm-messages');
  messagesEl.scrollTop = messagesEl.scrollHeight;

  const input = document.getElementById('dm-input');
  const submitBtn = document.getElementById('dm-submit');
  input.addEventListener('input', () => (submitBtn.disabled = !input.value.trim()));
  document.getElementById('dm-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = input.value.trim();
    if (!body) return;
    submitBtn.disabled = true;
    try {
      const res = await api(`/api/messages/${key}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body }),
      });
      const message = await res.json();
      messagesEl.insertAdjacentHTML('beforeend', dmBubbleHtml(message));
      messagesEl.scrollTop = messagesEl.scrollHeight;
      input.value = '';
      showToast(message.evidence_id ? `Sent -- evidence ${message.evidence_id}` : 'Sent');
    } finally {
      submitBtn.disabled = !input.value.trim();
    }
  });
}

function dmBubbleHtml(m) {
  const mine = m.sender === me.username;
  const playerBadge = m.source === 'player' ? '<span class="player-badge">New</span>' : '';
  const evidenceBadge = m.evidence_id ? `<span class="evidence-badge">${m.evidence_id}</span>` : '';
  return `
    <div class="dm-bubble-row ${mine ? 'mine' : ''}">
      <div class="dm-bubble">
        ${escapeHtml(m.body)}${playerBadge}
        <div class="dm-bubble-meta"><span>${timeAgo(m.sent_at)}</span>${evidenceBadge}</div>
      </div>
    </div>
  `;
}

// Opens the full permalink-style modal for any post, from anywhere (feed,
// profile grid, or another post's tag). Uses the live cache when we already
// have the full post (author/tags/comments); otherwise asks for that one post.
// It used to pull the entire feed and linear-search it, which meant opening a
// post from a profile grid downloaded every other post to throw them away.
async function openPostDetail(evidenceId) {
  let post = postsByEvidence[evidenceId];
  if (!post || !post.comments) {
    const res = await api(`/api/posts/${encodeURIComponent(evidenceId)}`);
    if (!res.ok) return;
    post = await res.json();
  }
  if (!post) return;

  const overlay = document.getElementById('post-detail-overlay');
  const content = document.getElementById('post-detail-content');
  content.innerHTML = postDetailHtml(post);
  overlay.hidden = false;
  wirePostInteractions(content);
  content.querySelector('[data-close-detail]').addEventListener('click', () => (overlay.hidden = true));

  overlay.onclick = (e) => {
    if (e.target === overlay) overlay.hidden = true;
  };
}

// ---------------------------------------------------------------------
// create post
// ---------------------------------------------------------------------

let selectedImageDataUrl = null;

function openCreatePostModal() {
  const overlay = document.getElementById('create-post-overlay');
  overlay.hidden = false;
}

function initCreatePostModal() {
  const overlay = document.getElementById('create-post-overlay');
  const dropZone = document.getElementById('upload-drop');
  const fileInput = document.getElementById('file-input');
  const preview = document.getElementById('upload-preview');
  const placeholder = document.getElementById('upload-placeholder');
  const captionInput = document.getElementById('caption-input');
  const shareBtn = document.getElementById('create-post-share');
  const cancelBtn = document.getElementById('create-post-cancel');

  function reset() {
    selectedImageDataUrl = null;
    preview.hidden = true;
    placeholder.hidden = false;
    captionInput.value = '';
    shareBtn.disabled = true;
    fileInput.value = '';
  }

  dropZone.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    const file = fileInput.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      selectedImageDataUrl = reader.result;
      preview.src = selectedImageDataUrl;
      preview.hidden = false;
      placeholder.hidden = true;
      shareBtn.disabled = false;
    };
    reader.readAsDataURL(file);
  });

  cancelBtn.addEventListener('click', () => {
    overlay.hidden = true;
    reset();
  });
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      overlay.hidden = true;
      reset();
    }
  });

  shareBtn.addEventListener('click', async () => {
    if (!selectedImageDataUrl) return;
    shareBtn.disabled = true;
    shareBtn.textContent = 'Sharing…';
    try {
      const res = await api('/api/posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ caption: captionInput.value.trim(), image_url: selectedImageDataUrl }),
      });
      const newPost = await res.json();
      overlay.hidden = true;
      reset();
      showToast(`Posted -- evidence ${newPost.evidence_id}`);
      if (!location.hash || location.hash === '#/') renderFeedView();
    } finally {
      shareBtn.disabled = false;
      shareBtn.textContent = 'Share';
    }
  });
}

// ---------------------------------------------------------------------
// routing
// ---------------------------------------------------------------------

function route() {
  const hash = window.location.hash || '#/';
  const profileMatch = hash.match(/^#\/profile\/(.+)$/);
  const threadMatch = hash.match(/^#\/messages\/(.+)$/);
  document.getElementById('post-detail-overlay').hidden = true;
  if (profileMatch) {
    renderProfileView(profileMatch[1]);
  } else if (threadMatch) {
    renderMessageThreadView(threadMatch[1]);
  } else if (hash === '#/messages') {
    renderMessagesInboxView();
  } else {
    renderFeedView();
  }
}

(async function init() {
  await initNav();
  initCreatePostModal();
  window.addEventListener('hashchange', route);
  route();
})();
