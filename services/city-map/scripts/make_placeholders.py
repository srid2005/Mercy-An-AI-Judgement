#!/usr/bin/env python
"""Creates placeholder drone stills for every frame in photos.json.

Reads services/city-map/photos.json (the drone-photo manifest, the only source
of truth for which frames exist) and writes public/images/drone/<file> for
each frame whose file does not already exist. Existing files are never
overwritten, so real footage the author drops in survives every re-run.

Each placeholder is a 1600x900 JPEG in the map's blueprint style: blue-black
ground, faint grid, thin cyan frame with corner brackets, a small circle
reticle, the frame kind top-left (THERMAL frames carry a dark magenta-to-white
palette bar), the set key and frame number bottom-left, the caption wrapped
bottom-right in dim grey.

Usage:
    python scripts/make_placeholders.py           create the missing ones
    python scripts/make_placeholders.py --regen   also rebuild files that are
                                                  themselves placeholders (they
                                                  carry a JPEG comment marker);
                                                  real images are still skipped

Pillow only. Font: C:/Windows/Fonts/consola.ttf, else a DejaVu mono if one is
around, else Pillow's default bitmap font.
"""
import json
import os
import sys

from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
MANIFEST = os.path.normpath(os.path.join(HERE, '..', 'photos.json'))
OUT_DIR = os.path.normpath(os.path.join(HERE, '..', 'public', 'images', 'drone'))

W, H = 1600, 900
MARGIN = 28                      # the cyan frame sits this far in from the edge
GRID_STEP = 100                  # 16 x 9 cells
MARKER = 'mercy-drone-placeholder'   # JPEG comment; lets --regen tell a placeholder from real footage

BG = (7, 17, 31)                 # #07111f  blue-black ground
CYAN = (79, 209, 255)            # #4fd1ff  HUD cyan
WHITE = (255, 255, 255)
MAGENTA_DARK = (42, 6, 48)       # start of the thermal palette bar
MAGENTA = (214, 31, 182)         # its mid stop
CAPTION_GREY = (122, 133, 148)   # dim grey for the caption
DIM = (78, 92, 110)              # dimmer grey for secondary labels

FONT_CANDIDATES = [
    'C:/Windows/Fonts/consola.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf',
    '/System/Library/Fonts/Menlo.ttc',
]

KINDS = ('aerial', 'thermal', 'ground', 'detail')


def blend(a, b, t):
    """Linear blend of two RGB tuples, t=0 -> a, t=1 -> b."""
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


GRID = blend(BG, CYAN, 0.075)
GRID_MAJOR = blend(BG, CYAN, 0.14)
FRAME = blend(BG, CYAN, 0.55)


_font_cache = {}


def font(size):
    """Mono font at the given pixel size; cached. Falls back gracefully."""
    if size in _font_cache:
        return _font_cache[size]
    f = None
    for path in FONT_CANDIDATES:
        try:
            f = ImageFont.truetype(path, size)
            break
        except OSError:
            continue
    if f is None:
        try:
            f = ImageFont.load_default(size=size)   # Pillow >= 10.1: scalable default
        except TypeError:
            f = ImageFont.load_default()            # old Pillow: fixed bitmap font
    _font_cache[size] = f
    return f


def text_w(draw, text, fnt):
    try:
        return draw.textlength(text, font=fnt)
    except AttributeError:                          # very old Pillow
        return draw.textsize(text, font=fnt)[0]


def wrap(draw, text, fnt, max_w):
    """Greedy word wrap to max_w pixels."""
    words = text.split()
    lines, cur = [], ''
    for word in words:
        trial = (cur + ' ' + word).strip()
        if not cur or text_w(draw, trial, fnt) <= max_w:
            cur = trial
        else:
            lines.append(cur)
            cur = word
    if cur:
        lines.append(cur)
    return lines


