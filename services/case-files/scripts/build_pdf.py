#!/usr/bin/env python
"""Builds FATHER_DEATH_CASE.pdf -- the five-page police file in Meera's protected folder.

The original Hennur Police Station file on Ravi Sharma's death, 14 October
2018, Turahalli forest: found at the base of Sunset Rock by two joggers, ruled
a fall while trekking alone, closed in three weeks. Five pages, as issued to
the family. Nothing in it says murder, and nobody is named.

What the file carries without knowing it:
  - the forest gate register: a scooter in at 06:05, fifteen minutes before
    Ravi's car, out at 07:35 "fast"; a young man, rucksack, glasses, "meeting a
    family friend"
  - a jogger who heard two men arguing at the rock at about 07:10, and the
    words "stay away from her"
  - the effects: a blue carabiner with a club tag "TD 2018" that was not his
  - the post-mortem: a fingernail torn to the bed, a hand-shaped bruise on the
    upper arm, knuckle abrasions on the other man in nobody's report
  - the phone: last call in at 05:48 from "a family friend, informed"

Each thread only closes against another app: Loop (Trail Diaries, Rahul's
trek photos and the carabiner on his strap), Haven (Dad's diary, the note on
his phone), Quill (the unsent letter). Rahul is never named here.

Photographs: put real images in  <repo>/source-media/case photos/
  photo-1-rock.jpg          Sunset Rock from the trail below, the ledge ~12 m up
  photo-2-ledge.jpg         the ledge on top: scuffed moss, Ravi's water bottle
  photo-3-base.jpg          the base, taped off, outline where he lay
  photo-4-effects.jpg       effects on a cloth: wallet, phone, keys, bottle, blue carabiner with tag
  photo-5-gate.jpg          the forest gate and guard hut, the register on the desk
(jpg or png; any that are missing are drawn as line art so the file still builds)

Output: ../FATHER_DEATH_CASE.pdf (password 1708RoseCafe) and ../FATHER_DEATH_CASE.unlocked.pdf
"""
import os
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.utils import simpleSplit, ImageReader
from reportlab.lib.colors import Color, black, white, HexColor
from pypdf import PdfReader, PdfWriter

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.abspath(os.path.join(HERE, '..'))
PHOTOS = os.path.abspath(os.path.join(HERE, '..', '..', '..', 'source-media', 'case photos'))
FONTS = 'C:/Windows/Fonts'
pdfmetrics.registerFont(TTFont('Type', os.path.join(FONTS, 'cour.ttf')))
pdfmetrics.registerFont(TTFont('TypeB', os.path.join(FONTS, 'courbd.ttf')))
pdfmetrics.registerFont(TTFont('Dad', os.path.join(FONTS, 'BRADHITC.TTF')))

W, H = A4
M = 54
PAPER = HexColor('#f3f0e6')
INK = HexColor('#1d1d1b')
FADED = HexColor('#5a5850')
RED = HexColor('#b3261e')
BLUE = HexColor('#2b4c8c')
DAD_INK = HexColor('#25336b')
STATION = ('BENGALURU CITY POLICE', 'Turahalli Police Station -- Unnatural Death Report', 'UDR No. 0412/2018')


def photo_path(name):
    for ext in ('.jpg', '.jpeg', '.png'):
        p = os.path.join(PHOTOS, name + ext)
        if os.path.exists(p):
            return p
    return None


