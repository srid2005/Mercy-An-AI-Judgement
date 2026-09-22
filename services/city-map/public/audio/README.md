# public/audio -- the band memo (SW-06)

What is in this folder is the voice memo Meera left on her PulseFit band in
the cave on Kettle Hill: evidence `SW-06`, 41 seconds in the story, the
recording in which she names Nikhil Rao. When the drone sweep of the cave
comes back with the trace, MERCY extracts the memo from the band in an
overlay on the map and gives the participant a player for it, and the memo
has to be played before Vehicle tracking unlocks. The overlay fetches the
audio from `GET /audio/SW-06-band-memo` and the transcript cues from
`GET /audio/SW-06.json`, both served by `server.js`.

## SW-06-band-memo.wav is a placeholder

The file here is not a recording of anyone. It is the SW-06 transcript
synthesised with Windows text-to-speech and then degraded to sound like a
band's pinhole microphone in a cave: band-limited, a little noise, a little
room. It exists so the beat plays end to end before the real recording is
made; it runs 48.6 s because the voice is slower than the memo's 41 s.

## Replacing it

Drop the real recording in this folder as `SW-06-band-memo.m4a`, `.mp3` or
`.wav` (`.ogg` also works). The route `/audio/SW-06-band-memo` serves the
first that exists in the order **m4a, mp3, wav, ogg**, so an `.m4a` or `.mp3`
beside the placeholder wins over it and the placeholder can stay or go; a
real `.wav` simply overwrites it. Nothing in the page names the extension.

## SW-06.json -- the cues

```
{
  "evidence_id": "SW-06",
  "title": "Voice memo · PulseFit Band 3",
  "recorded_label": "02:15",
  "duration_s": 48.6,
  "cues": [ { "t": 0.6, "text": "[whisper] It's Meera. Meera Sharma. ..." }, ... ],
  "placeholder": "..."
}
```

`cues` is the transcript in lines: `t` is the second, from the start of the
file, at which that line starts and is shown, `text` is the line. The lines
are the transcript, and the transcript is canonical in one place only -- the
`SW-06` row in `services/mercy-engine/db/init.sql` (`content.transcript`) --
so the words here must match it; what changes is the timing. When the real
recording is in, listen through it and set each `t` to where that line
starts, set `duration_s` to the file's real length (41 s in the story), and
delete the `placeholder` line so nothing treats the file as a stand-in.
Stage directions in square brackets -- `[whisper]`, `[breath]`, `[gravel]`,
`[recording ends]` -- are part of the transcript and stay.

The voice brief for the real recording -- the script with timings, the voice direction and the band-microphone treatment -- is `../../BAND_MEMO_AUDIO.md`.
