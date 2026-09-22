# MERCY -- The band memo (SW-06)

_Meera's voice memo, recorded on her PulseFit band at 02:15 on the floor of the cave on Kettle Hill and recovered by the drones. One file. Saved as **services/city-map/public/audio/SW-06-band-memo.m4a** (or .mp3 / .wav -- the route `GET /audio/SW-06-band-memo` serves the first that exists, in that order). **The real recording is in place** (`SW-06-band-memo.mp3`, 2 min 7 s); what follows is the brief that made it, kept for a re-take._


## What it is for

After the cave sweep, MERCY "extracts the band's memory" on the map and hands the participant a player: this recording. The transcript is written out line by line as the audio reaches each cue (`public/audio/SW-06.json`), Vehicle tracking unlocks on the first play, and the same file plays on the judge's SW-06 evidence card. It is the moment the participant hears, in her own voice, that it was Nikhil and not Rahul -- the one piece of evidence that turns the whole case. Everything about it should sound like it cost her something to make.


## The voice

Meera Kapoor (née Sharma), 28, Bengaluru. Indian English with a Bengaluru accent, the same voice as the Haven diary films (use a clean 20-30 s stretch of one of those -- HAV-020 "Normal day" or HAV-024 "Vet" are the steadiest -- as the reference for a voice clone; if the generator takes a description instead, use the one below).

> A young Indian woman in her late twenties, Bengaluru accent, naturally low and warm voice, speaking Indian English -- but here **whispering, close to the microphone, exhausted and drugged**: she was sedated hours ago and is fighting to stay awake, so the words come slowly, some run together, some are swallowed, the sentences are short and she loses the thread once or twice and comes back to it. Frightened but not screaming -- she is trying to be quiet because he is nearby, turning the car round outside. Breath is audible. Her mouth is dry. Toward the end she is fading and the last word does not finish.

Do not let it sound like a performance: no polished diction, no sobbing for effect, no reverb-drenched "dramatic" read. It is someone leaving a note.


## The script

The words are canon (they are the SW-06 transcript in `mercy-engine/db/init.sql`; the console shows them). Say them as written, including the stumbles. Bracketed notes are direction, not spoken. Times are targets; the cues in `SW-06.json` are re-timed to the final take.

```
0:00  [a breath; fabric moving; she is very close to the mic]
0:01  It's Meera. Meera Sharma.
0:04  I don't know what time it is -- two, maybe.
0:07  If anyone gets this -- Arjun, if you get this -- it wasn't Rahul.
0:11  Rahul came to the door to tell me. About Dad.
0:14  About who lied for him that morning.
0:17  And I ran from him. I ran to Nikhil's car.
0:20  [a shaky breath in]
0:21  It's Nikhil. Nikhil Rao.
0:23  He was Rahul's alibi in 2018. The emails were him.
0:26  The church, the auditorium, the vet's, the park -- I kept pressing the band.
0:30  He gave me something at the vet's. I can't stay awake.
0:33  [gravel; she shifts] We're in the cave from the photos. He's turning the car round.
0:36  He said he's moving me somewhere nobody will look.
0:38  I'm leaving the band. I'm leaving my jacket so you know it was me.
0:40  It's Nikhil. Not Rahul. Nikh--
0:41  [cut: the recording ends mid-word]
```

Performance notes, line by line:

- **"It's Meera. Meera Sharma."** -- flat, factual, the way you give your name to a machine. She uses her maiden name because this is for her father's case as much as for her.
- **"two, maybe."** -- genuinely unsure; a small pause before *maybe*.
- **"Arjun, if you get this"** -- the only place her voice nearly breaks. Then she steadies it for *it wasn't Rahul*, which is the line she needs to land.
- **"About Dad. About who lied for him that morning."** -- slower, each phrase a separate effort.
- **"I ran to Nikhil's car."** -- quiet, almost ashamed.
- **"It's Nikhil. Nikhil Rao."** -- the clearest, most deliberate line in the recording: she spells it out so there is no mistake. Say the surname carefully.
- **"I kept pressing the band."** -- a flicker of something like pride; then it goes.
- **"I can't stay awake."** -- the words are starting to slur here and stay that way to the end.
- **"He's turning the car round."** -- urgent, whispered faster; she can hear the engine.
- **"so you know it was me."** -- tender, for Arjun.
- **"It's Nikhil. Not Rahul. Nikh--"** -- one more try to make sure it is on the record, and she does not get to the end of the name. The file stops there: no fade, a hard cut.


## The recording -- what a band microphone in a cave sounds like

Generate the voice clean first (a dry, close, whispered take, mono, 44.1 or 48 kHz), keep that master, then treat a copy so it sounds like it came off a smartwatch:

1. **Band microphone:** band-limit to roughly 300 Hz - 3.4 kHz (a gentle high-pass and low-pass, not a brick wall), mild compression, a little clipping on the loudest consonants, a faint constant hiss.
2. **The cave:** a short, dead, stony room -- almost no reverb, just a slight boxiness; the odd scrape of gravel and fabric against the mic (it is on her wrist, by her face).
3. **Outside:** very faintly, an idling car engine and, near 0:33, the engine note changing as it turns; no wind, no birds, no music.
4. **Damage:** two or three brief dropouts of 50-150 ms in the second half (the band was at 3% and being handled), and a hard cut at 0:41 with no fade.
5. Level: peaks around -3 dBFS, the whispers well above the noise floor -- the participant listens on laptop speakers in a hall.

From a clean master `memo-clean.wav`, this ffmpeg line does 1, 2 (the boxiness) and the hiss in one pass; add the dropouts and the engine in an editor:

```
ffmpeg -i memo-clean.wav -af "highpass=f=300,lowpass=f=3400,acompressor=threshold=-18dB:ratio=3:attack=5:release=80,aecho=0.8:0.4:12:0.25,volume=1.4,alimiter=limit=0.9" -ac 1 -ar 22050 -c:a aac -b:a 64k SW-06-band-memo.m4a
```

Export mono, AAC (.m4a) or MP3. Drop it into `services/city-map/public/audio/` and delete the placeholder `.wav`; then re-time the `t` values in `SW-06.json` to the take (or hand the file over and it is re-timed for you), and rebuild `city-map`.


## Negative direction

No music, no cinematic reverb, no radio filter with sci-fi crackle, no screaming, no crying that swallows the words, no calm narrator tone, no British or American accent, no man's voice, no second voice, no words that are not in the script, no fade-out at the end.
