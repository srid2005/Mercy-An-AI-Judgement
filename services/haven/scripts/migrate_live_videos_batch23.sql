-- haven: the twenty-two recordings of batches 2 and 3 arrived; each entry's
-- duration and transcript become what is actually spoken on film (the long
-- originals are kept in db/transcripts-full.backup.json) and its poster the
-- frame taken from the video. Applied to both the single-player schema and the
-- event's template; participant schemas resolve entries from template.
--   docker compose exec -T haven-db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < services/haven/scripts/migrate_live_videos_batch23.sql
-- Idempotent: safe to run again.
DO $mig$ DECLARE sch TEXT; BEGIN
  FOREACH sch IN ARRAY ARRAY['public', 'template'] LOOP
    IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = sch) THEN
      EXECUTE format('SET LOCAL search_path TO %I', sch);
      UPDATE entries SET duration_seconds = 20, transcript = E'Okay. Okay, this is -- I don''t know how to do this. Priya said talking helps, and I can''t talk to people right now, so. Hi, camera. It''s been nineteen days. The app says nobody can see this. Not even them. So I guess this is where I put all of it.

Dad''s chair is still by the window. Mum keeps setting two cups out. I keep waiting for him to call at nine, like he always did. And then I remember. I''m not okay. I''m going to say that here so I don''t have to say it out loud anywhere else.', poster_url = '/images/posters/2018-11-02.jpg' WHERE evidence_id = 'HAV-001';
      UPDATE entries SET duration_seconds = 20, transcript = E'Slept six hours last night. Six. Writing that down like it''s an achievement. Because it is.

Arjun keeps showing up with food I didn''t ask for. Tonight it was terrible biryani, and I ate all of it. I don''t know what I''d do without him.', poster_url = '/images/posters/2018-11-20.jpg' WHERE evidence_id = 'HAV-002';
      UPDATE entries SET duration_seconds = 20, transcript = E'Birthday boy! Say hi, Bruno. He won''t say hi. He got a cake made of chicken and he''s currently trying to sit in my lap, which is why the camera keeps shaking.

Four years old and still convinced he''s a lapdog. Posted the photo. Rahul already commented something rude about the dog having better hair than me. Fair.', poster_url = '/images/posters/2019-03-14.jpg' WHERE evidence_id = 'HAV-003';
      UPDATE entries SET duration_seconds = 20, transcript = E'It''s been raining since Tuesday and I''ve done nothing but sketch app screens for a client who keeps saying ''make it pop''. I don''t know what that means. Nobody knows what that means.

Made pakoras. Watched the same show a third time. Boyfriend fell asleep on the sofa twenty minutes in. Husband-to-be. He''s not -- ignore that.', poster_url = '/images/posters/2019-07-20.jpg' WHERE evidence_id = 'HAV-004';
      UPDATE entries SET duration_seconds = 20, transcript = E'One year. We went to the temple -- Mum, me, Arjun. Mum was fine until the priest said his name. And then she wasn''t.

I keep thinking about the last thing he said to me. ''Drive slow.'' Which is so him it hurts. The police were very kind a year ago. And very final. He went up to the rock alone, he slipped, it happens in that forest every year, case closed. I asked for a copy of the file back then. They gave me five pages. A whole person, five pages.', poster_url = '/images/posters/2019-10-14.jpg' WHERE evidence_id = 'HAV-005';
      UPDATE entries SET duration_seconds = 20, transcript = E'Day whatever of working from the dining table. Three video calls today, and in two of them Bruno barked at the courier and everyone laughed and went back to talking about conversion funnels.

Arjun made banana bread. Apparently that''s the law now. It was good. This is what a diary looks like when nothing happens. That''s allowed.', poster_url = '/images/posters/2020-06-05.jpg' WHERE evidence_id = 'HAV-006';
      UPDATE entries SET duration_seconds = 19, transcript = E'So. Arjun proposed. On Dad''s birthday. He said he''d been carrying the ring for two months, and he wanted to ask on a day that already meant something.

And then he told me he asked Dad''s photo first, this morning, while I was in the shower. I lost it. Obviously I said yes. Seventeenth of August. It''s going to mean two things now.', poster_url = '/images/posters/2020-08-17.jpg' WHERE evidence_id = 'HAV-007';
      UPDATE entries SET duration_seconds = 20, transcript = E'I''m married. I''m recording this in a hotel bathrobe. We snuck out this morning before the family woke up and went to Rose Cafe. The one where we met.

Sat at the same table by the window. The same waiter was there -- I swear it was the same waiter -- and he didn''t recognise us at all. Arjun ordered the same thing he ordered the first day. I don''t know why that made me cry. Good crying. Everything is good crying today.', poster_url = '/images/posters/2021-02-15.jpg' WHERE evidence_id = 'HAV-008';
      UPDATE entries SET duration_seconds = 20, transcript = E'New year, same deadlines. Lead designer now, officially, which mostly means more meetings about meetings. Divya''s a good manager though. She actually pushes back on the sales guys.

Arjun''s travelling again. The flat''s very quiet, just me and the dog. Some days I like it. I''m not sure what that says.', poster_url = '/images/posters/2022-01-09.jpg' WHERE evidence_id = 'HAV-009';
      UPDATE entries SET duration_seconds = 20, transcript = E'Bruno''s walks are slower now. He stops at every tree like he''s reading the news. Seven years old.

Vet says his hips are fine. He''s just dramatic. Which -- he learned it from me.', poster_url = '/images/posters/2022-08-09.jpg' WHERE evidence_id = 'HAV-010';
      UPDATE entries SET duration_seconds = 20, transcript = E'Still hungover from the reunion. Everyone''s exactly the same and also completely different. Rahul hasn''t changed at all -- still the loudest person in any room. Still calls me ''Kapoor'' like we''re twelve.

