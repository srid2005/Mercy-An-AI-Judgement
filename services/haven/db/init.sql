-- Haven (private cloud video diary) service database
-- Every diary entry carries a globally-unique evidence_id, prefix HAV-###,
-- per the contract in /ARCHITECTURE.md.

-- Same time anchor as social-media / whatsapp / email: story dates are
-- written as fixed 2024 calendar dates, remapped relative to now() at seed
-- time so all services' timelines stay mutually consistent.
CREATE FUNCTION t(orig TIMESTAMPTZ) RETURNS TIMESTAMPTZ AS $$
  -- Pinned to 21:40 IST *yesterday* whatever the clock says at seed time, so
  -- "that night" is a night in every app and every derived time stays true.
  SELECT ((date_trunc('day', now() AT TIME ZONE 'Asia/Kolkata') - interval '1 day' + interval '21 hours 40 minutes') AT TIME ZONE 'Asia/Kolkata')
         + (orig - TIMESTAMPTZ '2024-09-02 21:40:00+05:30');
$$ LANGUAGE SQL STABLE;

CREATE TABLE users (
    id             SERIAL PRIMARY KEY,
    username       TEXT UNIQUE NOT NULL,
    display_name   TEXT NOT NULL,
    email_address  TEXT UNIQUE NOT NULL,
    avatar_url     TEXT NOT NULL,
    member_since   TIMESTAMPTZ NOT NULL
);

-- One row per recording. video_url / poster_url point at files under
-- public/ named by recording date -- drop the real recording in at the
-- same path to replace the sample, nothing else needs to change.
CREATE TABLE entries (
    id                SERIAL PRIMARY KEY,
    evidence_id       TEXT UNIQUE NOT NULL,
    title             TEXT NOT NULL,
    recorded_at       TIMESTAMPTZ NOT NULL,
    backed_up_at      TIMESTAMPTZ,
    duration_seconds  INTEGER NOT NULL,
    mood              TEXT NOT NULL,   -- happy | calm | tired | heavy | anxious | afraid | reflective
    tags              TEXT[] NOT NULL DEFAULT '{}',
    transcript        TEXT NOT NULL,
    video_url         TEXT NOT NULL,
    poster_url        TEXT NOT NULL,
    device            TEXT NOT NULL DEFAULT 'Meera''s laptop',
    is_final          BOOLEAN NOT NULL DEFAULT false
);

-- Step 1 of sign-in: a one-time code delivered as a real email into Quill.
CREATE TABLE login_codes (
    id          SERIAL PRIMARY KEY,
    code        TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    used        BOOLEAN NOT NULL DEFAULT false
);

-- Step 2 of sign-in: Meera's three security questions. Answers are stored
-- normalized (lowercase, letters+digits only) and compared the same way, so
-- "14/10/2018", "14-10-2018" and "14102018" all match.
CREATE TABLE security_questions (
    position           INTEGER PRIMARY KEY,
    question           TEXT NOT NULL,
    hint               TEXT NOT NULL,
    answer_normalized  TEXT NOT NULL
);

CREATE TABLE evidence_counters (
    service   TEXT PRIMARY KEY,
    next_seq  INTEGER NOT NULL
);

CREATE TABLE app_config (
    key    TEXT PRIMARY KEY,
    value  TEXT NOT NULL
);

INSERT INTO app_config (key, value) VALUES
    ('account_owner', 'meera'),
    ('storage_used_pct', '80'),
    ('storage_total_gb', '5');

INSERT INTO users (username, display_name, email_address, avatar_url, member_since) VALUES
    ('meera', 'Meera Kapoor', 'meera.kapoor@quillmail.com', '/images/avatars/meera.png', t('2018-11-02 20:15:00+05:30'));

