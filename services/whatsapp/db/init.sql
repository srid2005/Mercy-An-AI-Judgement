-- Wisp (WhatsApp-style messaging) service database
-- Every real message carries a globally-unique evidence_id, prefix WA-###,
-- per the contract in /ARCHITECTURE.md. Unlike social-media, this service
-- has no player login -- like real WhatsApp Web, it's just open once the
-- device is unlocked, no separate account/password.

-- Story timestamps below are written as fixed 2024 calendar dates for
-- readability, but displayed relative-time ("2d", "3mo") should stay
-- current no matter when this stack is actually run. t(x) remaps every
-- literal to be relative to now() at seed time, anchored on the latest
-- story timestamp (Nikhil's "why don't you post anything?" message)
-- mapping to interval '1 day' ago, preserving every other event's exact gap from it.
CREATE FUNCTION t(orig TIMESTAMPTZ) RETURNS TIMESTAMPTZ AS $$
  -- Pinned to 21:40 IST *yesterday* whatever the clock says at seed time, so
  -- "that night" is a night in every app and every derived time stays true.
  SELECT ((date_trunc('day', now() AT TIME ZONE 'Asia/Kolkata') - interval '1 day' + interval '21 hours 40 minutes') AT TIME ZONE 'Asia/Kolkata')
         + (orig - TIMESTAMPTZ '2024-09-02 21:40:00+05:30');
$$ LANGUAGE SQL STABLE;

CREATE TABLE users (
    id            SERIAL PRIMARY KEY,
    username      TEXT UNIQUE NOT NULL,
    display_name  TEXT NOT NULL,
    avatar_url    TEXT NOT NULL,
    phone_number  TEXT
);

CREATE TABLE threads (
    id          SERIAL PRIMARY KEY,
    thread_key  TEXT UNIQUE NOT NULL,
    kind        TEXT NOT NULL,     -- 'direct' | 'group'
    title       TEXT,              -- group name only; direct chats use the other participant's name
    avatar_url  TEXT               -- group avatar only; direct chats use the other participant's avatar
);

CREATE TABLE thread_participants (
    thread_id  INTEGER NOT NULL REFERENCES threads(id),
    user_id    INTEGER NOT NULL REFERENCES users(id),
    PRIMARY KEY (thread_id, user_id)
);

CREATE TABLE messages (
    id           SERIAL PRIMARY KEY,
    evidence_id  TEXT UNIQUE NOT NULL,
    thread_id    INTEGER NOT NULL REFERENCES threads(id),
    sender_id    INTEGER NOT NULL REFERENCES users(id),
    body         TEXT NOT NULL,       -- real content is always stored, even when deleted
    deleted      BOOLEAN NOT NULL DEFAULT false, -- "This message was deleted": player sees a placeholder,
                                                  -- MERCY still sees the real body via /api/evidence (forensic recovery)
    source       TEXT NOT NULL DEFAULT 'seed', -- 'seed' (story canon) | 'player' (sent in-game)
    sent_at      TIMESTAMPTZ NOT NULL
);

CREATE TABLE evidence_counters (
    service   TEXT PRIMARY KEY,
    next_seq  INTEGER NOT NULL
);

CREATE TABLE app_config (
    key    TEXT PRIMARY KEY,
    value  TEXT NOT NULL
);
INSERT INTO app_config (key, value) VALUES ('account_owner', 'meera');

-- ---------------------------------------------------------------------------
-- Noise: a bank alert account, a delivery bot, a promo broadcast, and a
-- wrong-number stranger. Real WhatsApp inboxes are mostly this. Explicitly
-- NOT evidence -- no evidence_id, never returned by /api/evidence.
-- ---------------------------------------------------------------------------
CREATE TABLE filler_threads (
    id             SERIAL PRIMARY KEY,
    kind           TEXT NOT NULL, -- 'bank' | 'delivery' | 'promo' | 'stranger'
    account_name   TEXT NOT NULL,
    account_avatar TEXT NOT NULL
);

CREATE TABLE filler_messages (
    id          SERIAL PRIMARY KEY,
    thread_id   INTEGER NOT NULL REFERENCES filler_threads(id),
    from_owner  BOOLEAN NOT NULL,
    body        TEXT NOT NULL,
    sent_at     TIMESTAMPTZ NOT NULL
);

-- ---------------------------------------------------------------------------
-- USERS
-- ---------------------------------------------------------------------------
INSERT INTO users (username, display_name, avatar_url, phone_number) VALUES
    ('meera',  'Meera Kapoor', '/images/avatars/meera.svg',  '+91 98450 11234'),
    ('rahul',  'Rahul Nair',   '/images/avatars/rahul.svg',  '+91 98450 55678'),
    ('nikhil', 'Nikhil Rao',   '/images/avatars/nikhil.jpg', '+91 98450 99012'),
    ('priya',  'Priya Menon',  '/images/avatars/priya.jpg',  '+91 98450 33456'),
    ('arjun',  'Arjun Kapoor', '/images/avatars/arjun.jpg',  '+91 98450 77890');

-- ---------------------------------------------------------------------------
-- THREADS + PARTICIPANTS
-- ---------------------------------------------------------------------------
INSERT INTO threads (thread_key, kind) VALUES
    ('meera-nikhil', 'direct'),
    ('arjun-meera', 'direct'),
    ('meera-rahul', 'direct'),
    ('meera-priya', 'direct');
INSERT INTO threads (thread_key, kind, title, avatar_url) VALUES
    ('college-batch', 'group', 'College Batch 💫', '/images/avatars/group-college.svg');

INSERT INTO thread_participants (thread_id, user_id)
    SELECT (SELECT id FROM threads WHERE thread_key='meera-nikhil'), id FROM users WHERE username IN ('meera','nikhil');
INSERT INTO thread_participants (thread_id, user_id)
    SELECT (SELECT id FROM threads WHERE thread_key='arjun-meera'), id FROM users WHERE username IN ('meera','arjun');
INSERT INTO thread_participants (thread_id, user_id)
    SELECT (SELECT id FROM threads WHERE thread_key='meera-rahul'), id FROM users WHERE username IN ('meera','rahul');
INSERT INTO thread_participants (thread_id, user_id)
    SELECT (SELECT id FROM threads WHERE thread_key='meera-priya'), id FROM users WHERE username IN ('meera','priya');
INSERT INTO thread_participants (thread_id, user_id)
    SELECT (SELECT id FROM threads WHERE thread_key='college-batch'), id FROM users WHERE username IN ('meera','rahul','nikhil','priya');

-- ---------------------------------------------------------------------------
-- MESSAGES -- evidence ids assigned in narrative order: WA-001..129
-- ---------------------------------------------------------------------------

-- meera <-> nikhil (WA-001..032) -- an escalating arc: an innocent favor,
-- then a session that's unambiguously about an affair (deleted-message
-- energy, guilt, "if he ever saw"), then a return to deniable warmth, then
-- the delayed-notification beat right at the disappearance. This is the
-- same real affair the story's Photos/Email beats confirm -- WhatsApp is
-- just one more channel it leaks through.

