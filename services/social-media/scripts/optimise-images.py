#!/usr/bin/env python3
"""Re-encode public/images in place.

The seeded photographs came out of the source-media folder at print
resolution -- 2.8 MB PNGs at 1774x887 for a feed column that is 470 CSS
pixels wide, and a 1.98 MB avatar drawn at 32x32. Fifty participants pull
the whole of it over event wifi on the first feed render, which is most of
the lag people report as "the app is slow".

Posts drop to a 1100px long edge (still better than 2x the largest box the
UI ever gives them: the detail modal's ~600px pane) as progressive JPEG
q82. PNG was measured first and kept losing by an order of magnitude --
cave-1 is 2.60 MB native, 1.69 MB as an optimised 1100px PNG, 0.19 MB as
JPEG -- so the post PNGs change extension and db/init.sql plus
scripts/migrate_live_image_reencode.sql follow them. Avatars keep their
extension: at 128x128 even PNG is ~30 KB, which is not worth a second
column of image_url rewrites in users/feed_filler/dm_filler_threads.

meme-2.webp stays WebP: it is already the best encoder for that frame and
leaving the extension alone keeps it out of the migration.

Also writes public/images/manifest.json -- the post dimensions server.js
hands to the feed so the browser can reserve each image's box before it
loads. Regenerate by re-running this script.

    python services/social-media/scripts/optimise-images.py
"""
import json
import os
from PIL import Image, ImageOps

HERE = os.path.dirname(os.path.abspath(__file__))
IMAGES = os.path.normpath(os.path.join(HERE, '..', 'public', 'images'))
POSTS = os.path.join(IMAGES, 'posts')
AVATARS = os.path.join(IMAGES, 'avatars')

POST_LONG_EDGE = 1100
POST_QUALITY = 82
AVATAR_SIZE = 128


def save_jpeg(im, dest, quality):
    im.convert('RGB').save(dest, 'JPEG', quality=quality, progressive=True, optimize=True)


def reencode_post(name):
    """One post image. Returns (old_name, new_name, before, after)."""
    src = os.path.join(POSTS, name)
    before = os.path.getsize(src)
    stem, ext = os.path.splitext(name)
    ext = ext.lower()

    with Image.open(src) as im:
        im.load()
        w, h = im.size
        scale = min(1.0, POST_LONG_EDGE / max(w, h))
        out = im.resize((round(w * scale), round(h * scale)), Image.LANCZOS) if scale < 1.0 else im.copy()

    if ext == '.webp':
        dest = src
        out.save(dest, 'WEBP', quality=POST_QUALITY, method=6)
    else:
        # .png and .jpg both land on .jpg; the rename is what db/init.sql and
        # the live migration exist to follow.
        dest = os.path.join(POSTS, stem + '.jpg')
        save_jpeg(out, dest, POST_QUALITY)
        if dest != src:
            os.remove(src)

    return name, os.path.basename(dest), before, os.path.getsize(dest), out.size


def reencode_avatar(name):
    src = os.path.join(AVATARS, name)
    before = os.path.getsize(src)
    ext = os.path.splitext(name)[1].lower()

    with Image.open(src) as im:
        im.load()
        # The UI always draws avatars with object-fit: cover inside a circle,
        # so crop to square here rather than shipping the padding.
        out = ImageOps.fit(im, (AVATAR_SIZE, AVATAR_SIZE), Image.LANCZOS)

    if ext == '.png':
        out.convert('RGBA' if out.mode in ('RGBA', 'LA', 'P') else 'RGB').save(src, 'PNG', optimize=True)
    else:
        save_jpeg(out, src, POST_QUALITY)
    return name, name, before, os.path.getsize(src), out.size


def main():
    rows = []
    for name in sorted(os.listdir(POSTS)):
        if name.lower().endswith(('.png', '.jpg', '.jpeg', '.webp')):
            rows.append(('posts',) + reencode_post(name))
    for name in sorted(os.listdir(AVATARS)):
        if name.lower().endswith(('.png', '.jpg', '.jpeg')):
            rows.append(('avatars',) + reencode_avatar(name))

    manifest = {}
    for name in sorted(os.listdir(POSTS)):
        path = os.path.join(POSTS, name)
        if not os.path.isfile(path):
            continue
        try:
            with Image.open(path) as im:
                manifest['/images/posts/' + name] = list(im.size)
        except OSError:
            continue
    with open(os.path.join(IMAGES, 'manifest.json'), 'w', encoding='utf-8') as fh:
        json.dump(manifest, fh, indent=2, sort_keys=True)
        fh.write('\n')

    print(f"{'dir':8} {'before':>24} {'after':>24} {'bytes before':>13} {'bytes after':>12} {'size':>11}")
    total_before = total_after = 0
    for d, old, new, before, after, size in rows:
        total_before += before
        total_after += after
        print(f'{d:8} {old:>24} {new:>24} {before:>13,} {after:>12,} {size[0]:>5}x{size[1]:<5}')
    print(f'{"TOTAL":8} {"":>24} {"":>24} {total_before:>13,} {total_after:>12,}'
          f'   ({100 * total_after / total_before:.1f}% of original)')


if __name__ == '__main__':
    main()
