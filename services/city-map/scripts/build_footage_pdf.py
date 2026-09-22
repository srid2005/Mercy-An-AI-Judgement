#!/usr/bin/env python
"""Renders photos.json (the drone-photo manifest) to DRONE_FOOTAGE.pdf and
DRONE_FOOTAGE.md -- the shot list the game's author works from when producing
the real frames. A plain, readable document, not a game asset; same house
style as services/haven/scripts/build_prompts_pdf.py (A4, Helvetica,
h1/h2/h3/body).

For every frame in the manifest: the file path, the kind, the caption the
participant sees, and either the full AI prompt or what to look for on a
stock site. An appendix counts AI vs stock frames per set.

Usage: python scripts/build_footage_pdf.py
"""
import datetime
import json
import os

from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.colors import HexColor
from reportlab.lib.enums import TA_LEFT
from reportlab.platypus import (SimpleDocTemplate, Paragraph, Spacer, HRFlowable,
                                KeepTogether, Table, TableStyle)

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.normpath(os.path.join(HERE, '..', 'photos.json'))
OUT_PDF = os.path.normpath(os.path.join(HERE, '..', 'DRONE_FOOTAGE.pdf'))
OUT_MD = os.path.normpath(os.path.join(HERE, '..', 'DRONE_FOOTAGE.md'))

TITLE = 'MERCY -- Drone footage shot list'
IMG_ROOT = 'services/city-map/public/images/drone/'

# Human-readable titles for the section headings. The key is the contract
# (it is what the server resolves); the title is only a courtesy to the reader.
SET_TITLES = {
    'sos-1': "St Aldric's churchyard (SOS 1)",
    'sos-2': 'Auditorium service yard (SOS 2)',
    'sos-3': 'Veterinary Hospital (SOS 3)',
    'sos-4': 'Eco-Park (SOS 4)',
    'kettle-north-face': 'Kettle Hill, north face -- clear',
    'kettle-cave-sealed': 'Kettle Hill cave, sealed -- the drones do not enter',
    'kettle-cave': 'Kettle Hill cave, interior -- trace',
    'stop-1': 'Vehicle stop 1, Northwind Campus -- place frames (both outcomes)',
    'stop-1:clear': 'Vehicle stop 1, Northwind Campus -- outcome: clear',
    'stop-1:found': 'Vehicle stop 1, Northwind Campus -- outcome: found',
    'stop-2': 'Vehicle stop 2, Meridian Stadium -- place frames (both outcomes)',
    'stop-2:clear': 'Vehicle stop 2, Meridian Stadium -- outcome: clear',
    'stop-2:found': 'Vehicle stop 2, Meridian Stadium -- outcome: found',
    'stop-3': 'Vehicle stop 3, Old Town Market Hall -- place frames (both outcomes)',
    'stop-3:clear': 'Vehicle stop 3, Old Town Market Hall -- outcome: clear',
    'stop-3:found': 'Vehicle stop 3, Old Town Market Hall -- outcome: found',
    'stop-4': 'Vehicle stop 4, house at the foot of Kettle Hill -- place frames (both outcomes)',
    'stop-4:clear': 'Vehicle stop 4, house at the foot of Kettle Hill -- outcome: clear',
    'stop-4:found': 'Vehicle stop 4, house at the foot of Kettle Hill -- outcome: found',
    'stop-5': 'Vehicle stop 5, Harrow Mills Unit 4 -- place frames (both outcomes)',
    'stop-5:clear': 'Vehicle stop 5, Harrow Mills Unit 4 -- outcome: clear',
    'stop-5:found': 'Vehicle stop 5, Harrow Mills Unit 4 -- outcome: found',
    'stop-6': 'Vehicle stop 6, Westhollow Chapel -- place frames (both outcomes)',
    'stop-6:clear': 'Vehicle stop 6, Westhollow Chapel -- outcome: clear',
    'stop-6:found': 'Vehicle stop 6, Westhollow Chapel -- outcome: found',
    'generic:building': 'Generic -- any other building',
    'generic:coords': 'Generic -- open ground or a street corner',
    'generic:cave': "Generic -- the decoy caves (Quarry cave, Hermit's cave)",
}

