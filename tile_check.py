#!/usr/bin/env python3
"""Hunt for an unloaded Leaflet tile: a large uniform-colour block in the map box."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from measure_pdf import px, read_ppm  # noqa: E402


def main():
    ppm = Path(sys.argv[1])
    dpi = int(sys.argv[2])
    w, h, buf = read_ppm(ppm)
    map_w = int(7.3333 * dpi)
    best = (0, None)
    hist = {}
    for y in range(0, h, 2):
        run = 0
        prev = None
        for x in range(0, map_w):
            p = px(buf, w, x, y)
            if p == prev:
                run += 1
            else:
                if run > best[0]:
                    best = (run, (x - run, y, prev))
                run = 1
                prev = p
            hist[p] = hist.get(p, 0) + 1
        if run > best[0]:
            best = (run, (map_w - run, y, prev))
    print(f"{ppm.name}: longest uniform horizontal run inside the map box:")
    run, info = best
    print(
        f"  {run}px = {run/dpi:.3f}in  at x={info[0]} y={info[1]}  colour={info[2]}"
    )
    print("  top 8 colours in the map box (sampled every other row):")
    for colour, n in sorted(hist.items(), key=lambda kv: -kv[1])[:8]:
        print(f"    {colour}  {n} px  ({100*n/sum(hist.values()):.2f}%)")


if __name__ == "__main__":
    main()
