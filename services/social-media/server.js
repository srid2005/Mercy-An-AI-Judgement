const path = require('path');
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { pool, rawPool } = require('./db');
const tenant = require('./tenant');

const PORT = process.env.PORT || 4001;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-secret-change-me';
const MERCY_API_KEY = process.env.MERCY_API_KEY || 'dev-mercy-key';
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || 'dev-internal-key';
const EMAIL_SERVICE_URL = process.env.EMAIL_SERVICE_URL || 'http://localhost:4002';

const app = express();
app.set('x-service', 'social-media');
// Before any route is registered: one participant's failed query must answer
// 500 to them alone, not take the process down for the other forty-nine.
tenant.guardApp(app);
// The browser sends the mercy_sid cookie cross-origin (the laptop embeds this
// app from another port), so CORS has to allow credentials.
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
// Whose game this request belongs to -- resolved before the auth routes,
// which write reset PINs that must land in the participant's own schema.
app.use(tenant.middleware);
app.use(express.static(path.join(__dirname, 'public')));

// Calls this service makes on the participant's behalf (to itself, to Quill)
// carry the participant next to the key, so the far side runs in the same
// schema. In single-player there is no participant and no header.
function playerHeader() {
  const id = tenant.currentId();
  return id ? { 'x-mercy-player': id } : {};
}

// ---------------------------------------------------------------------------
// Player-facing auth: "logging in" to Meera's account inside the game.
// This is a narrative lock screen, not real security -- the password is a
// story clue the player derives from another app (the case file).
// ---------------------------------------------------------------------------
app.post('/api/auth/login', async (req, res) => {
  const { password } = req.body || {};
  const { rows } = await pool.query("SELECT value FROM app_config WHERE key = 'unlock_password'");
  if (!rows.length) return res.status(500).json({ error: 'service not configured' });

  if (password !== rows[0].value) {
    return res.status(401).json({ error: 'incorrect password' });
  }
  const token = jwt.sign({ sub: 'player', account: 'meera' }, JWT_SECRET, { expiresIn: '2h' });
  res.json({ token });
});

app.get('/api/auth/hint', async (req, res) => {
  const { rows } = await pool.query("SELECT value FROM app_config WHERE key = 'unlock_password_hint'");
  res.json({ hint: rows[0]?.value || null });
});

// Shown on the lock screen before login, the way a phone shows whose account
// this is before asking to re-confirm the password. Public, read-only.
app.get('/api/public/account-preview', async (req, res) => {
  const { rows } = await pool.query("SELECT value FROM app_config WHERE key = 'account_owner'");
  const owner = rows[0]?.value;
  const user = await pool.query(
    'SELECT username, display_name, avatar_url FROM users WHERE username = $1',
    [owner]
  );
  if (!user.rows.length) return res.status(404).json({ error: 'not found' });
  res.json(user.rows[0]);
});

// ---------------------------------------------------------------------------
// Forgot password: generates a real 4-digit PIN, emails it to Meera's Quill
// inbox via a real cross-service call, and lets the player back in once they
// bring the PIN back from there. Mirrors how real password-reset flows work
// -- the PIN is single-use and expires after 15 minutes.
// ---------------------------------------------------------------------------
app.post('/api/auth/forgot-password', async (req, res) => {
  // Invalidate any earlier unused PINs so only the newest one ever works.
  await pool.query('UPDATE password_resets SET used = true WHERE used = false');

  const pin = String(Math.floor(1000 + Math.random() * 9000));
  await pool.query('INSERT INTO password_resets (pin) VALUES ($1)', [pin]);

  try {
    await fetch(`${EMAIL_SERVICE_URL}/api/internal/deliver-mail`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-key': INTERNAL_API_KEY, ...playerHeader() },
      body: JSON.stringify({
        sender_name: 'Loop Security',
        sender_email: 'security@loopapp.io',
        subject: 'Your Loop verification code',
        body: `Your one-time code to reset your Loop password is: ${pin}\n\nThis code expires in 15 minutes and can only be used once. If you didn't request this, you can safely ignore this email.`,
        kind: 'notification',
      }),
    });
  } catch (err) {
    console.error('[social-media] failed to deliver reset email:', err.message);
    return res.status(502).json({ error: 'could not send verification email right now' });
  }

  res.json({ sent: true });
});

