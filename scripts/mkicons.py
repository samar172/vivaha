# The VC monogram as PNGs, drawn analytically. No image library is installed on
# this machine and the app icon has to be a raster for Android and iOS to accept
# it, so the mark is described as geometry and supersampled 3x for smooth edges.
import math, struct, zlib, os

OUT = "apps/web/public"
BRAND = (0xA8, 0x1F, 0x52)
WHITE = (0xFF, 0xFF, 0xFF)
SS = 3  # supersampling factor


def rrect(x, y, w, h, r):
    """Inside a rounded rectangle?"""
    def f(px, py):
        if not (x <= px <= x + w and y <= py <= y + h):
            return False
        cx = min(max(px, x + r), x + w - r)
        cy = min(max(py, y + r), y + h - r)
        return (px - cx) ** 2 + (py - cy) ** 2 <= r * r
    return f


def seg(ax, ay, bx, by, t):
    """Inside a round-capped stroke from a to b of thickness t?"""
    def f(px, py):
        dx, dy = bx - ax, by - ay
        L2 = dx * dx + dy * dy
        u = 0.0 if L2 == 0 else max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / L2))
        qx, qy = ax + u * dx, ay + u * dy
        return (px - qx) ** 2 + (py - qy) ** 2 <= (t / 2) ** 2
    return f


def arc(cx, cy, rad, t, a0, a1):
    """Inside a C-shaped arc (degrees, counter-clockwise from a0 to a1)?"""
    def f(px, py):
        d = math.hypot(px - cx, py - cy)
        if abs(d - rad) > t / 2:
            return False
        a = math.degrees(math.atan2(-(py - cy), px - cx)) % 360
        lo, hi = a0 % 360, a1 % 360
        return (lo <= a <= hi) if lo <= hi else (a >= lo or a <= hi)
    return f


def monogram(size, pad_frac):
    """The mark on its plate, as an RGB pixel buffer."""
    pad = size * pad_frac
    box = size - 2 * pad
    plate = rrect(pad, pad, box, box, box * 0.22)

    # V and C sized off the plate so both icon paddings look the same.
    u = box / 100.0
    def P(x, y):
        return (pad + x * u, pad + y * u)
    t = 13 * u
    v1a, v1b = P(18, 30), P(31, 70)
    v2a, v2b = P(44, 30), P(31, 70)
    vs = (seg(*v1a, *v1b, t), seg(*v2a, *v2b, t))
    ccx, ccy = P(72, 50)
    ca = arc(ccx, ccy, 16.5 * u, t, 38, 322)

    rows = []
    for py in range(size):
        row = bytearray()
        for px in range(size):
            r = g = b = 0
            hit = 0
            for sy in range(SS):
                for sx in range(SS):
                    fx = px + (sx + 0.5) / SS
                    fy = py + (sy + 0.5) / SS
                    if not plate(fx, fy):
                        continue
                    hit += 1
                    ink = vs[0](fx, fy) or vs[1](fx, fy) or ca(fx, fy)
                    c = WHITE if ink else BRAND
                    r += c[0]; g += c[1]; b += c[2]
            n = SS * SS
            # Outside the plate stays brand-coloured too: a maskable icon must
            # bleed to the edge, and the non-maskable one is a full-bleed square.
            miss = n - hit
            r += BRAND[0] * miss; g += BRAND[1] * miss; b += BRAND[2] * miss
            row += bytes((r // n, g // n, b // n))
        rows.append(bytes(row))
    return rows


def png(path, rows, size):
    raw = b"".join(b"\x00" + r for r in rows)
    def chunk(tag, data):
        c = tag + data
        return struct.pack(">I", len(data)) + c + struct.pack(">I", zlib.crc32(c) & 0xFFFFFFFF)
    out = b"\x89PNG\r\n\x1a\n"
    out += chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0))
    out += chunk(b"IDAT", zlib.compress(raw, 9))
    out += chunk(b"IEND", b"")
    open(path, "wb").write(out)
    print(f"  {path}  {size}px  {len(out)/1024:.1f} kB")


os.makedirs(OUT, exist_ok=True)
for size, name, pad in [
    (192, "icon-192.png", 0.0),
    (512, "icon-512.png", 0.0),
    (192, "icon-192-maskable.png", 0.13),
    (512, "icon-512-maskable.png", 0.13),
    (180, "apple-touch-icon.png", 0.06),
]:
    png(f"{OUT}/{name}", monogram(size, pad), size)
