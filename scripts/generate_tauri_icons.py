#!/usr/bin/env python3
from __future__ import annotations

import pathlib
import struct
import zlib


ROOT = pathlib.Path(__file__).resolve().parents[1]
ICONS_DIR = ROOT / "src-tauri" / "icons"

BG = (244, 197, 66, 255)
FG = (28, 28, 28, 255)
ACCENT = (255, 255, 255, 255)


def draw_icon(size: int) -> bytes:
    center = size // 2
    circle_radius = round(size * 0.332)
    bar_left = round(size * 0.352)
    bar_right = round(size * 0.648)
    top_bar_top = round(size * 0.234)
    top_bar_bottom = round(size * 0.320)
    stem_left = round(size * 0.562)
    stem_right = round(size * 0.648)
    stem_top = top_bar_top
    stem_bottom = round(size * 0.633)
    footer_top = stem_bottom
    footer_bottom = round(size * 0.719)
    hook_left = round(size * 0.352)
    hook_right = round(size * 0.438)
    hook_top = round(size * 0.547)
    hook_bottom = footer_bottom
    hook_corner_radius = max(2, round(size * 0.086))

    rows: list[bytes] = []
    for y in range(size):
        row = bytearray([0])
        for x in range(size):
            rgba = BG
            dx = x - center
            dy = y - center
            if dx * dx + dy * dy <= circle_radius * circle_radius:
                rgba = FG
            if bar_left <= x <= bar_right and top_bar_top <= y <= top_bar_bottom:
                rgba = ACCENT
            if stem_left <= x <= stem_right and stem_top <= y <= stem_bottom:
                rgba = ACCENT
            if bar_left <= x <= bar_right and footer_top <= y <= footer_bottom:
                rgba = ACCENT
            if hook_left <= x <= hook_right and hook_top <= y <= hook_bottom:
                rgba = ACCENT

            hdx = x - hook_right
            hdy = y - footer_top
            if hdx < 0 and hdy > 0 and hdx * hdx + hdy * hdy <= hook_corner_radius * hook_corner_radius:
                rgba = ACCENT

            row.extend(rgba)
        rows.append(bytes(row))
    return b"".join(rows)


def png_chunk(tag: bytes, data: bytes) -> bytes:
    return (
        struct.pack(">I", len(data))
        + tag
        + data
        + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    )


def encode_png(size: int) -> bytes:
    raw = draw_icon(size)
    return (
        b"\x89PNG\r\n\x1a\n"
        + png_chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
        + png_chunk(b"IDAT", zlib.compress(raw, 9))
        + png_chunk(b"IEND", b"")
    )


def main() -> None:
    ICONS_DIR.mkdir(parents=True, exist_ok=True)
    outputs = {
        "32x32.png": 32,
        "128x128.png": 128,
        "128x128@2x.png": 256,
        "icon.png": 512,
    }
    for filename, size in outputs.items():
        (ICONS_DIR / filename).write_bytes(encode_png(size))
        print(f"generated {ICONS_DIR / filename}")


if __name__ == "__main__":
    main()
