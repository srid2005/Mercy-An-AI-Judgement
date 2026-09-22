# MERCY -- Rescue video shot list

_One file, seven shots, 16:9, with sound. Saved as services/city-map/public/video/rescue.mp4. **The film is in place** (1:07, 720p, 29 MB, faststart); what follows is the shot list it was made from, kept for a re-cut._


## What this video is for

The chase ends at one of Nikhil's six stops -- the one drawn at random into `app_config.truth_stop` when the volume is seeded, never sent to the browser -- where the drone search comes back `found`. The map shows the drone frames for that stop as it always does, and then MERCY comes into play: the rescue. The page fetches **/video/rescue** and plays it full-frame over the model, then shows its own CASE SOLVED card and tells the console the case is closed. This document is the shot list for that file: the six shots in order, each with the caption the participant reads over it, the AI video prompt to generate it and a description of what to find on a stock-footage site instead.


### Where the file goes

**services/city-map/public/video/rescue.mp4**. The server route `GET /video/rescue` serves the first of `rescue.mp4`, `rescue.webm`, `rescue.mov`, `rescue.ogv` that exists in that folder, so the file name is the contract; nothing else needs to change. When none of them exists the route answers 404 and the page plays a generated placeholder in its place -- a canvas sequence in the model's own palette (a thermal approach, the entry, the card) -- so the game is complete without the file, only less good.


### Format

- 30 to 45 s in total. The seven shots below add up to about 41 s at their suggested lengths; the card at the end can absorb slack.
- 16:9, **1280x720**, **H.264 MP4** (`yuv420p`, `+faststart` so it plays before it has finished downloading). WebM (VP9) is accepted too.
- **20 MB or less.** At 1280x720 a 35 s clip at 3 to 4 Mbit/s lands at 13 to 18 MB; if it is over, drop the bitrate before the resolution.
- **Sound matters in this cut**, because shot 6 is the only place in the whole game where Meera is heard speaking normally -- the band memo is a drugged whisper, and this answers it. Keep the night (shots 1 to 5) to rotors, radio, rain and the ambulance, no music; shot 6 carries her line, clean and close, over quiet room tone. The page plays the file unmuted; if a browser refuses to start audio on its own it shows a PLAY button instead, so nothing is lost. A silent cut still works -- the film just loses its best moment.
- No leader, no black at the head: the first frame is the first shot. A fade to black over the last second of the card is fine.

From any edit, this produces the right container:

```
ffmpeg -i cut.mov -vf scale=1280:720 -c:v libx264 -preset slow -crf 23 -pix_fmt yuv420p -movflags +faststart -c:a aac -b:a 96k rescue.mp4
```


### Rules the cut must keep

This is the one place in the game where people appear on camera, and they appear the way MERCY would see them: at a distance, in thermal, through a torch beam, from behind an officer's shoulder. **Meera is never a clear face during the rescue itself** (shots 1 to 5) -- turned away, under the blanket, out of focus, or a heat signature -- so the drone frames' rule (the drones see heat, not a person) carries through the night. The exception is the last shot, in daylight at the hospital: after the night is over she is finally a person, awake and talking, and her face may be seen -- use the same reference as the Haven diary films so it is recognisably her. **Nikhil Rao is a man in his thirties at a car**, seen from the drone or over the officers: no dialogue, no mugshot close-up. **Arjun's name is never shown or spoken**: the participant is Arjun, and the card that ends the game is the map's, not the video's, so the video's own card (shot 6) says what happened and stops there. No text anywhere in the picture except the number plate in shot 5 and the card in shot 6. The captions listed below are burnt in as lower thirds in the map's monospace style -- the page does not add its own -- and they state nothing the search result text does not.

**The building is generic on purpose.** The same clip plays whichever of the six stops turns out to be the truth, so the place in shots 1, 2 and 4 is any low building at the side of a road with a dark hill behind it: not recognisably a stadium, a chapel, a market hall or an office block. Keep it to a single storey or two, a yard, a rear door.


## Style


### Continuity with the drone frames

