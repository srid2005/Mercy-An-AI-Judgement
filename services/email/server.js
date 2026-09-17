const path = require('path');
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { pool } = require('./db');

const PORT = process.env.PORT || 4002;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-secret-change-me';
const MERCY_API_KEY = process.env.MERCY_API_KEY || 'dev-mercy-key';
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || 'dev-internal-key';

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---------------------------------------------------------------------------
// Player auth: a real login screen, like the social-media app -- this is
// where the deepest secrets live, so it's locked separately from everything
// else. Password is her husband's name (Arjun) -- an easy, personal choice,
// the way real people actually pick passwords.
// ---------------------------------------------------------------------------
app.post('/api/auth/login', async (req, res) => {
  const { password } = req.body || {};
  const { rows } = await pool.query("SELECT value FROM app_config WHERE key = 'unlock_password'");
  if (!rows.length) return res.status(500).json({ error: 'service not configured' });
  if ((password || '').trim().toLowerCase() !== rows[0].value.toLowerCase()) {
    return res.status(401).json({ error: 'incorrect password' });
  }
  const token = jwt.sign({ sub: 'player', account: 'meera' }, JWT_SECRET, { expiresIn: '2h' });
  res.json({ token });
});

app.get('/api/auth/hint', async (req, res) => {
  const { rows } = await pool.query("SELECT value FROM app_config WHERE key = 'unlock_password_hint'");
  res.json({ hint: rows[0]?.value || null });
});