app.post('/api/auth/verify-reset-pin', async (req, res) => {
  const { pin } = req.body || {};
  if (!pin) return res.status(400).json({ error: 'pin is required' });

  const match = await pool.query(
    `SELECT id FROM password_resets
     WHERE pin = $1 AND used = false AND created_at > now() - interval '15 minutes'
     ORDER BY created_at DESC LIMIT 1`,
    [pin]
  );
  if (!match.rows.length) return res.status(401).json({ error: 'incorrect or expired code' });

  await pool.query('UPDATE password_resets SET used = true WHERE id = $1', [match.rows[0].id]);

  const token = jwt.sign({ sub: 'player', account: 'meera' }, JWT_SECRET, { expiresIn: '2h' });
  res.json({ token });
});

function requirePlayerAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'missing token' });
  try {
    req.player = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'invalid or expired token' });
  }
}

// ---------------------------------------------------------------------------
// Service-to-service auth: this is how MERCY (or any other backend) reads
// evidence out of this container. Separate from the player's login above --
// MERCY always has access to the evidence, the player has to unlock the app.
// ---------------------------------------------------------------------------
function requireMercyKey(req, res, next) {
  if (req.headers['x-mercy-key'] !== MERCY_API_KEY) {
    return res.status(403).json({ error: 'missing or invalid x-mercy-key header' });
  }
  next();
}

// ---------------------------------------------------------------------------
// Feed
// ---------------------------------------------------------------------------
app.get('/api/feed', requirePlayerAuth, async (req, res) => {
  const posts = await pool.query(`
    SELECT p.id, p.evidence_id, p.caption, p.image_url, p.era, p.likes_count, p.source, p.posted_at,
           u.username, u.display_name, u.avatar_url
    FROM posts p JOIN users u ON u.id = p.user_id
    ORDER BY p.posted_at DESC
  `);

  const tags = await pool.query(`
    SELECT t.post_id, u.username, u.display_name
    FROM tags t JOIN users u ON u.id = t.tagged_user_id
  `);
  const comments = await pool.query(`
    SELECT c.id, c.evidence_id, c.post_id, c.body, c.source, c.commented_at,
           u.username, u.display_name, u.avatar_url
    FROM comments c JOIN users u ON u.id = c.user_id
    ORDER BY c.commented_at ASC
  `);

  const tagsByPost = groupBy(tags.rows, 'post_id');
  const commentsByPost = groupBy(comments.rows, 'post_id');

  const feed = posts.rows.map((p) => ({
    evidence_id: p.evidence_id,
    kind: 'post',
    era: p.era,
    source: p.source,
    posted_at: p.posted_at,
    caption: p.caption,
    image_url: p.image_url,
    likes_count: p.likes_count,
    author: { username: p.username, display_name: p.display_name, avatar_url: p.avatar_url },
    tags: (tagsByPost[p.id] || []).map((t) => ({ username: t.username, display_name: t.display_name })),
    comments: (commentsByPost[p.id] || []).map((c) => ({
      evidence_id: c.evidence_id,
      body: c.body,
      source: c.source,
      commented_at: c.commented_at,
      author: { username: c.username, display_name: c.display_name, avatar_url: c.avatar_url },
    })),
  }));

  // Sponsored posts and meme accounts: real feed noise with no evidence_id,
  // interleaved at fixed intervals like a real algorithmic feed. Never
  // returned by /api/evidence -- see the comment on feed_filler in init.sql.
  const filler = await pool.query(
    `SELECT id, kind, account_name, account_avatar, caption, image_url, likes_count, cta_label, posted_at
     FROM feed_filler ORDER BY posted_at DESC`
  );
  const fillerItems = filler.rows.map((f) => ({
    evidence_id: null,
    ui_id: `${f.kind.toUpperCase()}-${f.id}`,
    kind: f.kind,
    posted_at: f.posted_at,
    caption: f.caption,
    image_url: f.image_url,
    likes_count: f.likes_count,
    cta_label: f.cta_label,
    author: { username: f.account_name, display_name: f.account_name, avatar_url: f.account_avatar },
    tags: [],
    comments: [],
  }));

  const INSERT_EVERY = 4;
  fillerItems.forEach((item, i) => {
    const pos = Math.min((i + 1) * INSERT_EVERY, feed.length);
    feed.splice(pos, 0, item);
  });

  res.json({ feed });
});

