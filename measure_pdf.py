#!/usr/bin/env python3
"""Measure a printed brochure PDF rasterised to PPM.

Pure stdlib: parses binary P6 PPM (what `pdftoppm` emits) directly, so there
is no Pillow dependency. Reports, per page:
  - page size in points / inches
  - a per-edge white-pixel profile (full-bleed check)
  - the column boundaries found by scanning row colours (fold-line check)
"""

import subprocess
import sys
from pathlib import Path


def read_ppm(path: Path):
    data = path.read_bytes()
    if not data.startswith(b"P6"):
        raise SystemExit(f"{path} is not a binary PPM")
    # header: P6 <w> <h> <maxval>, whitespace/comment separated
    fields = []
    i = 2
    while len(fields) < 3:
        while i < len(data) and data[i : i + 1].isspace():
            i += 1
        if data[i : i + 1] == b"#":
            while data[i : i + 1] not in (b"\n", b""):
                i += 1
            continue
        start = i
        while i < len(data) and not data[i : i + 1].isspace():
            i += 1
        fields.append(int(data[start:i]))
    i += 1  # single whitespace after maxval
    w, h, maxval = fields
    if maxval != 255:
        raise SystemExit("expected 8-bit PPM")
    return w, h, memoryview(data)[i : i + w * h * 3]


def px(buf, w, x, y):
    o = (y * w + x) * 3
    return buf[o], buf[o + 1], buf[o + 2]


def is_white(p, tol=250):
    return p[0] >= tol and p[1] >= tol and p[2] >= tol


def edge_report(buf, w, h, inset=0):
    """Fraction of non-white pixels along each edge line (inset rows/cols in)."""
    out = {}
    top = [px(buf, w, x, inset) for x in range(w)]
    bottom = [px(buf, w, x, h - 1 - inset) for x in range(w)]
    left = [px(buf, w, inset, y) for y in range(h)]
    right = [px(buf, w, w - 1 - inset, y) for y in range(h)]
    for name, line in (
        ("top", top),
        ("bottom", bottom),
        ("left", left),
        ("right", right),
    ):
        painted = sum(0 if is_white(p) else 1 for p in line)
        out[name] = {
            "n": len(line),
            "painted": painted,
            "painted_pct": round(100 * painted / len(line), 2),
        }
    return out


def white_band(buf, w, h, side):
    """How many fully-white pixel rows/cols sit at the given edge."""
    if side in ("top", "bottom"):
        rng = range(h) if side == "top" else range(h - 1, -1, -1)
        for k, y in enumerate(rng):
            if any(not is_white(px(buf, w, x, y)) for x in range(w)):
                return k
        return h
    rng = range(w) if side == "left" else range(w - 1, -1, -1)
    for k, x in enumerate(rng):
        if any(not is_white(px(buf, w, x, y)) for y in range(h)):
            return k
    return w


def column_boundaries(buf, w, h, dpi):
    """Scan a horizontal band for the x where the dominant colour changes."""
    y = h // 2
    row = [px(buf, w, x, y) for x in range(w)]

    def bucket(p):
        return (p[0] // 16, p[1] // 16, p[2] // 16)

    runs = []
    cur = bucket(row[0])
    start = 0
    for x in range(1, w):
        b = bucket(row[x])
        if b != cur:
            runs.append((start, x - 1, cur, x - start))
            cur = b
            start = x
    runs.append((start, w - 1, cur, w - start))
    runs.sort(key=lambda r: -r[3])
    return [
        {
            "x0_in": round(r[0] / dpi, 4),
            "x1_in": round((r[1] + 1) / dpi, 4),
            "width_in": round(r[3] / dpi, 4),
            "rgb16": r[2],
        }
        for r in runs[:6]
    ]


def first_non_cream_from_right(buf, w, h, dpi):
    """Find the x of the map/itinerary boundary by colour, mid-height."""
    y = h // 2
    # cream is #fbf8f1-ish; the map is anything but
    def creamish(p):
        return abs(p[0] - 251) < 10 and abs(p[1] - 248) < 10 and abs(p[2] - 241) < 12

    x = w - 1
    while x >= 0 and creamish(px(buf, w, x, y)):
        x -= 1
    return round((x + 1) / dpi, 4)


def grey_tile_fraction(buf, w, h, box):
    """Fraction of pixels inside `box` that are Leaflet's unloaded-tile grey."""
    x0, y0, x1, y1 = box
    grey = 0
    total = 0
    for y in range(y0, y1, 3):
        for x in range(x0, x1, 3):
            p = px(buf, w, x, y)
            total += 1
            if (
                abs(p[0] - p[1]) < 4
                and abs(p[1] - p[2]) < 4
                and 215 <= p[0] <= 230
            ):
                grey += 1
    return round(100 * grey / max(total, 1), 3), total


def main():
    pdf = Path(sys.argv[1])
    dpi = int(sys.argv[2]) if len(sys.argv) > 2 else 150
    outdir = pdf.parent / (pdf.stem + f"-{dpi}dpi")
    outdir.mkdir(exist_ok=True)
    prefix = outdir / "pg"
    subprocess.run(
        ["pdftoppm", "-r", str(dpi), str(pdf), str(prefix)], check=True
    )
    pages = sorted(outdir.glob("pg-*.ppm"))
    print(f"PDF: {pdf}  dpi={dpi}  pages={len(pages)}")
    for p in pages:
        w, h, buf = read_ppm(p)
        print(f"\n=== {p.name}  {w}x{h}px = {w/dpi:.4f}in x {h/dpi:.4f}in ===")
        for inset in (0, 1, 3):
            r = edge_report(buf, w, h, inset)
            print(
                f"  inset {inset}px painted%: "
                + "  ".join(f"{k}={v['painted_pct']:>6.2f}" for k, v in r.items())
            )
        bands = {s: white_band(buf, w, h, s) for s in ("top", "bottom", "left", "right")}
        print(
            "  all-white band (px / in): "
            + "  ".join(f"{k}={v}px/{v/dpi:.4f}in" for k, v in bands.items())
        )
        if p.name.endswith("-1.ppm") or p.name.endswith("-01.ppm"):
            print("  mid-row colour runs (widest first):")
            for run in column_boundaries(buf, w, h, dpi):
                print(
                    f"    {run['x0_in']:.4f}in -> {run['x1_in']:.4f}in"
                    f"  width {run['width_in']:.4f}in  rgb16={run['rgb16']}"
                )
            print(
                f"  map/itinerary colour boundary (scan from right): "
                f"{first_non_cream_from_right(buf, w, h, dpi):.4f}in"
            )
            frac, total = grey_tile_fraction(
                buf, w, h, (0, 0, int(7.33 * dpi), h)
            )
            print(f"  unloaded-tile grey inside map box: {frac}% of {total} samples")


if __name__ == "__main__":
    main()