We ended up on the terrace at two a.m. talking about the cave. Our secret kingdom. When I wanted to disappear as a kid, there was one place nobody could find me. He was the only other person on earth who knew about it. He got quiet when Dad came up. Dad basically half-raised him, after his own father left.', poster_url = '/images/posters/2023-05-07.jpg' WHERE evidence_id = 'HAV-011';
      UPDATE entries SET duration_seconds = 20, transcript = E'Arjun and I had the same fight again. The one that''s not really about the dishes. He works late, I work late. We pass each other in the kitchen like colleagues.

I love him. I just don''t remember the last time we talked about anything that wasn''t logistics. I''m going to try harder. I''m going to plan something.', poster_url = '/images/posters/2023-11-11.jpg' WHERE evidence_id = 'HAV-012';
      UPDATE entries SET duration_seconds = 18, transcript = E'I''m not going to say it. I''m not even going to say it here. And this thing is locked with a password only I know.

It was one evening. It was a work thing, and then it wasn''t a work thing, and he walked me to the car, and I -- Nothing happened. Something happened. Nothing that can''t be undone. I''m going to delete his number. I''m recording this so tomorrow I remember I said I''d delete his number.', poster_url = '/images/posters/2024-03-22.jpg' WHERE evidence_id = 'HAV-013';
      UPDATE entries SET duration_seconds = 10, transcript = E'Bruno''s new vet is nice. Work is work. I made dal. Arjun''s mum called to ask when we''re having children. Fun call to get on a Tuesday.

That''s it. That''s the entry. I didn''t delete the number. I''m aware.', poster_url = '/images/posters/2024-04-30.jpg' WHERE evidence_id = 'HAV-014';
      UPDATE entries SET duration_seconds = 20, transcript = E'Priya''s frantic about Ritu''s wedding photos. Asked me who shot Ritu''s own wedding and I''ve completely blanked. Kunal Studios? Kunal something. I said I''d check.

Also she asked, very casually, if ''everything''s okay with me''. Which means she''s noticed something. I''m fine. I''m fine.', poster_url = '/images/posters/2024-05-16.jpg' WHERE evidence_id = 'HAV-015';
      UPDATE entries SET duration_seconds = 20, transcript = E'He emailed me. Not a text -- an email, like it''s 2009. Because he says the phone feels too risky. He''s right. It is.

I read it four times. I''m going to reply in the morning, when I''m thinking straight. And I already know what I''m going to say, which is the problem. I have a husband. I have a whole life. I keep saying that like it''s a spell that''ll work if I say it enough times.', poster_url = '/images/posters/2024-06-21.jpg' WHERE evidence_id = 'HAV-016';
      UPDATE entries SET duration_seconds = 20, transcript = E'Arjun forwarded the flight booking for the trip. He''s excited. He''s been planning it for weeks, sending me links to places to eat.

I''m going to go, and I''m going to have a good time, and I''m going to be the person he thinks he''s married to. That''s a promise. To this camera. Which is a strange thing to make promises to.', poster_url = '/images/posters/2024-07-01.jpg' WHERE evidence_id = 'HAV-017';
      UPDATE entries SET duration_seconds = 19, transcript = E'Thursday happened. I told Arjun I had a work thing. I''m getting good at saying that. Which is the part that scares me. Not the rest of it.

N. wants to talk about what this is. I told him not to label it. I can''t hold a label right now. I can barely hold my own face together at dinner. I''m not a bad person. I''m a person doing a bad thing. And I know the difference. I''m not sure the difference matters.', poster_url = '/images/posters/2024-07-19.jpg' WHERE evidence_id = 'HAV-018';
      UPDATE entries SET duration_seconds = 19, transcript = E'Normal day. Sprint review, Divya was happy. Bruno stole a chapati off the counter.

I''m recording the normal days on purpose. I''ve noticed the not-normal ones are starting to pile up in here. I don''t want this to become a place where I only talk when something''s wrong.', poster_url = '/images/posters/2024-08-06.jpg' WHERE evidence_id = 'HAV-020';
      UPDATE entries SET duration_seconds = 20, transcript = E'N. says stop. He said it twice, in writing. Then he said we shouldn''t talk about this here, delete the thread. I did. Sort of. I trashed it.

I know he''s scared for me. I know he''s probably right. But he didn''t know Dad. He doesn''t know what it''s like to sign a form that says ''accident'' and spend six years pretending you believed it.', poster_url = '/images/posters/2024-08-17.jpg' WHERE evidence_id = 'HAV-023';
      UPDATE entries SET duration_seconds = 20, transcript = E'Bruno''s hip thing again. X-rays fine. He''s just getting old. Like the rest of us.

Sixteen thousand rupees to be told my dog is dramatic. Worth it. Moving on.', poster_url = '/images/posters/2024-08-19.jpg' WHERE evidence_id = 'HAV-024';
      UPDATE entries SET duration_seconds = 20, transcript = E'Wrote to the police. A proper letter. Formal, polite -- ''to whom it may concern'', the whole thing. Asking for the full file. The joggers'' statements. The phone records they never pulled. Then I didn''t send it. It''s sitting in drafts.

Because whoever emailed me knows I''m looking. And a request from Ravi Sharma''s daughter is a flare going up. I''ll go and find the jogger myself instead. Her name''s in the statement. Next week. I''ll take leave.', poster_url = '/images/posters/2024-08-23.jpg' WHERE evidence_id = 'HAV-026';
    END IF;
  END LOOP;
END $mig$;
