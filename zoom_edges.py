#!/usr/bin/env python3
"""Zoom into a rasterised page: per-row ink profile and colour sampling."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from measure_pdf import is_white, px, read_ppm  # noqa: E402


def main():
    ppm = Path(sys.argv[1])
    dpi = int(sys.argv[2])
    rows = int(sys.argv[3]) if len(sys.argv) > 3 else 20
    w, h, buf = read_ppm(ppm)
    print(f"{ppm.name} {w}x{h} dpi={dpi}")
    print("--- top rows ---")
    for y in range(rows):
        painted = [x for x in range(w) if not is_white(px(buf, w, x, y))]
        if painted:
            colours = {}
            for x in painted[::7]:
                colours[px(buf, w, x, y)] = colours.get(px(buf, w, x, y), 0) + 1
            top = sorted(colours.items(), key=lambda kv: -kv[1])[:3]
            print(
                f"  y={y:>3} ({y/dpi:.4f}in)  painted={len(painted):>5}"
                f"  x {painted[0]}..{painted[-1]}"
                f" ({painted[0]/dpi:.3f}..{painted[-1]/dpi:.3f}in)"
                f"  colours={top}"
            )
        else:
            print(f"  y={y:>3} ({y/dpi:.4f}in)  painted=    0")
    print("--- bottom rows ---")
    for y in range(h - rows, h):
        painted = [x for x in range(w) if not is_white(px(buf, w, x, y))]
        print(
            f"  y={y:>3} ({(h-1-y)/dpi:.4f}in from bottom)  painted={len(painted):>5}"
            + (
                f"  x {painted[0]}..{painted[-1]}"
                f" ({painted[0]/dpi:.3f}..{painted[-1]/dpi:.3f}in)"
                if painted
                else ""
            )
        )


if __name__ == "__main__":
    main()
