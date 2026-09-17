-- Quill (Gmail-style email) service database
-- Every real email carries a globally-unique evidence_id, prefix EML-###,
-- per the contract in /ARCHITECTURE.md.

-- Story timestamps are written as fixed 2024 calendar dates for readability,
-- but displayed relative-time should stay current no matter when this stack
-- actually runs. t(x) remaps every literal to be relative to now() at seed
-- time, anchored on the SAME reference point used by social-media and
-- whatsapp (Nikhil's WhatsApp "why don't you post anything?" message) so
-- all three services' timelines stay mutually consistent with each other.
CREATE FUNCTION t(orig TIMESTAMPTZ) RETURNS TIMESTAMPTZ AS $$
  SELECT (now() - interval '3 days') + (orig - TIMESTAMPTZ '2024-09-02 21:40:00+05:30');
$$ LANGUAGE SQL STABLE;

CREATE TABLE users (
    id             SERIAL PRIMARY KEY,
    username       TEXT UNIQUE NOT NULL,
    display_name   TEXT NOT NULL,
    email_address  TEXT UNIQUE NOT NULL,
    avatar_url     TEXT NOT NULL
);

CREATE TABLE email_threads (
    id           SERIAL PRIMARY KEY,
    thread_key   TEXT UNIQUE NOT NULL,
    subject      TEXT NOT NULL,
    is_trashed   BOOLEAN NOT NULL DEFAULT false -- moved to Trash; still real evidence, just hidden from Inbox
);

CREATE TABLE emails (
    id           SERIAL PRIMARY KEY,
    evidence_id  TEXT UNIQUE NOT NULL,
    thread_id    INTEGER NOT NULL REFERENCES email_threads(id),
    sender_id    INTEGER NOT NULL REFERENCES users(id),
    recipient_id INTEGER NOT NULL REFERENCES users(id),
    body         TEXT NOT NULL,
    starred      BOOLEAN NOT NULL DEFAULT false, -- pre-starred by Meera before the player ever opened the account
    source       TEXT NOT NULL DEFAULT 'seed', -- 'seed' (story canon) | 'player' (sent in-game)
    sent_at      TIMESTAMPTZ NOT NULL
);

-- Attachments on real emails. Most email is text-only (like real life), but
-- a genuine photo or document attached to a message is itself evidence --
-- MERCY sees it the same way it sees the body.
CREATE TABLE email_attachments (
    id            SERIAL PRIMARY KEY,
    email_id      INTEGER NOT NULL REFERENCES emails(id) ON DELETE CASCADE,
    filename      TEXT NOT NULL,
    url           TEXT NOT NULL,
    content_type  TEXT NOT NULL DEFAULT 'image/jpeg',
    size_label    TEXT NOT NULL DEFAULT '1.2 MB'
);

CREATE TABLE evidence_counters (
    service   TEXT PRIMARY KEY,
    next_seq  INTEGER NOT NULL
);

-- Drafts: composed-but-unsent mail. Player-created drafts (source='player')
-- are ephemeral and not evidence, same as before. But a handful of these are
-- Meera's own real, pre-existing drafts (source='seed') -- she never sent
-- them, but a real forensic pull of the device would still find them, so
-- they get a genuine evidence_id and are read-only in the UI (can't be
-- edited, sent, or deleted -- the evidence has to stay exactly as found).
CREATE TABLE drafts (
    id            SERIAL PRIMARY KEY,
    evidence_id   TEXT UNIQUE,
    to_username   TEXT,
    subject       TEXT NOT NULL DEFAULT '',
    body          TEXT NOT NULL DEFAULT '',
    source        TEXT NOT NULL DEFAULT 'player',
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE app_config (
    key    TEXT PRIMARY KEY,
    value  TEXT NOT NULL
);
INSERT INTO app_config (key, value) VALUES
    ('account_owner', 'meera'),
    ('unlock_password', 'Arjun'),
    ('unlock_password_hint', 'My father-in-law''s son''s name.');

-- ---------------------------------------------------------------------------
-- Noise: newsletters, receipts, job-site notifications, spam. Explicitly
-- NOT evidence -- no evidence_id, never returned by /api/evidence. A real
-- inbox is mostly this.
-- ---------------------------------------------------------------------------
CREATE TABLE filler_emails (
    id             SERIAL PRIMARY KEY,
    kind           TEXT NOT NULL, -- 'newsletter' | 'receipt' | 'notification' | 'spam' | 'registration'
    sender_name    TEXT NOT NULL,
    sender_email   TEXT NOT NULL,
    sender_avatar  TEXT NOT NULL,
    subject        TEXT NOT NULL,
    body           TEXT NOT NULL,
    starred        BOOLEAN NOT NULL DEFAULT false,
    received_at    TIMESTAMPTZ NOT NULL
);

CREATE TABLE filler_email_attachments (
    id                SERIAL PRIMARY KEY,
    filler_email_id   INTEGER NOT NULL REFERENCES filler_emails(id) ON DELETE CASCADE,
    filename          TEXT NOT NULL,
    url               TEXT NOT NULL,
    content_type      TEXT NOT NULL DEFAULT 'image/jpeg',
    size_label        TEXT NOT NULL DEFAULT '480 KB'
);

-- ---------------------------------------------------------------------------
-- USERS
-- ---------------------------------------------------------------------------
INSERT INTO users (username, display_name, email_address, avatar_url) VALUES
    ('meera',  'Meera Kapoor', 'meera.kapoor@quillmail.com',  '/images/avatars/meera.png'),
    ('rahul',  'Rahul Nair',   'rahul.nair@quillmail.com',    '/images/avatars/rahul.svg'),
    ('nikhil', 'Nikhil Rao',   'nikhil.rao@quillmail.com',    '/images/avatars/nikhil.png'),
    ('priya',  'Priya Menon',  'priya.menon@quillmail.com',   '/images/avatars/priya.svg'),
    ('arjun',  'Arjun Kapoor', 'arjun.kapoor@quillmail.com',  '/images/avatars/arjun.svg');

-- An untraceable identity, not one of Meera's real contacts. Still a real
-- user row (still real evidence, still a genuine sender/recipient) -- it's
-- just anonymous by design, the way an actual threatening email would be.
INSERT INTO users (username, display_name, email_address, avatar_url) VALUES
    ('unknown', 'Unknown Sender', 'no.reply.4471@protonmail.com', '/images/avatars/unknown.svg');

-- Haven: a fictional private video-journal + cloud-backup app (planned for
-- the future `cloud`/`video-diary` services). Its registration email is
-- real evidence now -- this is the discoverable trail that the app exists
-- at all, well before those services are built.
INSERT INTO users (username, display_name, email_address, avatar_url) VALUES
    ('haven', 'Haven', 'hello@havenapp.io', '/images/avatars/haven.svg');

-- Real contacts outside the core cast -- an office manager and the police
-- records cell -- needed so the two seed drafts below have a real "To".
INSERT INTO users (username, display_name, email_address, avatar_url) VALUES
    ('manager', 'Divya Reddy', 'divya.reddy@meeraswork.example', '/images/avatars/manager.svg'),
    ('police', 'Bengaluru City Police -- Records Cell', 'records.cell@blrcitypolice.example.gov', '/images/avatars/police.png');

-- ---------------------------------------------------------------------------
-- EMAILS -- evidence ids assigned in narrative order: EML-001..014
-- ---------------------------------------------------------------------------

-- Thread: "Can't stop thinking about this" -- confirms the affair, too risky for WhatsApp
INSERT INTO email_threads (thread_key, subject) VALUES ('nikhil-1', 'Can''t stop thinking about this');
INSERT INTO emails (evidence_id, thread_id, sender_id, recipient_id, body, sent_at) VALUES
    ('EML-001', (SELECT id FROM email_threads WHERE thread_key='nikhil-1'),
     (SELECT id FROM users WHERE username='nikhil'), (SELECT id FROM users WHERE username='meera'),
     'I know we said we''d be careful, but I keep thinking about what you said. I don''t have answers, I just wanted you to know I''m not going anywhere. Whatever this is, however messed up it is -- I''m in it.

-N', t('2024-06-21 22:00:00+05:30')),
    ('EML-002', (SELECT id FROM email_threads WHERE thread_key='nikhil-1'),
     (SELECT id FROM users WHERE username='meera'), (SELECT id FROM users WHERE username='nikhil'),
     'You can''t say things like that. I have a husband. I have a life. But god help me, I read your email four times. This isn''t just a mistake anymore, is it.

-M', t('2024-06-22 08:30:00+05:30'));

-- Thread: "Something's not right" -- THE critical warning chain about the case
INSERT INTO email_threads (thread_key, subject) VALUES ('nikhil-2', 'Something''s not right');
INSERT INTO emails (evidence_id, thread_id, sender_id, recipient_id, body, sent_at) VALUES
    ('EML-003', (SELECT id FROM email_threads WHERE thread_key='nikhil-2'),
     (SELECT id FROM users WHERE username='meera'), (SELECT id FROM users WHERE username='nikhil'),
     'I went through the old case file again last night. The timeline doesn''t add up. The forest gate register has a scooter going in fifteen minutes before Dad''s car and leaving in a hurry, and a jogger heard two men arguing up at the rock. The report says he was alone. Why did that never come up in the original investigation? I can''t stop thinking about this.',
     t('2024-08-15 23:10:00+05:30')),
    ('EML-004', (SELECT id FROM email_threads WHERE thread_key='nikhil-2'),
     (SELECT id FROM users WHERE username='nikhil'), (SELECT id FROM users WHERE username='meera'),
     'Meera, you need to stop digging into this. I mean it. I don''t know what you think you''re going to find, but some things are better left alone. Please.',
     t('2024-08-16 09:00:00+05:30')),
    ('EML-005', (SELECT id FROM email_threads WHERE thread_key='nikhil-2'),
     (SELECT id FROM users WHERE username='meera'), (SELECT id FROM users WHERE username='nikhil'),
     'I can''t. Something about Dad''s case doesn''t make sense, and the more I look, the worse it gets. I have to know what happened to him.',
     t('2024-08-16 21:00:00+05:30')),
    ('EML-006', (SELECT id FROM email_threads WHERE thread_key='nikhil-2'),
     (SELECT id FROM users WHERE username='nikhil'), (SELECT id FROM users WHERE username='meera'),
     'We shouldn''t talk about this here. Delete this thread when you''re done reading it. I mean it.',
     t('2024-08-17 07:45:00+05:30'));

-- Thread: no subject -- checking in during her silence, days before the disappearance
INSERT INTO email_threads (thread_key, subject) VALUES ('nikhil-3', '(no subject)');
INSERT INTO emails (evidence_id, thread_id, sender_id, recipient_id, body, sent_at) VALUES
    ('EML-007', (SELECT id FROM email_threads WHERE thread_key='nikhil-3'),
     (SELECT id FROM users WHERE username='nikhil'), (SELECT id FROM users WHERE username='meera'),
     'Haven''t heard from you in a few days. Just want to know you''re safe. That''s all. Whenever you''re ready.

-N', t('2024-08-29 23:00:00+05:30')),
    ('EML-008', (SELECT id FROM email_threads WHERE thread_key='nikhil-3'),
     (SELECT id FROM users WHERE username='meera'), (SELECT id FROM users WHERE username='nikhil'),
     'I''m safe. I''m close to something, I can feel it. I''ll explain everything soon, I promise. Just need a little more time.',
     t('2024-08-30 08:00:00+05:30'));

-- Thread: mundane, real -- Priya asking about a wedding photographer
INSERT INTO email_threads (thread_key, subject) VALUES ('priya-photographer', 'Wedding photographer recs?');
INSERT INTO emails (evidence_id, thread_id, sender_id, recipient_id, body, sent_at) VALUES
    ('EML-009', (SELECT id FROM email_threads WHERE thread_key='priya-photographer'),
     (SELECT id FROM users WHERE username='priya'), (SELECT id FROM users WHERE username='meera'),
     'Hey! Do you remember the photographer''s name from Ritu''s wedding? Everyone keeps asking me and I''ve completely blanked.',
     t('2024-05-15 10:00:00+05:30')),
    ('EML-010', (SELECT id FROM email_threads WHERE thread_key='priya-photographer'),
     (SELECT id FROM users WHERE username='meera'), (SELECT id FROM users WHERE username='priya'),
     'Pretty sure it was Kunal Studios? Let me check and get back to you.',
     t('2024-05-15 14:30:00+05:30'));

-- Thread: mundane, real -- Arjun forwarding a flight confirmation
INSERT INTO email_threads (thread_key, subject) VALUES ('arjun-flight', 'Flight confirmation -- forward this');
INSERT INTO emails (evidence_id, thread_id, sender_id, recipient_id, body, sent_at) VALUES
    ('EML-011', (SELECT id FROM email_threads WHERE thread_key='arjun-flight'),
     (SELECT id FROM users WHERE username='arjun'), (SELECT id FROM users WHERE username='meera'),
     'Forwarding the flight confirmation for the trip in case you need it separately. Booking ref: BX4471.',
     t('2024-07-01 09:00:00+05:30')),
    ('EML-012', (SELECT id FROM email_threads WHERE thread_key='arjun-flight'),
     (SELECT id FROM users WHERE username='meera'), (SELECT id FROM users WHERE username='arjun'),
     'Got it, thank you!',
     t('2024-07-01 09:15:00+05:30'));

-- Thread: mundane, real -- Rahul asking for a reference
INSERT INTO email_threads (thread_key, subject) VALUES ('rahul-reference', 'Reference check?');
INSERT INTO emails (evidence_id, thread_id, sender_id, recipient_id, body, sent_at) VALUES
    ('EML-013', (SELECT id FROM email_threads WHERE thread_key='rahul-reference'),
     (SELECT id FROM users WHERE username='rahul'), (SELECT id FROM users WHERE username='meera'),
     'Hey, a recruiter might reach out about a reference for me, hope that''s ok! No pressure to say yes obviously.',
     t('2024-04-01 11:00:00+05:30')),
    ('EML-014', (SELECT id FROM email_threads WHERE thread_key='rahul-reference'),
     (SELECT id FROM users WHERE username='meera'), (SELECT id FROM users WHERE username='rahul'),
     'Of course, happy to! Good luck :)',
     t('2024-04-01 11:20:00+05:30'));

-- Thread: the affair deepens -- meeting in person, and the guilt/complication
-- that comes with it. Sits chronologically between the "Can't stop thinking"
-- thread (June) and the case-warning thread (August).
INSERT INTO email_threads (thread_key, subject) VALUES ('nikhil-4', 'We need to talk. In person.');
INSERT INTO emails (evidence_id, thread_id, sender_id, recipient_id, body, sent_at) VALUES
    ('EML-015', (SELECT id FROM email_threads WHERE thread_key='nikhil-4'),
     (SELECT id FROM users WHERE username='nikhil'), (SELECT id FROM users WHERE username='meera'),
     'I don''t want to do this over email anymore. Come by Thursday? Usual place. I just... I need to see you.',
     t('2024-07-15 20:00:00+05:30')),
    ('EML-016', (SELECT id FROM email_threads WHERE thread_key='nikhil-4'),
     (SELECT id FROM users WHERE username='meera'), (SELECT id FROM users WHERE username='nikhil'),
     'Thursday works. I''ll tell Arjun I have a work thing. God, listen to me, I''m getting good at this. I hate that I''m getting good at this.',
     t('2024-07-15 20:45:00+05:30')),
    ('EML-017', (SELECT id FROM email_threads WHERE thread_key='nikhil-4'),
     (SELECT id FROM users WHERE username='nikhil'), (SELECT id FROM users WHERE username='meera'),
     'Seeing you Thursday just confirmed what I already knew. I don''t know how much longer I can keep pretending this is casual.',
     t('2024-07-18 09:00:00+05:30')),
    ('EML-018', (SELECT id FROM email_threads WHERE thread_key='nikhil-4'),
     (SELECT id FROM users WHERE username='meera'), (SELECT id FROM users WHERE username='nikhil'),
     'Please don''t say that. I can''t think about "how much longer" right now. I have too much else going on. Just... let''s not label it. Please.',
     t('2024-07-18 21:30:00+05:30'));

-- Threads: anonymous threats warning her off the case, escalating toward the
-- disappearance. Same sender address every time -- the same person, not
-- random noise -- but the identity itself is deliberately withheld from the
-- player. Real evidence: MERCY sees these, the player just can't trace them.
INSERT INTO email_threads (thread_key, subject) VALUES ('threat-1', 'You should stop');
INSERT INTO emails (evidence_id, thread_id, sender_id, recipient_id, body, sent_at) VALUES
    ('EML-019', (SELECT id FROM email_threads WHERE thread_key='threat-1'),
     (SELECT id FROM users WHERE username='unknown'), (SELECT id FROM users WHERE username='meera'),
     'Whatever you think you''re looking into, stop. This is the only warning you''ll get. Some things are better left buried.',
     t('2024-08-20 23:45:00+05:30'));

INSERT INTO email_threads (thread_key, subject) VALUES ('threat-2', 'Last warning');
INSERT INTO emails (evidence_id, thread_id, sender_id, recipient_id, body, sent_at) VALUES
    ('EML-020', (SELECT id FROM email_threads WHERE thread_key='threat-2'),
     (SELECT id FROM users WHERE username='unknown'), (SELECT id FROM users WHERE username='meera'),
     'I told you to stop. You didn''t listen. I know where you''ve been going. I know who you''ve been talking to. Drop this, or you''ll regret it.',
     t('2024-08-27 22:10:00+05:30')),
    ('EML-021', (SELECT id FROM email_threads WHERE thread_key='threat-2'),
     (SELECT id FROM users WHERE username='meera'), (SELECT id FROM users WHERE username='unknown'),
     'Who is this? How do you even have this email address?',
     t('2024-08-27 22:40:00+05:30'));

INSERT INTO email_threads (thread_key, subject) VALUES ('threat-3', 'You have no idea');
INSERT INTO emails (evidence_id, thread_id, sender_id, recipient_id, body, sent_at) VALUES
    ('EML-022', (SELECT id FROM email_threads WHERE thread_key='threat-3'),
     (SELECT id FROM users WHERE username='unknown'), (SELECT id FROM users WHERE username='meera'),
     'You''re closer than you think, and that''s exactly the problem. Walk away now while you still can.',
     t('2024-09-01 23:50:00+05:30'));

-- Thread: Haven account registration -- starred by Meera herself, real
-- evidence. Dated right after her father's death: she started journaling
-- privately to cope with the loss, which is also why the account exists at
-- all. Note the "we can't recover your password" line -- in-world reason a
-- password reset isn't an option later, only finding the pattern is.
INSERT INTO email_threads (thread_key, subject) VALUES ('haven-signup', 'Welcome to Haven');
INSERT INTO emails (evidence_id, thread_id, sender_id, recipient_id, body, starred, sent_at) VALUES
    ('EML-023', (SELECT id FROM email_threads WHERE thread_key='haven-signup'),
     (SELECT id FROM users WHERE username='haven'), (SELECT id FROM users WHERE username='meera'),
     'Thanks for signing up for Haven. Click the link below to verify your email and activate your account. This link expires in 24 hours.

Verify Email',
     true, t('2018-11-02 20:00:00+05:30')),
    ('EML-024', (SELECT id FROM email_threads WHERE thread_key='haven-signup'),
     (SELECT id FROM users WHERE username='haven'), (SELECT id FROM users WHERE username='meera'),
     'You''re verified! Welcome to Haven -- a private space for your thoughts, safe and just for you. One important reminder: we never see your password, and we can''t recover it for you if it''s forgotten. Write it down somewhere only you would think to look.',
     true, t('2018-11-02 20:15:00+05:30'));

-- Trash thread 1: a 1am confession she regretted enough to delete the next
-- morning. Still real evidence -- MERCY sees everything, trashed or not.
INSERT INTO email_threads (thread_key, subject, is_trashed) VALUES ('trash-1', 'I shouldn''t have sent that', true);
INSERT INTO emails (evidence_id, thread_id, sender_id, recipient_id, body, sent_at) VALUES
    ('EML-025', (SELECT id FROM email_threads WHERE thread_key='trash-1'),
     (SELECT id FROM users WHERE username='meera'), (SELECT id FROM users WHERE username='nikhil'),
     'I can''t stop thinking about what it would be like if things were different. If I''d met you first. Is that insane? Tell me that''s insane.',
     t('2024-08-05 01:15:00+05:30')),
    ('EML-026', (SELECT id FROM email_threads WHERE thread_key='trash-1'),
     (SELECT id FROM users WHERE username='nikhil'), (SELECT id FROM users WHERE username='meera'),
     'It''s not insane. I think about that more than I should admit. But Meera, it''s 1am, we should talk about this when we''re both thinking straight.',
     t('2024-08-05 01:40:00+05:30')),
    ('EML-027', (SELECT id FROM email_threads WHERE thread_key='trash-1'),
     (SELECT id FROM users WHERE username='meera'), (SELECT id FROM users WHERE username='nikhil'),
     'Please forget I sent that last night. I wasn''t in a good headspace. I''m serious, forget it.',
     t('2024-08-05 09:30:00+05:30')),
    ('EML-028', (SELECT id FROM email_threads WHERE thread_key='trash-1'),
     (SELECT id FROM users WHERE username='nikhil'), (SELECT id FROM users WHERE username='meera'),
     'Forgotten. But for what it''s worth, you don''t have to pretend you didn''t mean it. I won''t bring it up again unless you want me to.',
     t('2024-08-05 09:45:00+05:30'));

-- Trash thread 2: pettier, jealousy-flavored -- lighter but still the kind
-- of thing you'd delete out of embarrassment.
INSERT INTO email_threads (thread_key, subject, is_trashed) VALUES ('trash-2', 'Saw you liked her photo', true);
INSERT INTO emails (evidence_id, thread_id, sender_id, recipient_id, body, sent_at) VALUES
    ('EML-029', (SELECT id FROM email_threads WHERE thread_key='trash-2'),
     (SELECT id FROM users WHERE username='meera'), (SELECT id FROM users WHERE username='nikhil'),
     'Saw you liked Ananya''s photo. Not that it''s any of my business. (It''s not. I have no right to say anything. Ignore this.)',
     t('2024-06-28 22:00:00+05:30')),
    ('EML-030', (SELECT id FROM email_threads WHERE thread_key='trash-2'),
     (SELECT id FROM users WHERE username='nikhil'), (SELECT id FROM users WHERE username='meera'),
     '...are you jealous right now? Because I have to say, kind of enjoying this.',
     t('2024-06-28 22:20:00+05:30')),
    ('EML-031', (SELECT id FROM email_threads WHERE thread_key='trash-2'),
     (SELECT id FROM users WHERE username='meera'), (SELECT id FROM users WHERE username='nikhil'),
     'I hate that you''re enjoying this. I hate this entire situation. Delete this email chain.',
     t('2024-06-28 22:25:00+05:30')),
    ('EML-032', (SELECT id FROM email_threads WHERE thread_key='trash-2'),
     (SELECT id FROM users WHERE username='nikhil'), (SELECT id FROM users WHERE username='meera'),
     'Deleting now. Also, no, I''m not, still enjoying this a little.',
     t('2024-06-28 22:30:00+05:30'));

-- Two of Meera's own real drafts -- never sent, but real evidence, and
-- read-only in the UI (the player can open and read them, but can't edit,
-- send, or delete them -- the evidence has to stay exactly as found).

-- A mundane one: requesting leave right around when she disappeared.
INSERT INTO drafts (evidence_id, to_username, subject, body, source, updated_at) VALUES
    ('EML-033', 'manager', 'Leave request -- next two weeks',
     'Hi Divya,

I''d like to request leave from September 3rd to September 10th. Some personal matters have come up that I need to take care of. I''ll make sure everything current is handed off before I go.

Thanks for understanding.

Meera',
     'seed', t('2024-08-28 18:40:00+05:30'));

-- The significant one: a formal, unsent request to the police records cell
-- for her father's full case file. Written days after the first anonymous
-- threat email -- drafted anyway, then never sent.
INSERT INTO drafts (evidence_id, to_username, subject, body, source, updated_at) VALUES
    ('EML-034', 'police', 'Request to review case file -- Ravi Sharma (deceased, Oct 2018)',
     'To whom it may concern,

I am writing to formally request access to the complete case file regarding the death of my father, Ravi Sharma, which occurred on 14 October 2018 at Turahalli forest and was recorded as an accident. I have identified several inconsistencies in the report I currently have -- a second vehicle in the gate register that morning, a witness who heard an argument at the place where he fell, and a telephone call to him minutes before he left the house -- none of which appear to have been followed up. I would like to review the full file, including any statements or records not included in the summary available to me.

Please let me know what documentation you require from me to proceed.

Regards,
Meera Kapoor
Daughter of Ravi Sharma',
     'seed', t('2024-08-22 21:15:00+05:30'));

-- Two more Haven emails -- routine "entry saved" confirmations. Real
-- evidence: they're the only trail (before the Haven/video-diary service
-- itself is built) that proves she was actively journaling, and exactly
-- when. The second is dated the same day as the critical WhatsApp exchange
-- with Nikhil -- her last saved entry, right before she disappeared.
INSERT INTO email_threads (thread_key, subject) VALUES ('haven-entry-1', 'Your entry has been saved');
INSERT INTO emails (evidence_id, thread_id, sender_id, recipient_id, body, sent_at) VALUES
    ('EML-035', (SELECT id FROM email_threads WHERE thread_key='haven-entry-1'),
     (SELECT id FROM users WHERE username='haven'), (SELECT id FROM users WHERE username='meera'),
     'Your journal entry from today has been saved and encrypted. Only you can access it -- not even we can see the content.',
     t('2024-08-10 22:40:00+05:30'));

INSERT INTO email_threads (thread_key, subject) VALUES ('haven-entry-2', 'Your entry has been saved');
INSERT INTO emails (evidence_id, thread_id, sender_id, recipient_id, body, sent_at) VALUES
    ('EML-036', (SELECT id FROM email_threads WHERE thread_key='haven-entry-2'),
     (SELECT id FROM users WHERE username='haven'), (SELECT id FROM users WHERE username='meera'),
     'Your journal entry from today has been saved and encrypted. Only you can access it -- not even we can see the content.',
     t('2024-09-02 22:10:00+05:30'));

INSERT INTO evidence_counters (service, next_seq) VALUES ('email', 37);

-- ---------------------------------------------------------------------------
-- Attachments on real evidence emails -- most emails are text-only (like
-- real email usually is), but a few carry a genuine photo, which is itself
-- evidence. Hand-drawn SVG illustrations (not real photos) so each one
-- actually depicts what its filename says.
-- ---------------------------------------------------------------------------
INSERT INTO email_attachments (email_id, filename, url, content_type, size_label) VALUES
    ((SELECT id FROM emails WHERE evidence_id='EML-001'), 'IMG_20240621_2159.jpg', '/images/attachments/personal-photo.svg', 'image/svg+xml', '2.1 MB'),
    ((SELECT id FROM emails WHERE evidence_id='EML-009'), 'photographer_reference.jpg', '/images/attachments/camera-reference.svg', 'image/svg+xml', '1.4 MB'),
    ((SELECT id FROM emails WHERE evidence_id='EML-011'), 'flight_itinerary_BX4471.jpg', '/images/attachments/boarding-pass.svg', 'image/svg+xml', '860 KB'),
    ((SELECT id FROM emails WHERE evidence_id='EML-024'), 'haven_app_preview.jpg', '/images/attachments/app-preview.svg', 'image/svg+xml', '1.1 MB');

-- ---------------------------------------------------------------------------
-- More filler: pre-starred "important" registrations. Ordinary digital-life
-- noise, still no evidence_id -- these just happen to be things Meera
-- herself flagged as worth keeping easy to find.
-- ---------------------------------------------------------------------------
INSERT INTO filler_emails (kind, sender_name, sender_email, sender_avatar, subject, body, starred, received_at) VALUES
    ('registration', 'Kartly', 'welcome@kartly.example', '/images/avatars/kartly.png',
     'Welcome to Kartly -- verify your email',
     'You''re almost there! Verify your email to start shopping. As a welcome gift, enjoy 10% off your first order.',
     true, now() - interval '620 days'),
    ('registration', 'Prime Bank', 'noreply@primebank.example', '/images/avatars/prime-bank.svg',
     'Your net banking registration is complete',
     'Your net banking registration for A/C **4521 is now active. Keep your MPIN confidential and never share your OTP with anyone.',
     true, now() - interval '900 days');

-- More account registrations, unstarred (ordinary inbox clutter -- Haven,
-- Kartly and Prime Bank above are the ones Meera actually bothered to
-- star). Each site follows the real two-email pattern: verify, then welcome.
INSERT INTO filler_emails (kind, sender_name, sender_email, sender_avatar, subject, body, received_at) VALUES
    ('registration', 'PulseFit', 'noreply@pulsefit.example', '/images/avatars/pulsefit.jpg',
     'Verify your email to activate PulseFit',
     'Welcome to PulseFit! Click below to verify your email and start tracking your workouts. This link expires in 24 hours.',
     now() - interval '400 days'),
    ('registration', 'PulseFit', 'noreply@pulsefit.example', '/images/avatars/pulsefit.jpg',
     'You''re in! Welcome to PulseFit',
     'Your account is verified and ready to go. Set your first fitness goal and let''s get moving!',
     (now() - interval '400 days') + interval '10 minutes'),
    ('registration', 'Stillwell', 'hello@stillwell.example', '/images/avatars/stillwell.png',
     'Confirm your email for Stillwell',
     'You''re one step away from a calmer mind. Verify your email to unlock guided sessions tailored just for you.',
     now() - interval '250 days'),
    ('registration', 'Stillwell', 'hello@stillwell.example', '/images/avatars/stillwell.png',
     'Welcome to Stillwell 🌿',
     'Your account is confirmed. Take a deep breath -- your first session is ready whenever you need it.',
     (now() - interval '250 days') + interval '15 minutes'),
    ('registration', 'Wanderly', 'noreply@wanderly.example', '/images/avatars/wanderly.jpg',
     'Verify your email -- Wanderly',
     'Almost there! Confirm your email to start planning your next trip and unlock member-only fares.',
     now() - interval '150 days'),
    ('registration', 'Wanderly', 'noreply@wanderly.example', '/images/avatars/wanderly.jpg',
     'Welcome aboard -- Wanderly is ready for you',
     'You''re all set! Browse destinations, save your favorites, and book with member pricing.',
     (now() - interval '150 days') + interval '5 minutes');

-- ---------------------------------------------------------------------------
-- FILLER: newsletters, receipts, job-site notifications, spam. Timestamped
-- relative to now() so the inbox always looks current.
-- ---------------------------------------------------------------------------
INSERT INTO filler_emails (kind, sender_name, sender_email, sender_avatar, subject, body, received_at) VALUES
    ('receipt', 'urbansole.in', 'orders@urbansole.in', '/images/avatars/urbansole.in.jpg',
     'Your Order Has Shipped 📦',
     'Good news! Your order #UB-88213 is on its way. Track your package for real-time updates.',
     now() - interval '1 day'),
    ('receipt', 'StreamBox', 'billing@streambox.app', '/images/avatars/streambox.png',
     'Your receipt for StreamBox Premium',
     'Thank you for your payment of ₹649.00. Your subscription has been renewed until next month.',
     now() - interval '3 days'),
    ('notification', 'WorkHive', 'notifications@workhive.io', '/images/avatars/workhive.jpg',
     '5 new job matches for Product Designers in Bengaluru',
     'Based on your profile, we found 5 new opportunities that might interest you. View matches now.',
     now() - interval '6 hours'),
    ('newsletter', 'GreenLeaf Grocers', 'hello@greenleaf.example', '/images/avatars/greenleaf.webp',
     '🥦 Your weekly grocery list is here!',
     'Fresh picks, weekly deals, and recipe ideas -- all in one place. Shop now and save 15% on your first order this week.',
     now() - interval '12 hours'),
    ('spam', 'International Lottery Commission', 'prize.notify@lottowin-intl.com', '/images/avatars/spam.svg',
     '🎉 YOU''VE WON $1,000,000!',
     'Congratulations! Your email has been selected in our international lottery draw. Claim your prize now before it expires! Reply with your bank details to proceed.',
     now() - interval '2 days'),
    ('notification', 'Haven', 'hello@havenapp.io', '/images/avatars/haven.svg',
     'You''re running low on storage',
     'You''ve used 80% of your free Haven storage. Upgrade to Haven Plus for unlimited encrypted backups.',
     now() - interval '40 days');

-- ---------------------------------------------------------------------------
-- More filler: two shopping brands -- spoofed marketplace-style names and
-- logos (not real brands, per house style), same real two-email
-- registration pattern, plus order mail with a genuine product-photo
-- attachment. Emazon = general marketplace; Mamster = small-pet supplies.
-- ---------------------------------------------------------------------------
INSERT INTO filler_emails (kind, sender_name, sender_email, sender_avatar, subject, body, received_at) VALUES
    ('registration', 'Emazon', 'no-reply@emazon.example', '/images/avatars/emazon.svg',
     'Verify your email for Emazon',
     'Welcome to Emazon! Please verify your email to start shopping millions of products with fast delivery.',
     now() - interval '500 days'),
    ('registration', 'Emazon', 'no-reply@emazon.example', '/images/avatars/emazon.svg',
     'Welcome to Emazon',
     'Your account is verified. Explore today''s deals and enjoy free delivery on your first order.',
     (now() - interval '500 days') + interval '8 minutes'),
    ('receipt', 'Emazon', 'orders@emazon.example', '/images/avatars/emazon.svg',
     'Your Emazon order has shipped 📦',
     'Your order #EMZ-33912 (Wireless Over-Ear Headphones) has shipped and should arrive in 2-3 days. Track your package for live updates.',
     now() - interval '4 days'),
    ('receipt', 'Emazon', 'orders@emazon.example', '/images/avatars/emazon.svg',
     'Delivered: Your Emazon package has arrived',
     'Your order #EMZ-33912 was delivered today. We hope you love it! Rate your purchase to help other shoppers.',
     now() - interval '2 days'),
    ('registration', 'Mamster', 'hello@mamster.example', '/images/avatars/mamster.jpg',
     'Confirm your email -- Mamster',
     'Welcome to Mamster! Confirm your email to start shopping for your favorite tiny friends.',
     now() - interval '320 days'),
    ('registration', 'Mamster', 'hello@mamster.example', '/images/avatars/mamster.jpg',
     'You''re confirmed! Welcome to Mamster 🐹',
     'Your account is ready. Check out our best-selling hamster habitats and chew toys, picked just for first-time pet parents.',
     (now() - interval '320 days') + interval '6 minutes'),
    ('receipt', 'Mamster', 'orders@mamster.example', '/images/avatars/mamster.jpg',
     'Your Mamster order is on its way 🐾',
     'Your order #MMS-10422 (Deluxe Hamster Habitat + Bedding) has shipped. Estimated arrival: 3-5 days.',
     now() - interval '9 days');

-- ---------------------------------------------------------------------------
-- Attachments on filler mail -- product illustrations, same hand-drawn SVG
-- approach as the real-evidence attachments above (so a "hamster habitat"
-- attachment actually shows a hamster habitat, not a random stock photo).
-- ---------------------------------------------------------------------------
INSERT INTO filler_email_attachments (filler_email_id, filename, url, content_type, size_label) VALUES
    ((SELECT id FROM filler_emails WHERE subject='Your Emazon order has shipped 📦'), 'wireless_headphones.jpg', '/images/attachments/headphones.svg', 'image/svg+xml', '210 KB'),
    ((SELECT id FROM filler_emails WHERE subject='Delivered: Your Emazon package has arrived'), 'wireless_headphones.jpg', '/images/attachments/headphones.svg', 'image/svg+xml', '210 KB'),
    ((SELECT id FROM filler_emails WHERE subject='Your Mamster order is on its way 🐾'), 'hamster_habitat.jpg', '/images/attachments/hamster-cage.svg', 'image/svg+xml', '245 KB'),
    ((SELECT id FROM filler_emails WHERE subject='Your Order Has Shipped 📦'), 'sneakers.jpg', '/images/attachments/sneaker.svg', 'image/svg+xml', '198 KB'),
    ((SELECT id FROM filler_emails WHERE subject='🥦 Your weekly grocery list is here!'), 'weekly_flyer.jpg', '/images/attachments/grocery-flyer.svg', 'image/svg+xml', '380 KB');
