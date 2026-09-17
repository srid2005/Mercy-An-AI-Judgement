const path = require('path');
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { pool } = require('./db');

const PORT = process.env.PORT || 4008;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-secret-change-me';
const MERCY_API_KEY = process.env.MERCY_API_KEY || 'dev-mercy-key';
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || 'dev-internal-key';
const EMAIL_SERVICE_URL = process.env.EMAIL_SERVICE_URL || 'http://email:4002';

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

async function getOwner() {
  const ownerUsername = (await pool.query("SELECT value FROM app_config WHERE key = 'account_owner'")).rows[0].value;
  return (await pool.query(
    'SELECT id, username, display_name, email_address, avatar_url, member_since FROM users WHERE username = $1',
    [ownerUsername]
  )).rows[0];
}

function maskEmail(address) {
  const [local, domain] = address.split('@');
  return `${local.slice(0, 2)}${'•'.repeat(Math.max(3, local.length - 2))}@${domain}`;
}

// Strip accents, lowercase, keep letters+digits only -- so "14/10/2018",
// "Rose Café" etc. compare the way a person would expect.
function normalizeAnswer(str) {
  return String(str || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

// ---------------------------------------------------------------------------
// Sign-in is two real steps, the way a cloud service with no password-reset
// actually does account recovery:
//   1. a one-time code, delivered as a real email into Quill;
//   2. Meera's three security questions.
// Each step hands out a stage-scoped JWT, so the questions can't be reached
// without the code, and the diary can't be reached without the answers.
// ---------------------------------------------------------------------------
function requireStage(stage) {
  return (req, res, next) => {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'missing token' });
    try {
      const payload = jwt.verify(token, JWT_SECRET);
      if (payload.stage !== stage) return res.status(401).json({ error: 'wrong sign-in stage' });
      req.player = payload;
      next();
    } catch {
      res.status(401).json({ error: 'invalid or expired token' });
    }
  };
}
const requireChallenge = requireStage('questions');
const requirePlayerAuth = requireStage('access');

function requireMercyKey(req, res, next) {
  if (req.headers['x-mercy-key'] !== MERCY_API_KEY) {
    return res.status(403).json({ error: 'missing or invalid x-mercy-key header' });
  }
  next();
}

app.get('/api/public/account-preview', async (req, res) => {
  const owner = await getOwner();
  res.json({
    username: owner.username,
    display_name: owner.display_name,
    avatar_url: owner.avatar_url,
    masked_email: maskEmail(owner.email_address),
  });
});

app.post('/api/auth/request-code', async (req, res) => {
  const owner = await getOwner();
  await pool.query('UPDATE login_codes SET used = true WHERE used = false');
  const code = String(Math.floor(100000 + Math.random() * 900000));
  await pool.query('INSERT INTO login_codes (code) VALUES ($1)', [code]);

  try {
    const r = await fetch(`${EMAIL_SERVICE_URL}/api/internal/deliver-mail`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-key': INTERNAL_API_KEY },
      body: JSON.stringify({
        sender_name: 'Haven',
        sender_email: 'hello@havenapp.io',
        sender_avatar: '/images/avatars/haven.svg',
        subject: `${code} is your Haven sign-in code`,
        body: `Someone is signing in to your Haven account from a new device.\n\nYour one-time sign-in code is: ${code}\n\nThis code expires in 10 minutes. Once it's confirmed, you'll be asked your security questions -- remember, we never see your password and can't recover it for you.\n\nIf this wasn't you, you can safely ignore this email.`,
        kind: 'notification',
      }),
    });
    if (!r.ok) throw new Error(`email service responded ${r.status}`);
  } catch (err) {
    console.error('[haven] failed to deliver sign-in code:', err.message);
    return res.status(502).json({ error: 'could not send the sign-in code right now' });
  }

  res.json({ sent: true, masked_email: maskEmail(owner.email_address) });
});

app.post('/api/auth/verify-code', async (req, res) => {
  const code = String((req.body || {}).code || '').trim();
  if (!code) return res.status(400).json({ error: 'code is required' });
  const match = await pool.query(
    `SELECT id FROM login_codes
     WHERE code = $1 AND used = false AND created_at > now() - interval '10 minutes'
     ORDER BY created_at DESC LIMIT 1`,
    [code]
  );
  if (!match.rows.length) return res.status(401).json({ error: 'incorrect or expired code' });
  await pool.query('UPDATE login_codes SET used = true WHERE id = $1', [match.rows[0].id]);
  const challenge = jwt.sign({ sub: 'player', account: 'meera', stage: 'questions' }, JWT_SECRET, { expiresIn: '15m' });
  res.json({ challenge });
});

