const path = require('path');
const express = require('express');
const cors = require('cors');
const { pool } = require('./db');

const PORT = process.env.PORT || 4003;
const MERCY_API_KEY = process.env.MERCY_API_KEY || 'dev-mercy-key';

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---------------------------------------------------------------------------
// No player login here -- unlike social-media, a real messaging app doesn't
// have its own separate account screen once the device is unlocked. Every
// /api route below is open to the frontend directly.
// ---------------------------------------------------------------------------

function requireMercyKey(req, res, next) {
  if (req.headers['x-mercy-key'] !== MERCY_API_KEY) {
    return res.status(403).json({ error: 'missing or invalid x-mercy-key header' });
  }
  next();
}

async function getOwner() {
  const ownerUsername = (await pool.query("SELECT value FROM app_config WHERE key = 'account_owner'")).rows[0].value;
  const row = (await pool.query('SELECT id, username, display_name, avatar_url FROM users WHERE username = $1', [ownerUsername])).rows[0];
  return row;
}

app.get('/api/me', async (req, res) => {
  res.json(await getOwner());
});

// ---------------------------------------------------------------------------
// Chat list -- merges real threads (direct + group, all evidence) with
// filler threads (bank/delivery/promo/stranger noise, never evidence).
// ---------------------------------------------------------------------------
app.get('/api/chats', async (req, res) => {
  const owner = await getOwner();

  const threadsRes = await pool.query('SELECT id, thread_key, kind, title, avatar_url FROM threads');
  const chats = [];

  for (const t of threadsRes.rows) {
    const last = await pool.query(
      'SELECT body, sent_at, sender_id FROM messages WHERE thread_id = $1 ORDER BY sent_at DESC LIMIT 1',
      [t.id]
    );
    if (!last.rows.length) continue;

    let key = t.thread_key;
    let displayName = t.title;
    let avatarUrl = t.avatar_url;

    if (t.kind === 'direct') {
      const other = (await pool.query(
        `SELECT u.username, u.display_name, u.avatar_url FROM thread_participants tp
         JOIN users u ON u.id = tp.user_id WHERE tp.thread_id = $1 AND u.username != $2`,
        [t.id, owner.username]
      )).rows[0];
      key = other.username;
      displayName = other.display_name;
      avatarUrl = other.avatar_url;
    }

    chats.push({
      key,
      kind: t.kind,
      display_name: displayName,
      avatar_url: avatarUrl,
      last_body: last.rows[0].body,
      last_sent_at: last.rows[0].sent_at,
      last_sender_is_me: last.rows[0].sender_id === owner.id,
    });
  }

  const fillerRes = await pool.query(`
    SELECT t.id, t.kind, t.account_name, t.account_avatar,
           lm.body AS last_body, lm.sent_at AS last_sent_at, lm.from_owner AS last_sender_is_me
    FROM filler_threads t
    JOIN LATERAL (
      SELECT body, sent_at, from_owner FROM filler_messages
      WHERE thread_id = t.id ORDER BY sent_at DESC LIMIT 1
    ) lm ON true
  `);
  fillerRes.rows.forEach((f) => {
    chats.push({
      key: `filler-${f.id}`,
      kind: 'filler',
      filler_kind: f.kind,
      display_name: f.account_name,
      avatar_url: f.account_avatar,
      last_body: f.last_body,
      last_sent_at: f.last_sent_at,
      last_sender_is_me: f.last_sender_is_me,
    });
  });

  chats.sort((a, b) => new Date(b.last_sent_at) - new Date(a.last_sent_at));
  res.json({ chats });
});

async function resolveThread(key, owner) {
  if (key.startsWith('filler-')) return null;

  const byKey = (await pool.query('SELECT * FROM threads WHERE thread_key = $1', [key])).rows[0];
  if (byKey && byKey.kind === 'group') return byKey;

  const otherUser = (await pool.query('SELECT * FROM users WHERE username = $1', [key])).rows[0];
  if (!otherUser) return null;

  return (await pool.query(
    `SELECT t.* FROM threads t
     JOIN thread_participants tp1 ON tp1.thread_id = t.id AND tp1.user_id = $1
     JOIN thread_participants tp2 ON tp2.thread_id = t.id AND tp2.user_id = $2
     WHERE t.kind = 'direct'`,
    [owner.id, otherUser.id]
  )).rows[0] || null;
}

