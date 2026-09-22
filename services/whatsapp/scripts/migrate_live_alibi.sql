-- Wisp: the alibi rows for a running game (init.sql only runs on a fresh volume).
-- docker compose exec -T whatsapp-db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < services/whatsapp/scripts/migrate_live_alibi.sql
BEGIN;

-- ---------------------------------------------------------------------------
-- THE ALIBI: the night she was taken, on her phone, unread. Arjun texts from
-- his brother's; his brother Vikram texts her too. Nothing is opened, because
-- by 22:10 she is gone. (WA-197..199; the_alibi checkpoint in mercy-engine.)
-- ---------------------------------------------------------------------------
INSERT INTO users (username, display_name, avatar_url, phone_number) VALUES
    ('vikram', 'Vikram Kapoor', '/images/avatars/vikram.svg', '+91 98450 66120') ON CONFLICT (username) DO NOTHING;
INSERT INTO threads (thread_key, kind) VALUES ('meera-vikram', 'direct') ON CONFLICT (thread_key) DO NOTHING;
INSERT INTO thread_participants (thread_id, user_id)
    SELECT (SELECT id FROM threads WHERE thread_key='meera-vikram'), id FROM users WHERE username IN ('meera','vikram') ON CONFLICT DO NOTHING;
INSERT INTO messages (evidence_id, thread_id, sender_id, body, sent_at) VALUES
    ('WA-197', (SELECT id FROM threads WHERE thread_key='arjun-meera'), (SELECT id FROM users WHERE username='arjun'),
     'Reached bhaiya''s. Mum''s already asleep, Vikram''s making chai and pretending he isn''t going to lecture me. Call me when you''re up :)', t('2024-09-02 22:20:00+05:30')),
    ('WA-198', (SELECT id FROM threads WHERE thread_key='arjun-meera'), (SELECT id FROM users WHERE username='arjun'),
     'Going to sleep. Back by 10 tomorrow and we''ll talk properly, I promise. Love you.', t('2024-09-03 00:41:00+05:30')),
    ('WA-199', (SELECT id FROM threads WHERE thread_key='meera-vikram'), (SELECT id FROM users WHERE username='vikram'),
     'Hey Meera, Vikram here. Arjun''s staying over tonight, he''s fine -- mum made him eat two plates. He''s worried about you, that''s all. Talk to him tomorrow, ok?', t('2024-09-02 23:12:00+05:30')) ON CONFLICT (evidence_id) DO NOTHING;
UPDATE evidence_counters SET next_seq = GREATEST(next_seq, 200) WHERE service='whatsapp';
COMMIT;
