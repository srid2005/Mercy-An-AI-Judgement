# desktop-shell -- Meera's laptop

The "virtual laptop" the participant works inside. A Windows-11-style desktop
in the browser, forked from [win11React](https://github.com/blueedgetechno/win11React)
(CC0) and cut down to what the story needs. Port **3000**.

The framing: MERCY has imaged the laptop recovered from Meera's flat and
mounted it in a sandbox. The participant (Arjun) unlocks it with the PIN he
knows and works through what she left on it.

## What is on the laptop

| Thing | Where | Notes |
|---|---|---|
| Lock screen | on every load | PIN `1998` (her birth year). The hint "my birth year" is always shown under the field, like a Windows password hint. A PulseFit "5 SOS alerts" card sits on the lock screen -- only once the console has released the trail (`mercy:gates`, after the `the_confession` checkpoint); standalone the shell runs in demo mode (`?sos=0` to see the gated state). |
| PulseFit toasts | after unlock | Five alerts in story order (22:41 St Aldric's Church, 23:27 Auditorium, 00:19 Veterinary Hospital, 01:12 Eco-Park, 02:14 Kettle Hill north face), paced one at a time; each is a cue, not evidence. |
| PulseFit app | desktop icon | The five SOS cards with coordinates and "Copy coordinates", the band's movement log for the night (signal lost 02:16, a 2:07 voice memo stored on the band). Opening it files SW-01..05 as evidence. |
| Quill | desktop + taskbar | The mail client, as a native app window (iframe of port 4002). |
| Orbit | desktop + taskbar | Meera's browser. Loop, Wisp and Haven are reachable **only** through it, from the bookmarks bar, the history page or a typed address. The address bar shows story domains (`loop.social`, `wisp.chat`, `haven.cloud`, `quill.mail`); the real services run on their ports. Every other site shows an "offline / sandbox" page. |
| Orbit history | clock icon / `orbit://history` | Seeded evidence: her searches ("request copy of UDR police file karnataka", "turahalli forest gate guard register", "trail diaries trekking club bengaluru 2018 batch"), Rahul's and Trail Diaries' profiles, Haven at 01:52 the night she vanished. Live browsing is appended. |
| Orbit passwords | key icon / `orbit://passwords` | Saved logins. Revealing one needs the Windows PIN. Loop was never saved; Haven's was removed 12 days ago, so those two stay puzzles. |
| Notes | desktop + start menu | Sticky-Notes-style app, eight notes. The one titled "logins (CHANGE THESE!!)" carries the protected folder's password among wifi and printer logins; the others are groceries, Mum's medicines, the Coorg trip, the district-office plan, things Dad said. |
| File Explorer | desktop + taskbar | `C:\Users\Meera`. `.txt` files open in Notepad. PDFs open in Orbit's built-in viewer. |
| Recycle Bin | desktop + Explorer sidebar | Three of the affair photos (WhatsApp-style `IMG-2024xxxx-WAxxxx.jpg` names), an old to-do, a deleted booking PDF. |
| Hidden folder | `C:\Users\Meera\AppData\Local\.n` | The other seven affair photos. AppData and `.n` are hidden: not listed in their parent folders unless "Hidden items" is ticked in the ribbon. The path is exposed by Explorer's **Recent** list in the sidebar (two of the photos sit there among her other recent files; the case file and the Dad folder are deliberately not listed), and it can be typed into the address bar. |
| Photos | desktop | Image viewer. Opening a picture from Explorer shows it with prev/next through that folder; the desktop icon shows the Pictures gallery (Camera Roll only, hidden folders never appear). Explorer shows real thumbnails for pictures. |
| Pictures | `C:\Users\Meera\Pictures` | `Camera Roll` (14: the old family and dog photographs, and eight of her and Arjun between 2022 and June 2024), `Wedding` (six from 14 February 2021, ending with the register they signed), `Screenshots` (five off her phone: a ride receipt, a gift ordered for Arjun, the dinner she paid for, a hotel booking and a table for Saturday). LAP-PHOTO-17..35, all filler -- they are the ordinary life the file is accusing him of ending. |
| Her papers | `C:\Users\Meera\Documents` | `Resume_Meera.pdf`, `Aadhaar_Copy.pdf`, `Passport.pdf`, `Insurance.pdf`, `Marriage_Certificate.pdf` and `Important_Contacts.docx` (LAP-DOC-07..12). Built by `scripts/build_personal_docs.py` from the two passport photographs in `scripts/assets/`; every name, date and number in them agrees with the case (born 12-03-1998, married 14-02-2021, the Wisp phone numbers). PDFs open in Orbit; there is no Word on this laptop, so the .docx opens in the text viewer. |
| Protected folder | `C:\Users\Meera\Documents\Dad` | Password `1708RoseCafe` (the Notes app gives it). Explorer shows a lock panel until it is entered; unlocked for the session. Inside: `FATHER_DEATH_CASE.pdf` (the unlocked copy; the folder is the lock) and the local copy of the first diary video, `2024-08-02 The box.mp4`. Neither appears in the Recent list; the participant reaches the folder by browsing Documents. |
| Movies & TV | opened from Explorer | Video player for `.mp4` files in the tree. Files live in `public/files/videos/`. |
| Notepad, Settings | desktop | Dressing. |

## How the pieces connect

- Every app window is an iframe of the real service on its port; the shell
  builds the URL from `window.location.hostname`, so it works over a LAN too.
- Each service's `index.html` carries a ten-line script that posts its route
  and title to the parent window (`mercy:route`). Orbit uses that to keep the
  address bar and tab title in step with what the participant is doing.
- The photos live in `public/files/photos/{hidden,bin,camera}`; the affair
  photos come from the repo's `source-media/affair photos/` folder,
  converted to JPEG.
- The evidence PDF is copied into `public/files/` by
  `services/case-files/scripts/build_pdf.py`; rebuild the PDF, then this
  container.
- Story data lives in `src/utils/sites.js` (sites, bookmarks, history, saved
  passwords), `src/utils/sos.js` (the SOS fix), `src/reducers/dir.json` (the
  file tree and the text files), `src/utils/apps.js` (which apps exist).

## Run

```bash
docker compose up --build -d desktop-shell
```

Then open http://localhost:3000. Development: `npm install && npm start`
inside this folder (port 3000), or the launcher config in `.claude/launch.json`
(port 3100).

## Removed from the fork

Store, Spotify, Discord, Terminal, Camera, Whiteboard, Calculator, Task
Manager, Get Started, widgets/news, Firebase, Sentry, Tauri, i18n, PWA. The
desktop layout is fixed (win11React let the user rearrange and cached it in
localStorage; an evidence image should look the same for everyone).
