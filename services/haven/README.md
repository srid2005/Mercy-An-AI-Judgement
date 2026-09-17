# haven (implemented)

Haven -- Meera's private cloud video diary. The app whose registration email
sits starred in Quill. Owns every daily recording she backed up, including
the final one the laptop never had a local copy of (she was taken minutes
after it uploaded). This is the `cloud` service from `/ARCHITECTURE.md`,
built under its in-world name.

- Evidence prefix: `HAV-` (one id per recording, `HAV-001..031`, chronological)
- Own DB (`haven-db`): `users`, `entries` (recording, transcript, mood, tags,
  backup time), `security_questions`, `login_codes`, `app_config`
- REST API + `/api/evidence` gated by `x-mercy-key`, same shape as the other
  services. Each record is `type: "video_entry"` and carries the full
  transcript, so MERCY can read the diary without the player ever unlocking it.

## Sign-in (two real steps, no password)

Haven never sees your password and can't reset it -- so recovery is:

1. **One-time code by email.** `POST /api/auth/request-code` generates a
   6-digit code and delivers it as a real email into Quill (via Quill's
   `x-internal-key` endpoint, sender "Haven"). The player has to go read it
   there. Codes expire in 10 minutes and are single-use.
2. **Three security questions.** Confirming the code returns a short-lived
   `questions`-stage token; the diary token is only issued once all three
   answers match. They're the story's three password beats, so the whole
   cross-app chain has to be solved to get in:

   | # | Question | Answer (any case/punctuation) | Found in |
   |---|----------|-------------------------------|----------|
   | 1 | Dad's birthday and the place Arjun and I first met -- you know how I combine them. | `1708RoseCafe` | `notes` (planned), echoed in HAV-007/008 |
   | 2 | When did everything change? | `14/10/2018` | social-media lock hint, `case-files`, EML-034 |
   | 3 | The password I've used since school. Rahul still teases me about it. | `NeverForget2018` | SOC-021..024 + the year from the case |

   Answers are compared normalized (lowercase, letters and digits only).

## Replacing the sample recordings

Every entry's `video_url` is `/videos/<YYYY-MM-DD>.mp4` and its thumbnail is
`/images/posters/<YYYY-MM-DD>.svg`. Drop the real recording / still in at the
same path and rebuild -- nothing else changes.

The placeholder `public/videos/sample.mp4` (8s, silent, 640x360) was made
with a Docker ffmpeg image, then copied per entry by `npm run gen:videos`
(which never overwrites an existing file):

```bash
docker run --rm -v "$PWD/services/haven/public/videos:/out" jrottenberg/ffmpeg:4.4-alpine \
  -y -f lavfi -i "gradients=s=640x360:c0=0x132621:c1=0x24594a:c2=0x3fa88a:d=8:speed=0.03:r=24" \
  -f lavfi -i "anullsrc=r=44100:cl=mono" \
  -vf "drawbox=x=24:y=24:w=16:h=16:color=red@0.9:t=fill,format=yuv420p" \
  -t 8 -c:v libx264 -preset veryfast -crf 28 -c:a aac -shortest -movflags +faststart /out/sample.mp4
```

Run via the root `docker compose up --build`; served at `http://localhost:4008`.

## Videos

Eight recordings have real 30-second webcam videos (HAV-019, 021, 022, 025,
027, 028, 029, 030); the rest still play the silent placeholder. The prompts
that made them are in `VIDEO_PROMPTS.md`. For those eight, `transcript` and
`duration_seconds` in the seed and the live database were replaced by the
lines actually spoken, so text and video agree; the original long transcripts
are kept in `db/transcripts-full.backup.json`. HAV-031 (the final recording)
still needs its video, `2024-09-02.mp4`; its transcript stays long until then.