-- Session A -- portfolio favor, casual catch-up (2024-04-15)
INSERT INTO messages (evidence_id, thread_id, sender_id, body, sent_at) VALUES
    ('WA-001', (SELECT id FROM threads WHERE thread_key='meera-nikhil'), (SELECT id FROM users WHERE username='nikhil'),
     'Random q -- do you still have that photo you took of me at Priya''s engagement? Need it for something', t('2024-04-15 16:00:00+05:30')),
    ('WA-002', (SELECT id FROM threads WHERE thread_key='meera-nikhil'), (SELECT id FROM users WHERE username='meera'),
     'Oh my god yes hold on', t('2024-04-15 16:05:00+05:30')),
    ('WA-003', (SELECT id FROM threads WHERE thread_key='meera-nikhil'), (SELECT id FROM users WHERE username='meera'),
     'Found it. You blinked in literally every other shot lol', t('2024-04-15 16:08:00+05:30')),
    ('WA-004', (SELECT id FROM threads WHERE thread_key='meera-nikhil'), (SELECT id FROM users WHERE username='nikhil'),
     'This one works, thank you 🙏', t('2024-04-15 16:10:00+05:30')),
    ('WA-005', (SELECT id FROM threads WHERE thread_key='meera-nikhil'), (SELECT id FROM users WHERE username='meera'),
     'What''s it for?', t('2024-04-15 16:11:00+05:30')),
    ('WA-006', (SELECT id FROM threads WHERE thread_key='meera-nikhil'), (SELECT id FROM users WHERE username='nikhil'),
     'Portfolio site, finally updating it', t('2024-04-15 16:13:00+05:30')),
    ('WA-007', (SELECT id FROM threads WHERE thread_key='meera-nikhil'), (SELECT id FROM users WHERE username='meera'),
     'About time. Send me the link when it''s up', t('2024-04-15 16:15:00+05:30')),
    ('WA-008', (SELECT id FROM threads WHERE thread_key='meera-nikhil'), (SELECT id FROM users WHERE username='nikhil'),
     'Will do', t('2024-04-15 16:16:00+05:30'));

-- Session B -- unambiguous affair session (2024-06-20)
INSERT INTO messages (evidence_id, thread_id, sender_id, body, sent_at) VALUES
    ('WA-009', (SELECT id FROM threads WHERE thread_key='meera-nikhil'), (SELECT id FROM users WHERE username='nikhil'),
     'Can''t stop thinking about last night', t('2024-06-20 23:10:00+05:30')),
    ('WA-010', (SELECT id FROM threads WHERE thread_key='meera-nikhil'), (SELECT id FROM users WHERE username='meera'),
     'Me neither. We shouldn''t have', t('2024-06-20 23:14:00+05:30')),
    ('WA-011', (SELECT id FROM threads WHERE thread_key='meera-nikhil'), (SELECT id FROM users WHERE username='nikhil'),
     'I know. I know.', t('2024-06-20 23:15:00+05:30')),
    ('WA-012', (SELECT id FROM threads WHERE thread_key='meera-nikhil'), (SELECT id FROM users WHERE username='nikhil'),
     'But I''m not sorry', t('2024-06-20 23:16:00+05:30')),
    ('WA-013', (SELECT id FROM threads WHERE thread_key='meera-nikhil'), (SELECT id FROM users WHERE username='meera'),
     'Delete this after you read it', t('2024-06-20 23:18:00+05:30')),
    ('WA-014', (SELECT id FROM threads WHERE thread_key='meera-nikhil'), (SELECT id FROM users WHERE username='nikhil'),
     'Always do', t('2024-06-20 23:18:30+05:30')),
    ('WA-015', (SELECT id FROM threads WHERE thread_key='meera-nikhil'), (SELECT id FROM users WHERE username='meera'),
     'I mean it Nikhil. If he ever saw--', t('2024-06-20 23:19:00+05:30')),
    ('WA-016', (SELECT id FROM threads WHERE thread_key='meera-nikhil'), (SELECT id FROM users WHERE username='nikhil'),
     'He won''t. I promise', t('2024-06-20 23:20:00+05:30')),
    ('WA-017', (SELECT id FROM threads WHERE thread_key='meera-nikhil'), (SELECT id FROM users WHERE username='meera'),
     'This is so messed up', t('2024-06-20 23:22:00+05:30')),
    ('WA-018', (SELECT id FROM threads WHERE thread_key='meera-nikhil'), (SELECT id FROM users WHERE username='nikhil'),
     'Then why does it feel like the only thing that makes sense lately', t('2024-06-20 23:24:00+05:30')),
    ('WA-019', (SELECT id FROM threads WHERE thread_key='meera-nikhil'), (SELECT id FROM users WHERE username='meera'),
     'Don''t. Please don''t say things like that', t('2024-06-20 23:26:00+05:30')),
    ('WA-020', (SELECT id FROM threads WHERE thread_key='meera-nikhil'), (SELECT id FROM users WHERE username='nikhil'),
     'Ok. I''m sorry', t('2024-06-20 23:27:00+05:30')),
    ('WA-021', (SELECT id FROM threads WHERE thread_key='meera-nikhil'), (SELECT id FROM users WHERE username='meera'),
     'I have to go', t('2024-06-20 23:30:00+05:30')),
    ('WA-022', (SELECT id FROM threads WHERE thread_key='meera-nikhil'), (SELECT id FROM users WHERE username='nikhil'),
     'Text me when you''re home safe', t('2024-06-20 23:31:00+05:30'));

-- Session C -- reunion follow-up, then the delayed-notification beat (2024-08-28 / 2024-09-02)
INSERT INTO messages (evidence_id, thread_id, sender_id, body, sent_at) VALUES
    ('WA-023', (SELECT id FROM threads WHERE thread_key='meera-nikhil'), (SELECT id FROM users WHERE username='nikhil'),
     'Hey, long time! Everything okay?', t('2024-08-28 10:00:00+05:30')),
    ('WA-024', (SELECT id FROM threads WHERE thread_key='meera-nikhil'), (SELECT id FROM users WHERE username='meera'),
     'Yeah just busy. You?', t('2024-08-28 10:20:00+05:30')),
    ('WA-025', (SELECT id FROM threads WHERE thread_key='meera-nikhil'), (SELECT id FROM users WHERE username='nikhil'),
     'Good good.', t('2024-08-28 10:22:00+05:30')),
    ('WA-026', (SELECT id FROM threads WHERE thread_key='meera-nikhil'), (SELECT id FROM users WHERE username='nikhil'),
     'Saw the reunion pics. You look happy', t('2024-08-28 10:25:00+05:30')),
    ('WA-027', (SELECT id FROM threads WHERE thread_key='meera-nikhil'), (SELECT id FROM users WHERE username='meera'),
     'I am 🙂', t('2024-08-28 10:30:00+05:30')),
    ('WA-028', (SELECT id FROM threads WHERE thread_key='meera-nikhil'), (SELECT id FROM users WHERE username='nikhil'),
     'Good. You deserve that', t('2024-08-28 10:32:00+05:30')),
    ('WA-029', (SELECT id FROM threads WHERE thread_key='meera-nikhil'), (SELECT id FROM users WHERE username='meera'),
     'That''s sweet, thank you', t('2024-08-28 10:35:00+05:30')),
    ('WA-030', (SELECT id FROM threads WHERE thread_key='meera-nikhil'), (SELECT id FROM users WHERE username='nikhil'),
     'Anytime you need to talk, I''m around. Always have been', t('2024-08-28 10:40:00+05:30')),
    ('WA-031', (SELECT id FROM threads WHERE thread_key='meera-nikhil'), (SELECT id FROM users WHERE username='meera'),
     'I know. Same here', t('2024-08-28 10:45:00+05:30')),
    ('WA-032', (SELECT id FROM threads WHERE thread_key='meera-nikhil'), (SELECT id FROM users WHERE username='nikhil'),
     'You regularly post status on your social media. What happened today? Why don''t you post anything?', t('2024-09-02 21:40:00+05:30'));

-- arjun <-> meera (WA-033..072) -- ordinary married life, then real tension.
-- The fight in the last session isn't resolved so much as paused -- Meera
-- can't explain what she's actually dealing with, and Arjun is left with
-- an unexplained rift right before she disappears.