// The logged-in account's own profile (Meera) -- used to render the nav
// avatar, the account menu, and the right-rail profile card.
app.get('/api/me', requirePlayerAuth, async (req, res) => {
  const owner = (await pool.query("SELECT value FROM app_config WHERE key = 'account_owner'")).rows[0].value;
  const profile = await getProfile(owner);
  if (!profile) return res.status(404).json({ error: 'not found' });
  res.json(profile);
});

// Everyone except the logged-in account, tagged with whether the owner
// already follows them. `following: true` -> a real connection (stories
// bar). `following: false` -> a stranger (right-rail "Suggested for you").
app.get('/api/users', requirePlayerAuth, async (req, res) => {
  const owner = (await pool.query("SELECT value FROM app_config WHERE key = 'account_owner'")).rows[0].value;
  const { rows } = await pool.query(
    `SELECT u.username, u.display_name, u.avatar_url,
            EXISTS (
              SELECT 1 FROM follows f
              JOIN users me ON me.id = f.follower_id
              WHERE me.username = $1 AND f.followee_id = u.id
            ) AS following
     FROM users u
     WHERE u.username != $1
     ORDER BY u.username`,
    [owner]
  );
  res.json({ users: rows });
});

app.post('/api/users/:username/follow', requirePlayerAuth, async (req, res) => {
  const owner = (await pool.query("SELECT value FROM app_config WHERE key = 'account_owner'")).rows[0].value;
  await pool.query(
    `INSERT INTO follows (follower_id, followee_id)
     SELECT (SELECT id FROM users WHERE username=$1), (SELECT id FROM users WHERE username=$2)
     WHERE EXISTS (SELECT 1 FROM users WHERE username=$2)
     ON CONFLICT DO NOTHING`,
    [owner, req.params.username]
  );
  res.json({ following: true });
});

app.delete('/api/users/:username/follow', requirePlayerAuth, async (req, res) => {
  const owner = (await pool.query("SELECT value FROM app_config WHERE key = 'account_owner'")).rows[0].value;
  await pool.query(
    `DELETE FROM follows
     WHERE follower_id = (SELECT id FROM users WHERE username=$1)
       AND followee_id = (SELECT id FROM users WHERE username=$2)`,
    [owner, req.params.username]
  );
  res.json({ following: false });
});

app.get('/api/users/:username', requirePlayerAuth, async (req, res) => {
  const profile = await getProfile(req.params.username);
  if (!profile) return res.status(404).json({ error: 'not found' });
  res.json(profile);
});

async function getProfile(username) {
  const user = await pool.query(
    'SELECT username, display_name, avatar_url, bio, followers_count, following_count FROM users WHERE username = $1',
    [username]
  );
  if (!user.rows.length) return null;

  const posts = await pool.query(
    `SELECT evidence_id, caption, image_url, likes_count, posted_at
     FROM posts WHERE user_id = (SELECT id FROM users WHERE username = $1)
     ORDER BY posted_at DESC`,
    [username]
  );

  return {
    ...user.rows[0],
    posts_count: posts.rows.length,
    posts: posts.rows,
  };
}

// Create a new post on the logged-in account. Gets a real evidence_id from
// the shared counter so it slots into the same evidence stream as the
// seeded story posts (tagged source='player' so consumers can tell the two
// apart -- see ARCHITECTURE.md).
app.post('/api/posts', requirePlayerAuth, async (req, res) => {
  const { caption, image_url } = req.body || {};
  if (!image_url) return res.status(400).json({ error: 'image_url is required' });

  const owner = (await pool.query("SELECT value FROM app_config WHERE key = 'account_owner'")).rows[0].value;
  const ownerRow = (await pool.query('SELECT id, display_name, avatar_url FROM users WHERE username = $1', [owner])).rows[0];

  const seq = await pool.query(
    `UPDATE evidence_counters SET next_seq = next_seq + 1
     WHERE service = 'social-media' RETURNING next_seq - 1 AS seq`
  );
  const evidenceId = `SOC-${String(seq.rows[0].seq).padStart(3, '0')}`;

  const inserted = await pool.query(
    `INSERT INTO posts (evidence_id, user_id, caption, image_url, era, likes_count, source, posted_at)
     VALUES ($1, $2, $3, $4, 'recent', 0, 'player', now())
     RETURNING evidence_id, caption, image_url, era, likes_count, source, posted_at`,
    [evidenceId, ownerRow.id, caption || '', image_url]
  );

  const row = inserted.rows[0];
  res.status(201).json({
    evidence_id: row.evidence_id,
    era: row.era,
    source: row.source,
    posted_at: row.posted_at,
    caption: row.caption,
    image_url: row.image_url,
    likes_count: row.likes_count,
    author: { username: owner, display_name: ownerRow.display_name, avatar_url: ownerRow.avatar_url },
    tags: [],
    comments: [],
  });
});