INTRO = [
    ('p', 'After every drone search on the City Map the map shows two to four "drone photos" of what the '
          'drones saw: an aerial frame, a thermal frame, a ground-level or detail frame. This document lists '
          'every frame the game needs, with the caption the participant reads under it and either the full '
          'AI prompt to generate it or a description of what to find on a stock-photo site.'),
    ('p', 'Story-specific frames (the four SOS sites, Kettle Hill, the six vehicle stops) are AI-generated. '
          'The generic sweeps (any other building, open ground, the two decoy caves) are ordinary night '
          'drone shots that can be found online.'),
    ('h3', 'Where the files go'),
    ('p', 'Every frame has a fixed path under <b>' + IMG_ROOT + '</b>. The server reads '
          '<b>services/city-map/photos.json</b> and nothing else, so the file name is the contract: save the '
          'finished image at exactly the path printed for it, replacing the placeholder that is there now. '
          'The placeholders come from <b>scripts/make_placeholders.py</b>, which never overwrites an existing '
          'file, so real footage survives re-runs.'),
    ('h3', 'Which set the participant sees'),
    ('p', 'The server picks a set by key, in this order: the exact story spot (sos-1 to sos-4, '
          'kettle-north-face, kettle-cave-sealed, kettle-cave); for the six vehicle stops the place frames '
          '(stop-N, shown for both outcomes) followed by the outcome frames (stop-N:clear or stop-N:found); '
          'for anything else generic:building, generic:coords or generic:cave.'),
    ('h3', 'Rules that every frame must keep'),
    ('p', 'No people and no faces anywhere. The only exception is the single thermal frame in each '
          '"found" set, which shows exactly one human heat signature indoors: a bright, blurred, '
          'featureless shape with no face, no clothing and no identifying detail. The drones see heat, '
          'not a person. Captions are fixed by the manifest and never state anything the search result '
          'text does not; do not change a caption without changing the result text it belongs to.'),
]


def esc(s):
    return s.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')


# ----------------------------------------------------------------------------
# One block list, rendered twice (PDF and Markdown) so the two stay identical.
#   ('h1', text) ('h2', text) ('h3', text) ('note', text) ('p', text)
#   ('quote', text)                       a style paragraph, indented
#   ('frame', n, frame)                   one frame of a set
#   ('table', header, rows)               the appendix counts
# 'p' text may carry <b>...</b>; everything else is plain text.
# ----------------------------------------------------------------------------

def build_blocks(manifest):
    style = manifest.get('style') or {}
    sets = manifest.get('sets') or {}
    total = sum(len(v) for v in sets.values())
    n_ai = sum(1 for v in sets.values() for f in v if f.get('source') == 'ai')
    n_stock = total - n_ai
    today = datetime.date.today().isoformat()

    blocks = [
        ('h1', TITLE),
        ('note', f'Generated from services/city-map/photos.json on {today}: {len(sets)} sets, {total} frames '
                 f'({n_ai} AI-generated, {n_stock} stock). Sizes: {style.get("sizes", "1600x900 landscape JPEG")}.'),
        ('h2', 'What these frames are for'),
        *INTRO,
        ('h2', 'Style'),
        ('h3', 'Sizes'),
        ('p', esc(style.get('sizes', ''))),
        ('h3', 'AI base prompt -- append this paragraph to every AI prompt below'),
        ('quote', style.get('ai_base_prompt', '')),
        ('h3', 'Thermal note -- applies to every frame of kind "thermal"'),
        ('quote', style.get('thermal_note', '')),
    ]

    for key, frames in sets.items():
        title = SET_TITLES.get(key)
        blocks.append(('h2', f'{key} -- {title}' if title else key))
        for n, frame in enumerate(frames, start=1):
            blocks.append(('frame', n, frame))

    header = ['Key', 'Set', 'Frames', 'AI', 'Stock']
    rows = []
    for key, frames in sets.items():
        ai = sum(1 for f in frames if f.get('source') == 'ai')
        rows.append([key, SET_TITLES.get(key, ''), len(frames), ai, len(frames) - ai])
    rows.append(['Total', f'{len(sets)} sets', total, n_ai, n_stock])
    blocks.append(('h2', 'Appendix -- frame counts'))
    blocks.append(('table', header, rows))

    kinds = {}
    for v in sets.values():
        for f in v:
            k = f.get('kind', '?')
            kinds.setdefault(k, [0, 0])
            kinds[k][0 if f.get('source') == 'ai' else 1] += 1
    krows = [[k, '', a + s, a, s] for k, (a, s) in kinds.items()]
    krows.append(['Total', '', total, n_ai, n_stock])
    blocks.append(('h3', 'By kind'))
    blocks.append(('table', ['Kind', '', 'Frames', 'AI', 'Stock'], krows))
    return blocks


