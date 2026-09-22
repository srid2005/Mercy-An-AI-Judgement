# The band memo

`SW-06-band-memo.mp3` is the real recording: Meera's voice memo on her PulseFit
band, 02:15, recovered from the cave on Kettle Hill -- evidence `SW-06`, 2
minutes 7 seconds. The route `GET /audio/SW-06-band-memo` serves the first of
`SW-06-band-memo.m4a`, `.mp3`, `.wav`, `.ogg` that exists here, so a newer take
can be dropped in as `.m4a` and it wins without any code change. The
synthesised placeholder that stood in until now has been deleted.

`SW-06.json` is what the map's memo card reads: `{ evidence_id, title,
recorded_label, duration_s, cues: [{ t, text }] }`. The cue texts are the
canonical transcript (the same words as the `SW-06` row in
`mercy-engine/db/init.sql`); each line is written out on screen when the audio
passes its `t`. The current `t` values were fitted to this recording from its
phrase boundaries -- if a line lands early or late, nudge that one number.

The voice brief that produced it -- the script with timings, the voice
direction and the band-microphone treatment -- is `../../BAND_MEMO_AUDIO.md`.