// Inbox: one row per conversation thread, most recent message first,
// merging real conversations (evidence) with dm_filler threads (a stranger,
// a promo DM -- noise, no evidence_id). A single real thread would make the
// password-clue conversation obvious by elimination; mixing in ordinary and
// junk threads is what makes a real inbox.
app.get('/api/messages', requirePlayerAuth, async (req, res) => {
  const owner = (await pool.query("SELECT value FROM app_config WHERE key = 'account_owner'")).rows[0].value;

  const userThreads = await pool.query(
    `SELECT DISTINCT ON (m.thread_key)
        CASE WHEN su.username = $1 THEN ru.username ELSE su.username END AS key,
        CASE WHEN su.username = $1 THEN ru.display_name ELSE su.display_name END AS display_name,
        CASE WHEN su.username = $1 THEN ru.avatar_url ELSE su.avatar_url END AS avatar_url,
        m.body AS last_body,
        m.sent_at AS last_sent_at,
        (su.username = $1) AS last_sender_is_me
     FROM messages m
     JOIN users su ON su.id = m.sender_id
     JOIN users ru ON ru.id = m.recipient_id
     WHERE su.username = $1 OR ru.username = $1
     ORDER BY m.thread_key, m.sent_at DESC`,
    [owner]
  );

  const fillerThreads = await pool.query(`
    SELECT t.id, t.account_name, t.account_avatar,
           lm.body AS last_body, lm.sent_at AS last_sent_at, lm.from_owner AS last_sender_is_me
    FROM dm_filler_threads t
    JOIN LATERAL (
      SELECT body, sent_at, from_owner FROM dm_filler_messages
      WHERE thread_id = t.id ORDER BY sent_at DESC LIMIT 1
    ) lm ON true
  `);

  const threads = [
    ...userThreads.rows,
    ...fillerThreads.rows.map((f) => ({
      key: `filler-${f.id}`,
      display_name: f.account_name,
      avatar_url: f.account_avatar,
      last_body: f.last_body,
      last_sent_at: f.last_sent_at,
      last_sender_is_me: f.last_sender_is_me,
    })),
  ].sort((a, b) => new Date(b.last_sent_at) - new Date(a.last_sent_at));

  res.json({ threads });
});

app.get('/api/messages/:key', requirePlayerAuth, async (req, res) => {
  const { key } = req.params;

  if (key.startsWith('filler-')) {
    const threadId = key.slice('filler-'.length);
    const threadInfo = await pool.query('SELECT * FROM dm_filler_threads WHERE id = $1', [threadId]);
    if (!threadInfo.rows.length) return res.status(404).json({ error: 'not found' });
    const t = threadInfo.rows[0];

    const owner = (await pool.query("SELECT value FROM app_config WHERE key = 'account_owner'")).rows[0].value;
    const ownerRow = (await pool.query('SELECT username, avatar_url FROM users WHERE username = $1', [owner])).rows[0];

    const msgs = await pool.query(
      'SELECT from_owner, body, sent_at FROM dm_filler_messages WHERE thread_id = $1 ORDER BY sent_at ASC',
      [threadId]
    );
    const thread = msgs.rows.map((m) => ({
      evidence_id: null,
      body: m.body,
      source: 'filler',
      sent_at: m.sent_at,
      sender: m.from_owner ? ownerRow.username : t.account_name,
      sender_avatar: m.from_owner ? ownerRow.avatar_url : t.account_avatar,
    }));
    return res.json({
      contact: { username: t.account_name, display_name: t.account_name, avatar_url: t.account_avatar },
      thread,
    });
  }

  const owner = (await pool.query("SELECT value FROM app_config WHERE key = 'account_owner'")).rows[0].value;
  const contact = await pool.query('SELECT username, display_name, avatar_url FROM users WHERE username = $1', [key]);
  if (!contact.rows.length) return res.status(404).json({ error: 'not found' });

  const threadKey = [owner, key].sort().join('-');
  const { rows } = await pool.query(
    `SELECT m.evidence_id, m.body, m.source, m.sent_at, u.username AS sender, u.avatar_url AS sender_avatar
     FROM messages m JOIN users u ON u.id = m.sender_id
     WHERE m.thread_key = $1
     ORDER BY m.sent_at ASC`,
    [threadKey]
  );
  res.json({ contact: contact.rows[0], thread: rows });
});