def draw_grid(draw):
    x0, y0, x1, y1 = MARGIN, MARGIN, W - MARGIN - 1, H - MARGIN - 1
    for x in range(GRID_STEP, W, GRID_STEP):
        if x0 < x < x1:
            draw.line([(x, y0), (x, y1)], fill=GRID, width=1)
    for y in range(GRID_STEP, H, GRID_STEP):
        if y0 < y < y1:
            draw.line([(x0, y), (x1, y)], fill=GRID, width=1)
    # the two centre lines, a shade brighter, run through the reticle
    draw.line([(W // 2, y0), (W // 2, y1)], fill=GRID_MAJOR, width=1)
    draw.line([(x0, H // 2), (x1, H // 2)], fill=GRID_MAJOR, width=1)


def draw_frame(draw):
    x0, y0, x1, y1 = MARGIN, MARGIN, W - MARGIN - 1, H - MARGIN - 1
    draw.rectangle([x0, y0, x1, y1], outline=FRAME, width=1)
    L, T = 46, 3   # bracket arm length and thickness
    for cx, cy, sx, sy in ((x0, y0, 1, 1), (x1, y0, -1, 1), (x0, y1, 1, -1), (x1, y1, -1, -1)):
        draw.line([(cx, cy), (cx + sx * L, cy)], fill=CYAN, width=T)
        draw.line([(cx, cy), (cx, cy + sy * L)], fill=CYAN, width=T)


def draw_reticle(draw):
    cx, cy, r = W // 2, H // 2, 26
    draw.ellipse([cx - r, cy - r, cx + r, cy + r], outline=CYAN, width=2)
    for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        draw.line([(cx + dx * (r + 6), cy + dy * (r + 6)), (cx + dx * (r + 20), cy + dy * (r + 20))], fill=CYAN, width=2)
    draw.ellipse([cx - 2, cy - 2, cx + 2, cy + 2], fill=CYAN)
    f = font(18)
    label = 'AWAITING FOOTAGE'
    draw.text((cx - text_w(draw, label, f) / 2, cy + r + 30), label, font=f, fill=DIM)


def draw_gradient_bar(draw, x, y, w, h):
    """Dark magenta -> magenta -> white, the thermal palette strip."""
    for i in range(w):
        t = i / max(1, w - 1)
        c = blend(MAGENTA_DARK, MAGENTA, t * 2) if t < 0.5 else blend(MAGENTA, WHITE, (t - 0.5) * 2)
        draw.line([(x + i, y), (x + i, y + h - 1)], fill=c)
    draw.rectangle([x - 1, y - 1, x + w, y + h], outline=FRAME, width=1)


def draw_kind(draw, kind):
    x, y = MARGIN + 22, MARGIN + 14
    f = font(36)
    draw.text((x, y), kind.upper(), font=f, fill=CYAN)
    if kind == 'thermal':
        draw_gradient_bar(draw, x + 2, y + 52, 240, 12)


def draw_footer(draw, key, index, rel_file, caption):
    f_id = font(22)
    f_path = font(17)
    f_cap = font(22)
    base = H - MARGIN - 18

    # bottom-left: key and frame number, then the file path beneath
    path_h = f_path.size if hasattr(f_path, 'size') else 16
    id_h = f_id.size if hasattr(f_id, 'size') else 16
    draw.text((MARGIN + 22, base - path_h), rel_file, font=f_path, fill=DIM)
    draw.text((MARGIN + 22, base - path_h - 8 - id_h), f'{key}  ·  {index:02d}', font=f_id, fill=FRAME)

    # bottom-right: caption, right-aligned, wrapped, growing upward
    max_w = 780
    lines = wrap(draw, caption, f_cap, max_w)
    if len(lines) > 4:
        lines = lines[:4]
        lines[-1] = lines[-1][:-3].rstrip() + '...'
    line_h = (f_cap.size if hasattr(f_cap, 'size') else 16) + 8
    right = W - MARGIN - 22
    y = base - len(lines) * line_h + 6
    for line in lines:
        draw.text((right - text_w(draw, line, f_cap), y), line, font=f_cap, fill=CAPTION_GREY)
        y += line_h


def render(key, index, frame):
    img = Image.new('RGB', (W, H), BG)
    draw = ImageDraw.Draw(img)
    draw_grid(draw)
    draw_frame(draw)
    draw_reticle(draw)
    kind = frame.get('kind', '')
    draw_kind(draw, kind if kind in KINDS else (kind or 'frame'))
    draw_footer(draw, key, index, frame['file'], frame.get('caption', ''))
    return img


def is_placeholder(path):
    try:
        with Image.open(path) as im:
            c = im.info.get('comment', b'')
            if isinstance(c, bytes):
                c = c.decode('utf-8', 'ignore')
            return MARKER in c
    except Exception:
        return False


def main(argv):
    regen = '--regen' in argv
    with open(MANIFEST, encoding='utf-8') as fh:
        manifest = json.load(fh)
    sets = manifest.get('sets') or {}
    if not isinstance(sets, dict) or not sets:
        sys.exit(f'{MANIFEST}: no "sets" object')

    created = skipped = regenerated = 0
    for key, frames in sets.items():
        for i, frame in enumerate(frames, start=1):
            rel = frame['file']
            dest = os.path.normpath(os.path.join(OUT_DIR, rel))
            if not dest.startswith(OUT_DIR + os.sep):
                sys.exit(f'refusing to write outside {OUT_DIR}: {rel}')
            exists = os.path.exists(dest)
            if exists and not (regen and is_placeholder(dest)):
                skipped += 1
                continue
            os.makedirs(os.path.dirname(dest), exist_ok=True)
            img = render(key, i, frame)
            img.save(dest, 'JPEG', quality=88, optimize=True, comment=MARKER)
            if exists:
                regenerated += 1
                print(f'regen   {rel}')
            else:
                created += 1
                print(f'created {rel}')

    total = created + skipped + regenerated
    print(f'\n{total} frames in {len(sets)} sets: created {created}, skipped {skipped} (already present)'
          + (f', regenerated {regenerated}' if regen else '')
          + f'\n-> {OUT_DIR}')


if __name__ == '__main__':
    main(sys.argv[1:])
