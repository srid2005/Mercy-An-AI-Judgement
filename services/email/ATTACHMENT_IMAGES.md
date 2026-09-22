# Quill attachment images

_Nine images stand in as SVG placeholders under `public/images/attachments/`. Each one is the attachment on one mail: a 42 × 42 thumbnail on the chip, the full image when the chip is clicked (it opens in a new tab). Deliver JPGs, 1200-1600 px on the long side, under 400 KB each, named exactly as below; drop them in the same folder and the seed is switched from the `.svg` to the `.jpg` (see the bottom of this file)._

Style for all of them: real phone photos and real screenshots, slightly imperfect -- a little noise, ordinary framing, no watermark, no captions, no text that was not on the thing itself. Meera is the woman in the Haven diary films (late twenties, Bengaluru); Arjun and Nikhil are the men in Loop's avatars (`social-media/public/images/avatars/`).

## The four that are evidence

### 1. `personal-photo.jpg` -- on EML-001, Nikhil to Meera, 21 June 2024, 22:00
The mail that starts the affair ("I don't have answers, I just wanted you to know I'm not going anywhere ... -N"). Filename shown: `IMG_20240621_2159.jpg`, 2.1 MB.
**Shows:** a candid taken on Nikhil's phone that evening -- Meera across a small café table, half-turned, laughing at something off-frame, unaware of the camera; a cup and a phone on the table, warm evening light, shallow phone-camera depth of field. Portrait or 4:3. Nothing explicit: it is intimate because of who took it, not what it shows. (One of the `affair photos` you made for the laptop can be reused here if it fits.)

### 2. `camera-reference.jpg` -- on EML-009, Priya to Meera, 15 May 2024
"Do you remember the photographer's name from Ritu's wedding?" Filename shown: `photographer_reference.jpg`, 1.4 MB.
**Shows:** a phone snapshot of a printed wedding photo, or of a photographer's business card / studio sticker on the back of a print, with **Kunal Studios** readable (a Bengaluru address line and a phone number are fine, invented). A finger or table edge at the border sells it as a quick snap.