app.post('/api/messages/:key', requirePlayerAuth, async (req, res) => {
  const { key } = req.params;
  const { body } = req.body || {};
  if (!body || !body.trim()) return res.status(400).json({ error: 'body is required' });

  const owner = (await pool.query("SELECT value FROM app_config WHERE key = 'account_owner'")).rows[0].value;

  if (key.startsWith('filler-')) {
    const threadId = key.slice('filler-'.length);
    const threadInfo = await pool.query('SELECT id FROM dm_filler_threads WHERE id = $1', [threadId]);
    if (!threadInfo.rows.length) return res.status(404).json({ error: 'not found' });
    const inserted = await pool.query(
      `INSERT INTO dm_filler_messages (thread_id, from_owner, body, sent_at)
       VALUES ($1, true, $2, now()) RETURNING body, sent_at`,
      [threadId, body.trim()]
    );
    return res.status(201).json({
      evidence_id: null,
      source: 'filler',
      body: inserted.rows[0].body,
      sent_at: inserted.rows[0].sent_at,
      sender: owner,
    });
  }

  const recipient = await pool.query('SELECT id FROM users WHERE username = $1', [key]);
  if (!recipient.rows.length) return res.status(404).json({ error: 'recipient not found' });
  const ownerRow = (await pool.query('SELECT id FROM users WHERE username = $1', [owner])).rows[0];

  const threadKey = [owner, key].sort().join('-');
  const seq = await pool.query(
    `UPDATE evidence_counters SET next_seq = next_seq + 1
     WHERE service = 'social-media' RETURNING next_seq - 1 AS seq`
  );
  const evidenceId = `SOC-${String(seq.rows[0].seq).padStart(3, '0')}`;

  const inserted = await pool.query(
    `INSERT INTO messages (evidence_id, thread_key, sender_id, recipient_id, body, source, sent_at)
     VALUES ($1, $2, $3, $4, $5, 'player', now())
     RETURNING evidence_id, body, source, sent_at`,
    [evidenceId, threadKey, ownerRow.id, recipient.rows[0].id, body.trim()]
  );

  res.status(201).json({ ...inserted.rows[0], sender: owner });
});

// ---------------------------------------------------------------------------
// Evidence API -- consumed by the MERCY judgement engine (a separate service).
// Returns every post/comment/message in this container as a flat, uniform
// evidence record. See /ARCHITECTURE.md for the shared evidence contract.
// ---------------------------------------------------------------------------
app.get('/api/evidence', requireMercyKey, async (req, res) => {
  const posts = await pool.query(`
    SELECT p.evidence_id, p.caption, p.image_url, p.era, p.latitude, p.longitude, p.source,
           p.posted_at, u.username AS author,
           array_remove(array_agg(t.username), NULL) AS involves
    FROM posts p
    JOIN users u ON u.id = p.user_id
    LEFT JOIN (
      SELECT tg.post_id, us.username FROM tags tg JOIN users us ON us.id = tg.tagged_user_id
    ) t ON t.post_id = p.id
    GROUP BY p.id, u.username
  `);
  const comments = await pool.query(`
    SELECT c.evidence_id, c.body, c.source, c.commented_at AS posted_at, u.username AS author, p.evidence_id AS parent_evidence_id
    FROM comments c
    JOIN users u ON u.id = c.user_id
    JOIN posts p ON p.id = c.post_id
  `);
  const messages = await pool.query(`
    SELECT m.evidence_id, m.body, m.source, m.sent_at AS posted_at, m.thread_key, u.username AS author
    FROM messages m JOIN users u ON u.id = m.sender_id
  `);

  const evidence = [
    ...posts.rows.map((p) => ({
      evidence_id: p.evidence_id,
      service: 'social-media',
      type: 'post',
      timestamp: p.posted_at,
      summary: p.caption,
      involves: [p.author, ...(p.involves || [])],
      content: {
        caption: p.caption,
        image_url: p.image_url,
        era: p.era,
        latitude: p.latitude,
        longitude: p.longitude,
        source: p.source,
      },
    })),
    ...comments.rows.map((c) => ({
      evidence_id: c.evidence_id,
      service: 'social-media',
      type: 'comment',
      timestamp: c.posted_at,
      summary: c.body,
      involves: [c.author],
      content: { body: c.body, parent_evidence_id: c.parent_evidence_id, source: c.source },
    })),
    ...messages.rows.map((m) => ({
      evidence_id: m.evidence_id,
      service: 'social-media',
      type: 'message',
      timestamp: m.posted_at,
      summary: m.body,
      involves: [m.author],
      content: { body: m.body, thread_key: m.thread_key, source: m.source },
    })),
  ].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

  res.json({ service: 'social-media', count: evidence.length, evidence });
});

