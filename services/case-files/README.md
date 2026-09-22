# case-files

`FATHER_DEATH_CASE.pdf` -- the file in Meera's protected folder. Five A4
pages, opens with the password from Notes (`1708RoseCafe`).
`FATHER_DEATH_CASE.unlocked.pdf` is the same file without the password, for
review; it is not part of the game.

It is the family's copy of the Turahalli Police Station file on Ravi
Sharma's death: 14 October 2018, found at the base of Sunset Rock in
Turahalli forest, where he walked alone every Sunday. Closed in three weeks
as a fall. **Nothing in it says murder, and nobody is named.** The truth --
that Rahul Nair, Meera's childhood friend, met him at the rock and pushed
him -- is only reachable by reading this file against the other apps.

| Page | What it is | What it carries without knowing it |
|---|---|---|
| 1 | First information (UDR 0412/2018), particulars of the deceased with photograph | Ravi Sharma, 61, retired engineer, Malleshwaram; wife Lakshmi Sharma; daughter Meera Sharma, 20, unmarried (she marries Arjun in 2021). He was "alone". Car in at 06:20. |
| 2 | Scene report, exhibits 1-4 | Effects include a blue carabiner with club tag "TD 2018" that was not his. |
| 3 | Gate register, statements, exhibit 5 | A scooter in at 06:05, out at 07:35 "fast"; "young man, rucksack, spectacles, meeting a family friend". Jogger S. Iyer heard "stay away from her" at 07:10 and saw a young man run down holding his hand. |
| 4 | Post-mortem extract, phone note | Knuckle abrasions, a fingernail torn to the bed, a hand-shaped bruise on the upper arm, all "attributed to impact". Last call in at 05:48 from "R (Meera's friend)" -- "family friend, informed". |
| 5 | Closure | Accidental. "The other visitors recorded at the gate were not traced." |

Each thread closes elsewhere: Loop (Trail Diaries trekking club, Rahul's
Turahalli post with "same rock, same carabiner"), Haven (HAV-019 to HAV-031:
Dad's pocket diary "Talked to R. again. Warned him off.", the phone note
"Sun. Talk to R at the rock. End it.", the jogger found again), Quill
(EML-003, the unsent letter EML-034), Wisp.

## Photographs

The five exhibits are read from `<repo>/source-media/case photos/`
(jpg or png). Any that are missing are drawn as line art so the file still
builds.

| File | Shot |
|---|---|
| `photo-1-rock` | Sunset Rock from the trail below; the ledge about 12 m up, the base where he was found |
| `photo-2-ledge` | On the ledge: moss scuffed at the lip, his steel water bottle standing near the scramble |
| `photo-3-base` | The base of the rock, trail side, police tape, position of the body marked |
| `photo-4-effects` | Effects on a cloth: wallet, cracked phone, keys, bottle, and the blue carabiner with the "TD 2018" tag |
| `photo-5-gate` | The Kanakapura Road forest gate and guard hut, barrier, register on the desk, white Dzire beyond |
| `ravi sharma` | Portrait of Ravi Sharma, cropped to head and shoulders for the passport-style photo on page 1 |

- Evidence prefix (when a service serves it): `CASE-`.
- Regenerate with `python scripts/build_pdf.py` (needs `reportlab`, `pypdf`;
  uses the Windows fonts Courier New and Bradley Hand). Edit the script, not
  the PDF.

No container. When the laptop shell exists, this PDF is the file it opens
from `Documents/FATHER_DEATH_CASE`.
