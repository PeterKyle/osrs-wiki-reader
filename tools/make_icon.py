"""Renders the OSRS Wiki Reader app icon at each size (supersampled), and writes a multi-size .ico."""
import io, struct, sys
from PIL import Image, ImageDraw, ImageFilter

def lerp(a, b, t): return a + (b - a) * t
def mix(c1, c2, t): return tuple(int(round(lerp(a, b, t))) for a, b in zip(c1, c2))
def hexc(h): h = h.lstrip('#'); return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))

def quad(p0, p1, p2, n=40):
    return [(lerp(lerp(p0[0], p1[0], t), lerp(p1[0], p2[0], t), t), lerp(lerp(p0[1], p1[1], t), lerp(p1[1], p2[1], t), t))
            for t in (i / n for i in range(n + 1))]

def squircle(R, inset, n=5.0, steps=720):
    import math
    c = R / 2; a = R / 2 - inset
    pts = []
    for i in range(steps):
        t = 2 * math.pi * i / steps
        ct, st = math.cos(t), math.sin(t)
        x = c + a * (abs(ct) ** (2 / n)) * (1 if ct >= 0 else -1)
        y = c + a * (abs(st) ** (2 / n)) * (1 if st >= 0 else -1)
        pts.append((x, y))
    return pts

def vgradient(R, top, bottom, y0=0.0, y1=1.0):
    g = Image.new('RGBA', (1, 256))
    for i in range(256):
        t = min(1, max(0, (i / 255 - y0) / max(1e-6, (y1 - y0))))
        g.putpixel((0, i), mix(top, bottom, t) + (255,))
    return g.resize((R, R), Image.BILINEAR)