The drone frames (`DRONE_FOOTAGE.md`) set the look, and this is the same night a few minutes on: overcast, no moon, cold and desaturated, blacks true black, the drones' own white LED lamps as the key light, street lighting sodium amber, thermal in the white-hot palette with soft edges and no overlay. The map behind it is a blueprint -- dark blue ground, cyan wire buildings, orange search rings, amber lamps -- so the grade should lean **blue-black in the shadows and amber in the lights**, and nothing in it should be a false-colour rainbow thermal. The one deliberate break is the last shot: the hospital in the morning is warm, bright and clean, and the cut should feel the temperature change -- hold a beat of black between shot 5 and shot 6 so the daylight lands. Emergency lighting is amber (hazards, beacons, the ambulance's side lights) with blue allowed; keep red from flooding the frame. Consumer-drone image quality throughout: 24 mm equivalent, high ISO grain, slight motion softness, mild vignette, chromatic fringing on the lamps. No HUD, no crosshair, no timestamps, no logos.


### AI base prompt -- append this paragraph to every AI prompt below

> This is real footage captured tonight by police surveillance drones and body-worn cameras during a rescue in the city of Meridian, not a render, not an illustration, not a game. Night, overcast, no moon. Drone shots from 30 to 60 m at a steep angle with the drone's own white spotlight as the key light; ground shots from a body-worn or handheld camera with torchlight as the key light. Consumer image quality: 24 mm equivalent, high ISO, fine luminance grain, slight chromatic fringing on highlights, mild vignette, motion softness. Colour: cold and desaturated, blue-black shadows, drone lamps white, street lighting sodium amber, emergency beacons amber, everything outside the light falling to true black. Mood: urgent but controlled, forensic, quiet. NEGATIVE: no readable text, no captions, no timestamps, no watermarks, no logos, no HUD or crosshair, no daylight, no dawn, no lens flare stars, no slow-motion, no music-video look, no CGI or render look.


### Thermal note -- applies to shots 1 and 3

> Long-wave infrared from the drone's FLIR-style camera in a white-hot palette: hottest surfaces pure white, warm mid-grey, cold near black, no false colour. Soft edges and low resolution, as if a 640x512 sensor was upscaled, gentle vignette, slight noise, no on-screen data, no reticle, no temperature scale. Shot 1 shows engine blocks, exhausts and one faint warm window; shot 3 shows exactly one human heat signature, blurred and featureless, plus the medic's warmer hands and torch. No face, no clothing detail, no identifying feature in thermal, ever.


## Shots


### 01 -- APPROACH -- drone thermal over the building (7 s) -- AI

**Caption:** Four drones on station. Units two minutes out.

**AI PROMPT:**

> Aerial thermal footage from a police drone at 50 m, white-hot palette, slow forward drift and a gentle descent toward a low single-storey building beside a dark road at the foot of a hill, a walled yard behind it. Three other small quadcopters hold position around the building, each a bright hot point with a faint downward cone of light. Along the road two, then three police vehicles arrive with amber beacons rendered as pulsing white blooms in thermal, engines and exhausts glowing, and stop at the kerb. One window of the building is faintly warm; everything else is cold grey and black. The camera settles above the yard and holds. 7 seconds. NEGATIVE: no people in the open, no faces, no false-colour rainbow palette, no text, no crosshair, no temperature scale, no timestamp, no watermark, no daylight, no CGI look.

**STOCK -- search for:**

> Search: thermal drone footage night police vehicles arriving building aerial infrared white hot || Must be in frame: an aerial thermal (greyscale or white-hot) clip of vehicles arriving at a low building at night, engines glowing, no crowd, no person-shaped signatures in the open, no on-screen telemetry. Add the three drone lights as small white points in post if the clip has none.


### 02 -- ENTRY -- back door, torchlight (5 s) -- AI

**Caption:** Entry team at the rear door.

**AI PROMPT:**

> Body-worn camera footage, handheld, night, behind two police officers in dark tactical jackets approaching a plain rear door at the back of a low building, the yard wet, torches on their weapons and helmets the only light, hard white beams sweeping across peeling paint, a padlock hasp and a new sliding bolt on the outside of the door, breath in the cold air, a drone's white spotlight sliding across the yard from above. The lead officer draws the bolt and pushes the door in; the beams go inside; darkness beyond. Shoulders and backs only, no faces to camera. 5 seconds. NEGATIVE: no faces, no visible name tapes or badges, no readable text, no daylight, no gunfire, no shouting mouths visible, no CGI look, no HUD.

**STOCK -- search for:**

> Search: police entry team night rear door torch flashlight body camera POV || Must be in frame: officers seen from behind approaching and opening a door at night by torchlight, backs to camera, no readable insignia, no faces, no daylight. Crop out any watermark or agency name.


### 03 -- FOUND -- the woman on the mattress (6 s) -- AI

**Caption:** One person. Alive. Medic with her.

**AI PROMPT:**