class Page:
    def __init__(self, c, n, total, header=STATION):
        self.c, self.n, self.total = c, n, total
        self.y = H - M
        self.background()
        self.letterhead(*header)

    def background(self):
        c = self.c
        c.setFillColor(PAPER)
        c.rect(0, 0, W, H, stroke=0, fill=1)
        c.setStrokeColor(Color(0, 0, 0, alpha=0.03))
        for i in range(0, int(H), 9):
            c.line(0, i, W, i + 1)
        c.setFillColor(Color(0, 0, 0, alpha=0.06))
        c.rect(0, 0, 9, H, stroke=0, fill=1)
        c.rect(W - 5, 0, 5, H, stroke=0, fill=1)

    def letterhead(self, org, unit, ref):
        c = self.c
        c.setFillColor(INK)
        c.setFont('Helvetica-Bold', 11.5)
        c.drawCentredString(W / 2, H - M + 16, org)
        c.setFont('Helvetica', 8.5)
        c.drawCentredString(W / 2, H - M + 5, unit)
        c.setFont('Type', 8)
        c.drawRightString(W - M, H - M + 16, ref)
        c.drawString(M, H - M + 16, 'Form UD-1 (Karnataka)')
        c.setStrokeColor(INK)
        c.setLineWidth(0.8)
        c.line(M, H - M - 3, W - M, H - M - 3)
        self.y = H - M - 20

    def footer(self, label):
        c = self.c
        c.setFont('Type', 7.5)
        c.setFillColor(FADED)
        c.drawString(M, 30, label)
        c.drawRightString(W - M, 30, f'Page {self.n} of {self.total}')
        c.drawCentredString(W / 2, 18, 'COPY -- ISSUED TO NEXT OF KIN 19-10-2018')

    def gap(self, h=8):
        self.y -= h

    def h(self, text, sub=None):
        c = self.c
        self.gap(3)
        c.setFillColor(INK)
        c.setFont('TypeB', 11)
        c.drawString(M, self.y - 12, text)
        self.y -= 16
        if sub:
            c.setFont('Type', 8.5)
            c.setFillColor(FADED)
            c.drawString(M, self.y - 9, sub)
            self.y -= 12
        self.gap(3)

    def p(self, text, size=9.4, leading=12.6, font='Type', color=INK, width=None):
        c = self.c
        width = width or (W - 2 * M)
        c.setFont(font, size)
        c.setFillColor(color)
        for ln in simpleSplit(text, font, size, width):
            c.drawString(M, self.y - size, ln)
            self.y -= leading
        self.gap(5)

    def fields(self, rows, label_w=178, width=None):
        c = self.c
        width = width or (W - 2 * M)
        for label, value in rows:
            c.setFont('TypeB', 8.8)
            c.setFillColor(INK)
            c.drawString(M, self.y - 10, label)
            lines = simpleSplit(value, 'Type', 9.2, width - label_w)
            c.setFont('Type', 9.2)
            for i, ln in enumerate(lines):
                c.drawString(M + label_w, self.y - 10, ln)
                if i < len(lines) - 1:
                    self.y -= 12
            c.setStrokeColor(HexColor('#c9c4b6'))
            c.setLineWidth(0.4)
            c.line(M + label_w, self.y - 13, M + width, self.y - 13)
            self.y -= 15.5
        self.gap(5)

    def table(self, head, rows, widths, font_size=8.4):
        c = self.c
        x0 = M
        c.setFillColor(HexColor('#e4dfd1'))
        c.rect(x0, self.y - 15, sum(widths), 15, stroke=0, fill=1)
        c.setFillColor(INK)
        c.setFont('TypeB', font_size)
        x = x0
        for hcell, wcol in zip(head, widths):
            c.drawString(x + 3, self.y - 11, hcell)
            x += wcol
        self.y -= 15
        c.setFont('Type', font_size)
        for row in rows:
            cells = [simpleSplit(str(v), 'Type', font_size, wcol - 6) or [''] for v, wcol in zip(row, widths)]
            nlines = max(len(cl) for cl in cells)
            rh = nlines * (font_size + 3) + 5
            c.setStrokeColor(HexColor('#a7a297'))
            c.setLineWidth(0.5)
            c.rect(x0, self.y - rh, sum(widths), rh, stroke=1, fill=0)
            x = x0
            for cl, wcol in zip(cells, widths):
                for i, ln in enumerate(cl):
                    c.setFillColor(INK)
                    c.drawString(x + 3, self.y - (font_size + 3) * (i + 1) + 1, ln)
                x += wcol
            self.y -= rh
        self.gap(8)

    def stamp(self, text, color=RED, angle=-7, x=None, y=None, size=14):
        c = self.c
        x = x if x is not None else W - M - 220
        y = y if y is not None else self.y - 20
        c.saveState()
        c.translate(x, y)
        c.rotate(angle)
        col = Color(color.red, color.green, color.blue, alpha=0.72)
        c.setStrokeColor(col)
        c.setFillColor(col)
        c.setLineWidth(1.8)
        tw = pdfmetrics.stringWidth(text, 'Helvetica-Bold', size)
        c.roundRect(-8, -8, tw + 16, size + 14, 3, stroke=1, fill=0)
        c.setFont('Helvetica-Bold', size)
        c.drawString(0, 0, text)
        c.restoreState()

    def sig(self, name, role, date, x=None):
        c = self.c
        x = x if x is not None else M
        c.setFont('Dad', 14)
        c.setFillColor(DAD_INK)
        c.drawString(x, self.y - 15, name)
        c.setStrokeColor(FADED)
        c.setLineWidth(0.5)
        c.line(x, self.y - 19, x + 180, self.y - 19)
        c.setFont('Type', 7.6)
        c.setFillColor(FADED)
        c.drawString(x, self.y - 29, f'{name} -- {role}')
        c.drawString(x, self.y - 39, date)

    def photo(self, name, caption, draw_fallback, x, y, w, h, exhibit):
        """A scene photograph in a frame with the exhibit stamp and the photographer's caption."""
        c = self.c
        path = photo_path(name)
        c.setFillColor(HexColor('#d6d2c6'))
        c.rect(x, y, w, h, stroke=0, fill=1)
        if path:
            # the source PNGs are ~10 MB each; embed a 1000 px JPEG so the file stays small
            from PIL import Image
            import io
            im = Image.open(path).convert('RGB')
            # centre-crop to the frame's aspect so the photo fills it, then downscale
            iw, ih = im.size
            target = w / h
            if iw / ih > target:
                nw = int(ih * target); im = im.crop(((iw - nw) // 2, 0, (iw - nw) // 2 + nw, ih))
            else:
                nh = int(iw / target); im = im.crop((0, (ih - nh) // 2, iw, (ih - nh) // 2 + nh))
            im.thumbnail((1000, 1000))
            buf = io.BytesIO()
            im.save(buf, 'JPEG', quality=82)
            buf.seek(0)
            c.drawImage(ImageReader(buf), x, y, w, h)
        else:
            c.saveState()
            clip = c.beginPath()
            clip.rect(x, y, w, h)
            c.clipPath(clip, stroke=0, fill=0)
            c.translate(x, y)
            draw_fallback(c, w, h)
            c.restoreState()
        c.setStrokeColor(HexColor('#4a4740'))
        c.setLineWidth(0.8)
        c.rect(x, y, w, h, stroke=1, fill=0)
        # exhibit strip
        c.setFillColor(Color(0, 0, 0, alpha=0.62))
        c.rect(x, y, w, 12, stroke=0, fill=1)
        c.setFillColor(white)
        c.setFont('Type', 6.8)
        strip = f'14-10-2018  TURAHALLI PS  EXHIBIT {exhibit}  UDR 0412/2018' if w > 230 else f'14-10-2018  EXHIBIT {exhibit}  UDR 0412/2018'
        c.drawString(x + 4, y + 3.5, strip)
        c.setFont('Type', 7.8)
        c.setFillColor(INK)
        yy = y - 10
        for ln in simpleSplit(caption, 'Type', 7.8, w):
            c.drawString(x, yy, ln)
            yy -= 10


def portrait(c, x, y, w, h):
    """Passport-style photograph of the deceased, cropped from source-media/case photos/ravi sharma.jpg."""
    path = photo_path('ravi sharma')
    c.setFillColor(HexColor('#d6d2c6'))
    c.rect(x, y, w, h, stroke=0, fill=1)
    if path:
        from PIL import Image
        import io
        im = Image.open(path).convert('RGB')
        iw, ih = im.size
        # head and shoulders: the upper part of the picture, at the frame's aspect
        ch = int(iw / (w / h))
        if ch > ih:
            ch = ih
        im = im.crop((0, 0, iw, ch))
        im.thumbnail((500, 500))
        buf = io.BytesIO()
        im.save(buf, 'JPEG', quality=85)
        buf.seek(0)
        c.drawImage(ImageReader(buf), x, y, w, h)
    else:
        c.setStrokeColor(FADED)
        c.setFont('Type', 7)
        c.setFillColor(FADED)
        c.drawCentredString(x + w / 2, y + h / 2, 'PHOTO')
    c.setStrokeColor(HexColor('#4a4740'))
    c.setLineWidth(0.8)
    c.rect(x, y, w, h, stroke=1, fill=0)
    # pasted corners
    c.setFillColor(Color(0, 0, 0, alpha=0.18))
    for cx, cy in ((x, y + h), (x + w, y + h), (x, y), (x + w, y)):
        c.circle(cx, cy, 3, stroke=0, fill=1)
    c.setFont('Type', 6.8)
    c.setFillColor(FADED)
    c.drawCentredString(x + w / 2, y - 9, 'photo supplied by family')


# --- line-art fallbacks for the five photographs ---------------------------------------------
def fb_rock(c, w, h):
    c.setStrokeColor(HexColor('#3d3a33')); c.setLineWidth(1.2); c.setFillColor(HexColor('#a8a396'))
    c.rect(0, 0, w, h, stroke=0, fill=1)
    k = h / 180.0
    pts = [(10, 20), (40, 60), (60, 120), (110, 150), (150, 160), (190, 135), (210, 90), (230, 40), (250, 20)]
    pts = [(x * (w / 260.0), y * k) for x, y in pts]
    p = c.beginPath(); p.moveTo(*pts[0])
    for x, y in pts[1:]: p.lineTo(x, y)
    p.lineTo(pts[-1][0], 0); p.lineTo(pts[0][0], 0); p.close()
    c.setFillColor(HexColor('#8d887a')); c.drawPath(p, stroke=1, fill=1)
    c.setFont('Helvetica', 6.5); c.setFillColor(INK); c.drawString(pts[4][0] + 12, pts[4][1] - 2, 'ledge')


def fb_ledge(c, w, h):
    c.setFillColor(HexColor('#9a9587')); c.rect(0, 0, w, h, stroke=0, fill=1)
    c.setFillColor(HexColor('#7f7a6c')); c.rect(0, 0, w, h * 0.45, stroke=0, fill=1)
    c.setStrokeColor(HexColor('#3d3a33')); c.setLineWidth(1)
    c.line(0, h * 0.45, w, h * 0.45)
    c.setFillColor(HexColor('#5f6b4a')); c.ellipse(40, h * 0.5, 120, h * 0.7, stroke=0, fill=1)
    c.setFillColor(HexColor('#dfe4ea')); c.roundRect(w * 0.6, h * 0.5, 14, 34, 4, stroke=1, fill=1)
    c.setFont('Helvetica', 6.5); c.setFillColor(INK); c.drawString(w * 0.6 - 8, h * 0.5 - 10, 'bottle'); c.drawString(44, h * 0.72, 'moss scuffed')


def fb_base(c, w, h):
    c.setFillColor(HexColor('#8f8a7c')); c.rect(0, 0, w, h, stroke=0, fill=1)
    c.setStrokeColor(HexColor('#e8d25c')); c.setLineWidth(3); c.line(0, h * 0.8, w, h * 0.72)
    c.setStrokeColor(white); c.setLineWidth(1.4); c.setDash(4, 3)
    c.roundRect(w * 0.3, h * 0.25, w * 0.4, h * 0.3, 14, stroke=1, fill=0)
    c.setDash()
    c.setFont('Helvetica', 6.5); c.setFillColor(white); c.drawString(w * 0.3, h * 0.2, 'position of body')


def fb_effects(c, w, h):
    c.setFillColor(HexColor('#cfcabd')); c.rect(0, 0, w, h, stroke=0, fill=1)
    c.setStrokeColor(HexColor('#3d3a33')); c.setLineWidth(1); c.setFillColor(HexColor('#8d887a'))
    c.rect(20, h * 0.55, 46, 30, stroke=1, fill=1); c.rect(80, h * 0.52, 30, 54, stroke=1, fill=1)
    c.circle(140, h * 0.68, 7, stroke=1, fill=0); c.line(147, h * 0.68, 160, h * 0.62); c.line(147, h * 0.68, 160, h * 0.74)
    c.setFillColor(HexColor('#dfe4ea')); c.roundRect(180, h * 0.5, 14, 40, 4, stroke=1, fill=1)
    c.setStrokeColor(HexColor('#2f6fd6')); c.setLineWidth(2.2); c.setFillColor(Color(0, 0, 0, 0))
    c.roundRect(60, h * 0.15, 22, 34, 9, stroke=1, fill=0)
    c.setFillColor(HexColor('#f2e9c8')); c.setStrokeColor(HexColor('#3d3a33')); c.setLineWidth(0.8)
    c.rect(86, h * 0.2, 26, 14, stroke=1, fill=1)
    c.setFont('Helvetica-Bold', 5.5); c.setFillColor(INK); c.drawString(89, h * 0.2 + 4, 'TD 2018')
    c.setFont('Helvetica', 6.5)
    for x, t in [(20, 'wallet'), (80, 'phone'), (132, 'keys'), (176, 'bottle'), (56, 'carabiner')]:
        c.drawString(x, h * 0.45 if x != 56 else h * 0.08, t)


def fb_gate(c, w, h):
    c.setFillColor(HexColor('#a9b39a')); c.rect(0, 0, w, h, stroke=0, fill=1)
    c.setStrokeColor(HexColor('#3d3a33')); c.setLineWidth(1.2)
    c.setFillColor(HexColor('#8d887a')); c.rect(w * 0.6, 20, w * 0.3, h * 0.45, stroke=1, fill=1)
    c.setFillColor(HexColor('#6b675c')); c.rect(w * 0.58, h * 0.65, w * 0.34, 10, stroke=1, fill=1)
    c.line(30, 20, 30, h * 0.6); c.line(30, h * 0.55, w * 0.55, h * 0.5)
    c.setFont('Helvetica', 6.5); c.setFillColor(INK); c.drawString(w * 0.62, 8, 'guard hut'); c.drawString(34, h * 0.62, 'barrier')


# --- build --------------------------------------------------------------------------------
OUT_PLAIN = os.path.join(OUT_DIR, 'FATHER_DEATH_CASE.unlocked.pdf')
C = canvas.Canvas(OUT_PLAIN, pagesize=A4)
C.setTitle('FATHER_DEATH_CASE')
C.setAuthor('Turahalli Police Station')
C.setSubject('Ravi Sharma -- UDR 0412/2018')
TOTAL = 5

# 1 -- FIR / first information ---------------------------------------------------------------
pg = Page(C, 1, TOTAL)
pg.h('UNNATURAL DEATH REPORT -- FIRST INFORMATION', 'Section 174 CrPC -- registered at Turahalli PS, 14-10-2018, 08:55 hrs')
pg.fields([('UDR No.', '0412/2018'), ('Date and time of information', '14-10-2018, 08:55 hrs'), ('Informant', 'Sri Deepak Menon, aged 34, of Uttarahalli; jogger (statement at page 3)'), ('Place of occurrence', 'Turahalli Minor Forest, upper trail, base of "Sunset Rock" (approx. 1.4 km from the Kanakapura Road gate)'), ('Date and time of occurrence', '14-10-2018, between 06:30 and 07:40 hrs (approx.)'), ('Nature', 'Fall from height while trekking alone -- accidental (provisional)'), ('Investigating officer', 'SI R. Prabhakar'), ('Supervising officer', 'Inspector B. R. Shivakumar')])
pg.h('Particulars of the deceased')
# passport-style photograph, pasted at the right; particulars run down the left
PW, PH = 84, 108
portrait(C, W - M - PW, pg.y - PH + 2, PW, PH)
pg.fields([('Full name', 'RAVI SHARMA'), ('Father\'s name', 'Late Gopal Sharma'), ('Date of birth / age', '17-08-1957 / 61 years'), ('Sex', 'Male'), ('Occupation', 'Retired engineer (BEML, 2016)'), ('Residence', 'No. 42, 8th Cross, Malleshwaram, Bengaluru 560003'), ('Mobile', '98450 22417'), ('Identification', 'Spectacles; short grey beard; scar on left knee. Identified by daughter from the wallet and person.'), ('Next of kin', 'Smt. Lakshmi Sharma (wife, 58), same address'), ('Children', 'Kum. Meera Sharma (daughter, 20), unmarried, r/o Koramangala, Bengaluru'), ('Informed', 'Wife by phone 09:30 hrs; daughter reached the scene 10:20 hrs')], width=W - 2 * M - PW - 14)
pg.h('Brief facts')
pg.p('At about 08:40 hrs the informant and another jogger (Smt. S. Iyer) found a male person lying at the base of the rock outcrop known locally as Sunset Rock, on the upper trail of Turahalli Minor Forest, not moving. They informed the forest gate guard, who informed this station. The deceased was identified from the wallet as Ravi Sharma. He was known to the gate staff as a regular solo walker on Sunday mornings; his vehicle, white Maruti Dzire KA-03-MH-2214, was parked at the gate.')
pg.p('The deceased appears to have climbed to the ledge on top of the rock (approx. 12 m) as was his habit, and fallen from it. The body was moved to Victoria General Hospital for post-mortem. The wife was informed at 09:30 hrs and the daughter, Kum. Meera Sharma, reached the gate at 10:20 hrs and identified the deceased.')
pg.p('The gate register for the morning is annexed (page 3). The deceased\'s personal effects were recovered from the scene and are listed at page 2.')
pg.gap(6)
pg.stamp('RECEIVED', BLUE, -6, x=W - M - 150, y=pg.y - 8, size=12)
pg.sig('R. Prabhakar', 'Sub-Inspector, Turahalli PS', '14-10-2018')
pg.footer('UDR 0412/2018 -- first information')
C.showPage()

# 2 -- scene report + photographs ------------------------------------------------------------
pg = Page(C, 2, TOTAL)
pg.h('SCENE OF OCCURRENCE -- INSPECTION REPORT', 'inspected 14-10-2018, 09:40 to 11:10 hrs, by SI R. Prabhakar with scene photographer HC 2210')
pg.p('Sunset Rock is a granite outcrop on the upper trail with a flat ledge on top reached by a scramble on the north side. The ledge is about 12 m above the trail on the south side, where the deceased was found. The ledge showed moss scuffed at the southern lip over about half a metre. The deceased\'s steel water bottle was standing upright on the ledge near the scramble, about 3 m from the lip. No slip marks were found on the scramble. Light rain had fallen the previous night.')
pg.p('Effects recovered from the deceased and from the ground within 3 m of the body, and handed to the family against receipt: leather wallet with Rs 640 and cards; mobile phone (screen cracked); key ring with three keys; steel water bottle (from the ledge); one blue aluminium carabiner clip with a small cloth tag marked "TD 2018", found on the trail 2 m from the body.')
pg.p('Nothing further was found at the scene. There was no sign of any other person at the ledge at the time of inspection.', color=INK)
photo_w = (W - 2 * M - 14) / 2
photo_h = 150
top = pg.y - 4
pg.photo('photo-1-rock', 'Exhibit 1. Sunset Rock from the trail below. The ledge at top right; the deceased was found at the base, left of centre.', fb_rock, M, top - photo_h, photo_w, photo_h, '1')
pg.photo('photo-2-ledge', 'Exhibit 2. The ledge on top of the rock. Moss scuffed at the lip (foreground). Water bottle of the deceased standing near the scramble.', fb_ledge, M + photo_w + 14, top - photo_h, photo_w, photo_h, '2')
top2 = top - photo_h - 34
pg.photo('photo-3-base', 'Exhibit 3. Base of the rock, trail side, taped off. Position of the body marked. Trail continues to the left towards the gate.', fb_base, M, top2 - photo_h, photo_w, photo_h, '3')
pg.photo('photo-4-effects', 'Exhibit 4. Effects as recovered: wallet, phone, keys, water bottle, and the carabiner clip with tag "TD 2018" found on the trail.', fb_effects, M + photo_w + 14, top2 - photo_h, photo_w, photo_h, '4')
pg.y = top2 - photo_h - 36
pg.footer('UDR 0412/2018 -- scene report and photographs')
C.showPage()

# 3 -- gate register + statements ----------------------------------------------------------------
pg = Page(C, 3, TOTAL)
pg.h('FOREST GATE REGISTER -- EXTRACT', 'Kanakapura Road gate, 14-10-2018 -- copied from the guard\'s register by SI R. Prabhakar')
pg.table(['Time in', 'Vehicle / person', 'Purpose', 'Time out', 'Guard\'s remark'], [
    ['05:50', 'Walkers (2), on foot', 'morning walk', '07:05', ''],
    ['06:05', 'Two-wheeler, black, KA-05 .. 7 (rest not noted)', 'trek', '07:35', 'young man, rucksack, spectacles; said he is meeting a family friend up the trail. Left fast.'],
    ['06:20', 'Car, white, KA-03-MH-2214 (Sharma sir)', 'walk -- regular, Sundays', '--', 'did not come out'],
    ['06:45', 'Jogger (D. Menon)', 'jog', '09:20', 'reported the fall'],
    ['06:50', 'Jogger (S. Iyer)', 'jog', '09:25', 'reported the fall'],
], widths=[42, 150, 92, 50, 153])
pg.h('STATEMENT -- Sri Nanjappa, gate guard (aged 58)', 'recorded 14-10-2018, 12:10 hrs')
pg.p('I have been on the Kanakapura Road gate for nine years. Sharma sir comes every Sunday at about six-twenty and walks up to the big rock and comes back by eight. He always comes alone. On the 14th he came at the usual time. Before him, at about five past six, a young man came on a black scooter with a rucksack. He had spectacles. I asked his purpose and he said he was going up the trail to meet a family friend. I wrote "trek". He came out at about twenty-five to eight, walking fast, and went off on the scooter. I did not see Sharma sir come out. At about quarter to nine the joggers came running down and said a man had fallen at the rock.')
pg.h('STATEMENT -- Smt. S. Iyer, jogger (aged 41)', 'recorded 14-10-2018, 12:40 hrs')
pg.p('I run the upper trail on Sunday mornings. At about ten past seven I was passing below the big rock and I heard two men\'s voices above me, on the rock, arguing. One voice was older and one was younger. The older voice said loudly, "stay away from her." I did not look up and I did not see them; the rock is high. I continued my run. On the way back at about twenty to nine my friend Deepak and I found the man lying at the base of the rock and we ran to the gate.')
pg.p('Q. Did you see anyone else on the trail?  A. Some time after the voices a young man ran past me going down, fast. I did not see his face. I thought he had fallen and hurt his hand.', size=9)
pg.sig('R. Prabhakar', 'SI', '14-10-2018')
gate_w, gate_h = 210, 150
pg.photo('photo-5-gate', 'Exhibit 5. Kanakapura Road gate and guard hut, 14-10-2018, 09:15 hrs. The register is kept on the desk inside. The deceased\'s car is parked beyond the barrier.', fb_gate, W - M - gate_w, pg.y - gate_h - 2, gate_w, gate_h, '5')
pg.footer('UDR 0412/2018 -- register and statements')
C.showPage()

# 4 -- post-mortem extract + phone ------------------------------------------------------------------
pg = Page(C, 4, TOTAL, ('VICTORIA GENERAL HOSPITAL', 'Department of Forensic Medicine -- extract furnished to Turahalli PS', 'PM No. 1188/2018'))
pg.h('POST-MORTEM EXAMINATION -- EXTRACT OF FINDINGS')
pg.fields([('Deceased', 'Ravi Sharma, M, 61 yrs, S/o late Gopal Sharma, r/o Malleshwaram'), ('Brought by', 'PC 4471, Turahalli PS'), ('Identified by', 'Kum. Meera Sharma (daughter) and Smt. Lakshmi Sharma (wife)'), ('Examined', '15-10-2018, 10:30 hrs'), ('Examiner', 'Dr. S. Hegde, Asst. Professor')])
pg.h('External injuries')
pg.p('Fracture-dislocation of the cervical spine; depressed fracture of the right parietal bone; multiple abrasions over the back and right side of the trunk consistent with impact on rock.')
pg.p('Abrasions over the knuckles of the right hand. Left index fingernail torn to the bed. Consistent with the hand striking or grasping rock during the fall.')
pg.p('Oval contusion, 3 x 2 cm, over the lateral aspect of the left upper arm, with three smaller contusions in a line proximal to it. Noted. Attributed to impact.')
pg.h('Internal / chemical')
pg.p('Blood alcohol: nil. No natural disease found sufficient to cause death.')
pg.h('Opinion')
pg.p('Death is due to head and spinal injuries consequent to a fall from height. Time since death at examination is consistent with death between 06:30 and 07:45 hrs on 14-10-2018.')
pg.sig('Dr. S. Hegde', 'Forensic Medicine', '15-10-2018')
pg.y -= 52
pg.h('MOBILE PHONE OF THE DECEASED -- NOTE BY IO', 'examined 15-10-2018 before return to the family')
pg.p('The handset (screen cracked, working) was examined for the last activity. Last outgoing call: 13-10-2018, 20:05 hrs, to "Meera" (daughter). Last incoming call: 14-10-2018, 05:48 hrs, duration 1 min 40 s, from a contact saved as "R (Meera\'s friend)" -- a family friend, since informed of the death. No message activity on the morning of 14-10-2018. The handset was returned to the family with the effects. No further examination was considered necessary.')
pg.footer('PM 1188/2018 extract -- phone note')
C.showPage()

# 5 -- closure --------------------------------------------------------------------------------------
pg = Page(C, 5, TOTAL)
pg.h('CLOSURE REPORT', 'Unnatural Death Report -- Sec. 174 CrPC')
pg.h('1. Summary of enquiry')
pg.p('The deceased, Ravi Sharma (61), a retired engineer, was in the habit of walking alone in Turahalli Minor Forest every Sunday morning and climbing to the ledge of Sunset Rock. On 14-10-2018 he entered the forest by car at 06:20 hrs and was found at the base of the rock at about 08:40 hrs by two joggers. The scene inspection, the gate register and the statements of the gate guard and the joggers were recorded. The post-mortem attributes death to head and spinal injuries from a fall from height. No alcohol was detected.')
pg.h('2. Findings')
pg.p('The ledge is unfenced and the lip was wet and mossy after rain in the night. The deceased, aged 61, appears to have slipped or lost his footing at the lip and fallen to the trail below. No suicide note was found and the family reports no such intention. There is no evidence of foul play.')
pg.p('The effects recovered, including a carabiner clip found on the trail, were returned to the family. The other visitors recorded at the gate that morning were not traced and their evidence was not considered necessary to the enquiry.')
pg.h('3. Conclusion')
pg.p('From the enquiry, the death of Ravi Sharma is found to be accidental, caused by a fall from the rock while walking alone in the forest. No cognizable offence is made out. The UDR is closed. The Forest Department is advised to fence the ledge of Sunset Rock.')
pg.gap(6)
pg.stamp('CLOSED -- ACCIDENTAL DEATH', RED, -7, x=M + 20, y=pg.y - 10, size=13)
pg.y -= 40
pg.sig('R. Prabhakar', 'Sub-Inspector', '06-11-2018')
pg.sig('B. R. Shivakumar', 'Inspector', '06-11-2018', x=W / 2 + 20)
pg.y -= 70
pg.p('Copy issued to Smt. Lakshmi Sharma (wife) and Kum. Meera Sharma (daughter) on request, 19-10-2018, and closure page on 08-11-2018. Effects (page 2) handed over to the daughter against receipt, 19-10-2018. -- Station Writer', size=8, color=FADED)
pg.footer('UDR 0412/2018 -- closure')
C.showPage()
C.save()

reader = PdfReader(OUT_PLAIN)
writer = PdfWriter()
for p in reader.pages:
    writer.add_page(p)
writer.add_metadata({'/Title': 'FATHER_DEATH_CASE', '/Author': 'Turahalli Police Station'})
writer.encrypt(user_password='1708RoseCafe', owner_password='1708RoseCafe', algorithm='AES-256')
locked = os.path.join(OUT_DIR, 'FATHER_DEATH_CASE.pdf')
with open(locked, 'wb') as f:
    writer.write(f)
# the laptop shell serves the locked copy from Meera's Documents folder
import shutil
shell_copy = os.path.join(HERE, '..', '..', 'desktop-shell', 'public', 'files', 'FATHER_DEATH_CASE.pdf')
os.makedirs(os.path.dirname(shell_copy), exist_ok=True)
shutil.copyfile(OUT_PLAIN, shell_copy)  # the laptop copy is not encrypted: the folder it sits in is the lock
missing = [n for n in ['photo-1-rock', 'photo-2-ledge', 'photo-3-base', 'photo-4-effects', 'photo-5-gate'] if not photo_path(n)]
print(f'wrote {OUT_PLAIN} ({len(reader.pages)} pages) and {locked} (password 1708RoseCafe)')
print('photographs missing, drawn as line art:', ', '.join(missing) if missing else 'none')