app.get('/api/auth/questions', requireChallenge, async (req, res) => {
  const { rows } = await pool.query('SELECT position, question, hint FROM security_questions ORDER BY position');
  res.json({ questions: rows });
});

app.post('/api/auth/answers', requireChallenge, async (req, res) => {
  const answers = (req.body || {}).answers || {};
  const { rows } = await pool.query('SELECT position, answer_normalized FROM security_questions ORDER BY position');
  const wrong = rows
    .filter((q) => normalizeAnswer(answers[q.position]) !== q.answer_normalized)
    .map((q) => q.position);
  if (wrong.length) return res.status(401).json({ ok: false, wrong });
  const token = jwt.sign({ sub: 'player', account: 'meera', stage: 'access' }, JWT_SECRET, { expiresIn: '2h' });
  res.json({ ok: true, token });
});

// ---------------------------------------------------------------------------
// The diary
// ---------------------------------------------------------------------------
app.get('/api/me', requirePlayerAuth, async (req, res) => {
  const owner = await getOwner();
  const cfg = Object.fromEntries((await pool.query('SELECT key, value FROM app_config')).rows.map((r) => [r.key, r.value]));
  res.json({
    ...owner,
    storage: { used_pct: Number(cfg.storage_used_pct), total_gb: Number(cfg.storage_total_gb) },
  });
});

function entryRow(e) {
  return {
    evidence_id: e.evidence_id,
    title: e.title,
    recorded_at: e.recorded_at,
    backed_up_at: e.backed_up_at,
    duration_seconds: e.duration_seconds,
    mood: e.mood,
    tags: e.tags,
    video_url: e.video_url,
    poster_url: e.poster_url,
    device: e.device,
    is_final: e.is_final,
  };
}

app.get('/api/entries', requirePlayerAuth, async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM entries ORDER BY recorded_at DESC');
  res.json({ entries: rows.map((e) => ({ ...entryRow(e), preview: e.transcript.slice(0, 140) })) });
});

app.get('/api/entries/:evidenceId', requirePlayerAuth, async (req, res) => {
  const e = (await pool.query('SELECT * FROM entries WHERE evidence_id = $1', [req.params.evidenceId])).rows[0];
  if (!e) return res.status(404).json({ error: 'not found' });
  const prev = (await pool.query(
    'SELECT evidence_id, title FROM entries WHERE recorded_at < $1 ORDER BY recorded_at DESC LIMIT 1', [e.recorded_at]
  )).rows[0] || null;
  const next = (await pool.query(
    'SELECT evidence_id, title FROM entries WHERE recorded_at > $1 ORDER BY recorded_at ASC LIMIT 1', [e.recorded_at]
  )).rows[0] || null;
  res.json({ ...entryRow(e), transcript: e.transcript, prev, next });
});

// ---------------------------------------------------------------------------
// Evidence API -- consumed by MERCY.
// ---------------------------------------------------------------------------
app.get('/api/evidence', requireMercyKey, async (req, res) => {
  const owner = await getOwner();
  const { rows } = await pool.query('SELECT * FROM entries ORDER BY recorded_at ASC');
  const evidence = rows.map((e) => ({
    evidence_id: e.evidence_id,
    service: 'haven',
    type: 'video_entry',
    timestamp: e.recorded_at,
    summary: `${e.title}: ${e.transcript.replace(/\s+/g, ' ').slice(0, 140)}`,
    involves: [owner.username],
    content: {
      title: e.title,
      transcript: e.transcript,
      mood: e.mood,
      tags: e.tags,
      duration_seconds: e.duration_seconds,
      video_url: e.video_url,
      backed_up_at: e.backed_up_at,
      device: e.device,
      is_final: e.is_final,
    },
  }));
  res.json({ service: 'haven', count: evidence.length, evidence });
});

app.get('/api/evidence/:evidenceId', requireMercyKey, async (req, res) => {
  const full = await fetch(`http://localhost:${PORT}/api/evidence`, {
    headers: { 'x-mercy-key': MERCY_API_KEY },
  }).then((r) => r.json());
  const item = full.evidence.find((e) => e.evidence_id === req.params.evidenceId);
  if (!item) return res.status(404).json({ error: 'not found' });
  res.json(item);
});

app.get('/api/health', (req, res) => res.json({ ok: true, service: 'haven' }));

app.listen(PORT, () => {
  console.log(`[haven] listening on :${PORT}`);
});