> Two views cut together. First 3 seconds: thermal from a small quadcopter hovering inside a bare room, white-hot palette, a single bright blurred human heat signature lying curled on a mattress on the floor, warmth spreading into the mattress, and a second warmer shape -- a kneeling medic -- entering frame with a bright hot torch and hands, no faces, no detail. Cut. Next 3 seconds: visible light from a body-worn camera, torchlit, the same bare room, a paramedic in a green jacket kneeling beside a mattress on the floor, one gloved hand on the shoulder of a woman lying on her side with her back to the camera under a grey blanket, her dark hair across the pillow, her face turned away and out of frame, the medic's torch on her hand as her fingers move. Dust in the beam. Quiet. 6 seconds. NEGATIVE: no clear face, no eyes to camera, no blood, no injury detail, no restraints shown, no readable text, no daylight, no CGI look, no HUD.

**STOCK -- search for:**

> Search: paramedic kneeling beside person lying on floor flashlight night indoor rescue || Must be in frame: a medic or first responder kneeling by someone lying on a mattress or floor in a dark room lit by torchlight, the patient's face turned away or covered, no blood, no daylight. For the thermal half, search "thermal camera person lying indoors infrared" and use only a clip with a single blurred signature.


### 04 -- OUT -- carried to the ambulance (6 s) -- AI

**Caption:** Meera Kapoor, out. Breathing on her own.

**AI PROMPT:**

> Handheld night footage from the yard of a low building beside a dark road, sodium amber street lamp, an ambulance at the kerb with its rear doors open and amber side lights pulsing, two paramedics carrying a woman on a scoop stretcher wrapped to the chin in a crinkled silver foil blanket, her head turned into the blanket so her face is not visible, one hand out of the foil, a police officer walking alongside with a torch, a drone's white spotlight tracking the group from above, the foil flashing in the light. They reach the doors and lift her in. Grain, slight shake, cold air. 6 seconds. NEGATIVE: no clear face, no name on any vehicle or jacket, no readable text or number plates, no blood, no crowd, no daylight, no CGI look, no HUD.

**STOCK -- search for:**

> Search: patient foil blanket stretcher loaded into ambulance night emergency lights || Must be in frame: a person under a foil or silver survival blanket on a stretcher being carried or wheeled to an ambulance at night, face not visible, amber or blue lights, no readable livery or number plate. Blur any livery or plate in post.


### 05 -- DETAINED -- Nikhil Rao at the i20 (5 s) -- AI

**Caption:** Nikhil Rao. Detained at the vehicle. KA 05 MN 4471.

**AI PROMPT:**

> Aerial night footage from a police drone at 30 m, its white spotlight the key light, looking down at a steep angle at a grey Hyundai i20 hatchback stopped askew on a dark road with its driver's door open and headlights still on, two police vehicles blocking it nose to nose with amber beacons pulsing, and beside the car an Indian man in his thirties in a dark jacket held against the rear door by two officers, his hands behind his back, his face turned down and away from the camera. The drone drifts slowly around the scene and the spotlight settles on the back of the car so its number plate is square to the camera and lit. Rain on the road. 5 seconds. NEGATIVE: no clear face to camera, no violence, no weapons drawn, no readable text other than the plate, no watermark, no daylight, no CGI look, no HUD.

**STOCK -- search for:**

> Search: police arrest man beside car night aerial drone flashing lights hatchback || Must be in frame: a man held by officers beside a small grey hatchback at night, seen from above or at a distance, face not readable, no readable plate (it is replaced in post), amber or blue beacons, no daylight.

**Note on the plate.** Video generators cannot be trusted with text. Generate or shoot the car with a blank or unreadable plate and composite the plate in post: an Indian private plate, white ground, black characters, reading **KA 05 MN 4471**, tracked to the rear of the car for the last two seconds of the shot while the spotlight holds on it. If that is more than the edit can take, hold the last frame as a still with the plate legible and let the caption carry the number.


### 06 -- AFTER -- the hospital, morning (8 s, she speaks) -- AI

**Caption:** Meridian General, 09:10. Recovering. Talking.

The night ends and the film lets go of it: the only warm, bright, quiet shot in the cut, the only one where Meera has a face, and the only one where she speaks in her own voice -- awake, hoarse, amused, asking for her husband. Everything before it has been a machine's view of her: a heat signature, a shape under foil, a whisper on a dying watch. No police, no drones, no thermal -- daylight through a window, a doctor at the bedside, a woman who is going to be all right.