# ----------------------------------------------------------------------------
# PDF
# ----------------------------------------------------------------------------

INK = HexColor('#1d1d1b')
FADED = HexColor('#5a5850')
ACCENT = HexColor('#2b4c8c')
RULE = HexColor('#cccccc')

styles = getSampleStyleSheet()
h1 = ParagraphStyle('H1', parent=styles['Title'], fontName='Helvetica-Bold', fontSize=20, textColor=INK, spaceAfter=4, alignment=TA_LEFT)
h2 = ParagraphStyle('H2', parent=styles['Heading1'], fontName='Helvetica-Bold', fontSize=14.5, textColor=ACCENT, spaceBefore=18, spaceAfter=8)
h3 = ParagraphStyle('H3', parent=styles['Heading2'], fontName='Helvetica-Bold', fontSize=11.5, textColor=INK, spaceBefore=14, spaceAfter=5)
body = ParagraphStyle('Body', parent=styles['Normal'], fontName='Helvetica', fontSize=9.6, leading=14.2, textColor=INK, spaceAfter=7)
note = ParagraphStyle('Note', parent=body, fontName='Helvetica-Oblique', textColor=FADED, fontSize=9)
quote = ParagraphStyle('Quote', parent=body, leftIndent=10, fontSize=9.2, leading=13.4, textColor=INK, spaceAfter=8)
mono = ParagraphStyle('Mono', parent=body, fontName='Courier', fontSize=8.8, leading=12, spaceAfter=2, spaceBefore=8)
label = ParagraphStyle('Label', parent=body, fontName='Helvetica-Bold', fontSize=9.2, spaceAfter=2, spaceBefore=4)
cell = ParagraphStyle('Cell', parent=body, fontSize=8.5, leading=11, spaceAfter=0)
cell_mono = ParagraphStyle('CellMono', parent=cell, fontName='Courier')


def frame_flowables(n, frame):
    head = [
        Paragraph(esc(IMG_ROOT + frame['file']), mono),
        Paragraph(f'<b>{n:02d}</b> &nbsp; kind: <b>{esc(frame.get("kind", "?").upper())}</b>'
                  f' &nbsp; source: {esc(frame.get("source", "?"))}', body),
        Paragraph('<b>Caption:</b> ' + esc(frame.get('caption', '')), body),
    ]
    if frame.get('source') == 'ai':
        head.append(Paragraph('AI PROMPT:', label))
        tail = [Paragraph(esc(frame.get('prompt', '')), quote)]
    else:
        head.append(Paragraph('STOCK -- search for:', label))
        tail = [Paragraph(esc(frame.get('stock', '')), quote)]
    return [KeepTogether(head)] + tail


def count_table(header, rows):
    data = [[Paragraph(f'<b>{esc(str(c))}</b>', cell) for c in header]]
    for r in rows:
        data.append([Paragraph(esc(str(r[0])), cell_mono), Paragraph(esc(str(r[1])), cell)]
                    + [Paragraph(str(c), cell) for c in r[2:]])
    t = Table(data, colWidths=[36 * mm, 82 * mm, 16 * mm, 16 * mm, 16 * mm], repeatRows=1)
    t.setStyle(TableStyle([
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('LINEBELOW', (0, 0), (-1, 0), 0.6, ACCENT),
        ('LINEBELOW', (0, 1), (-1, -2), 0.25, RULE),
        ('LINEABOVE', (0, -1), (-1, -1), 0.6, INK),
        ('TOPPADDING', (0, 0), (-1, -1), 2.5),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 2.5),
    ]))
    return t