app.get('/api/evidence/:evidenceId', requireMercyKey, async (req, res) => {
  const { evidenceId } = req.params;
  const full = await fetch(`http://localhost:${PORT}/api/evidence`, {
    headers: { 'x-mercy-key': MERCY_API_KEY, ...playerHeader() },
  }).then((r) => r.json());
  const item = full.evidence.find((e) => e.evidence_id === evidenceId);
  if (!item) return res.status(404).json({ error: 'not found' });
  res.json(item);
});

// Add a comment to a post, as the logged-in account. Gets a real evidence_id
// from the same shared counter used by player-created posts.
app.post('/api/posts/:evidenceId/comments', requirePlayerAuth, async (req, res) => {
  const { body } = req.body || {};
  if (!body || !body.trim()) return res.status(400).json({ error: 'body is required' });

  const post = await pool.query('SELECT id FROM posts WHERE evidence_id = $1', [req.params.evidenceId]);
  if (!post.rows.length) return res.status(404).json({ error: 'post not found' });

  const owner = (await pool.query("SELECT value FROM app_config WHERE key = 'account_owner'")).rows[0].value;
  const ownerRow = (await pool.query('SELECT id, username, display_name, avatar_url FROM users WHERE username = $1', [owner])).rows[0];

  const seq = await pool.query(
    `UPDATE evidence_counters SET next_seq = next_seq + 1
     WHERE service = 'social-media' RETURNING next_seq - 1 AS seq`
  );
  const evidenceId = `SOC-${String(seq.rows[0].seq).padStart(3, '0')}`;

  const inserted = await pool.query(
    `INSERT INTO comments (evidence_id, post_id, user_id, body, source, commented_at)
     VALUES ($1, $2, $3, $4, 'player', now())
     RETURNING evidence_id, body, source, commented_at`,
    [evidenceId, post.rows[0].id, ownerRow.id, body.trim()]
  );

  const row = inserted.rows[0];
  res.status(201).json({
    evidence_id: row.evidence_id,
    body: row.body,
    source: row.source,
    commented_at: row.commented_at,
    author: { username: ownerRow.username, display_name: ownerRow.display_name, avatar_url: ownerRow.avatar_url },
  });
});

app.get('/api/health', (req, res) => res.json({ ok: true, service: 'social-media' }));

function groupBy(rows, key) {
  return rows.reduce((acc, row) => {
    (acc[row[key]] = acc[row[key]] || []).push(row);
    return acc;
  }, {});
}

// ---------------------------------------------------------------------------
// The event: one schema per participant (see /MULTIPLAYER.md). The accounts,
// the tags on the seeded posts and the feed/DM noise are the same for
// everyone and stay in `template`; posts, comments, DMs, follows, the
// counter, reset PINs and replies to the filler are theirs.
// ---------------------------------------------------------------------------
// One cheap count for the admin panel; a null is "unknown", never a throw.
async function countRows(sql) {
  try {
    return (await pool.query(sql)).rows[0].n;
  } catch {
    return null;
  }
}

tenant.mount(app, {
  service: 'social-media',
  pool: rawPool,
  sqlDir: path.join(__dirname, 'db'),
  staticTables: ['users', 'tags', 'feed_filler', 'dm_filler_threads', 'app_config'],
  // Follows come and go without a trace of which were seeded, so the panel
  // gets the three things that carry a source and nothing for follows.
  summary: async () => ({
    posts: await countRows("SELECT count(*)::int AS n FROM posts WHERE source = 'player'"),
    comments: await countRows("SELECT count(*)::int AS n FROM comments WHERE source = 'player'"),
    dms: await countRows("SELECT count(*)::int AS n FROM messages WHERE source = 'player'"),
    follows_changed: null,
  }),
});
app.use(app.tenantErrorHandler);

app.listen(PORT, () => {
  console.log(`[social-media] listening on :${PORT}`);
});