### 3. `boarding-pass.jpg` -- on EML-011, Arjun to Meera, 1 July 2024
"Forwarding the flight confirmation for the trip in case you need it separately. Booking ref: BX4471." Filename shown: `flight_itinerary_BX4471.jpg`, 860 KB.
**Shows:** a screenshot of an airline / booking-app e-ticket: two passengers **ARJUN KAPOOR** and **MEERA KAPOOR**, booking reference **BX4471**, Bengaluru (BLR) → Goa (GOI) out on Fri 12 Jul 2024 and back Mon 15 Jul 2024, economy, a fake airline name (not a real carrier's logo). The dates keep it inside the story (HAV-017 "Trip" is recorded on 1 July; their date night on Loop is 20 July).

### 4. `app-preview.jpg` -- on EML-024, Haven to Meera, 2 November 2018
The "You're verified! Welcome to Haven" mail. Filename shown: `haven_app_preview.jpg`, 1.1 MB.
**Shows:** a product image of the Haven app -- a phone or laptop mock-up with the diary screen: a grid of video thumbnails, the Haven wordmark (`haven/public/images/haven-logo.png` is the logo), the tagline "A private space for your thoughts". Marketing-clean, unlike the others.

## Prompts for the four evidence images

Use the reference photo of Meera (`social-media/public/images/avatars/meera.jpg`, or a frame from a Haven film) wherever a generator takes a face reference. Text is the weak point of every image generator: for the ticket and the studio card, generate the base image with the prompt and put the exact words on afterwards in an editor (or use a generator that renders text reliably and check every character). Negative prompt for all four is at the end.

### 1. `personal-photo.jpg` (portrait 3:4, or 4:3)
> A candid photograph taken on a phone by someone sitting across a small café table, Bengaluru, June evening, golden-hour light coming in low through a window on the left. A young Indian woman in her late twenties [match the reference photo for face and hair], hair down, a plain sage-green cotton top, half-turned away from the camera, mid-laugh at something outside the frame, one hand near her cup, not posing and not looking at the lens. On the table: a half-finished filter coffee in a steel tumbler, her phone face down, a folded paper napkin. Background soft: the café's brick wall, a hanging plant, bokeh of a pendant lamp. Real phone-camera look: 26 mm equivalent, shallow phone-portrait depth of field with a slightly imperfect edge around her hair, warm white balance, mild noise in the shadows, a touch of lens flare from the window. Nobody else in frame, no text, no watermark. Nothing staged: it looks like a moment someone did not want to lose.

### 2. `camera-reference.jpg` (portrait 3:4)
> A quick phone snapshot, indoors, daylight from a window, of the back of a printed wedding photograph held in a woman's hand, a wooden table and the edge of a photo album visible behind it. Stuck to the back of the print is a small cream studio sticker / business card, slightly crooked, printed in a modest serif: "KUNAL STUDIOS" in capitals, below it "Wedding & Portrait Photography", "Jayanagar 4th Block, Bengaluru", "+91 98450 21870", and a tiny camera icon. The sticker is sharp and fully readable; the rest of the frame is ordinary and a little tilted, thumb at the corner of the print, soft shadow of the phone. Real phone-camera colour, no filters, no text anywhere except on the sticker, no watermark.
> _Put the four lines of the sticker on in an editor if the generator misspells them; the name "Kunal Studios" is the one thing the participant will read._

### 3. `boarding-pass.jpg` (portrait 9:16 -- it is a phone screenshot)
> A clean phone screenshot of an airline e-ticket / booking confirmation inside a booking app, light theme, an invented airline called "IndiSky" with a simple blue-and-orange wing mark (not any real carrier). At the top: "Booking confirmed" and the PNR / booking reference "BX4471" large. Itinerary card: "BLR Bengaluru → GOI Goa", "Fri 12 Jul 2024, 07:40 – 08:55, flight IS 2214, Economy"; a second card "GOI Goa → BLR Bengaluru", "Mon 15 Jul 2024, 19:20 – 20:35, flight IS 2219, Economy". Passengers: "ARJUN KAPOOR" and "MEERA KAPOOR", "2 adults", "Cabin bag 7 kg, check-in 15 kg". A "Download boarding pass" button. Status bar at the top with time 08:52, full signal, battery. Crisp UI rendering, ordinary app typography, no photos, nothing else on screen.
> _Every name, code, date and time above is story canon -- correct them by hand in an editor after generating; a wrong reference or a real airline's logo is worse than the placeholder._

### 4. `app-preview.jpg` (landscape 16:9)
> A polished product marketing image for a video-diary app called "Haven": a modern laptop and a phone side by side on a pale warm background with soft studio light, both screens showing the same app -- a calm, private diary interface in deep green and cream: a grid of small video thumbnails of a young woman talking to her webcam (faces indistinct, tiny), each with a date and a short title, a sidebar listing years, a green record button. The Haven wordmark (a small rounded video-camera icon in green next to the lowercase word "haven") on the screen and again on the left of the image, with the tagline underneath in a light sans-serif: "A private space for your thoughts". Clean, minimal, 2018-era SaaS marketing style, no people outside the tiny thumbnails, no other text, no watermark.
> _The real logo is `services/haven/public/images/haven-logo.png`; paste it over whatever the generator draws so the two match._

### Negative prompt (all four)
> illustration, painting, 3D render, cartoon, anime, CGI, plastic skin, extra fingers, deformed hands, duplicated face, watermark, signature, caption, subtitle, stock-photo logo, real airline logo, real brand logo, blurry text, gibberish text, lorem ipsum, oversaturated, HDR halo, bokeh balls everywhere, studio backdrop (for 1 and 2), people in the background (for 1), nudity, kissing, explicit

## The five filler ones (inbox noise, no evidence)

### 5. `headphones.jpg` -- Emazon "Your order has shipped" and "Delivered" (used on both)
Filename shown: `wireless_headphones.jpg`, 210 KB. A product shot of over-ear wireless headphones on white, generic, no brand.

### 6. `hamster-cage.jpg` -- Mamster "Your order is on its way 🐾"
Filename shown: `hamster_habitat.jpg`, 245 KB. A product shot of a hamster cage / habitat with tubes and a wheel, on white.

### 7. `sneaker.jpg` -- "Your Order Has Shipped 📦"
Filename shown: `sneakers.jpg`, 198 KB. A product shot of a pair of white-and-pastel running sneakers, generic.

### 8. `grocery-flyer.jpg` -- "🥦 Your weekly grocery list is here!"
Filename shown: `weekly_flyer.jpg`, 380 KB. A supermarket weekly-offers flyer: vegetables, a few price tags in rupees, a fake store name, portrait.

(That is eight files for nine attachment rows -- the headphones image is used twice.)

## Status
All eight JPGs are in `public/images/attachments/` (converted to ≤1600 px, ≤400 KB
from the originals in `/quill attachment images/`); the seed rows point at
them (`.jpg` / `image/jpeg`) and a running database gets the same with
`scripts/migrate_live_attachments.sql`. The SVG placeholders were removed.