app.get('/api/chats/:key', async (req, res) => {
  const { key } = req.params;
  const owner = await getOwner();

  if (key.startsWith('filler-')) {
    const threadId = key.slice('filler-'.length);
    const t = (await pool.query('SELECT * FROM filler_threads WHERE id = $1', [threadId])).rows[0];
    if (!t) return res.status(404).json({ error: 'not found' });

    const msgs = await pool.query(
      'SELECT from_owner, body, sent_at FROM filler_messages WHERE thread_id = $1 ORDER BY sent_at ASC',
      [threadId]
    );
    const thread = msgs.rows.map((m) => ({
      evidence_id: null,
      body: m.body,
      source: 'filler',
      sent_at: m.sent_at,
      sender: m.from_owner ? owner.username : t.account_name,
      sender_display_name: m.from_owner ? owner.display_name : t.account_name,
      sender_avatar: m.from_owner ? owner.avatar_url : t.account_avatar,
    }));
    return res.json({
      contact: { username: t.account_name, display_name: t.account_name, avatar_url: t.account_avatar, kind: 'filler' },
      thread,
    });
  }

  const thread = await resolveThread(key, owner);
  if (!thread) return res.status(404).json({ error: 'not found' });

  const messagesRes = await pool.query(
    `SELECT m.evidence_id, m.body, m.deleted, m.source, m.sent_at,
            u.username AS sender, u.display_name AS sender_display_name, u.avatar_url AS sender_avatar
     FROM messages m JOIN users u ON u.id = m.sender_id
     WHERE m.thread_id = $1 ORDER BY m.sent_at ASC`,
    [thread.id]
  );
  // The player only ever sees "This message was deleted" -- the real body
  // is never sent to this endpoint. MERCY still gets it via /api/evidence.
  const playerThread = messagesRes.rows.map((m) =>
    m.deleted ? { ...m, body: 'This message was deleted' } : m
  );

  let contact;
  if (thread.kind === 'group') {
    const participants = (await pool.query(
      `SELECT u.username, u.display_name FROM thread_participants tp JOIN users u ON u.id = tp.user_id WHERE tp.thread_id = $1`,
      [thread.id]
    )).rows;
    contact = { username: thread.thread_key, display_name: thread.title, avatar_url: thread.avatar_url, kind: 'group', participants };
  } else {
    const other = (await pool.query('SELECT username, display_name, avatar_url FROM users WHERE username = $1', [key])).rows[0];
    contact = { ...other, kind: 'direct' };
  }

  res.json({ contact, thread: playerThread });
});

app.post('/api/chats/:key', async (req, res) => {
  const { key } = req.params;
  const { body } = req.body || {};
  if (!body || !body.trim()) return res.status(400).json({ error: 'body is required' });

  const owner = await getOwner();

  if (key.startsWith('filler-')) {
    const threadId = key.slice('filler-'.length);
    const exists = await pool.query('SELECT id FROM filler_threads WHERE id = $1', [threadId]);
    if (!exists.rows.length) return res.status(404).json({ error: 'not found' });
    const inserted = await pool.query(
      `INSERT INTO filler_messages (thread_id, from_owner, body, sent_at)
       VALUES ($1, true, $2, now()) RETURNING body, sent_at`,
      [threadId, body.trim()]
    );
    return res.status(201).json({
      evidence_id: null,
      source: 'filler',
      body: inserted.rows[0].body,
      sent_at: inserted.rows[0].sent_at,
      sender: owner.username,
      sender_display_name: owner.display_name,
      sender_avatar: owner.avatar_url,
    });
  }

  const thread = await resolveThread(key, owner);
  if (!thread) return res.status(404).json({ error: 'not found' });

  const seq = await pool.query(
    `UPDATE evidence_counters SET next_seq = next_seq + 1
     WHERE service = 'whatsapp' RETURNING next_seq - 1 AS seq`
  );
  const evidenceId = `WA-${String(seq.rows[0].seq).padStart(3, '0')}`;

  const inserted = await pool.query(
    `INSERT INTO messages (evidence_id, thread_id, sender_id, body, source, sent_at)
     VALUES ($1, $2, $3, $4, 'player', now())
     RETURNING evidence_id, body, source, sent_at`,
    [evidenceId, thread.id, owner.id, body.trim()]
  );

  res.status(201).json({
    ...inserted.rows[0],
    sender: owner.username,
    sender_display_name: owner.display_name,
    sender_avatar: owner.avatar_url,
  });
});

// ---------------------------------------------------------------------------
// Evidence API -- consumed by MERCY. Filler threads never appear here.
// ---------------------------------------------------------------------------
app.get('/api/evidence', requireMercyKey, async (req, res) => {
  const messagesRes = await pool.query(`
    SELECT m.evidence_id, m.body, m.deleted, m.source, m.sent_at, t.thread_key, t.kind, u.username AS sender
    FROM messages m
    JOIN threads t ON t.id = m.thread_id
    JOIN users u ON u.id = m.sender_id
  `);
  const participantsRes = await pool.query(`
    SELECT tp.thread_id, u.username
    FROM thread_participants tp JOIN users u ON u.id = tp.user_id
  `);
  const participantsByThreadKey = {};
  const threadIdToKey = Object.fromEntries(
    (await pool.query('SELECT id, thread_key FROM threads')).rows.map((t) => [t.id, t.thread_key])
  );
  participantsRes.rows.forEach((p) => {
    const key = threadIdToKey[p.thread_id];
    (participantsByThreadKey[key] = participantsByThreadKey[key] || []).push(p.username);
  });

  const evidence = messagesRes.rows
    .map((m) => ({
      evidence_id: m.evidence_id,
      service: 'whatsapp',
      type: 'message',
      timestamp: m.sent_at,
      summary: m.body,
      involves: participantsByThreadKey[m.thread_key] || [m.sender],
      content: { body: m.body, deleted: m.deleted, thread_key: m.thread_key, thread_kind: m.kind, source: m.source },
    }))
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

  res.json({ service: 'whatsapp', count: evidence.length, evidence });
});

app.get('/api/evidence/:evidenceId', requireMercyKey, async (req, res) => {
  const full = await fetch(`http://localhost:${PORT}/api/evidence`, {
    headers: { 'x-mercy-key': MERCY_API_KEY },
  }).then((r) => r.json());
  const item = full.evidence.find((e) => e.evidence_id === req.params.evidenceId);
  if (!item) return res.status(404).json({ error: 'not found' });
  res.json(item);
});

app.get('/api/health', (req, res) => res.json({ ok: true, service: 'whatsapp' }));

app.listen(PORT, () => {
  console.log(`[whatsapp] listening on :${PORT}`);
});