**What she says.** Same voice as the band memo and the Haven diary films (clone from the same reference, so it is recognisably her) -- but the opposite of the memo: warm, dry-throated, a little hoarse from the sedative, and cheerful. Lip-sync matters here; generate the shot with the line so the mouth matches, or shoot it silent and dub the line over it in the editor.

```
0:00  DOCTOR (gently, half off-camera):  How are you feeling?
0:02  MEERA (a small laugh):             Like I slept for a week.
0:04  MEERA:                             I'm fine. Really.
0:06  MEERA (looking to the door):       Is Arjun here? Can he come in?
```

Shorter alternative if eight seconds is tight: drop the doctor's line and open on *"Like I slept for a week."* Whatever is used, the last thing she says must be about Arjun -- the participant has spent twenty-five minutes being accused of killing her, and this is the film telling them she never thought it was him.

**AI PROMPT:**

> Warm daylight hospital footage with sound, handheld and steady, a private room in an Indian hospital in the morning, soft sunlight through a half-open blind falling across the bed. A young Indian woman in her late twenties [match the reference photo for face and hair], propped up on pillows in a pale hospital gown with a blanket over her legs, hair loose and unbrushed, a cannula taped to the back of her hand, a pulse-oximeter clip on one finger and a monitor beside the bed showing a steady rhythm. She looks tired but well. A doctor -- a woman in her forties in a white coat with a stethoscope -- sits at the bedside with a clipboard, leaning in, and asks gently, "How are you feeling?" The young woman gives a small hoarse laugh and answers, speaking Indian English with a Bengaluru accent, her voice tired and warm and amused: "Like I slept for a week." A beat, still smiling: "I'm fine. Really." Then she looks past the doctor toward the door and asks, hopeful: "Is Arjun here? Can he come in?" The doctor smiles and nods. Realistic lip-sync and natural micro-movements, clear close dialogue over quiet room tone, no music. A glass of water and a small bunch of flowers on the side table. The camera drifts slowly closer and holds on her as she speaks. 8 seconds. NEGATIVE: no blood, no injuries, no bruises, no oxygen mask, no ventilator, no crying, no shouting, no police, no uniforms, no night, no thermal, no music, no subtitles or captions, no readable text on charts or monitors, no hospital name or logo, no watermark, no CGI look.

**STOCK -- search for:**

> Search: patient smiling talking to doctor hospital bed morning sunlight recovery || Must be in frame: a young woman sitting up in a hospital bed in daylight, talking and smiling with a doctor at the bedside, calm and unhurried, no distress, no visible injuries, no readable hospital branding. Grade it warm to match the AI shot. Stock has no usable dialogue: record or generate the four lines separately in Meera's voice and lay them over a clip whose mouth movements roughly fit, or keep the camera off her face while she speaks.


### 07 -- CARD -- MERCY caption card (4 s) -- built in the editor

**Caption:** SUBJECT LOCATED -- ALIVE / NIKHIL RAO -- DETAINED / MERCY -- search concluded

No footage: a title card made in the editor in the map's own style. Black background, the three lines above in a monospace face (the map uses the system monospace; JetBrains Mono or Consolas match), cyan-white text on the first two lines, dimmer grey-blue on the third, a thin one-pixel rule between the second and third lines, letter-spaced, left-aligned at a third of the frame width. Lines type on one after the other over the first two seconds, hold, then fade to black over the last second. No logo, no "case solved", no verdict, no Arjun: the map's CASE SOLVED card and the judge's closing line follow the video and say the rest.


## Appendix -- shot table

| # | Shot | Length | Source | Caption |
|---|---|---|---|---|
| 01 | Drone thermal approach, drones and units | 7 s | AI | Four drones on station. Units two minutes out. |
| 02 | Entry team, rear door, torchlight | 5 s | AI | Entry team at the rear door. |
| 03 | Thermal then torchlight: woman on mattress, medic | 6 s | AI | One person. Alive. Medic with her. |
| 04 | Foil blanket to the ambulance | 6 s | AI | Meera Kapoor, out. Breathing on her own. |
| 05 | Nikhil Rao detained at the grey i20, plate | 5 s | AI + plate composite | Nikhil Rao. Detained at the vehicle. KA 05 MN 4471. |
| 06 | The hospital next morning: Meera awake, speaking -- "Is Arjun here?" | 8 s | AI (with dialogue) | Meridian General, 09:10. Recovering. Talking. |
| 07 | MERCY caption card | 4 s | Editor | SUBJECT LOCATED -- ALIVE / NIKHIL RAO -- DETAINED / MERCY -- search concluded |
| | Total | 41 s | | |
