#!/usr/bin/env python3
"""4조 근무표 앱 아이콘 생성 (외부 폰트 없이 도형만 사용)."""
from PIL import Image, ImageDraw

BG = [(22, 33, 58), (10, 16, 30)]
COLORS = ["#f59e0b", "#3b82f6", "#8b5cf6", "#34d399"]


def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def gradient(size):
    img = Image.new("RGB", (size, size), BG[0])
    d = ImageDraw.Draw(img)
    for y in range(size):
        d.line([(0, y), (size, y)], fill=lerp(BG[0], BG[1], y / max(1, size - 1)))
    return img


def draw_blocks(img, size, inset_frac=0.0):
    d = ImageDraw.Draw(img)
    pad = size * 0.17 + size * inset_frac
    gap = size * 0.055
    inner = size - pad * 2
    cell = (inner - gap) / 2
    radius = cell * 0.28
    for i, col in enumerate(COLORS):
        cx = pad + (i % 2) * (cell + gap)
        cy = pad + (i // 2) * (cell + gap)
        d.rounded_rectangle([cx, cy, cx + cell, cy + cell], radius=radius, fill=col)
        # subtle top highlight
        hi = tuple(min(255, int(col[1:3], 16) * 0.25 + 190) for _ in range(3)) if False else None
    return img


def rounded_mask(size, radius):
    m = Image.new("L", (size, size), 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
    return m


def make(size, corner_frac, out):
    base = gradient(size)
    draw_blocks(base, size)
    if corner_frac:
        base = base.convert("RGBA")
        base.putalpha(rounded_mask(size, int(size * corner_frac)))
        base.save(out)
    else:
        base.save(out, quality=95)


def make_maskable(size, out):
    img = gradient(size).convert("RGBA")
    draw_blocks(img, size, inset_frac=0.10)
    img.save(out)


if __name__ == "__main__":
    import os
    os.makedirs("icons", exist_ok=True)
    make(512, 0.22, "icons/icon-512.png")
    make(192, 0.22, "icons/icon-192.png")
    make(180, 0, "icons/apple-touch-icon.png")
    make_maskable(512, "icons/icon-maskable-512.png")
    make(32, 0.22, "icons/favicon-32.png")
    print("icons done")
