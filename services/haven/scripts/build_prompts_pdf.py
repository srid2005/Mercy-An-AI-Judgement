#!/usr/bin/env python
"""Renders VIDEO_PROMPTS.md to VIDEO_PROMPTS.pdf -- a plain, readable
document, not a game asset. Minimal markdown: #, ##, ###, **bold**, blank
lines as paragraph breaks, --- as a rule.
"""
import os
import re
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.colors import HexColor
from reportlab.lib.enums import TA_LEFT
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, HRFlowable, PageBreak

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, '..', 'VIDEO_PROMPTS.md')
OUT = os.path.join(HERE, '..', 'VIDEO_PROMPTS.pdf')

INK = HexColor('#1d1d1b')
FADED = HexColor('#5a5850')
ACCENT = HexColor('#2b4c8c')

styles = getSampleStyleSheet()
h1 = ParagraphStyle('H1', parent=styles['Title'], fontName='Helvetica-Bold', fontSize=20, textColor=INK, spaceAfter=4, alignment=TA_LEFT)
h2 = ParagraphStyle('H2', parent=styles['Heading1'], fontName='Helvetica-Bold', fontSize=14.5, textColor=ACCENT, spaceBefore=18, spaceAfter=8)
h3 = ParagraphStyle('H3', parent=styles['Heading2'], fontName='Helvetica-Bold', fontSize=11.5, textColor=INK, spaceBefore=14, spaceAfter=5)
body = ParagraphStyle('Body', parent=styles['Normal'], fontName='Helvetica', fontSize=9.6, leading=14.2, textColor=INK, spaceAfter=7)
clip = ParagraphStyle('Clip', parent=body, leftIndent=10, fontSize=9.4, leading=13.6, spaceAfter=8)
note = ParagraphStyle('Note', parent=body, fontName='Helvetica-Oblique', textColor=FADED, fontSize=9)


def inline(s):
    s = s.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')
    s = re.sub(r'\*\*(.+?)\*\*', r'<b>\1</b>', s)
    return s


def build():
    lines = open(SRC, encoding='utf-8').read().split('\n')
    story = []
    para_buf = []

    def flush():
        if para_buf:
            text = ' '.join(l.strip() for l in para_buf if l.strip())
            if text:
                style = clip if text.startswith('**Clip') else body
                story.append(Paragraph(inline(text), style))
            para_buf.clear()

    for raw in lines:
        line = raw.rstrip()
        if line.startswith('# '):
            flush(); story.append(Paragraph(inline(line[2:]), h1))
            story.append(Paragraph('Video-generation prompts for every Haven diary entry', note))
            story.append(Spacer(1, 6))
        elif line.startswith('## '):
            flush(); story.append(HRFlowable(width='100%', thickness=0.6, color=HexColor('#cccccc'), spaceBefore=4, spaceAfter=2))
            story.append(Paragraph(inline(line[3:]), h2))
        elif line.startswith('### '):
            flush(); story.append(Paragraph(inline(line[4:]), h3))
        elif line.strip() == '---':
            flush(); story.append(Spacer(1, 4))
        elif line.strip() == '':
            flush()
        else:
            para_buf.append(line)
    flush()

    doc = SimpleDocTemplate(OUT, pagesize=A4,
                             leftMargin=22 * mm, rightMargin=22 * mm,
                             topMargin=18 * mm, bottomMargin=18 * mm,
                             title='Haven -- Video Generation Prompts')
    doc.build(story)
    print(f'wrote {OUT}')


if __name__ == '__main__':
    build()
