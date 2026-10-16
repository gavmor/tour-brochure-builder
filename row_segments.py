#!/usr/bin/env python3
"""Report contiguous painted x-segments on a given raster row."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from measure_pdf import is_white, px, read_ppm  # noqa: E402


def segments(buf, w, y):
    out = []
    start = None
    for x in range(w):
        ink = not is_white(px(buf, w, x, y))
        if ink and start is None:
            start = x
        elif not ink and start is not None:
            out.append((start, x - 1))
            start = None
    if start is not None:
        out.append((start, w - 1))
    return out


def main():
    ppm = Path(sys.argv[1])
    dpi = int(sys.argv[2])
    ys = [int(v) for v in sys.argv[3].split(",")]
    w, h, buf = read_ppm(ppm)
    for y in ys:
        yy = y if y >= 0 else h + y
        segs = [s for s in segments(buf, w, yy) if s[1] - s[0] >= 2]
        print(f"{ppm.name} y={yy} ({yy/dpi:.4f}in)  {len(segs)} segments >=3px:")
        for a, b in segs:
            print(
                f"    {a/dpi:.4f}in -> {(b+1)/dpi:.4f}in"
                f"  (width {(b-a+1)/dpi:.4f}in)  rgb={px(buf,w,(a+b)//2,yy)}"
            )


if __name__ == "__main__":
    main()