-- Session -- missing each other (2024-06-10)
INSERT INTO messages (evidence_id, thread_id, sender_id, body, sent_at) VALUES
    ('WA-033', (SELECT id FROM threads WHERE thread_key='arjun-meera'), (SELECT id FROM users WHERE username='arjun'),
     'Miss you, meeting''s running long', t('2024-06-10 18:30:00+05:30')),
    ('WA-034', (SELECT id FROM threads WHERE thread_key='arjun-meera'), (SELECT id FROM users WHERE username='meera'),
     'Miss you too, hurry home', t('2024-06-10 18:32:00+05:30')),
    ('WA-035', (SELECT id FROM threads WHERE thread_key='arjun-meera'), (SELECT id FROM users WHERE username='arjun'),
     'Bringing your favorite from that bakery', t('2024-06-10 18:35:00+05:30')),
    ('WA-036', (SELECT id FROM threads WHERE thread_key='arjun-meera'), (SELECT id FROM users WHERE username='meera'),
     'Marry me again', t('2024-06-10 19:10:00+05:30')),
    ('WA-037', (SELECT id FROM threads WHERE thread_key='arjun-meera'), (SELECT id FROM users WHERE username='arjun'),
     'Already did 😌', t('2024-06-10 19:11:00+05:30'));

-- Session -- forgotten errand, weekend plans (2024-07-05)
INSERT INTO messages (evidence_id, thread_id, sender_id, body, sent_at) VALUES
    ('WA-038', (SELECT id FROM threads WHERE thread_key='arjun-meera'), (SELECT id FROM users WHERE username='arjun'),
     'Did you cancel the internet guy? He just called me confused', t('2024-07-05 13:00:00+05:30')),
    ('WA-039', (SELECT id FROM threads WHERE thread_key='arjun-meera'), (SELECT id FROM users WHERE username='meera'),
     'Ugh I forgot, sorry! I''ll call him', t('2024-07-05 13:02:00+05:30')),
    ('WA-040', (SELECT id FROM threads WHERE thread_key='arjun-meera'), (SELECT id FROM users WHERE username='arjun'),
     'It''s fine just do it before he shows up at 3 lol', t('2024-07-05 13:03:00+05:30')),
    ('WA-041', (SELECT id FROM threads WHERE thread_key='arjun-meera'), (SELECT id FROM users WHERE username='meera'),
     'On it', t('2024-07-05 13:04:00+05:30')),
    ('WA-042', (SELECT id FROM threads WHERE thread_key='arjun-meera'), (SELECT id FROM users WHERE username='meera'),
     'Done, rescheduled to next week', t('2024-07-05 13:20:00+05:30')),
    ('WA-043', (SELECT id FROM threads WHERE thread_key='arjun-meera'), (SELECT id FROM users WHERE username='arjun'),
     'Hero', t('2024-07-05 13:21:00+05:30')),
    ('WA-044', (SELECT id FROM threads WHERE thread_key='arjun-meera'), (SELECT id FROM users WHERE username='arjun'),
     'What do you want to do this weekend?', t('2024-07-05 13:25:00+05:30')),
    ('WA-045', (SELECT id FROM threads WHERE thread_key='arjun-meera'), (SELECT id FROM users WHERE username='meera'),
     'Nothing. Absolutely nothing. Maybe a movie', t('2024-07-05 13:26:00+05:30')),
    ('WA-046', (SELECT id FROM threads WHERE thread_key='arjun-meera'), (SELECT id FROM users WHERE username='arjun'),
     'Deal', t('2024-07-05 13:27:00+05:30'));

-- Session -- pizza night (2024-08-01)
INSERT INTO messages (evidence_id, thread_id, sender_id, body, sent_at) VALUES
    ('WA-047', (SELECT id FROM threads WHERE thread_key='arjun-meera'), (SELECT id FROM users WHERE username='arjun'),
     'Pizza tonight?', t('2024-08-01 19:00:00+05:30')),
    ('WA-048', (SELECT id FROM threads WHERE thread_key='arjun-meera'), (SELECT id FROM users WHERE username='meera'),
     'Yes pls 🍕', t('2024-08-01 19:02:00+05:30')),
    ('WA-049', (SELECT id FROM threads WHERE thread_key='arjun-meera'), (SELECT id FROM users WHERE username='arjun'),
     'Ordering now', t('2024-08-01 19:03:00+05:30')),
    ('WA-050', (SELECT id FROM threads WHERE thread_key='arjun-meera'), (SELECT id FROM users WHERE username='meera'),
     'You''re the best', t('2024-08-01 19:04:00+05:30'));

-- Session -- vet appointment + quiet at dinner (2024-08-25 / 2024-08-29)
INSERT INTO messages (evidence_id, thread_id, sender_id, body, sent_at) VALUES
    ('WA-051', (SELECT id FROM threads WHERE thread_key='arjun-meera'), (SELECT id FROM users WHERE username='arjun'),
     'Don''t forget Bruno''s vet appt tomorrow', t('2024-08-25 21:10:00+05:30')),
    ('WA-052', (SELECT id FROM threads WHERE thread_key='arjun-meera'), (SELECT id FROM users WHERE username='meera'),
     'On it, 5pm right?', t('2024-08-25 21:12:00+05:30')),
    ('WA-053', (SELECT id FROM threads WHERE thread_key='arjun-meera'), (SELECT id FROM users WHERE username='arjun'),
     'You okay? You seemed quiet at dinner', t('2024-08-29 22:00:00+05:30')),
    ('WA-054', (SELECT id FROM threads WHERE thread_key='arjun-meera'), (SELECT id FROM users WHERE username='meera'),
     'Just tired, work stuff. I''m fine', t('2024-08-29 22:05:00+05:30')),
    ('WA-055', (SELECT id FROM threads WHERE thread_key='arjun-meera'), (SELECT id FROM users WHERE username='arjun'),
     'Ok. Love you', t('2024-08-29 22:06:00+05:30')),
    ('WA-056', (SELECT id FROM threads WHERE thread_key='arjun-meera'), (SELECT id FROM users WHERE username='meera'),
     'Love you too', t('2024-08-29 22:07:00+05:30'));