-- The three questions are personal facts the player (Arjun) can confirm from
-- the other apps: the Bengaluru geotags on the childhood posts, Bruno the dog,
-- and Meera's own "married my best friend" post.
INSERT INTO security_questions (position, question, hint, answer_normalized) VALUES
    (1, 'Where was I born?',
        'The city. Spelled the way it is now, not the old name.',
        'bengaluru'),
    (2, 'What is my pet''s name?',
        'Four years old and still convinced he''s a lapdog.',
        'bruno'),
    (3, 'What is my favourite person''s name?',
        'First name only. I married him.',
        'arjun'),
    -- the password Rahul still teases her about (SOC-021..024: "NeverForget +
    -- the year"), asked here without the year
    (4, 'I have always used this password, since I was a child -- but for this, use it without the year.',
        'Rahul still teases me about it. Loop knows.',
        'neverforget');

-- ---------------------------------------------------------------------------
-- ENTRIES -- evidence ids in chronological order, HAV-001..031.
-- Most are ordinary: the dog, work, the marriage. The investigation only
-- takes over in the last month, and even then it's mixed with normal days.
-- ---------------------------------------------------------------------------
INSERT INTO entries (evidence_id, title, recorded_at, duration_seconds, mood, tags, transcript, video_url, poster_url) VALUES
('HAV-001', 'Day one', t('2018-11-02 20:32:00+05:30'), 20, 'heavy', '{dad,grief}',
 'Okay. Okay, this is -- I don''t know how to do this. Priya said talking helps, and I can''t talk to people right now, so. Hi, camera. It''s been nineteen days. The app says nobody can see this. Not even them. So I guess this is where I put all of it.

Dad''s chair is still by the window. Mum keeps setting two cups out. I keep waiting for him to call at nine, like he always did. And then I remember. I''m not okay. I''m going to say that here so I don''t have to say it out loud anywhere else.',
 '/videos/2018-11-02.mp4', '/images/posters/2018-11-02.jpg'),

('HAV-002', 'Sleeping again', t('2018-11-20 22:05:00+05:30'), 20, 'tired', '{dad,arjun,bruno}',
 'Slept six hours last night. Six. Writing that down like it''s an achievement. Because it is.

Arjun keeps showing up with food I didn''t ask for. Tonight it was terrible biryani, and I ate all of it. I don''t know what I''d do without him.',
 '/videos/2018-11-20.mp4', '/images/posters/2018-11-20.jpg'),

('HAV-003', 'Bruno is four', t('2019-03-14 12:20:00+05:30'), 20, 'happy', '{bruno}',
 'Birthday boy! Say hi, Bruno. He won''t say hi. He got a cake made of chicken and he''s currently trying to sit in my lap, which is why the camera keeps shaking.

Four years old and still convinced he''s a lapdog. Posted the photo. Rahul already commented something rude about the dog having better hair than me. Fair.',
 '/videos/2019-03-14.mp4', '/images/posters/2019-03-14.jpg'),

('HAV-004', 'Rain', t('2019-07-20 21:40:00+05:30'), 20, 'calm', '{work,random}',
 'It''s been raining since Tuesday and I''ve done nothing but sketch app screens for a client who keeps saying ''make it pop''. I don''t know what that means. Nobody knows what that means.

Made pakoras. Watched the same show a third time. Boyfriend fell asleep on the sofa twenty minutes in. Husband-to-be. He''s not -- ignore that.',
 '/videos/2019-07-20.mp4', '/images/posters/2019-07-20.jpg'),

('HAV-005', 'One year', t('2019-10-14 23:10:00+05:30'), 20, 'heavy', '{dad}',
 'One year. We went to the temple -- Mum, me, Arjun. Mum was fine until the priest said his name. And then she wasn''t.

I keep thinking about the last thing he said to me. ''Drive slow.'' Which is so him it hurts. The police were very kind a year ago. And very final. He went up to the rock alone, he slipped, it happens in that forest every year, case closed. I asked for a copy of the file back then. They gave me five pages. A whole person, five pages.',
 '/videos/2019-10-14.mp4', '/images/posters/2019-10-14.jpg'),

('HAV-006', 'Lockdown brain', t('2020-06-05 19:15:00+05:30'), 20, 'tired', '{work,bruno,random}',
 'Day whatever of working from the dining table. Three video calls today, and in two of them Bruno barked at the courier and everyone laughed and went back to talking about conversion funnels.

Arjun made banana bread. Apparently that''s the law now. It was good. This is what a diary looks like when nothing happens. That''s allowed.',
 '/videos/2020-06-05.mp4', '/images/posters/2020-06-05.jpg'),

('HAV-007', 'He asked', t('2020-08-17 22:50:00+05:30'), 19, 'happy', '{arjun,dad}',
 'So. Arjun proposed. On Dad''s birthday. He said he''d been carrying the ring for two months, and he wanted to ask on a day that already meant something.

And then he told me he asked Dad''s photo first, this morning, while I was in the shower. I lost it. Obviously I said yes. Seventeenth of August. It''s going to mean two things now.',
 '/videos/2020-08-17.mp4', '/images/posters/2020-08-17.jpg'),

('HAV-008', 'Married', t('2021-02-15 11:05:00+05:30'), 20, 'happy', '{arjun}',
 'I''m married. I''m recording this in a hotel bathrobe. We snuck out this morning before the family woke up and went to Rose Cafe. The one where we met.

Sat at the same table by the window. The same waiter was there -- I swear it was the same waiter -- and he didn''t recognise us at all. Arjun ordered the same thing he ordered the first day. I don''t know why that made me cry. Good crying. Everything is good crying today.',
 '/videos/2021-02-15.mp4', '/images/posters/2021-02-15.jpg'),

('HAV-009', 'Work again', t('2022-01-09 20:30:00+05:30'), 20, 'tired', '{work}',
 'New year, same deadlines. Lead designer now, officially, which mostly means more meetings about meetings. Divya''s a good manager though. She actually pushes back on the sales guys.

Arjun''s travelling again. The flat''s very quiet, just me and the dog. Some days I like it. I''m not sure what that says.',
 '/videos/2022-01-09.mp4', '/images/posters/2022-01-09.jpg'),

('HAV-010', 'Old man', t('2022-08-09 19:50:00+05:30'), 20, 'calm', '{bruno}',
 'Bruno''s walks are slower now. He stops at every tree like he''s reading the news. Seven years old.

Vet says his hips are fine. He''s just dramatic. Which -- he learned it from me.',
 '/videos/2022-08-09.mp4', '/images/posters/2022-08-09.jpg'),

('HAV-011', 'Reunion', t('2023-05-07 12:40:00+05:30'), 20, 'reflective', '{rahul,school,childhood}',
 'Still hungover from the reunion. Everyone''s exactly the same and also completely different. Rahul hasn''t changed at all -- still the loudest person in any room. Still calls me ''Kapoor'' like we''re twelve.

We ended up on the terrace at two a.m. talking about the cave. Our secret kingdom. When I wanted to disappear as a kid, there was one place nobody could find me. He was the only other person on earth who knew about it. He got quiet when Dad came up. Dad basically half-raised him, after his own father left.',
 '/videos/2023-05-07.mp4', '/images/posters/2023-05-07.jpg'),

('HAV-012', 'Distance', t('2023-11-11 21:30:00+05:30'), 20, 'tired', '{arjun,work}',
 'Arjun and I had the same fight again. The one that''s not really about the dishes. He works late, I work late. We pass each other in the kitchen like colleagues.

I love him. I just don''t remember the last time we talked about anything that wasn''t logistics. I''m going to try harder. I''m going to plan something.',
 '/videos/2023-11-11.mp4', '/images/posters/2023-11-11.jpg'),

('HAV-013', 'I did something stupid', t('2024-03-22 23:45:00+05:30'), 18, 'anxious', '{random}',
 'I''m not going to say it. I''m not even going to say it here. And this thing is locked with a password only I know.

It was one evening. It was a work thing, and then it wasn''t a work thing, and he walked me to the car, and I -- Nothing happened. Something happened. Nothing that can''t be undone. I''m going to delete his number. I''m recording this so tomorrow I remember I said I''d delete his number.',
 '/videos/2024-03-22.mp4', '/images/posters/2024-03-22.jpg'),

('HAV-014', 'Nothing much', t('2024-04-30 20:10:00+05:30'), 10, 'calm', '{bruno,work}',
 'Bruno''s new vet is nice. Work is work. I made dal. Arjun''s mum called to ask when we''re having children. Fun call to get on a Tuesday.

That''s it. That''s the entry. I didn''t delete the number. I''m aware.',
 '/videos/2024-04-30.mp4', '/images/posters/2024-04-30.jpg'),

('HAV-015', 'Photographer', t('2024-05-16 22:20:00+05:30'), 20, 'calm', '{priya}',
 'Priya''s frantic about Ritu''s wedding photos. Asked me who shot Ritu''s own wedding and I''ve completely blanked. Kunal Studios? Kunal something. I said I''d check.

Also she asked, very casually, if ''everything''s okay with me''. Which means she''s noticed something. I''m fine. I''m fine.',
 '/videos/2024-05-16.mp4', '/images/posters/2024-05-16.jpg'),

('HAV-016', 'Four times', t('2024-06-21 23:58:00+05:30'), 20, 'anxious', '{random}',
 'He emailed me. Not a text -- an email, like it''s 2009. Because he says the phone feels too risky. He''s right. It is.

I read it four times. I''m going to reply in the morning, when I''m thinking straight. And I already know what I''m going to say, which is the problem. I have a husband. I have a whole life. I keep saying that like it''s a spell that''ll work if I say it enough times.',
 '/videos/2024-06-21.mp4', '/images/posters/2024-06-21.jpg'),

('HAV-017', 'Trip', t('2024-07-01 21:15:00+05:30'), 20, 'anxious', '{arjun}',
 'Arjun forwarded the flight booking for the trip. He''s excited. He''s been planning it for weeks, sending me links to places to eat.

I''m going to go, and I''m going to have a good time, and I''m going to be the person he thinks he''s married to. That''s a promise. To this camera. Which is a strange thing to make promises to.',
 '/videos/2024-07-01.mp4', '/images/posters/2024-07-01.jpg'),

('HAV-018', 'Thursday', t('2024-07-19 00:20:00+05:30'), 19, 'anxious', '{random}',
 'Thursday happened. I told Arjun I had a work thing. I''m getting good at saying that. Which is the part that scares me. Not the rest of it.

N. wants to talk about what this is. I told him not to label it. I can''t hold a label right now. I can barely hold my own face together at dinner. I''m not a bad person. I''m a person doing a bad thing. And I know the difference. I''m not sure the difference matters.',
 '/videos/2024-07-19.mp4', '/images/posters/2024-07-19.jpg'),

('HAV-019', 'The box', t('2024-08-02 22:35:00+05:30'), 30, 'heavy', '{dad,case}',
 'Found Dad''s box today. The police file. Five pages. He went up to the rock at Turahalli, alone, and he fell. That''s what it says.

But the gate register has a scooter going in fifteen minutes before his car. And coming out at 7:35. ''Fast'', the guard wrote. Nobody in the report mentions it again.

He wrote petrol receipts in this. My exam dates. Every Sunday, ''walk, six-twenty'', in his neat little hand. He never missed one.

The last thing he said to me was ''drive slow''. I''m probably being stupid. It''s been six years.',
 '/videos/2024-08-02.mp4', '/images/posters/2024-08-02.jpg'),

('HAV-020', 'Normal day', t('2024-08-06 21:00:00+05:30'), 19, 'calm', '{work,bruno}',
 'Normal day. Sprint review, Divya was happy. Bruno stole a chapati off the counter.

I''m recording the normal days on purpose. I''ve noticed the not-normal ones are starting to pile up in here. I don''t want this to become a place where I only talk when something''s wrong.',
 '/videos/2024-08-06.mp4', '/images/posters/2024-08-06.jpg'),

('HAV-021', 'Timelines', t('2024-08-10 22:28:00+05:30'), 30, 'anxious', '{dad,case}',
 'I made a timeline. Scooter in at 6:05. Dad''s car at 6:20. At ten past seven a jogger hears two men arguing on the rock, and one of them says ''stay away from her''. That''s in her statement.

The report says he fell at 7:15. Alone. And the last call into his phone was 5:48 that morning. A contact saved as ''R, Meera''s friend''. The police wrote one line: ''family friend, informed''.

They called him to tell him Dad was dead. Nobody asked why he''d phoned Dad at ten to six on a Sunday.

The register, the jogger, the phone, they all say one thing. The file says another. And it just... moves on.',
 '/videos/2024-08-10.mp4', '/images/posters/2024-08-10.jpg'),

('HAV-022', 'The gate', t('2024-08-14 23:30:00+05:30'), 10, 'anxious', '{dad,case}',
 'I went to Turahalli today. First time since. The gate guard from 2018 is still there. Same chair. He remembers the young man on the scooter. Rucksack, glasses, said he was meeting a family friend up the trail.

He told the police all of that. Nobody ever came back to ask him anything.

Effects: wallet, phone, keys, water bottle... and a blue carabiner with a little club tag. ''TD 2018''. Dad didn''t own a carabiner. Dad didn''t own anything with a tag on it.

Someone was up on that rock with him. Someone dropped that. I haven''t told Arjun any of this.',
 '/videos/2024-08-14.mp4', '/images/posters/2024-08-14.jpg'),

('HAV-023', 'Stop', t('2024-08-17 21:10:00+05:30'), 20, 'anxious', '{dad,case}',
 'N. says stop. He said it twice, in writing. Then he said we shouldn''t talk about this here, delete the thread. I did. Sort of. I trashed it.

I know he''s scared for me. I know he''s probably right. But he didn''t know Dad. He doesn''t know what it''s like to sign a form that says ''accident'' and spend six years pretending you believed it.',
 '/videos/2024-08-17.mp4', '/images/posters/2024-08-17.jpg'),

('HAV-024', 'Vet', t('2024-08-19 20:45:00+05:30'), 20, 'calm', '{bruno}',
 'Bruno''s hip thing again. X-rays fine. He''s just getting old. Like the rest of us.

Sixteen thousand rupees to be told my dog is dramatic. Worth it. Moving on.',
 '/videos/2024-08-19.mp4', '/images/posters/2024-08-19.jpg'),

('HAV-025', 'You should stop', t('2024-08-21 00:40:00+05:30'), 20, 'afraid', '{case,threat}',
 'Someone emailed me. Quarter to midnight. No name, an address that''s just numbers. ''Whatever you think you''re looking into, stop. This is the only warning you''ll get.''

I''ve read it maybe forty times. I only use that address for a handful of people. So someone knows I''m looking into Dad''s case. Not ''might know''. Knows.

I locked the balcony door twice and then checked it again. Bruno keeps looking at the door.',
 '/videos/2024-08-21.mp4', '/images/posters/2024-08-21.jpg'),

('HAV-026', 'Drafts', t('2024-08-23 22:15:00+05:30'), 20, 'anxious', '{case,police}',
 'Wrote to the police. A proper letter. Formal, polite -- ''to whom it may concern'', the whole thing. Asking for the full file. The joggers'' statements. The phone records they never pulled. Then I didn''t send it. It''s sitting in drafts.

Because whoever emailed me knows I''m looking. And a request from Ravi Sharma''s daughter is a flare going up. I''ll go and find the jogger myself instead. Her name''s in the statement. Next week. I''ll take leave.',
 '/videos/2024-08-23.mp4', '/images/posters/2024-08-23.jpg'),

('HAV-027', 'Watched', t('2024-08-25 23:20:00+05:30'), 10, 'afraid', '{case,rahul}',
 'I think I''m being watched. I don''t say that lightly. I went back to the gate guard, to thank him. He said someone had already been by. Asking what I''d wanted. This week.

Somebody knew I went to the forest. I told exactly no one.

And Rahul called tonight. Out of nowhere. Just to chat, what have you been up to. And I said ''nothing''. Why did I say nothing? He''s the one person I could always tell everything.

I''m scared of everyone now. That''s what this is doing to me.',
 '/videos/2024-08-25.mp4', '/images/posters/2024-08-25.jpg'),

('HAV-028', 'Leave', t('2024-08-28 22:00:00+05:30'), 20, 'afraid', '{case,arjun,threat}',
 '''I know where you''ve been going. I know who you''ve been talking to.'' They know about the forest. They know about the gate guard. They might know about N.

I''ve drafted a leave request for next week. I''m going to the district office in person, first thing, before anyone can pull anything else out of that file.

Arjun and I had a real fight tonight. A bad one. About nothing, about everything. I couldn''t tell him the actual reason. I got as far as ''there''s something about Dad''. And then I just... didn''t.',
 '/videos/2024-08-28.mp4', '/images/posters/2024-08-28.jpg'),

('HAV-029', 'Close', t('2024-08-30 07:50:00+05:30'), 20, 'anxious', '{case,dad}',
 'I''m close. I can feel it. The jogger. S. Iyer, she still runs there. She remembers more than the statement. The older voice said ''I told you to stay away from her''. Her.

And a bit later a young man came running down the trail past her. No rucksack. Blood on his knuckles. She thought he''d fallen.

Dad''s diary. Three separate pages, same year, same line: ''Talked to R. again. Warned him off.'' And the last note he ever typed, the Saturday night: ''Sun. Talk to R at the rock. End it.''

I''ve been staring at that R for an hour. I''m not saying the name until I''m sure.',
 '/videos/2024-08-30.mp4', '/images/posters/2024-08-30.jpg'),

('HAV-030', 'Hide-and-seek', t('2024-09-01 23:20:00+05:30'), 20, 'reflective', '{rahul,childhood,case}',
 'Rahul messaged tonight. About passwords, of all things. ''You still use that?'' And then, out of nowhere, about the cave. Whether I remembered our kingdom. Whether I still cheated at hide-and-seek.

It was sweet. It should have been sweet.

Instead I sat here afterwards with Dad''s diary open, looking at one letter. And I felt sick.

I''m going through his Loop in the morning. Every trek photo. Then I''ll know.',
 '/videos/2024-09-01.mp4', '/images/posters/2024-09-01.jpg');

-- The final recording. Backed up to Haven minutes before she was taken --
-- the newest entry the laptop never had a local copy of.
INSERT INTO entries (evidence_id, title, recorded_at, duration_seconds, mood, tags, transcript, video_url, poster_url, device, is_final) VALUES
('HAV-031', 'If something happens', t('2024-09-02 21:52:00+05:30'), 36, 'afraid', '{rahul,dad,case}',
 'I''m recording this because I need it to exist somewhere he can''t reach.

Rahul''s Loop. Every trek photo since 2017. A blue carabiner on his strap in all of them, with the Trail Diaries tag. TD. He was a member in 2018.

His number is the 5:48 call in Dad''s phone. He''s "R". Dad warned him off three times that year. It''s in Dad''s handwriting. Dad went up to the rock that morning to end it. Rahul went too. Dad never came down.

It wasn''t an accident. Rahul killed my father.

He''s outside right now. I saw his car from the balcony. He''s texting that he just wants to talk. Arjun''s at his brother''s. N. isn''t picking up.

If something happens to me, it''s Rahul. Rahul Nair. It was always --',
 '/videos/2024-09-02.mp4', '/images/posters/2024-09-02.jpg', 'Meera''s phone', true);

-- Cloud backup timestamps: a few minutes after each recording finished.
-- Two are pinned to match the "Your entry has been saved" emails in Quill
-- (EML-035, EML-036) so the two services agree to the minute.
UPDATE entries SET backed_up_at = recorded_at + (duration_seconds * interval '1 second') + interval '4 minutes';
UPDATE entries SET backed_up_at = t('2024-08-10 22:40:00+05:30') WHERE evidence_id = 'HAV-021';
UPDATE entries SET backed_up_at = t('2024-09-02 22:10:00+05:30') WHERE evidence_id = 'HAV-031';

INSERT INTO evidence_counters (service, next_seq) VALUES ('haven', 32);