def render(size):
    S = 8 if size <= 64 else 4
    R = size * S
    detail = size >= 32
    u = lambda v: v * R
    img = Image.new('RGBA', (R, R), (0, 0, 0, 0))

    # tile: squircle with a warm charcoal gradient, faint top highlight, hairline edge
    inset = u(0.045)
    mask = Image.new('L', (R, R), 0); ImageDraw.Draw(mask).polygon(squircle(R, inset), fill=255)
    tile = vgradient(R, hexc('#34302b'), hexc('#151311'))
    img.paste(tile, (0, 0), mask)
    hl = Image.new('L', (R, R), 0); ImageDraw.Draw(hl).polygon(squircle(R, inset + max(1, u(0.008))), fill=255)
    edge = Image.eval(mask, lambda v: v) ; ring = Image.new('L', (R, R), 0)
    ring.paste(mask); ring.paste(0, (0, 0), hl)
    top_glow = vgradient(R, (255, 255, 255), (255, 255, 255))
    top_alpha = Image.new('L', (R, R), 0)
    for y in range(R):
        a = max(0, 1 - y / (R * 0.5)) * 46
        top_alpha.paste(int(a), (0, y, R, y + 1))
    ring_a = Image.composite(top_alpha, Image.new('L', (R, R), 10), ring)
    ring_a = Image.composite(ring_a, Image.new('L', (R, R), 0), ring)
    img.paste(Image.new('RGBA', (R, R), (255, 255, 255, 255)), (0, 0), ring_a)

    # book geometry (unit square)
    spine_gap = 0.022 if detail else 0.035
    L_out, R_out = 0.19, 0.81
    top_out, top_in = 0.315, 0.355
    bot_out, bot_in = 0.705, 0.745
    lift = 0.045
    def page(side):
        sx = 0.5 - spine_gap / 2 if side < 0 else 0.5 + spine_gap / 2
        ox = L_out if side < 0 else R_out
        mx = (sx + ox) / 2
        top = quad((sx, top_in), (mx, top_in - lift - 0.012), (ox, top_out))
        bot = quad((ox, bot_out), (mx, bot_in - lift + 0.02), (sx, bot_in))
        return [(u(x), u(y)) for x, y in top + bot]

    # soft shadow under the book
    sh = Image.new('L', (R, R), 0); d = ImageDraw.Draw(sh)
    for side in (-1, 1):
        d.polygon([(x, y + u(0.035)) for x, y in page(side)], fill=150)
    sh = sh.filter(ImageFilter.GaussianBlur(u(0.03)))
    sh = Image.composite(sh, Image.new('L', (R, R), 0), mask)
    img.paste(Image.new('RGBA', (R, R), (0, 0, 0, 255)), (0, 0), sh)

    # cover edge: darker gold, peeking below the pages
    cov = Image.new('L', (R, R), 0); d = ImageDraw.Draw(cov)
    for side in (-1, 1):
        d.polygon([(x + side * u(0.012), y + u(0.022)) for x, y in page(side)], fill=255)
    img.paste(Image.new('RGBA', (R, R), hexc('#8c5d1c') + (255,)), (0, 0), cov)

    # pages: warm gold gradient
    pg = Image.new('L', (R, R), 0); d = ImageDraw.Draw(pg)
    for side in (-1, 1):
        d.polygon(page(side), fill=255)
    gold = vgradient(R, hexc('#fbdc8e'), hexc('#d99f3f'), 0.28, 0.76)
    img.paste(gold, (0, 0), pg)

    if detail:
        # text lines on each page, following the page curve
        d = ImageDraw.Draw(img)
        lw = max(1, int(u(0.016)))
        col = hexc('#b07a2a') + (190,)
        for side in (-1, 1):
            sx = 0.5 + side * (spine_gap / 2 + 0.05)
            ox = 0.5 + side * (0.5 - L_out - 0.06)
            for k, dy in enumerate((0.11, 0.19, 0.27)):
                if side > 0 and k == 0:
                    continue  # room for the ribbon
                mx = (sx + ox) / 2
                pts = quad((sx, top_in + dy), (mx, top_in + dy - lift - 0.006), (ox, top_out + dy + 0.004), 24)
                d.line([(u(x), u(y)) for x, y in pts], fill=col, width=lw, joint='curve')
        # red ribbon bookmark from the top of the right page
        rx0, rx1, ry0, ry1 = 0.585, 0.635, 0.29, 0.80
        notch = 0.035
        rib = [(u(rx0), u(ry0)), (u(rx1), u(ry0 - 0.004)), (u(rx1), u(ry1)), (u((rx0 + rx1) / 2), u(ry1 - notch)), (u(rx0), u(ry1))]
        rm = Image.new('L', (R, R), 0); ImageDraw.Draw(rm).polygon(rib, fill=255)
        red = vgradient(R, hexc('#e0574a'), hexc('#a8302a'), 0.3, 0.8)
        img.paste(red, (0, 0), rm)

    return img.resize((size, size), Image.LANCZOS)

def write_ico(path, images):
    entries, blobs = [], []
    for im in images:
        b = io.BytesIO(); im.save(b, 'PNG'); blobs.append(b.getvalue())
    offset = 6 + 16 * len(images)
    out = struct.pack('<HHH', 0, 1, len(images))
    for im, blob in zip(images, blobs):
        w = im.width if im.width < 256 else 0
        out += struct.pack('<BBBBHHII', w, w, 0, 0, 1, 32, len(blob), offset)
        offset += len(blob)
    with open(path, 'wb') as f:
        f.write(out + b''.join(blobs))

if __name__ == '__main__':
    out_ico, preview = sys.argv[1], sys.argv[2]
    sizes = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256]
    imgs = [render(s) for s in sizes]
    write_ico(out_ico, imgs)
    sheet = Image.new('RGBA', (760, 300), (243, 243, 243, 255)); sheet.paste((32, 32, 32, 255), (380, 0, 760, 300))
    big = imgs[-1].resize((160, 160), Image.LANCZOS)
    for ox in (0, 380):
        sheet.alpha_composite(big, (ox + 20, 70))
        x = ox + 200
        for im in (imgs[0], imgs[2], imgs[3], imgs[5], imgs[6]):
            sheet.alpha_composite(im, (x, 150 - im.height // 2)); x += im.width + 14
    sheet.save(preview)
    print('ok', [im.size for im in imgs])