-- Session -- the fight (2024-08-31), two days before the disappearance
INSERT INTO messages (evidence_id, thread_id, sender_id, body, sent_at) VALUES
    ('WA-057', (SELECT id FROM threads WHERE thread_key='arjun-meera'), (SELECT id FROM users WHERE username='arjun'),
     'Are you even going to tell me what''s going on with you?', t('2024-08-31 21:00:00+05:30')),
    ('WA-058', (SELECT id FROM threads WHERE thread_key='arjun-meera'), (SELECT id FROM users WHERE username='meera'),
     'Nothing is going on, I already told you', t('2024-08-31 21:02:00+05:30')),
    ('WA-059', (SELECT id FROM threads WHERE thread_key='arjun-meera'), (SELECT id FROM users WHERE username='arjun'),
     'You''ve been distracted for weeks. Distant. And don''t say work', t('2024-08-31 21:03:00+05:30')),
    ('WA-060', (SELECT id FROM threads WHERE thread_key='arjun-meera'), (SELECT id FROM users WHERE username='meera'),
     'Can we not do this right now', t('2024-08-31 21:04:00+05:30')),
    ('WA-061', (SELECT id FROM threads WHERE thread_key='arjun-meera'), (SELECT id FROM users WHERE username='arjun'),
     'When then? You disappear into your phone every night and shut down the second I ask anything', t('2024-08-31 21:06:00+05:30')),
    ('WA-062', (SELECT id FROM threads WHERE thread_key='arjun-meera'), (SELECT id FROM users WHERE username='meera'),
     'That''s not fair', t('2024-08-31 21:07:00+05:30')),
    ('WA-063', (SELECT id FROM threads WHERE thread_key='arjun-meera'), (SELECT id FROM users WHERE username='arjun'),
     'Isn''t it? I don''t even know who I''m talking to anymore', t('2024-08-31 21:08:00+05:30')),
    ('WA-064', (SELECT id FROM threads WHERE thread_key='arjun-meera'), (SELECT id FROM users WHERE username='meera'),
     'Don''t you dare turn this around on me', t('2024-08-31 21:09:00+05:30')),
    ('WA-065', (SELECT id FROM threads WHERE thread_key='arjun-meera'), (SELECT id FROM users WHERE username='arjun'),
     'I''m not trying to fight', t('2024-08-31 21:10:00+05:30')),
    ('WA-066', (SELECT id FROM threads WHERE thread_key='arjun-meera'), (SELECT id FROM users WHERE username='meera'),
     'Could''ve fooled me', t('2024-08-31 21:11:00+05:30')),
    ('WA-067', (SELECT id FROM threads WHERE thread_key='arjun-meera'), (SELECT id FROM users WHERE username='arjun'),
     'I just want my wife back', t('2024-08-31 21:13:00+05:30')),
    ('WA-068', (SELECT id FROM threads WHERE thread_key='arjun-meera'), (SELECT id FROM users WHERE username='meera'),
     'I''m right here Arjun', t('2024-08-31 21:14:00+05:30')),
    ('WA-069', (SELECT id FROM threads WHERE thread_key='arjun-meera'), (SELECT id FROM users WHERE username='arjun'),
     'Are you though', t('2024-08-31 21:15:00+05:30')),
    ('WA-070', (SELECT id FROM threads WHERE thread_key='arjun-meera'), (SELECT id FROM users WHERE username='meera'),
     'I''m sorry. I''m just dealing with something. I can''t explain it yet. Please just trust me a little longer', t('2024-08-31 21:22:00+05:30')),
    ('WA-071', (SELECT id FROM threads WHERE thread_key='arjun-meera'), (SELECT id FROM users WHERE username='arjun'),
     'Ok. I trust you. I just miss you', t('2024-08-31 21:24:00+05:30')),
    ('WA-072', (SELECT id FROM threads WHERE thread_key='arjun-meera'), (SELECT id FROM users WHERE username='meera'),
     'I miss you too. I promise this will make sense soon', t('2024-08-31 21:26:00+05:30'));