def footer(canvas, doc):
    canvas.saveState()
    canvas.setFont('Helvetica', 8)
    canvas.setFillColor(FADED)
    canvas.drawString(doc.leftMargin, 11 * mm, TITLE)
    canvas.drawRightString(A4[0] - doc.rightMargin, 11 * mm, f'page {doc.page}')
    canvas.restoreState()


def render_pdf(blocks):
    story = []
    for b in blocks:
        kind = b[0]
        if kind == 'h1':
            story.append(Paragraph(esc(b[1]), h1))
        elif kind == 'note':
            story.append(Paragraph(esc(b[1]), note))
            story.append(Spacer(1, 6))
        elif kind == 'h2':
            story.append(HRFlowable(width='100%', thickness=0.6, color=RULE, spaceBefore=4, spaceAfter=2))
            story.append(Paragraph(esc(b[1]), h2))
        elif kind == 'h3':
            story.append(Paragraph(esc(b[1]), h3))
        elif kind == 'p':
            story.append(Paragraph(b[1], body))          # may carry <b> tags
        elif kind == 'quote':
            story.append(Paragraph(esc(b[1]), quote))
        elif kind == 'frame':
            story.extend(frame_flowables(b[1], b[2]))
        elif kind == 'table':
            story.append(count_table(b[1], b[2]))
            story.append(Spacer(1, 8))
    doc = SimpleDocTemplate(OUT_PDF, pagesize=A4,
                            leftMargin=22 * mm, rightMargin=22 * mm,
                            topMargin=18 * mm, bottomMargin=18 * mm,
                            title=TITLE, author='MERCY: AI Judgement')
    doc.build(story, onFirstPage=footer, onLaterPages=footer)
    return doc.page


# ----------------------------------------------------------------------------
# Markdown
# ----------------------------------------------------------------------------

def md_inline(s):
    """The 'p' blocks carry <b>..</b>; everything else is plain."""
    return s.replace('<b>', '**').replace('</b>', '**')


def render_md(blocks):
    out = []
    for b in blocks:
        kind = b[0]
        if kind == 'h1':
            out.append(f'# {b[1]}\n')
        elif kind == 'note':
            out.append(f'_{b[1]}_\n')
        elif kind == 'h2':
            out.append(f'\n## {b[1]}\n')
        elif kind == 'h3':
            out.append(f'\n### {b[1]}\n')
        elif kind == 'p':
            out.append(md_inline(b[1]) + '\n')
        elif kind == 'quote':
            out.append(f'> {b[1]}\n')
        elif kind == 'frame':
            n, f = b[1], b[2]
            out.append(f'\n### {n:02d} -- {f.get("kind", "?").upper()} -- `{IMG_ROOT}{f["file"]}`\n')
            out.append(f'**Caption:** {f.get("caption", "")}\n')
            if f.get('source') == 'ai':
                out.append('**AI PROMPT:**\n')
                out.append(f'> {f.get("prompt", "")}\n')
            else:
                out.append('**STOCK -- search for:**\n')
                out.append(f'> {f.get("stock", "")}\n')
        elif kind == 'table':
            header, rows = b[1], b[2]
            out.append('| ' + ' | '.join(header) + ' |')
            out.append('|' + '|'.join(['---'] * len(header)) + '|')
            for r in rows:
                out.append('| `' + str(r[0]) + '` | ' + ' | '.join(str(c) for c in r[1:]) + ' |')
            out.append('')
    with open(OUT_MD, 'w', encoding='utf-8', newline='\n') as fh:
        fh.write('\n'.join(out).rstrip() + '\n')


def build():
    with open(SRC, encoding='utf-8') as fh:
        manifest = json.load(fh)
    blocks = build_blocks(manifest)
    render_md(blocks)
    print(f'wrote {OUT_MD}')
    pages = render_pdf(blocks)
    print(f'wrote {OUT_PDF} ({pages} pages)')


if __name__ == '__main__':
    build()