// Shown on the sign-in screen before login -- public, read-only.
app.get('/api/public/account-preview', async (req, res) => {
  const owner = (await pool.query("SELECT value FROM app_config WHERE key = 'account_owner'")).rows[0].value;
  const user = await pool.query(
    'SELECT username, display_name, email_address, avatar_url FROM users WHERE username = $1',
    [owner]
  );
  if (!user.rows.length) return res.status(404).json({ error: 'not found' });
  res.json(user.rows[0]);
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

function requireMercyKey(req, res, next) {
  if (req.headers['x-mercy-key'] !== MERCY_API_KEY) {
    return res.status(403).json({ error: 'missing or invalid x-mercy-key header' });
  }
  next();
}

function requireInternalKey(req, res, next) {
  if (req.headers['x-internal-key'] !== INTERNAL_API_KEY) {
    return res.status(403).json({ error: 'missing or invalid x-internal-key header' });
  }
  next();
}

async function getOwner() {
  const ownerUsername = (await pool.query("SELECT value FROM app_config WHERE key = 'account_owner'")).rows[0].value;
  return (await pool.query('SELECT id, username, display_name, email_address, avatar_url FROM users WHERE username = $1', [ownerUsername])).rows[0];
}

app.get('/api/me', requirePlayerAuth, async (req, res) => {
  res.json(await getOwner());
});

// ---------------------------------------------------------------------------
// Internal delivery: lets another in-game service (e.g. social-media's
// "forgot password" flow) drop a real email into this inbox. Always filler
// -- system-generated mail like a password-reset PIN was never part of
// Meera's life, so it's never evidence, same reasoning as ads/spam/receipts.
// ---------------------------------------------------------------------------
app.post('/api/internal/deliver-mail', requireInternalKey, async (req, res) => {
  const { sender_name, sender_email, sender_avatar, subject, body, kind } = req.body || {};
  if (!sender_name || !subject || !body) {
    return res.status(400).json({ error: 'sender_name, subject, and body are required' });
  }
  // Only avatars this service already ships are allowed, so another service
  // can pick its own logo but can't point the inbox at an arbitrary URL.
  const avatar = typeof sender_avatar === 'string' && /^\/images\/avatars\/[a-z0-9._-]+\.(svg|png|jpg|webp)$/.test(sender_avatar)
    ? sender_avatar
    : '/images/avatars/security.jpg';
  const inserted = await pool.query(
    `INSERT INTO filler_emails (kind, sender_name, sender_email, sender_avatar, subject, body, received_at)
     VALUES ($1, $2, $3, $4, $5, $6, now())
     RETURNING id`,
    [kind || 'notification', sender_name, sender_email || 'no-reply@internal', avatar, subject, body]
  );
  res.status(201).json({ delivered: true, id: inserted.rows[0].id });
});

// ---------------------------------------------------------------------------
// Inbox -- merges real threads (evidence) with filler mail (newsletters,
// receipts, notifications, spam -- never evidence), sorted by recency.
// ---------------------------------------------------------------------------
async function buildThreadItems(owner, { trashedOnly = false } = {}) {
  const threadsRes = await pool.query(
    'SELECT id, thread_key, subject FROM email_threads WHERE is_trashed = $1',
    [trashedOnly]
  );
  const items = [];

  for (const t of threadsRes.rows) {
    const emails = await pool.query(
      `SELECT e.sender_id, e.body, e.starred, e.sent_at, u.username AS sender_username
       FROM emails e JOIN users u ON u.id = e.sender_id
       WHERE e.thread_id = $1 ORDER BY e.sent_at DESC`,
      [t.id]
    );
    if (!emails.rows.length) continue;
    const latest = emails.rows[0];

    const otherRes = await pool.query(
      `SELECT DISTINCT u.username, u.display_name, u.avatar_url
       FROM emails e JOIN users u ON u.id = (CASE WHEN e.sender_id = $2 THEN e.recipient_id ELSE e.sender_id END)
       WHERE e.thread_id = $1 AND (e.sender_id != $2 OR e.recipient_id != $2)
       LIMIT 1`,
      [t.id, owner.id]
    );
    const other = otherRes.rows[0];

    const hasAttachment = (await pool.query(
      `SELECT EXISTS (SELECT 1 FROM email_attachments ea JOIN emails e ON e.id = ea.email_id WHERE e.thread_id = $1) AS has_attachment`,
      [t.id]
    )).rows[0].has_attachment;

    items.push({
      type: 'thread',
      key: t.thread_key,
      subject: t.subject,
      other: other ? { username: other.username, display_name: other.display_name, avatar_url: other.avatar_url } : null,
      preview: latest.body.slice(0, 140),
      message_count: emails.rows.length,
      last_sent_at: latest.sent_at,
      last_sender_is_me: latest.sender_id === owner.id,
      starred: emails.rows.some((e) => e.starred),
      has_attachment: hasAttachment,
    });
  }

  return items;
}

app.get('/api/inbox', requirePlayerAuth, async (req, res) => {
  const owner = await getOwner();
  const items = await buildThreadItems(owner, { trashedOnly: false });

  const fillerRes = await pool.query('SELECT * FROM filler_emails ORDER BY received_at DESC');
  const fillerAttachmentIds = new Set(
    (await pool.query('SELECT DISTINCT filler_email_id FROM filler_email_attachments')).rows.map((r) => r.filler_email_id)
  );
  fillerRes.rows.forEach((f) => {
    items.push({
      type: 'filler',
      key: `filler-${f.id}`,
      subject: f.subject,
      other: { username: f.sender_name, display_name: f.sender_name, avatar_url: f.sender_avatar },
      preview: f.body.slice(0, 140),
      message_count: 1,
      last_sent_at: f.received_at,
      last_sender_is_me: false,
      filler_kind: f.kind,
      starred: f.starred,
      has_attachment: fillerAttachmentIds.has(f.id),
    });
  });

  items.sort((a, b) => new Date(b.last_sent_at) - new Date(a.last_sent_at));
  res.json({ inbox: items });
});

// Trash: real threads the player (as Meera) deleted -- still real evidence,
// just hidden from the main Inbox. Filler is never trashable (there's
// nothing to hide -- it was never evidence to begin with).
app.get('/api/trash', requirePlayerAuth, async (req, res) => {
  const owner = await getOwner();
  const items = await buildThreadItems(owner, { trashedOnly: true });
  items.sort((a, b) => new Date(b.last_sent_at) - new Date(a.last_sent_at));
  res.json({ trash: items });
});

app.post('/api/threads/:key/trash', requirePlayerAuth, async (req, res) => {
  const updated = await pool.query(
    'UPDATE email_threads SET is_trashed = true WHERE thread_key = $1 RETURNING thread_key',
    [req.params.key]
  );
  if (!updated.rows.length) return res.status(404).json({ error: 'not found' });
  res.json({ trashed: true });
});

app.post('/api/threads/:key/restore', requirePlayerAuth, async (req, res) => {
  const updated = await pool.query(
    'UPDATE email_threads SET is_trashed = false WHERE thread_key = $1 RETURNING thread_key',
    [req.params.key]
  );
  if (!updated.rows.length) return res.status(404).json({ error: 'not found' });
  res.json({ trashed: false });
});

// Every people the player can address mail to/from -- used to populate the
// Compose "To" field and to resolve avatars for Sent rows.
app.get('/api/contacts', requirePlayerAuth, async (req, res) => {
  const owner = await getOwner();
  const { rows } = await pool.query(
    'SELECT username, display_name, email_address, avatar_url FROM users WHERE username != $1 ORDER BY display_name',
    [owner.username]
  );
  res.json({ contacts: rows });
});

// Sent: one row per message the owner actually sent (real Gmail behavior --
// Sent lists individual messages, not whole conversations).
app.get('/api/sent', requirePlayerAuth, async (req, res) => {
  const owner = await getOwner();
  const { rows } = await pool.query(
    `SELECT e.evidence_id, e.body, e.sent_at, t.thread_key, t.subject,
            ru.username, ru.display_name, ru.avatar_url
     FROM emails e
     JOIN email_threads t ON t.id = e.thread_id
     JOIN users ru ON ru.id = e.recipient_id
     WHERE e.sender_id = $1
     ORDER BY e.sent_at DESC`,
    [owner.id]
  );
  res.json({
    sent: rows.map((r) => ({
      key: r.thread_key,
      subject: r.subject,
      other: { username: r.username, display_name: r.display_name, avatar_url: r.avatar_url },
      preview: r.body.slice(0, 140),
      last_sent_at: r.sent_at,
      evidence_id: r.evidence_id,
    })),
  });
});

// Drafts: composed-but-unsent mail. Not evidence.
app.get('/api/drafts', requirePlayerAuth, async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM drafts ORDER BY updated_at DESC');
  const contacts = (await pool.query('SELECT username, display_name, avatar_url FROM users')).rows;
  const byUsername = Object.fromEntries(contacts.map((c) => [c.username, c]));
  res.json({
    drafts: rows.map((d) => ({
      id: d.id,
      evidence_id: d.evidence_id,
      source: d.source,
      to: d.to_username ? byUsername[d.to_username] : null,
      subject: d.subject,
      body: d.body,
      updated_at: d.updated_at,
    })),
  });
});

app.post('/api/drafts', requirePlayerAuth, async (req, res) => {
  const { to, subject, body } = req.body || {};
  const inserted = await pool.query(
    `INSERT INTO drafts (to_username, subject, body, source, updated_at) VALUES ($1, $2, $3, 'player', now())
     RETURNING id, evidence_id, source, to_username, subject, body, updated_at`,
    [to || null, subject || '', body || '']
  );
  res.status(201).json(inserted.rows[0]);
});

// Seed drafts (Meera's own, real evidence) are read-only: no edit, no
// delete, no sending. The evidence has to stay exactly as found. Player
// drafts remain freely editable, same as before.
async function isSeedDraft(id) {
  const row = (await pool.query('SELECT source FROM drafts WHERE id = $1', [id])).rows[0];
  return row?.source === 'seed';
}

app.patch('/api/drafts/:id', requirePlayerAuth, async (req, res) => {
  if (await isSeedDraft(req.params.id)) {
    return res.status(403).json({ error: 'this draft is preserved evidence and can\'t be edited' });
  }
  const { to, subject, body } = req.body || {};
  const updated = await pool.query(
    `UPDATE drafts SET to_username = $2, subject = $3, body = $4, updated_at = now()
     WHERE id = $1 RETURNING id, evidence_id, source, to_username, subject, body, updated_at`,
    [req.params.id, to || null, subject || '', body || '']
  );
  if (!updated.rows.length) return res.status(404).json({ error: 'not found' });
  res.json(updated.rows[0]);
});

app.delete('/api/drafts/:id', requirePlayerAuth, async (req, res) => {
  if (await isSeedDraft(req.params.id)) {
    return res.status(403).json({ error: 'this draft is preserved evidence and can\'t be deleted' });
  }
  await pool.query('DELETE FROM drafts WHERE id = $1', [req.params.id]);
  res.status(204).end();
});

// Compose: a brand new conversation, not a reply. Real evidence -- gets a
// genuine evidence_id from the same counter as replies. If a draftId is
// given, that draft is deleted once the send succeeds.
app.post('/api/compose', requirePlayerAuth, async (req, res) => {
  const { to, subject, body, draftId } = req.body || {};
  if (!to || !body || !body.trim()) return res.status(400).json({ error: 'to and body are required' });
  if (draftId && (await isSeedDraft(draftId))) {
    return res.status(403).json({ error: 'this draft is preserved evidence and can\'t be sent' });
  }

  const owner = await getOwner();
  const recipient = (await pool.query('SELECT id FROM users WHERE username = $1', [to])).rows[0];
  if (!recipient) return res.status(404).json({ error: 'unknown recipient' });

  const threadKey = `compose-${Date.now()}`;
  const thread = await pool.query(
    'INSERT INTO email_threads (thread_key, subject) VALUES ($1, $2) RETURNING id',
    [threadKey, subject && subject.trim() ? subject.trim() : '(no subject)']
  );

  const seq = await pool.query(
    `UPDATE evidence_counters SET next_seq = next_seq + 1
     WHERE service = 'email' RETURNING next_seq - 1 AS seq`
  );
  const evidenceId = `EML-${String(seq.rows[0].seq).padStart(3, '0')}`;

  await pool.query(
    `INSERT INTO emails (evidence_id, thread_id, sender_id, recipient_id, body, source, sent_at)
     VALUES ($1, $2, $3, $4, $5, 'player', now())`,
    [evidenceId, thread.rows[0].id, owner.id, recipient.id, body.trim()]
  );

  if (draftId) await pool.query('DELETE FROM drafts WHERE id = $1', [draftId]);

  res.status(201).json({ thread_key: threadKey, evidence_id: evidenceId });
});

app.get('/api/threads/:key', requirePlayerAuth, async (req, res) => {
  const { key } = req.params;
  const owner = await getOwner();

  if (key.startsWith('filler-')) {
    const id = key.slice('filler-'.length);
    const f = (await pool.query('SELECT * FROM filler_emails WHERE id = $1', [id])).rows[0];
    if (!f) return res.status(404).json({ error: 'not found' });
    const attachments = (await pool.query(
      'SELECT filename, url, content_type, size_label FROM filler_email_attachments WHERE filler_email_id = $1',
      [id]
    )).rows;
    return res.json({
      subject: f.subject,
      emails: [
        {
          evidence_id: null,
          source: 'filler',
          body: f.body,
          sent_at: f.received_at,
          sender: { username: f.sender_name, display_name: f.sender_name, email_address: f.sender_email, avatar_url: f.sender_avatar },
          recipient: { username: owner.username, display_name: owner.display_name, email_address: owner.email_address },
          attachments,
        },
      ],
    });
  }

  const thread = (await pool.query('SELECT * FROM email_threads WHERE thread_key = $1', [key])).rows[0];
  if (!thread) return res.status(404).json({ error: 'not found' });

  const emailsRes = await pool.query(
    `SELECT e.id, e.evidence_id, e.body, e.source, e.sent_at,
            su.username AS sender_username, su.display_name AS sender_display_name, su.email_address AS sender_email, su.avatar_url AS sender_avatar,
            ru.username AS recipient_username, ru.display_name AS recipient_display_name, ru.email_address AS recipient_email
     FROM emails e
     JOIN users su ON su.id = e.sender_id
     JOIN users ru ON ru.id = e.recipient_id
     WHERE e.thread_id = $1 ORDER BY e.sent_at ASC`,
    [thread.id]
  );

  const attachmentsRes = await pool.query(
    `SELECT email_id, filename, url, content_type, size_label FROM email_attachments WHERE email_id = ANY($1::int[])`,
    [emailsRes.rows.map((e) => e.id)]
  );
  const attachmentsByEmail = {};
  attachmentsRes.rows.forEach((a) => {
    (attachmentsByEmail[a.email_id] ||= []).push({ filename: a.filename, url: a.url, content_type: a.content_type, size_label: a.size_label });
  });

  res.json({
    subject: thread.subject,
    key: thread.thread_key,
    is_trashed: thread.is_trashed,
    emails: emailsRes.rows.map((e) => ({
      evidence_id: e.evidence_id,
      source: e.source,
      body: e.body,
      recipient: { username: e.recipient_username, display_name: e.recipient_display_name, email_address: e.recipient_email },
      sent_at: e.sent_at,
      sender: { username: e.sender_username, display_name: e.sender_display_name, email_address: e.sender_email, avatar_url: e.sender_avatar },
      attachments: attachmentsByEmail[e.id] || [],
    })),
  });
});

app.post('/api/threads/:key', requirePlayerAuth, async (req, res) => {
  const { key } = req.params;
  const { body } = req.body || {};
  if (!body || !body.trim()) return res.status(400).json({ error: 'body is required' });
  if (key.startsWith('filler-')) return res.status(400).json({ error: 'cannot reply to this message' });

  const thread = (await pool.query('SELECT * FROM email_threads WHERE thread_key = $1', [key])).rows[0];
  if (!thread) return res.status(404).json({ error: 'not found' });

  const owner = await getOwner();
  // Reply goes to whoever the owner was last corresponding with in this thread.
  const lastOther = (await pool.query(
    `SELECT (CASE WHEN sender_id = $2 THEN recipient_id ELSE sender_id END) AS other_id
     FROM emails WHERE thread_id = $1 ORDER BY sent_at DESC LIMIT 1`,
    [thread.id, owner.id]
  )).rows[0];
  const recipientId = lastOther ? lastOther.other_id : owner.id;

  const seq = await pool.query(
    `UPDATE evidence_counters SET next_seq = next_seq + 1
     WHERE service = 'email' RETURNING next_seq - 1 AS seq`
  );
  const evidenceId = `EML-${String(seq.rows[0].seq).padStart(3, '0')}`;

  const inserted = await pool.query(
    `INSERT INTO emails (evidence_id, thread_id, sender_id, recipient_id, body, source, sent_at)
     VALUES ($1, $2, $3, $4, $5, 'player', now())
     RETURNING evidence_id, body, source, sent_at`,
    [evidenceId, thread.id, owner.id, recipientId, body.trim()]
  );

  res.status(201).json({
    ...inserted.rows[0],
    sender: { username: owner.username, display_name: owner.display_name, email_address: owner.email_address, avatar_url: owner.avatar_url },
  });
});

// ---------------------------------------------------------------------------
// Evidence API -- consumed by MERCY. Filler mail never appears here.
// ---------------------------------------------------------------------------
app.get('/api/evidence', requireMercyKey, async (req, res) => {
  const emailsRes = await pool.query(`
    SELECT e.id, e.evidence_id, e.body, e.source, e.sent_at, t.thread_key, t.subject,
           su.username AS sender, ru.username AS recipient
    FROM emails e
    JOIN email_threads t ON t.id = e.thread_id
    JOIN users su ON su.id = e.sender_id
    JOIN users ru ON ru.id = e.recipient_id
  `);

  const attachmentsRes = await pool.query('SELECT email_id, filename, url, content_type, size_label FROM email_attachments');
  const attachmentsByEmail = {};
  attachmentsRes.rows.forEach((a) => {
    (attachmentsByEmail[a.email_id] ||= []).push({ filename: a.filename, url: a.url, content_type: a.content_type, size_label: a.size_label });
  });

  // Seed drafts: never sent, but real -- a forensic pull of the device would
  // still find them in the Drafts folder, so MERCY sees them too.
  const draftsRes = await pool.query(`
    SELECT d.evidence_id, d.body, d.subject, d.updated_at, ru.username AS recipient
    FROM drafts d
    LEFT JOIN users ru ON ru.username = d.to_username
    WHERE d.evidence_id IS NOT NULL
  `);

  const owner = await getOwner();

  const evidence = [
    ...emailsRes.rows.map((e) => ({
      evidence_id: e.evidence_id,
      service: 'email',
      type: 'email',
      timestamp: e.sent_at,
      summary: e.body.slice(0, 160),
      involves: [e.sender, e.recipient],
      content: { body: e.body, subject: e.subject, thread_key: e.thread_key, source: e.source, attachments: attachmentsByEmail[e.id] || [] },
    })),
    ...draftsRes.rows.map((d) => ({
      evidence_id: d.evidence_id,
      service: 'email',
      type: 'draft',
      timestamp: d.updated_at,
      summary: d.body.slice(0, 160),
      involves: [owner.username, d.recipient].filter(Boolean),
      content: { body: d.body, subject: d.subject, sent: false, source: 'seed' },
    })),
  ].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

  res.json({ service: 'email', count: evidence.length, evidence });
});

app.get('/api/evidence/:evidenceId', requireMercyKey, async (req, res) => {
  const full = await fetch(`http://localhost:${PORT}/api/evidence`, {
    headers: { 'x-mercy-key': MERCY_API_KEY },
  }).then((r) => r.json());
  const item = full.evidence.find((e) => e.evidence_id === req.params.evidenceId);
  if (!item) return res.status(404).json({ error: 'not found' });
  res.json(item);
});

app.get('/api/health', (req, res) => res.json({ ok: true, service: 'email' }));

app.listen(PORT, () => {
  console.log(`[email] listening on :${PORT}`);
});
