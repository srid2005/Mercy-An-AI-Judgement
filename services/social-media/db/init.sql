-- Social Media service database
-- Every piece of player-visible content (post, comment, direct message) carries
-- a globally-unique evidence_id following this service's prefix: SOC-###
-- This is the contract MERCY (and every other in-game app) is expected to follow
-- so evidence can be cross-referenced regardless of which container produced it.
-- See /ARCHITECTURE.md at the repo root for the full evidence contract.

-- Story timestamps below are written as fixed 2024 calendar dates for
-- readability, but displayed relative-time ("2d", "3mo") should stay
-- current no matter when this stack is actually run. t(x) remaps every
-- literal to be relative to now() at seed time, anchored on the latest
-- story timestamp (Nikhil's "why don't you post anything?" message)
-- mapping to interval '3 days' ago, preserving every other event's exact gap from it.
CREATE FUNCTION t(orig TIMESTAMPTZ) RETURNS TIMESTAMPTZ AS $$
  SELECT (now() - interval '3 days') + (orig - TIMESTAMPTZ '2024-09-02 21:40:00+05:30');
$$ LANGUAGE SQL STABLE;

CREATE TABLE users (
    id               SERIAL PRIMARY KEY,
    username         TEXT UNIQUE NOT NULL,
    display_name     TEXT NOT NULL,
    avatar_url       TEXT NOT NULL,
    bio              TEXT,
    followers_count  INTEGER NOT NULL DEFAULT 0,
    following_count  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE posts (
    id           SERIAL PRIMARY KEY,
    evidence_id  TEXT UNIQUE NOT NULL,
    user_id      INTEGER NOT NULL REFERENCES users(id),
    caption      TEXT NOT NULL,
    image_url    TEXT NOT NULL,
    era          TEXT NOT NULL,             -- family | dog | childhood | college | reunion | married-life | recent
    latitude     DOUBLE PRECISION,          -- only set on posts that matter to the rescue puzzle
    longitude    DOUBLE PRECISION,
    likes_count  INTEGER NOT NULL DEFAULT 0,
    source       TEXT NOT NULL DEFAULT 'seed', -- 'seed' (story canon) | 'player' (created in-game by the player)
    posted_at    TIMESTAMPTZ NOT NULL
);

-- Player-created posts (via "New Post") still get a real evidence_id, issued
-- from this counter so it never collides with the seeded SOC-001..024 range.
CREATE TABLE evidence_counters (
    service   TEXT PRIMARY KEY,
    next_seq  INTEGER NOT NULL
);
INSERT INTO evidence_counters (service, next_seq) VALUES ('social-media', 50);

-- "Forgot password" flow: a real 4-digit PIN gets emailed to Meera's Quill
-- inbox (cross-service call), then verified here. Not evidence -- this is
-- a device mechanic, not something that happened in Meera's life.
CREATE TABLE password_resets (
    id          SERIAL PRIMARY KEY,
    pin         TEXT NOT NULL,
    used        BOOLEAN NOT NULL DEFAULT false,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE tags (
    id             SERIAL PRIMARY KEY,
    post_id        INTEGER NOT NULL REFERENCES posts(id),
    tagged_user_id INTEGER NOT NULL REFERENCES users(id)
);

CREATE TABLE comments (
    id            SERIAL PRIMARY KEY,
    evidence_id   TEXT UNIQUE NOT NULL,
    post_id       INTEGER NOT NULL REFERENCES posts(id),
    user_id       INTEGER NOT NULL REFERENCES users(id),
    body          TEXT NOT NULL,
    source        TEXT NOT NULL DEFAULT 'seed', -- 'seed' (story canon) | 'player' (typed in-game)
    commented_at  TIMESTAMPTZ NOT NULL
);

-- Private messages: Meera's account has DM history with a handful of people.
-- Only the meera<->rahul thread is seeded for now.
CREATE TABLE messages (
    id             SERIAL PRIMARY KEY,
    evidence_id    TEXT UNIQUE NOT NULL,
    thread_key     TEXT NOT NULL,           -- stable id for a conversation, e.g. 'meera-rahul'
    sender_id      INTEGER NOT NULL REFERENCES users(id),
    recipient_id   INTEGER NOT NULL REFERENCES users(id),
    body           TEXT NOT NULL,
    source         TEXT NOT NULL DEFAULT 'seed', -- 'seed' (story canon) | 'player' (sent in-game)
    sent_at        TIMESTAMPTZ NOT NULL
);

-- Who the account owner (Meera) already follows. Anyone in this table is a
-- real connection -- they belong in the stories bar, not "Suggested for you".
CREATE TABLE follows (
    id           SERIAL PRIMARY KEY,
    follower_id  INTEGER NOT NULL REFERENCES users(id),
    followee_id  INTEGER NOT NULL REFERENCES users(id),
    UNIQUE (follower_id, followee_id)
);

-- Feed filler: sponsored posts and meme accounts that show up in any real
-- feed regardless of who you follow. Deliberately NOT evidence -- no
-- evidence_id, never returned by /api/evidence -- because none of it comes
-- from Meera's actual social graph, it's just algorithmic noise a real feed
-- would inject.
CREATE TABLE feed_filler (
    id             SERIAL PRIMARY KEY,
    kind           TEXT NOT NULL, -- 'ad' | 'meme'
    account_name   TEXT NOT NULL,
    account_avatar TEXT NOT NULL,
    caption        TEXT NOT NULL,
    image_url      TEXT NOT NULL,
    likes_count    INTEGER NOT NULL DEFAULT 0,
    cta_label      TEXT, -- ads only, e.g. 'Shop Now'
    posted_at      TIMESTAMPTZ NOT NULL
);

INSERT INTO feed_filler (kind, account_name, account_avatar, caption, image_url, likes_count, cta_label, posted_at) VALUES
    ('ad',   'urbansole.in',     '/images/avatars/urbansole.in.svg',     'New drop. 30% off this week only.',            '/images/posts/ad-shoes.jpg',  2400, 'Shop Now',  now() - interval '2 hours'),
    ('meme', 'daily.memez',      '/images/avatars/daily.memez.svg',      'when the wifi drops during the finale 💀',     '/images/posts/meme-1.png',   58200, NULL,        now() - interval '9 hours'),
    ('ad',   'brewhouse.coffee', '/images/avatars/brewhouse.coffee.svg', 'Your Monday fix, delivered in 15 minutes.',    '/images/posts/ad-coffee.jpg', 1100, 'Order Now', now() - interval '1 day'),
    ('meme', 'daily.memez',      '/images/avatars/daily.memez.svg',      'me pretending i have my life together',        '/images/posts/meme-2.webp',   91500, NULL,        now() - interval '2 days');

-- Simple key/value config for this service (unlock password, feature flags, etc).
CREATE TABLE app_config (
    key    TEXT PRIMARY KEY,
    value  TEXT NOT NULL
);

INSERT INTO app_config (key, value) VALUES
    ('account_owner', 'meera'),
    ('unlock_password', '14102018'),           -- hint: "When did everything change?" -> father's death date
    ('unlock_password_hint', 'When did everything change?'),
    ('father_death_date', '2018-10-14');

-- ---------------------------------------------------------------------------
-- USERS
-- ---------------------------------------------------------------------------
INSERT INTO users (username, display_name, avatar_url, bio, followers_count, following_count) VALUES
    ('meera',       'Meera Kapoor',   '/images/avatars/meera.jpg',       'Dog mom. Coffee first. 📍Bengaluru',                      842, 301),
    ('rahul',       'Rahul Nair',     '/images/avatars/rahul.png',       'Known Meera since we were 7. Still not sorry.',           530, 410),
    ('nikhil',      'Nikhil Rao',     '/images/avatars/nikhil.jpg',      'Product design. Bad at captions.',                        389, 275),
    ('priya',       'Priya Menon',    '/images/avatars/priya.png',       'Same friend group since 2014.',                          412, 350),
    ('arjun',       'Arjun Kapoor',   '/images/avatars/arjun.jpg',       'Married to my best friend.',                              298, 260),
    ('ravi_sharma', 'Ravi Sharma',    '/images/avatars/ravi_sharma.svg', 'Meera''s dad. Retired. Terrible at texting.',              64,  12);

-- Unconnected accounts with no story relevance, seeded only so "Suggested
-- for you" has something real to show once every actual character is
-- already followed (see below). No posts, no evidence.
INSERT INTO users (username, display_name, avatar_url, bio, followers_count, following_count) VALUES
    ('blr.foodscene',  'Bangalore Food Scene', '/images/avatars/blr.foodscene.svg', 'Where to eat this weekend.', 18400, 210),
    ('trail.diaries',  'Trail Diaries',        '/images/avatars/trail.diaries.svg', 'Weekend trekking club, Bengaluru. Est. 2016. Turahalli on Sundays. Batch tag every year -- clip it to your carabiner.', 9200, 340),
    ('citypaws.rescue','City Paws Rescue',     '/images/avatars/citypaws.rescue.svg', 'Street dog rescue & adoption.', 5400, 120);

-- ---------------------------------------------------------------------------
-- FOLLOW GRAPH: who Meera already follows. Everyone she has a real
-- relationship with (husband, best friend, college friends, family) is
-- already a connection -- only the filler accounts above are left over for
-- "Suggested for you".
-- ---------------------------------------------------------------------------
INSERT INTO follows (follower_id, followee_id)
    SELECT (SELECT id FROM users WHERE username='meera'), id
    FROM users WHERE username IN ('rahul','nikhil','priya','arjun','ravi_sharma');

-- ---------------------------------------------------------------------------
-- POSTS + COMMENTS + TAGS
-- Evidence ids are assigned in narrative order: SOC-001 .. SOC-024
-- ---------------------------------------------------------------------------

-- SOC-001
INSERT INTO posts (evidence_id, user_id, caption, image_url, era, likes_count, posted_at) VALUES
    ('SOC-001', (SELECT id FROM users WHERE username='meera'),
     'Sunday breakfasts with this man are non-negotiable. ❤️',
     '/images/posts/family-dad-1.png', 'family', 214, t('2016-05-08 09:12:00+05:30'));
INSERT INTO tags (post_id, tagged_user_id)
    SELECT (SELECT id FROM posts WHERE evidence_id='SOC-001'), id FROM users WHERE username='ravi_sharma';

-- SOC-002
INSERT INTO posts (evidence_id, user_id, caption, image_url, era, likes_count, posted_at) VALUES
    ('SOC-002', (SELECT id FROM users WHERE username='meera'),
     'Dad teaching me to ride a bike... in an empty parking lot, at 32 years old. Still can''t balance.',
     '/images/posts/family-dad-2.png', 'family', 331, t('2017-11-02 18:40:00+05:30'));
INSERT INTO tags (post_id, tagged_user_id)
    SELECT (SELECT id FROM posts WHERE evidence_id='SOC-002'), id FROM users WHERE username='ravi_sharma';

-- SOC-003
INSERT INTO posts (evidence_id, user_id, caption, image_url, era, likes_count, posted_at) VALUES
    ('SOC-003', (SELECT id FROM users WHERE username='meera'),
     'New family member. Meet Bruno. 🐶',
     '/images/posts/dog-1.jpg', 'dog', 458, t('2015-06-01 20:05:00+05:30'));

-- SOC-004
INSERT INTO posts (evidence_id, user_id, caption, image_url, era, likes_count, posted_at) VALUES
    ('SOC-004', (SELECT id FROM users WHERE username='meera'),
     'Bruno turns 4 today and still thinks he''s a lapdog.',
     '/images/posts/dog-2.jpg', 'dog', 276, t('2019-03-14 12:00:00+05:30'));

-- SOC-005
INSERT INTO posts (evidence_id, user_id, caption, image_url, era, likes_count, posted_at) VALUES
    ('SOC-005', (SELECT id FROM users WHERE username='meera'),
     'Old man Bruno enjoying his evening walk.',
     '/images/posts/dog-3.jpg', 'dog', 190, t('2022-08-09 19:30:00+05:30'));

-- SOC-006 (cave photo #1 -- has coordinates, matters for the rescue puzzle)
INSERT INTO posts (evidence_id, user_id, caption, image_url, era, latitude, longitude, likes_count, posted_at) VALUES
    ('SOC-006', (SELECT id FROM users WHERE username='meera'),
     'Our secret kingdom.',
     '/images/posts/cave-1.png', 'childhood', 12.951181, 77.501304, 87, t('2009-04-18 16:20:00+05:30'));
INSERT INTO tags (post_id, tagged_user_id)
    SELECT (SELECT id FROM posts WHERE evidence_id='SOC-006'), id FROM users WHERE username='rahul';
INSERT INTO comments (evidence_id, post_id, user_id, body, commented_at) VALUES
    ('SOC-007', (SELECT id FROM posts WHERE evidence_id='SOC-006'), (SELECT id FROM users WHERE username='rahul'),
     'Nobody knew about this place.', t('2009-04-18 16:45:00+05:30')),
    ('SOC-008', (SELECT id FROM posts WHERE evidence_id='SOC-006'), (SELECT id FROM users WHERE username='meera'),
     'That''s why it was ours.', t('2009-04-18 17:02:00+05:30'));

-- SOC-009 (cave photo #2 -- same location)
INSERT INTO posts (evidence_id, user_id, caption, image_url, era, latitude, longitude, likes_count, posted_at) VALUES
    ('SOC-009', (SELECT id FROM users WHERE username='meera'),
     'We used to play hide-and-seek here for hours.',
     '/images/posts/cave-2.png', 'childhood', 12.951181, 77.501304, 73, t('2009-07-22 15:10:00+05:30'));
INSERT INTO tags (post_id, tagged_user_id)
    SELECT (SELECT id FROM posts WHERE evidence_id='SOC-009'), id FROM users WHERE username='rahul';
INSERT INTO comments (evidence_id, post_id, user_id, body, commented_at) VALUES
    ('SOC-010', (SELECT id FROM posts WHERE evidence_id='SOC-009'), (SELECT id FROM users WHERE username='rahul'),
     'You cheated every single time.', t('2009-07-22 15:40:00+05:30')),
    ('SOC-011', (SELECT id FROM posts WHERE evidence_id='SOC-009'), (SELECT id FROM users WHERE username='meera'),
     'You were just terrible at hiding.', t('2009-07-22 16:00:00+05:30'));

-- SOC-012 (college group photo -- quietly tags both Rahul and Nikhil, years before either mattered to the case)
INSERT INTO posts (evidence_id, user_id, caption, image_url, era, likes_count, posted_at) VALUES
    ('SOC-012', (SELECT id FROM users WHERE username='meera'),
     'Group project chaos before it was cool.',
     '/images/posts/college-1.png', 'college', 305, t('2016-09-30 14:00:00+05:30'));
INSERT INTO tags (post_id, tagged_user_id)
    SELECT (SELECT id FROM posts WHERE evidence_id='SOC-012'), id FROM users WHERE username IN ('rahul','priya','nikhil');

-- SOC-013
INSERT INTO posts (evidence_id, user_id, caption, image_url, era, likes_count, posted_at) VALUES
    ('SOC-013', (SELECT id FROM users WHERE username='meera'),
     'Last day of college hit different.',
     '/images/posts/college-2.png', 'college', 412, t('2017-12-20 11:15:00+05:30'));
INSERT INTO tags (post_id, tagged_user_id)
    SELECT (SELECT id FROM posts WHERE evidence_id='SOC-013'), id FROM users WHERE username IN ('rahul','priya');

-- SOC-014 (school reunion)
INSERT INTO posts (evidence_id, user_id, caption, image_url, era, likes_count, posted_at) VALUES
    ('SOC-014', (SELECT id FROM users WHERE username='meera'),
     'Back with the oldest troublemaker in my life 😂 @Rahul',
     '/images/posts/reunion.png', 'reunion', 522, t('2023-05-06 21:00:00+05:30'));
INSERT INTO tags (post_id, tagged_user_id)
    SELECT (SELECT id FROM posts WHERE evidence_id='SOC-014'), id FROM users WHERE username='rahul';
INSERT INTO comments (evidence_id, post_id, user_id, body, commented_at) VALUES
    ('SOC-015', (SELECT id FROM posts WHERE evidence_id='SOC-014'), (SELECT id FROM users WHERE username='rahul'),
     'Still blaming me after all these years?', t('2023-05-06 21:20:00+05:30')),
    ('SOC-016', (SELECT id FROM posts WHERE evidence_id='SOC-014'), (SELECT id FROM users WHERE username='meera'),
     'Best-friend privilege.', t('2023-05-06 21:25:00+05:30'));

-- SOC-017
INSERT INTO posts (evidence_id, user_id, caption, image_url, era, likes_count, posted_at) VALUES
    ('SOC-017', (SELECT id FROM users WHERE username='meera'),
     'Some people stay in your life forever.',
     '/images/posts/tagged-forever.png', 'reunion', 467, t('2023-05-07 10:00:00+05:30'));
INSERT INTO tags (post_id, tagged_user_id)
    SELECT (SELECT id FROM posts WHERE evidence_id='SOC-017'), id FROM users WHERE username='rahul';
INSERT INTO comments (evidence_id, post_id, user_id, body, commented_at) VALUES
    ('SOC-018', (SELECT id FROM posts WHERE evidence_id='SOC-017'), (SELECT id FROM users WHERE username='rahul'),
     'Unfortunately for you 😂', t('2023-05-07 10:20:00+05:30')),
    ('SOC-019', (SELECT id FROM posts WHERE evidence_id='SOC-017'), (SELECT id FROM users WHERE username='meera'),
     'Wouldn''t have it any other way.', t('2023-05-07 10:26:00+05:30'));

-- SOC-020 (grounds Arjun in the account)
INSERT INTO posts (evidence_id, user_id, caption, image_url, era, likes_count, posted_at) VALUES
    ('SOC-020', (SELECT id FROM users WHERE username='meera'),
     'Married my best friend (the other one 😉) — @Arjun',
     '/images/posts/wedding.png', 'married-life', 891, t('2021-02-14 19:00:00+05:30'));
INSERT INTO tags (post_id, tagged_user_id)
    SELECT (SELECT id FROM posts WHERE evidence_id='SOC-020'), id FROM users WHERE username='arjun';

-- ---------------------------------------------------------------------------
-- DIRECT MESSAGES: meera <-> rahul (the password-pattern clue)
-- ---------------------------------------------------------------------------
INSERT INTO messages (evidence_id, thread_key, sender_id, recipient_id, body, sent_at) VALUES
    ('SOC-021', 'meera-rahul', (SELECT id FROM users WHERE username='rahul'), (SELECT id FROM users WHERE username='meera'),
     'You still use that password?', t('2024-09-01 22:10:00+05:30')),
    ('SOC-022', 'meera-rahul', (SELECT id FROM users WHERE username='meera'), (SELECT id FROM users WHERE username='rahul'),
     'Of course 😂 I still use NeverForget + the year for some of my passwords.', t('2024-09-01 22:12:00+05:30')),
    ('SOC-023', 'meera-rahul', (SELECT id FROM users WHERE username='rahul'), (SELECT id FROM users WHERE username='meera'),
     'You''re seriously still doing that?', t('2024-09-01 22:13:00+05:30')),
    ('SOC-024', 'meera-rahul', (SELECT id FROM users WHERE username='meera'), (SELECT id FROM users WHERE username='rahul'),
     'Easy for me to remember.', t('2024-09-01 22:14:00+05:30'));

-- ---------------------------------------------------------------------------
-- OTHER PEOPLE'S POSTS: a real feed shows content from everyone you follow,
-- not just your own account. These are ordinary, non-canon posts from Rahul,
-- Nikhil, Priya and Arjun so the home feed reads like an actual social feed
-- instead of Meera's own activity log. Still real evidence (SOC-025..032).
-- ---------------------------------------------------------------------------

-- SOC-025
INSERT INTO posts (evidence_id, user_id, caption, image_url, era, likes_count, posted_at) VALUES
    ('SOC-025', (SELECT id FROM users WHERE username='rahul'),
     'Turahalli at dawn with the usual suspects. Same rock, same carabiner, still on my 2018 batch tag. @trail.diaries',
     '/images/posts/rahul-trek.png', 'lifestyle', 156, t('2024-05-12 08:40:00+05:30'));
INSERT INTO comments (evidence_id, post_id, user_id, body, commented_at) VALUES
    ('SOC-026', (SELECT id FROM posts WHERE evidence_id='SOC-025'), (SELECT id FROM users WHERE username='nikhil'),
     'Count me in next time.', t('2024-05-12 09:15:00+05:30')),
    ('SOC-042', (SELECT id FROM posts WHERE evidence_id='SOC-025'), (SELECT id FROM users WHERE username='trail.diaries'),
     'Original blue 2018 batch tag still going strong. Respect. See you Sunday.', t('2024-05-12 10:02:00+05:30'));

-- SOC-027
INSERT INTO posts (evidence_id, user_id, caption, image_url, era, likes_count, posted_at) VALUES
    ('SOC-027', (SELECT id FROM users WHERE username='nikhil'),
     'New desk, who dis.',
     '/images/posts/nikhil-desk.png', 'lifestyle', 84, t('2024-06-03 17:20:00+05:30'));

-- SOC-028
INSERT INTO posts (evidence_id, user_id, caption, image_url, era, likes_count, posted_at) VALUES
    ('SOC-028', (SELECT id FROM users WHERE username='priya'),
     'Sunday brunch, per tradition.',
     '/images/posts/priya-brunch.png', 'lifestyle', 203, t('2024-06-16 12:05:00+05:30'));
INSERT INTO comments (evidence_id, post_id, user_id, body, commented_at) VALUES
    ('SOC-029', (SELECT id FROM posts WHERE evidence_id='SOC-028'), (SELECT id FROM users WHERE username='meera'),
     'Wish I was there!', t('2024-06-16 13:00:00+05:30'));

-- SOC-030 (Arjun, tags Meera -- grounds normal married life shortly before the disappearance)
INSERT INTO posts (evidence_id, user_id, caption, image_url, era, likes_count, posted_at) VALUES
    ('SOC-030', (SELECT id FROM users WHERE username='arjun'),
     'Date night with my favorite person.',
     '/images/posts/arjun-datenight.png', 'married-life', 312, t('2024-07-20 20:30:00+05:30'));
INSERT INTO tags (post_id, tagged_user_id)
    SELECT (SELECT id FROM posts WHERE evidence_id='SOC-030'), id FROM users WHERE username='meera';
INSERT INTO comments (evidence_id, post_id, user_id, body, commented_at) VALUES
    ('SOC-031', (SELECT id FROM posts WHERE evidence_id='SOC-030'), (SELECT id FROM users WHERE username='meera'),
     '❤️', t('2024-07-20 21:00:00+05:30'));

-- SOC-032
INSERT INTO posts (evidence_id, user_id, caption, image_url, era, likes_count, posted_at) VALUES
    ('SOC-032', (SELECT id FROM users WHERE username='rahul'),
     'Monday motivation: coffee and denial.',
     '/images/posts/rahul-monday.png', 'lifestyle', 71, t('2024-08-05 09:00:00+05:30'));

-- ---------------------------------------------------------------------------
-- TRAIL DIARIES (SOC-043..049): the trekking club's own posts. This is where
-- "TD 2018" becomes readable: the club issues a coloured batch tag per year,
-- 2018 was blue, and Rahul is in the 2018 batch throwback.
-- ---------------------------------------------------------------------------

-- SOC-043 -- the batch tags
INSERT INTO posts (evidence_id, user_id, caption, image_url, era, likes_count, posted_at) VALUES
    ('SOC-043', (SELECT id FROM users WHERE username='trail.diaries'),
     'Eight years of batch tags. 2016 red, 2017 green, 2018 blue, 2019 yellow, 2020 grey, 2021 orange, 2022 white, 2023 black. New members get this year''s colour at the gate on Sunday. Old-timers, we know you''re still on your original. Clip it to your carabiner and don''t lose it -- we don''t reissue.',
     '/images/posts/td-tags.png', 'lifestyle', 412, t('2024-03-03 18:20:00+05:30'));
INSERT INTO comments (evidence_id, post_id, user_id, body, commented_at) VALUES
    ('SOC-044', (SELECT id FROM posts WHERE evidence_id='SOC-043'), (SELECT id FROM users WHERE username='rahul'),
     'Blue gang. Never lost mine.', t('2024-03-03 19:05:00+05:30'));

-- SOC-045 -- Sunset Rock
INSERT INTO posts (evidence_id, user_id, caption, image_url, era, likes_count, posted_at) VALUES
    ('SOC-045', (SELECT id FROM users WHERE username='trail.diaries'),
     'Sunset Rock, Turahalli, 6 a.m. The ledge has a railing now (Forest Dept put it up in 2019). Before that it was a scramble on the north side and a prayer at the lip. Please use the railing. We''ve had one too many bad mornings on this rock.',
     '/images/posts/td-rock.png', 'lifestyle', 388, t('2024-06-16 08:10:00+05:30'));

-- SOC-046 -- Sunday crew at the gate
INSERT INTO posts (evidence_id, user_id, caption, image_url, era, likes_count, posted_at) VALUES
    ('SOC-046', (SELECT id FROM users WHERE username='trail.diaries'),
     'Sunday crew at the Kanakapura Road gate. Nanjappa anna still writes every single one of us into the register and still asks your purpose. Nine years, same chair. Sign in, say hi, then go up.',
     '/images/posts/td-gate.png', 'lifestyle', 265, t('2024-07-21 07:45:00+05:30'));
INSERT INTO tags (post_id, tagged_user_id)
    SELECT (SELECT id FROM posts WHERE evidence_id='SOC-046'), id FROM users WHERE username='rahul';
INSERT INTO comments (evidence_id, post_id, user_id, body, commented_at) VALUES
    ('SOC-047', (SELECT id FROM posts WHERE evidence_id='SOC-046'), (SELECT id FROM users WHERE username='rahul'),
     'He wrote "trek" for me again. Eight years and still "trek".', t('2024-07-21 09:30:00+05:30'));

-- SOC-048 -- the 2018 batch throwback
INSERT INTO posts (evidence_id, user_id, caption, image_url, era, likes_count, posted_at) VALUES
    ('SOC-048', (SELECT id FROM users WHERE username='trail.diaries'),
     'Throwback: the 2018 batch on their first Turahalli Sunday, fresh blue tags and no idea what they were signing up for. Seven of you started. Five still show up. Tag yourself.',
     '/images/posts/td-2018.png', 'lifestyle', 530, t('2024-08-11 20:15:00+05:30'));
INSERT INTO tags (post_id, tagged_user_id)
    SELECT (SELECT id FROM posts WHERE evidence_id='SOC-048'), id FROM users WHERE username='rahul';
INSERT INTO comments (evidence_id, post_id, user_id, body, commented_at) VALUES
    ('SOC-049', (SELECT id FROM posts WHERE evidence_id='SOC-048'), (SELECT id FROM users WHERE username='rahul'),
     'Second from left. The hair was a choice.', t('2024-08-11 21:00:00+05:30'));

-- ---------------------------------------------------------------------------
-- MORE DIRECT MESSAGES: real conversations with people she actually texts.
-- A single-thread inbox makes the Rahul thread obvious by elimination -- these
-- are ordinary, mundane exchanges (still real evidence) so the password clue
-- doesn't stand out just for being the only conversation that exists.
-- ---------------------------------------------------------------------------

-- meera <-> arjun (SOC-033..036)
INSERT INTO messages (evidence_id, thread_key, sender_id, recipient_id, body, sent_at) VALUES
    ('SOC-033', 'arjun-meera', (SELECT id FROM users WHERE username='arjun'), (SELECT id FROM users WHERE username='meera'),
     'Did you take the car keys?', t('2024-08-20 08:02:00+05:30')),
    ('SOC-034', 'arjun-meera', (SELECT id FROM users WHERE username='meera'), (SELECT id FROM users WHERE username='arjun'),
     'They''re in my bag, why?', t('2024-08-20 08:03:00+05:30')),
    ('SOC-035', 'arjun-meera', (SELECT id FROM users WHERE username='arjun'), (SELECT id FROM users WHERE username='meera'),
     'Nvm found mine lol', t('2024-08-20 08:05:00+05:30')),
    ('SOC-036', 'arjun-meera', (SELECT id FROM users WHERE username='meera'), (SELECT id FROM users WHERE username='arjun'),
     '😂 classic', t('2024-08-20 08:06:00+05:30'));

-- meera <-> priya (SOC-037..039)
INSERT INTO messages (evidence_id, thread_key, sender_id, recipient_id, body, sent_at) VALUES
    ('SOC-037', 'meera-priya', (SELECT id FROM users WHERE username='priya'), (SELECT id FROM users WHERE username='meera'),
     'Brunch this Saturday? Same place?', t('2024-06-15 19:20:00+05:30')),
    ('SOC-038', 'meera-priya', (SELECT id FROM users WHERE username='meera'), (SELECT id FROM users WHERE username='priya'),
     'Obviously. I''ll bring Bruno.', t('2024-06-15 19:25:00+05:30')),
    ('SOC-039', 'meera-priya', (SELECT id FROM users WHERE username='priya'), (SELECT id FROM users WHERE username='meera'),
     'BRING BRUNO 🐶', t('2024-06-15 19:26:00+05:30'));

-- meera <-> nikhil (SOC-040..041) -- kept deliberately mundane/professional;
-- the real Nikhil material lives in the email service, not here.
INSERT INTO messages (evidence_id, thread_key, sender_id, recipient_id, body, sent_at) VALUES
    ('SOC-040', 'meera-nikhil', (SELECT id FROM users WHERE username='nikhil'), (SELECT id FROM users WHERE username='meera'),
     'Sent you the revised deck, let me know if the numbers look right.', t('2024-07-01 11:00:00+05:30')),
    ('SOC-041', 'meera-nikhil', (SELECT id FROM users WHERE username='meera'), (SELECT id FROM users WHERE username='nikhil'),
     'Looks good, thanks for turning it around so fast.', t('2024-07-01 11:20:00+05:30'));

-- ---------------------------------------------------------------------------
-- DM FILLER: a random stranger and a promo DM. Explicitly NOT evidence --
-- same reasoning as feed_filler (ads/memes): this is generic noise any real
-- inbox has, unconnected to Meera's actual social graph, so MERCY never
-- sees it. No evidence_id, no row in `messages`.
-- ---------------------------------------------------------------------------
CREATE TABLE dm_filler_threads (
    id             SERIAL PRIMARY KEY,
    kind           TEXT NOT NULL, -- 'stranger' | 'ad'
    account_name   TEXT NOT NULL,
    account_avatar TEXT NOT NULL
);

CREATE TABLE dm_filler_messages (
    id          SERIAL PRIMARY KEY,
    thread_id   INTEGER NOT NULL REFERENCES dm_filler_threads(id),
    from_owner  BOOLEAN NOT NULL, -- true = Meera replied, false = the other account sent it
    body        TEXT NOT NULL,
    sent_at     TIMESTAMPTZ NOT NULL
);

INSERT INTO dm_filler_threads (kind, account_name, account_avatar) VALUES
    ('stranger', 'kavya.raje29',   '/images/avatars/kavya.raje29.svg'),
    ('ad',       'stylehub.deals', '/images/avatars/stylehub.deals.svg');

INSERT INTO dm_filler_messages (thread_id, from_owner, body, sent_at) VALUES
    ((SELECT id FROM dm_filler_threads WHERE account_name='kavya.raje29'), false,
     'hiii finally found ur insta! this is Kavya from Ritu''s wedding 😄', now() - interval '3 days'),
    ((SELECT id FROM dm_filler_threads WHERE account_name='kavya.raje29'), true,
     'Oh hi! Yes of course, so good to connect 😊', now() - interval '3 days' + interval '20 minutes'),
    ((SELECT id FROM dm_filler_threads WHERE account_name='stylehub.deals'), false,
     '🎉 FLASH SALE: 40% off everything, tonight only! Use code HELLO40', now() - interval '5 hours');
