-- Loop: the alibi rows for a running game.
-- docker compose exec -T social-media-db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < services/social-media/scripts/migrate_live_alibi.sql
BEGIN;

-- ---------------------------------------------------------------------------
-- THE ALIBI: Arjun's brother posts from their mother's house at 23:40 the
-- night Meera was taken, tagging Arjun; Arjun comments at 23:52. She never
-- saw it. (SOC-050..051; the_alibi checkpoint in mercy-engine.)
-- ---------------------------------------------------------------------------
INSERT INTO users (username, display_name, avatar_url, bio, followers_count, following_count) VALUES
    ('vikram', 'Vikram Kapoor', '/images/avatars/vikram.svg', 'Older brother. Chai > coffee.', 210, 180) ON CONFLICT (username) DO NOTHING;
INSERT INTO follows (follower_id, followee_id)
    SELECT (SELECT id FROM users WHERE username='meera'), id FROM users WHERE username='vikram' ON CONFLICT DO NOTHING;
INSERT INTO posts (evidence_id, user_id, caption, image_url, era, likes_count, posted_at) VALUES
    ('SOC-050', (SELECT id FROM users WHERE username='vikram'),
     'Late-night chai with the little brother. Mum refusing to go to bed until he finishes his plate. @arjun',
     '/images/posts/chai-night.svg', 'recent', 41, t('2024-09-02 23:40:00+05:30')) ON CONFLICT (evidence_id) DO NOTHING;
INSERT INTO tags (post_id, tagged_user_id)
    SELECT (SELECT id FROM posts WHERE evidence_id='SOC-050'), id FROM users WHERE username='arjun'
    AND NOT EXISTS (SELECT 1 FROM tags WHERE post_id = (SELECT id FROM posts WHERE evidence_id='SOC-050'));
INSERT INTO comments (evidence_id, post_id, user_id, body, commented_at) VALUES
    ('SOC-051', (SELECT id FROM posts WHERE evidence_id='SOC-050'), (SELECT id FROM users WHERE username='arjun'),
     'she''s going to make me eat again in the morning isn''t she', t('2024-09-02 23:52:00+05:30')) ON CONFLICT (evidence_id) DO NOTHING;
UPDATE evidence_counters SET next_seq = GREATEST(next_seq, 52) WHERE service='social-media';
COMMIT;
