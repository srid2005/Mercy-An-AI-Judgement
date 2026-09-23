# Poster assets -- what the event already owns

_Everything below was made for this game (AI-generated or drawn for it), so it can go on the poster without a licence question. Paths are relative to the repo root; sizes are pixels. A poster at A2 needs ~300 dpi for photos held large -- the drone frames, the case photos and the logos are the only things here big enough to run edge to edge; everything else is for inset, texture or small use._

## 1. Hero / mood -- the pieces that say "this is a mystery"

| Asset | Path | Size | Notes |
|---|---|---|---|
| The angel (MERCY) | `services/mercy-lobby/public/media/angel.png` | 1254² | Stone angel, arms raised, on white; the lobby reveals **MERCY · AI JUDGEMENT** over it. The natural centrepiece -- knock out the white, put it on the chamber black/amber. |
| Lady Justice | `services/mercy-console/public/img/mercy/justice.png` | 606×1011 | The console's chat background. Small for print; fine as a translucent watermark. |
| Drone frames (65) | `services/city-map/public/images/drone/**` (originals `source-media/drone_shots/**`, 1672×941 PNG) | 1599×900 | Night aerial / thermal / ground shots: the cave (`kettle-cave/`), the four SOS sites (`sos-1..4/`), thermal "found" frames (`stop-*-found/01-thermal`). Cold blue-black, drone lamp white -- the look of the investigation. Best for a full-bleed background or a filmstrip. |
| Case-file photographs (5) | `source-media/case photos/photo-1-rock.png` … `photo-5-gate.png` (also `services/mercy-engine/public/case-photos/`) | 2400×1792 | Sunset Rock, the ledge, the base, the effects on a cloth (the blue carabiner), the forest gate and register. Evidence-board texture; the effects photo is a strong detail crop. |
| The cave, childhood | `services/social-media/public/images/posts/cave-1.png`, `cave-2.png` | 1402×1122 | "Our kingdom" -- Kettle Hill's cave in 2009 sunshine, before it meant anything. |

## 2. Faces (only if the poster names the cast; keep Nikhil off it -- he is the twist)

| Who | Path | Size |
|---|---|---|
| Meera Kapoor | `services/haven/public/images/avatars/meera.png` (1254²), `services/social-media/public/images/avatars/meera.jpg` (735×919), Haven film stills `services/haven/public/images/posters/*.jpg` (960×540, 30 of them) | The missing woman. The diary stills -- her talking to a webcam at night -- are the most "true crime" of anything here. |
| Arjun Kapoor | `services/social-media/public/images/avatars/arjun.jpg` (736×1212), `services/whatsapp/public/images/avatars/arjun.jpg` | The accused -- the participant. |
| Ravi Sharma | `source-media/case photos/ravi sharma.jpg` (736×927) | The father, 2018. |
| Rahul, Priya | `services/social-media/public/images/avatars/rahul.png`, `priya.png` (1254²) | Supporting. |

## 3. Brand marks

| Mark | Path | Notes |
|---|---|---|
| MERCY wordmark | text only: **MERCY** in Manrope 700, letter-spaced, with **AI JUDGEMENT** in Share Tech Mono beneath (the console, lobby and map all set it this way); the map's small round mark is `services/city-map/public/images/mercy-map.svg` | No raster logo exists -- set it in type. |
| App logos (icon-only, transparent) | Quill `services/email/public/images/quill-logo.png`, Wisp `services/whatsapp/public/images/wisp-logo.png`, Haven `services/haven/public/images/haven-logo.png`, Orbit `services/desktop-shell/public/img/icon/orbit.png` (256² each; 1254² originals with wordmarks in `source-media/APP Logos/`) | A row of "the apps you will search" -- Loop has no logo yet. |
| PulseFit | `services/desktop-shell/public/img/icon/pulsefit.png` (app icon) | The band that sent the five SOS alerts. |

## 4. Evidence texture -- small, layered, torn

| Asset | Path | Use |
|---|---|---|
| The police file | `services/case-files/FATHER_DEATH_CASE.unlocked.pdf` (5 pages, vector: stamps, redactions, the CLOSED -- ACCIDENTAL DEATH stamp, the gate register table) | Export a page at 300 dpi; the "CLOSED" stamp and the register rows are strong graphic elements. |
| Boarding pass, Kunal Studios card, the café photo | `services/email/public/images/attachments/{boarding-pass,camera-reference,personal-photo}.jpg` (1024-1448 px) | Scattered evidence. |
| Trail Diaries posts | `services/social-media/public/images/posts/td-2018.png`, `td-gate.png`, `td-rock.png`, `td-tags.png`, `rahul-trek.png` | The blue carabiner and its 2018 tag. |
| Family | `services/social-media/public/images/posts/family-dad-1.png`, `family-dad-2.png`, `wedding.png`, `tagged-forever.png` | The life before. |
| The laptop's protected folder | `services/desktop-shell/public/files/photos/camera/*.jpg` (1402×1122 and 1312×1199) | Same photos as Loop, as camera files. |

## 5. Screens (capture from the running game -- ask and they are rendered at 1920×1080 or 4K)

- The console: the guilt HUD at **96.8%**, the amber chips, the chamber.
- The city map: the blueprint city with the four drones out and a search ring, or the cave.
- The band memo player over the map: **EXTRACTING BAND MEMORY**.
- The lobby: the angel reveal.
- Haven: the diary grid; Quill: an inbox with the anonymous mail.

## 6. Copy -- lines the game already says

- **MERCY · AI JUDGEMENT**
- **The file stands at 96.8%.**
- **You are Arjun Kapoor. Your wife Meera disappeared last night at 21:40. The file says you did it.**
- **I am MERCY. I decide.**
- **Her laptop is yours. Her messages, her mail, her diary, her band, the city's cameras and four drones.**
- **Argue. Every piece that holds moves the needle.**
- **You have 60 minutes. Find her, and the file closes. Fail, and it stands.**
- **FILE UDR 0412/2018 · CLOSED -- ACCIDENTAL DEATH** (the father's case, the number on every console)
- **It wasn't Rahul.** (do not print -- it is the twist)

## 7. Palette and type (the chamber, from the console's stylesheet)

- Paper `#f7f0e4` · Paper-2 `#ecdcc3` · Ink `#221a10` · Ink-dim `#77694f` · Ink-soft `#a89478`
- Amber `#ffb043` · Amber-2 `#ff8c1a` · Amber glow `rgba(255,150,40,.55)` · HUD text `#f6e2bf` · HUD ground `rgba(34,20,8,.76)`
- Green (alive) `#3fbf7a` · Red (guilt) `#e5533a`
- The map's blueprint: ground `#061a30`, wire `#2a6ea3`, edge `#8fdcff`, drone `#dfeeff`, trace magenta `#ff5fd2`, clue amber `#ffc44d`, tracked car red `#ff2a1e`
- Type: **Manrope** (400-700) for words, **Share Tech Mono** for numbers, IDs and HUD labels (both on Google Fonts); Inter inside the phone-style apps.

## Do not use

- The *Mercy* film still (Rebecca Ferguson) that was the HUD reference -- a copyrighted frame, not ours.
- The laptop's Windows-style wallpapers and store art (`services/desktop-shell/public/img/wallpaper/**`, `img/store/**`, `img/oobe/**`) -- third-party assets from the win11React base.
- The `source-media/affair photos` folder (the intimate set) -- not for a public wall.
- The placeholder SVGs still in Loop (`social-media/public/images/posts/*.svg`) and the synthesised band-memo waveform -- placeholders.