-- meera <-> rahul (WA-073..107) -- childhood best friends, unmistakably. Four
-- sessions spread across the year. Rahul circles a confession three separate
-- times and backs out every time -- reads as sentimental best-friend energy
-- on a first pass, and very differently once Rahul's real feelings and what
-- they drove him to are known. Deliberately never explicit; not the
-- password clue (that's the social-media DM thread).

-- Session A -- childhood nostalgia, first near-confession (2024-02-14)
INSERT INTO messages (evidence_id, thread_id, sender_id, body, sent_at) VALUES
    ('WA-073', (SELECT id FROM threads WHERE thread_key='meera-rahul'), (SELECT id FROM users WHERE username='rahul'),
     'Found an old photo of us from 4th grade today 😂', t('2024-02-14 10:00:00+05:30')),
    ('WA-074', (SELECT id FROM threads WHERE thread_key='meera-rahul'), (SELECT id FROM users WHERE username='meera'),
     'NO. Delete it.', t('2024-02-14 10:01:00+05:30')),
    ('WA-075', (SELECT id FROM threads WHERE thread_key='meera-rahul'), (SELECT id FROM users WHERE username='rahul'),
     'Never. Blackmail material for life', t('2024-02-14 10:02:00+05:30')),
    ('WA-076', (SELECT id FROM threads WHERE thread_key='meera-rahul'), (SELECT id FROM users WHERE username='meera'),
     'I had a bowl cut, Rahul. Show mercy', t('2024-02-14 10:03:00+05:30')),
    ('WA-077', (SELECT id FROM threads WHERE thread_key='meera-rahul'), (SELECT id FROM users WHERE username='rahul'),
     'Remember Mrs. Iyer''s class? She hated us', t('2024-02-14 10:05:00+05:30')),
    ('WA-078', (SELECT id FROM threads WHERE thread_key='meera-rahul'), (SELECT id FROM users WHERE username='meera'),
     'She hated YOU. I was an angel', t('2024-02-14 10:06:00+05:30')),
    ('WA-079', (SELECT id FROM threads WHERE thread_key='meera-rahul'), (SELECT id FROM users WHERE username='rahul'),
     'You started the paper plane war', t('2024-02-14 10:07:00+05:30')),
    ('WA-080', (SELECT id FROM threads WHERE thread_key='meera-rahul'), (SELECT id FROM users WHERE username='meera'),
     '...okay fair', t('2024-02-14 10:08:00+05:30')),
    ('WA-081', (SELECT id FROM threads WHERE thread_key='meera-rahul'), (SELECT id FROM users WHERE username='rahul'),
     'We had a good childhood', t('2024-02-14 10:10:00+05:30')),
    ('WA-082', (SELECT id FROM threads WHERE thread_key='meera-rahul'), (SELECT id FROM users WHERE username='meera'),
     'The best. It''s rare, what we have', t('2024-02-14 10:12:00+05:30')),
    ('WA-083', (SELECT id FROM threads WHERE thread_key='meera-rahul'), (SELECT id FROM users WHERE username='rahul'),
     'Yeah. Meera, can I tell you something', t('2024-02-14 10:15:00+05:30')),
    ('WA-084', (SELECT id FROM threads WHERE thread_key='meera-rahul'), (SELECT id FROM users WHERE username='meera'),
     'Always', t('2024-02-14 10:16:00+05:30')),
    ('WA-085', (SELECT id FROM threads WHERE thread_key='meera-rahul'), (SELECT id FROM users WHERE username='rahul'),
     '...nvm. It''s dumb, forget it', t('2024-02-14 10:20:00+05:30')),
    ('WA-086', (SELECT id FROM threads WHERE thread_key='meera-rahul'), (SELECT id FROM users WHERE username='meera'),
     'Ok weirdo 😂', t('2024-02-14 10:21:00+05:30'));

-- Session B -- following up on his own trek post from social media (2024-05-13)
INSERT INTO messages (evidence_id, thread_id, sender_id, body, sent_at) VALUES
    ('WA-087', (SELECT id FROM threads WHERE thread_key='meera-rahul'), (SELECT id FROM users WHERE username='rahul'),
     'That trek was so much fun, you really should''ve come', t('2024-05-13 09:00:00+05:30')),
    ('WA-088', (SELECT id FROM threads WHERE thread_key='meera-rahul'), (SELECT id FROM users WHERE username='meera'),
     'I know! Next time for sure, promise', t('2024-05-13 09:05:00+05:30')),
    ('WA-089', (SELECT id FROM threads WHERE thread_key='meera-rahul'), (SELECT id FROM users WHERE username='rahul'),
     'Holding you to that', t('2024-05-13 09:06:00+05:30'));

-- Session C -- second near-confession (2024-07-10)
INSERT INTO messages (evidence_id, thread_id, sender_id, body, sent_at) VALUES
    ('WA-090', (SELECT id FROM threads WHERE thread_key='meera-rahul'), (SELECT id FROM users WHERE username='rahul'),
     'Hey are you free to talk', t('2024-07-10 20:00:00+05:30')),
    ('WA-091', (SELECT id FROM threads WHERE thread_key='meera-rahul'), (SELECT id FROM users WHERE username='meera'),
     'Always for you, what''s up', t('2024-07-10 20:02:00+05:30')),
    ('WA-092', (SELECT id FROM threads WHERE thread_key='meera-rahul'), (SELECT id FROM users WHERE username='rahul'),
     'There''s something I''ve been meaning to say for a while', t('2024-07-10 20:05:00+05:30')),
    ('WA-093', (SELECT id FROM threads WHERE thread_key='meera-rahul'), (SELECT id FROM users WHERE username='meera'),
     'Ok now I''m curious, say it', t('2024-07-10 20:06:00+05:30')),
    ('WA-094', (SELECT id FROM threads WHERE thread_key='meera-rahul'), (SELECT id FROM users WHERE username='rahul'),
     'I don''t know how to say this without it coming out wrong', t('2024-07-10 20:08:00+05:30')),
    ('WA-095', (SELECT id FROM threads WHERE thread_key='meera-rahul'), (SELECT id FROM users WHERE username='meera'),
     'Rahul you''re scaring me a little 😅', t('2024-07-10 20:09:00+05:30')),
    ('WA-096', (SELECT id FROM threads WHERE thread_key='meera-rahul'), (SELECT id FROM users WHERE username='rahul'),
     'No no it''s not bad, I promise. I just—', t('2024-07-10 20:10:00+05:30')),
    ('WA-097', (SELECT id FROM threads WHERE thread_key='meera-rahul'), (SELECT id FROM users WHERE username='rahul'),
     'Forget it. I''ll tell you in person sometime', t('2024-07-10 20:12:00+05:30')),
    ('WA-098', (SELECT id FROM threads WHERE thread_key='meera-rahul'), (SELECT id FROM users WHERE username='meera'),
     'You always say that', t('2024-07-10 20:13:00+05:30')),
    ('WA-099', (SELECT id FROM threads WHERE thread_key='meera-rahul'), (SELECT id FROM users WHERE username='rahul'),
     'I mean it this time', t('2024-07-10 20:14:00+05:30'));

-- Session D -- possessive undertone, right before the disappearance (2024-08-30)
INSERT INTO messages (evidence_id, thread_id, sender_id, body, sent_at) VALUES
    ('WA-100', (SELECT id FROM threads WHERE thread_key='meera-rahul'), (SELECT id FROM users WHERE username='rahul'),
     'You''ve been quiet lately', t('2024-08-30 21:00:00+05:30')),
    ('WA-101', (SELECT id FROM threads WHERE thread_key='meera-rahul'), (SELECT id FROM users WHERE username='meera'),
     'Just busy with stuff', t('2024-08-30 21:02:00+05:30')),
    ('WA-102', (SELECT id FROM threads WHERE thread_key='meera-rahul'), (SELECT id FROM users WHERE username='rahul'),
     'You''d tell me if something was wrong right? Anything at all', t('2024-08-30 21:05:00+05:30')),
    ('WA-103', (SELECT id FROM threads WHERE thread_key='meera-rahul'), (SELECT id FROM users WHERE username='meera'),
     'Of course. Why?', t('2024-08-30 21:07:00+05:30')),
    ('WA-104', (SELECT id FROM threads WHERE thread_key='meera-rahul'), (SELECT id FROM users WHERE username='rahul'),
     'No reason. I just don''t like not knowing what''s going on with you', t('2024-08-30 21:10:00+05:30')),
    ('WA-105', (SELECT id FROM threads WHERE thread_key='meera-rahul'), (SELECT id FROM users WHERE username='meera'),
     'I''m fine Rahul, promise', t('2024-08-30 21:12:00+05:30')),
    ('WA-106', (SELECT id FROM threads WHERE thread_key='meera-rahul'), (SELECT id FROM users WHERE username='rahul'),
     'Ok. I''m here. Always have been, since we were kids', t('2024-08-30 21:15:00+05:30')),
    ('WA-107', (SELECT id FROM threads WHERE thread_key='meera-rahul'), (SELECT id FROM users WHERE username='meera'),
     '😊 same to you', t('2024-08-30 21:16:00+05:30'));

-- meera <-> priya (WA-108..125)

-- Session -- disaster Tinder date, comic relief (2024-05-01)
INSERT INTO messages (evidence_id, thread_id, sender_id, body, sent_at) VALUES
    ('WA-108', (SELECT id FROM threads WHERE thread_key='meera-priya'), (SELECT id FROM users WHERE username='priya'),
     'Ok I need to tell you about my disaster of a Tinder date last night', t('2024-05-01 21:00:00+05:30')),
    ('WA-109', (SELECT id FROM threads WHERE thread_key='meera-priya'), (SELECT id FROM users WHERE username='meera'),
     'OMG go on', t('2024-05-01 21:01:00+05:30')),
    ('WA-110', (SELECT id FROM threads WHERE thread_key='meera-priya'), (SELECT id FROM users WHERE username='priya'),
     'He brought his mother. TO THE DATE.', t('2024-05-01 21:02:00+05:30')),
    ('WA-111', (SELECT id FROM threads WHERE thread_key='meera-priya'), (SELECT id FROM users WHERE username='meera'),
     'WHAT', t('2024-05-01 21:02:30+05:30')),
    ('WA-112', (SELECT id FROM threads WHERE thread_key='meera-priya'), (SELECT id FROM users WHERE username='priya'),
     'She ordered for him', t('2024-05-01 21:03:00+05:30')),
    ('WA-113', (SELECT id FROM threads WHERE thread_key='meera-priya'), (SELECT id FROM users WHERE username='meera'),
     'I''m actually screaming, please never date again', t('2024-05-01 21:04:00+05:30')),
    ('WA-114', (SELECT id FROM threads WHERE thread_key='meera-priya'), (SELECT id FROM users WHERE username='priya'),
     'Deleting the app as we speak', t('2024-05-01 21:05:00+05:30'));

-- Session -- August catch-up (2024-08-01)
INSERT INTO messages (evidence_id, thread_id, sender_id, body, sent_at) VALUES
    ('WA-115', (SELECT id FROM threads WHERE thread_key='meera-priya'), (SELECT id FROM users WHERE username='priya'),
     'Can''t believe it''s already August', t('2024-08-01 08:00:00+05:30')),
    ('WA-116', (SELECT id FROM threads WHERE thread_key='meera-priya'), (SELECT id FROM users WHERE username='meera'),
     'Time flies 😩', t('2024-08-01 08:05:00+05:30')),
    ('WA-117', (SELECT id FROM threads WHERE thread_key='meera-priya'), (SELECT id FROM users WHERE username='priya'),
     'Coffee this week?', t('2024-08-01 08:06:00+05:30')),
    ('WA-118', (SELECT id FROM threads WHERE thread_key='meera-priya'), (SELECT id FROM users WHERE username='meera'),
     'Yes pls, I need it', t('2024-08-01 08:07:00+05:30'));

-- Session -- supportive check-in, noticing Meera's been off (2024-07-22)
INSERT INTO messages (evidence_id, thread_id, sender_id, body, sent_at) VALUES
    ('WA-119', (SELECT id FROM threads WHERE thread_key='meera-priya'), (SELECT id FROM users WHERE username='priya'),
     'Hey, you''ve seemed a little off lately. Everything ok?', t('2024-07-22 19:00:00+05:30')),
    ('WA-120', (SELECT id FROM threads WHERE thread_key='meera-priya'), (SELECT id FROM users WHERE username='meera'),
     'Yeah just a lot on my mind. Nothing major', t('2024-07-22 19:03:00+05:30')),
    ('WA-121', (SELECT id FROM threads WHERE thread_key='meera-priya'), (SELECT id FROM users WHERE username='priya'),
     'You''d tell me if it was though right', t('2024-07-22 19:04:00+05:30')),
    ('WA-122', (SELECT id FROM threads WHERE thread_key='meera-priya'), (SELECT id FROM users WHERE username='meera'),
     'Of course. Promise', t('2024-07-22 19:05:00+05:30')),
    ('WA-123', (SELECT id FROM threads WHERE thread_key='meera-priya'), (SELECT id FROM users WHERE username='priya'),
     'Ok. I''m here if you need to vent, always', t('2024-07-22 19:06:00+05:30')),
    ('WA-124', (SELECT id FROM threads WHERE thread_key='meera-priya'), (SELECT id FROM users WHERE username='meera'),
     'I know. Love you', t('2024-07-22 19:08:00+05:30')),
    ('WA-125', (SELECT id FROM threads WHERE thread_key='meera-priya'), (SELECT id FROM users WHERE username='priya'),
     'Love you too weirdo', t('2024-07-22 19:09:00+05:30'));

-- College Batch group (WA-126..129)
INSERT INTO messages (evidence_id, thread_id, sender_id, body, sent_at) VALUES
    ('WA-126', (SELECT id FROM threads WHERE thread_key='college-batch'), (SELECT id FROM users WHERE username='priya'),
     'Does anyone still have the notes from 3rd year stats??', t('2024-03-10 14:00:00+05:30')),
    ('WA-127', (SELECT id FROM threads WHERE thread_key='college-batch'), (SELECT id FROM users WHERE username='rahul'),
     'lmaooo why', t('2024-03-10 14:02:00+05:30')),
    ('WA-128', (SELECT id FROM threads WHERE thread_key='college-batch'), (SELECT id FROM users WHERE username='nikhil'),
     'I definitely deleted those the day we graduated', t('2024-03-10 14:03:00+05:30')),
    ('WA-129', (SELECT id FROM threads WHERE thread_key='college-batch'), (SELECT id FROM users WHERE username='meera'),
     'Same 😂', t('2024-03-10 14:05:00+05:30'));

-- meera <-> nikhil, deleted messages (WA-130..131) -- placed at the end of
-- the id sequence (not renumbered into the thread) since display order is
-- controlled by sent_at, not evidence_id -- same convention already used in
-- the Priya thread. Both fall inside the June 20 affair session: real
-- content that got deleted in the moment, still real evidence -- the player
-- sees "This message was deleted", MERCY still sees the original body.
INSERT INTO messages (evidence_id, thread_id, sender_id, body, deleted, sent_at) VALUES
    ('WA-130', (SELECT id FROM threads WHERE thread_key='meera-nikhil'), (SELECT id FROM users WHERE username='nikhil'),
     'I think I''m falling for you and I don''t know what to do about it', true, t('2024-06-20 23:23:00+05:30')),
    ('WA-131', (SELECT id FROM threads WHERE thread_key='meera-nikhil'), (SELECT id FROM users WHERE username='meera'),
     'I love my husband. I do. But lately I don''t feel like myself', true, t('2024-06-20 23:28:00+05:30'));

-- meera <-> priya, appended sessions (WA-132..159) -- placed at the end of
-- the id sequence (not renumbered into the thread) since display order is
-- controlled by sent_at, not evidence_id -- same convention already used
-- elsewhere in this thread.

-- Session -- talking around the affair without ever naming Nikhil (2024-06-25)
INSERT INTO messages (evidence_id, thread_id, sender_id, body, sent_at) VALUES
    ('WA-132', (SELECT id FROM threads WHERE thread_key='meera-priya'), (SELECT id FROM users WHERE username='priya'),
     'How are you doing with... everything', t('2024-06-25 20:00:00+05:30')),
    ('WA-133', (SELECT id FROM threads WHERE thread_key='meera-priya'), (SELECT id FROM users WHERE username='meera'),
     'I don''t know what I''m doing anymore, Priya', t('2024-06-25 20:02:00+05:30')),
    ('WA-134', (SELECT id FROM threads WHERE thread_key='meera-priya'), (SELECT id FROM users WHERE username='priya'),
     'Have you told him. Wait, no, don''t answer that here', t('2024-06-25 20:03:00+05:30')),
    ('WA-135', (SELECT id FROM threads WHERE thread_key='meera-priya'), (SELECT id FROM users WHERE username='meera'),
     'God no. Never', t('2024-06-25 20:04:00+05:30')),
    ('WA-136', (SELECT id FROM threads WHERE thread_key='meera-priya'), (SELECT id FROM users WHERE username='priya'),
     'Ok. I just worry about you', t('2024-06-25 20:05:00+05:30')),
    ('WA-137', (SELECT id FROM threads WHERE thread_key='meera-priya'), (SELECT id FROM users WHERE username='meera'),
     'I know. I worry about me too', t('2024-06-25 20:06:00+05:30')),
    ('WA-138', (SELECT id FROM threads WHERE thread_key='meera-priya'), (SELECT id FROM users WHERE username='priya'),
     'Is it still happening', t('2024-06-25 20:10:00+05:30')),
    ('WA-139', (SELECT id FROM threads WHERE thread_key='meera-priya'), (SELECT id FROM users WHERE username='meera'),
     '...', t('2024-06-25 20:15:00+05:30')),
    ('WA-140', (SELECT id FROM threads WHERE thread_key='meera-priya'), (SELECT id FROM users WHERE username='meera'),
     'Yeah', t('2024-06-25 20:15:30+05:30')),
    ('WA-141', (SELECT id FROM threads WHERE thread_key='meera-priya'), (SELECT id FROM users WHERE username='priya'),
     'Meera', t('2024-06-25 20:16:00+05:30')),
    ('WA-142', (SELECT id FROM threads WHERE thread_key='meera-priya'), (SELECT id FROM users WHERE username='meera'),
     'I know', t('2024-06-25 20:17:00+05:30')),
    ('WA-143', (SELECT id FROM threads WHERE thread_key='meera-priya'), (SELECT id FROM users WHERE username='priya'),
     'I''m not judging you. I just don''t want you to get hurt', t('2024-06-25 20:18:00+05:30')),
    ('WA-144', (SELECT id FROM threads WHERE thread_key='meera-priya'), (SELECT id FROM users WHERE username='meera'),
     'It''s complicated', t('2024-06-25 20:20:00+05:30')),
    ('WA-145', (SELECT id FROM threads WHERE thread_key='meera-priya'), (SELECT id FROM users WHERE username='priya'),
     'It always is', t('2024-06-25 20:21:00+05:30'));

-- Session -- venting about the fight with Arjun, secrets tangled together (2024-09-01)
INSERT INTO messages (evidence_id, thread_id, sender_id, body, sent_at) VALUES
    ('WA-146', (SELECT id FROM threads WHERE thread_key='meera-priya'), (SELECT id FROM users WHERE username='priya'),
     'You ok? You seemed off on the phone earlier', t('2024-09-01 12:00:00+05:30')),
    ('WA-147', (SELECT id FROM threads WHERE thread_key='meera-priya'), (SELECT id FROM users WHERE username='meera'),
     'Arjun and I had a huge fight last night', t('2024-09-01 12:02:00+05:30')),
    ('WA-148', (SELECT id FROM threads WHERE thread_key='meera-priya'), (SELECT id FROM users WHERE username='priya'),
     'About what?', t('2024-09-01 12:03:00+05:30')),
    ('WA-149', (SELECT id FROM threads WHERE thread_key='meera-priya'), (SELECT id FROM users WHERE username='meera'),
     'He knows something''s up. He doesn''t know what, but he knows', t('2024-09-01 12:05:00+05:30')),
    ('WA-150', (SELECT id FROM threads WHERE thread_key='meera-priya'), (SELECT id FROM users WHERE username='priya'),
     'Are you going to tell him?', t('2024-09-01 12:06:00+05:30')),
    ('WA-151', (SELECT id FROM threads WHERE thread_key='meera-priya'), (SELECT id FROM users WHERE username='meera'),
     'I can''t. Not yet. Not until I figure this out', t('2024-09-01 12:08:00+05:30')),
    ('WA-152', (SELECT id FROM threads WHERE thread_key='meera-priya'), (SELECT id FROM users WHERE username='priya'),
     'Figure out the thing with... the other stuff too?', t('2024-09-01 12:09:00+05:30')),
    ('WA-153', (SELECT id FROM threads WHERE thread_key='meera-priya'), (SELECT id FROM users WHERE username='meera'),
     'Both. Everything''s tangled together right now', t('2024-09-01 12:10:00+05:30')),
    ('WA-154', (SELECT id FROM threads WHERE thread_key='meera-priya'), (SELECT id FROM users WHERE username='priya'),
     'That sounds exhausting', t('2024-09-01 12:11:00+05:30')),
    ('WA-155', (SELECT id FROM threads WHERE thread_key='meera-priya'), (SELECT id FROM users WHERE username='meera'),
     'It is. I love him Priya. I really do', t('2024-09-01 12:13:00+05:30')),
    ('WA-156', (SELECT id FROM threads WHERE thread_key='meera-priya'), (SELECT id FROM users WHERE username='priya'),
     'I know you do', t('2024-09-01 12:14:00+05:30')),
    ('WA-157', (SELECT id FROM threads WHERE thread_key='meera-priya'), (SELECT id FROM users WHERE username='meera'),
     'I just don''t know how to fix any of this', t('2024-09-01 12:15:00+05:30')),
    ('WA-158', (SELECT id FROM threads WHERE thread_key='meera-priya'), (SELECT id FROM users WHERE username='priya'),
     'You will. You always land on your feet', t('2024-09-01 12:17:00+05:30')),
    ('WA-159', (SELECT id FROM threads WHERE thread_key='meera-priya'), (SELECT id FROM users WHERE username='meera'),
     'I hope you''re right', t('2024-09-01 12:18:00+05:30'));

-- College Batch group, appended sessions (WA-160..196) -- placed at the end
-- of the id sequence (not renumbered into the thread) since display order
-- is controlled by sent_at, not evidence_id. A 4-person group should feel
-- messier and more chaotic than the 1:1 threads -- more people talking over
-- each other, inside jokes, nobody fully finishing a thought before the
-- next person jumps in.

-- Session -- old class photo derails into roasting Rahul (2024-01-15)
INSERT INTO messages (evidence_id, thread_id, sender_id, body, sent_at) VALUES
    ('WA-160', (SELECT id FROM threads WHERE thread_key='college-batch'), (SELECT id FROM users WHERE username='rahul'),
     'why is nikhil the only one who never responds in this chat', t('2024-01-15 19:00:00+05:30')),
    ('WA-161', (SELECT id FROM threads WHERE thread_key='college-batch'), (SELECT id FROM users WHERE username='nikhil'),
     'I respond! Eventually', t('2024-01-15 19:05:00+05:30')),
    ('WA-162', (SELECT id FROM threads WHERE thread_key='college-batch'), (SELECT id FROM users WHERE username='priya'),
     'eventually as in next fiscal year', t('2024-01-15 19:06:00+05:30')),
    ('WA-163', (SELECT id FROM threads WHERE thread_key='college-batch'), (SELECT id FROM users WHERE username='nikhil'),
     'rude but fair', t('2024-01-15 19:07:00+05:30')),
    ('WA-164', (SELECT id FROM threads WHERE thread_key='college-batch'), (SELECT id FROM users WHERE username='meera'),
     'guys I found our old class photo from 10th grade', t('2024-01-15 19:15:00+05:30')),
    ('WA-165', (SELECT id FROM threads WHERE thread_key='college-batch'), (SELECT id FROM users WHERE username='priya'),
     'SEND IT', t('2024-01-15 19:15:30+05:30')),
    ('WA-166', (SELECT id FROM threads WHERE thread_key='college-batch'), (SELECT id FROM users WHERE username='meera'),
     'no caption needed, rahul''s hair speaks for itself', t('2024-01-15 19:17:00+05:30')),
    ('WA-167', (SELECT id FROM threads WHERE thread_key='college-batch'), (SELECT id FROM users WHERE username='rahul'),
     'I will end this group chat', t('2024-01-15 19:18:00+05:30')),
    ('WA-168', (SELECT id FROM threads WHERE thread_key='college-batch'), (SELECT id FROM users WHERE username='nikhil'),
     '😂😂😂', t('2024-01-15 19:18:30+05:30')),
    ('WA-169', (SELECT id FROM threads WHERE thread_key='college-batch'), (SELECT id FROM users WHERE username='priya'),
     'please never delete this photo', t('2024-01-15 19:20:00+05:30')),
    ('WA-170', (SELECT id FROM threads WHERE thread_key='college-batch'), (SELECT id FROM users WHERE username='rahul'),
     'I hate it here', t('2024-01-15 19:21:00+05:30'));

-- Session -- planning a get-together (2024-06-05)
INSERT INTO messages (evidence_id, thread_id, sender_id, body, sent_at) VALUES
    ('WA-171', (SELECT id FROM threads WHERE thread_key='college-batch'), (SELECT id FROM users WHERE username='priya'),
     'ok who''s free next weekend, I miss everyone', t('2024-06-05 11:00:00+05:30')),
    ('WA-172', (SELECT id FROM threads WHERE thread_key='college-batch'), (SELECT id FROM users WHERE username='rahul'),
     'I''m in', t('2024-06-05 11:02:00+05:30')),
    ('WA-173', (SELECT id FROM threads WHERE thread_key='college-batch'), (SELECT id FROM users WHERE username='nikhil'),
     'same, assuming no work fires to put out', t('2024-06-05 11:05:00+05:30')),
    ('WA-174', (SELECT id FROM threads WHERE thread_key='college-batch'), (SELECT id FROM users WHERE username='meera'),
     'count me in, bringing Bruno', t('2024-06-05 11:07:00+05:30')),
    ('WA-175', (SELECT id FROM threads WHERE thread_key='college-batch'), (SELECT id FROM users WHERE username='priya'),
     'OBSESSED bring him', t('2024-06-05 11:07:30+05:30')),
    ('WA-176', (SELECT id FROM threads WHERE thread_key='college-batch'), (SELECT id FROM users WHERE username='rahul'),
     'does Arjun get an invite or is this an OG members only thing', t('2024-06-05 11:09:00+05:30')),
    ('WA-177', (SELECT id FROM threads WHERE thread_key='college-batch'), (SELECT id FROM users WHERE username='meera'),
     'lol he can come', t('2024-06-05 11:10:00+05:30')),
    ('WA-178', (SELECT id FROM threads WHERE thread_key='college-batch'), (SELECT id FROM users WHERE username='priya'),
     'casual coffee or are we doing the whole dinner thing', t('2024-06-05 11:12:00+05:30')),
    ('WA-179', (SELECT id FROM threads WHERE thread_key='college-batch'), (SELECT id FROM users WHERE username='rahul'),
     'dinner obviously, we''re not in college anymore we have money now', t('2024-06-05 11:13:00+05:30')),
    ('WA-180', (SELECT id FROM threads WHERE thread_key='college-batch'), (SELECT id FROM users WHERE username='nikhil'),
     'speak for yourself', t('2024-06-05 11:14:00+05:30')),
    ('WA-181', (SELECT id FROM threads WHERE thread_key='college-batch'), (SELECT id FROM users WHERE username='meera'),
     'same place as last time?', t('2024-06-05 11:16:00+05:30')),
    ('WA-182', (SELECT id FROM threads WHERE thread_key='college-batch'), (SELECT id FROM users WHERE username='priya'),
     'yesss', t('2024-06-05 11:16:30+05:30'));

-- Session -- nostalgic tangent, getting older (2024-08-10)
INSERT INTO messages (evidence_id, thread_id, sender_id, body, sent_at) VALUES
    ('WA-183', (SELECT id FROM threads WHERE thread_key='college-batch'), (SELECT id FROM users WHERE username='nikhil'),
     'reminder that we''re all getting old, saw a gray hair today', t('2024-08-10 21:00:00+05:30')),
    ('WA-184', (SELECT id FROM threads WHERE thread_key='college-batch'), (SELECT id FROM users WHERE username='rahul'),
     'we''ve been getting old since the day we met you', t('2024-08-10 21:02:00+05:30')),
    ('WA-185', (SELECT id FROM threads WHERE thread_key='college-batch'), (SELECT id FROM users WHERE username='nikhil'),
     'harsh', t('2024-08-10 21:02:30+05:30')),
    ('WA-186', (SELECT id FROM threads WHERE thread_key='college-batch'), (SELECT id FROM users WHERE username='priya'),
     'he''s not wrong', t('2024-08-10 21:03:00+05:30')),
    ('WA-187', (SELECT id FROM threads WHERE thread_key='college-batch'), (SELECT id FROM users WHERE username='meera'),
     'guys can we normalize turning 30 gracefully', t('2024-08-10 21:05:00+05:30')),
    ('WA-188', (SELECT id FROM threads WHERE thread_key='college-batch'), (SELECT id FROM users WHERE username='rahul'),
     'no', t('2024-08-10 21:05:30+05:30')),
    ('WA-189', (SELECT id FROM threads WHERE thread_key='college-batch'), (SELECT id FROM users WHERE username='priya'),
     'absolutely not', t('2024-08-10 21:06:00+05:30')),
    ('WA-190', (SELECT id FROM threads WHERE thread_key='college-batch'), (SELECT id FROM users WHERE username='meera'),
     'worth a shot', t('2024-08-10 21:06:30+05:30')),
    ('WA-191', (SELECT id FROM threads WHERE thread_key='college-batch'), (SELECT id FROM users WHERE username='nikhil'),
     'anyway happy almost-birthday season to whoever''s next', t('2024-08-10 21:08:00+05:30')),
    ('WA-192', (SELECT id FROM threads WHERE thread_key='college-batch'), (SELECT id FROM users WHERE username='priya'),
     'that''s meera in a few weeks!', t('2024-08-10 21:08:30+05:30')),
    ('WA-193', (SELECT id FROM threads WHERE thread_key='college-batch'), (SELECT id FROM users WHERE username='meera'),
     'don''t remind me', t('2024-08-10 21:09:00+05:30')),
    ('WA-194', (SELECT id FROM threads WHERE thread_key='college-batch'), (SELECT id FROM users WHERE username='rahul'),
     'we''re doing something for it, don''t argue', t('2024-08-10 21:10:00+05:30')),
    ('WA-195', (SELECT id FROM threads WHERE thread_key='college-batch'), (SELECT id FROM users WHERE username='meera'),
     'I would never dream of arguing with you', t('2024-08-10 21:11:00+05:30')),
    ('WA-196', (SELECT id FROM threads WHERE thread_key='college-batch'), (SELECT id FROM users WHERE username='rahul'),
     'good answer', t('2024-08-10 21:11:30+05:30'));


-- ---------------------------------------------------------------------------
-- THE ALIBI: the night she was taken, on her phone, unread. Arjun texts from
-- his brother's; his brother Vikram texts her too. Nothing is opened, because
-- by 22:10 she is gone. (WA-197..199; the_alibi checkpoint in mercy-engine.)
-- ---------------------------------------------------------------------------
INSERT INTO users (username, display_name, avatar_url, phone_number) VALUES
    ('vikram', 'Vikram Kapoor', '/images/avatars/vikram.svg', '+91 98450 66120');
INSERT INTO threads (thread_key, kind) VALUES ('meera-vikram', 'direct');
INSERT INTO thread_participants (thread_id, user_id)
    SELECT (SELECT id FROM threads WHERE thread_key='meera-vikram'), id FROM users WHERE username IN ('meera','vikram');
INSERT INTO messages (evidence_id, thread_id, sender_id, body, sent_at) VALUES
    ('WA-197', (SELECT id FROM threads WHERE thread_key='arjun-meera'), (SELECT id FROM users WHERE username='arjun'),
     'Reached bhaiya''s. Mum''s already asleep, Vikram''s making chai and pretending he isn''t going to lecture me. Call me when you''re up :)', t('2024-09-02 22:20:00+05:30')),
    ('WA-198', (SELECT id FROM threads WHERE thread_key='arjun-meera'), (SELECT id FROM users WHERE username='arjun'),
     'Going to sleep. Back by 10 tomorrow and we''ll talk properly, I promise. Love you.', t('2024-09-03 00:41:00+05:30')),
    ('WA-199', (SELECT id FROM threads WHERE thread_key='meera-vikram'), (SELECT id FROM users WHERE username='vikram'),
     'Hey Meera, Vikram here. Arjun''s staying over tonight, he''s fine -- mum made him eat two plates. He''s worried about you, that''s all. Talk to him tomorrow, ok?', t('2024-09-02 23:12:00+05:30'));

INSERT INTO evidence_counters (service, next_seq) VALUES ('whatsapp', 200);

-- ---------------------------------------------------------------------------
-- FILLER: bank alerts, delivery bot, promo broadcast, wrong-number stranger.
-- Timestamped relative to now() so the inbox always looks current.
-- ---------------------------------------------------------------------------
INSERT INTO filler_threads (kind, account_name, account_avatar) VALUES
    ('bank',     'Prime Bank',      '/images/avatars/prime-bank.jpg'),
    ('delivery', 'QuickCart',       '/images/avatars/quickcart.png'),
    ('promo',    'GreenLeaf Grocers', '/images/avatars/greenleaf.jpg'),
    ('stranger', '+91 90210 44872', '/images/avatars/unknown.svg');

INSERT INTO filler_messages (thread_id, from_owner, body, sent_at) VALUES
    ((SELECT id FROM filler_threads WHERE kind='bank'), false,
     'Your OTP for login is 482911. Do not share this with anyone.', now() - interval '6 hours'),
    ((SELECT id FROM filler_threads WHERE kind='bank'), false,
     '₹1,240 debited from A/C **4521 on 12-Aug for QuickCart Order#88213.', now() - interval '1 day'),
    ((SELECT id FROM filler_threads WHERE kind='delivery'), false,
     'Your order #88213 has been delivered! Enjoy 🛍️', now() - interval '2 days'),
    ((SELECT id FROM filler_threads WHERE kind='promo'), false,
     '🥦 Weekend Sale! Fresh produce at 25% off. Shop now!', now() - interval '8 hours'),
    ((SELECT id FROM filler_threads WHERE kind='stranger'), false,
     'Hi is this Rohan''s number? This is regarding the flat viewing tomorrow', now() - interval '4 days'),
    ((SELECT id FROM filler_threads WHERE kind='stranger'), true,
     'Sorry wrong number!', now() - interval '4 days' + interval '10 minutes');
