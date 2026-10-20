"""Draw the app icons: a pitch corner with chalk lines and a yellow corner flag.
Usage: python3 -I make_icons.py <out_dir>
"""
import sys
from PIL import Image, ImageDraw

OUT = sys.argv[1]
GRASS, GRASS2, CHALK, FLAG, POLE = (47, 108, 75), (42, 99, 68), (243, 245, 238), (242, 194, 48), (243, 245, 238)


def icon(size):
    S = 4 * size  # draw large, then downsample for smooth edges
    im = Image.new('RGB', (S, S), GRASS)
    d = ImageDraw.Draw(im)
    band = S // 6
    for k in range(0, 6, 2):
        d.rectangle([0, k * band, S, (k + 1) * band], fill=GRASS2)
    w = max(4, S // 40)
    cx, cy = int(S * 0.26), int(S * 0.74)  # corner point: touchline on the left, goal line at the bottom
    d.line([(cx, -10), (cx, cy)], fill=CHALK, width=w)
    d.line([(cx, cy), (S + 10, cy)], fill=CHALK, width=w)
    r = int(S * 0.13)
    d.arc([cx - r, cy - r, cx + r, cy + r], start=270, end=360, fill=CHALK, width=w)
    # penalty-box corner hint on the right
    bx = int(S * 0.78)
    d.line([(bx, cy), (bx, int(S * 0.5))], fill=CHALK, width=w)
    d.line([(bx, int(S * 0.5)), (S + 10, int(S * 0.5))], fill=CHALK, width=w)
    # corner flag
    top = int(S * 0.2)
    d.line([(cx, cy), (cx, top)], fill=POLE, width=int(w * 1.4))
    fw, fh = int(S * 0.3), int(S * 0.2)
    d.polygon([(cx + w, top), (cx + w + fw, top), (cx + w + int(fw * 0.72), top + fh // 2), (cx + w + fw, top + fh), (cx + w, top + fh)], fill=FLAG)
    return im.resize((size, size), Image.LANCZOS)


for n in (180, 192, 512):
    icon(n).save(f'{OUT}/icon-{n}.png', optimize=True)
print('ok')
