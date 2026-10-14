"""Download the latin subsets of Oswald + Source Sans 3 and emit a self-hosted
@font-face stylesheet.

SPEC §4 asks for self-hosted fonts (no Google CDN at runtime), so this runs once
at authoring time, not in the app. Google serves both families as *variable*
fonts: every requested weight resolves to the same woff2, so the file is stored
once per family and declared with a weight range instead of five near-duplicate
@font-face rules.

Usage: python3 scripts/fetch-fonts.py src/fonts
"""

import hashlib
import pathlib
import re
import subprocess
import sys

UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"
CSS_URL = (
    "https://fonts.googleapis.com/css2"
    "?family=Oswald:wght@500;700"
    "&family=Source+Sans+3:ital,wght@0,400;0,600;0,700"
    "&display=swap"
)
# Weight range declared per family (what the app actually asks for).
RANGES = {"Oswald": "500 700", "Source Sans 3": "400 700"}
# Emitted to match Biome's CSS formatting (double quotes, wrapped
# unicode-range) so a regenerated file passes `pnpm lint` unchanged.
LATIN_RANGE = (
    "unicode-range:\n"
    "    U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC,\n"
    "    U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193,\n"
    "    U+2212, U+2215, U+FEFF, U+FFFD"
)

out = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "src/fonts")
out.mkdir(parents=True, exist_ok=True)

css = subprocess.run(
    ["curl", "-sS", "--fail", "-A", UA, CSS_URL],
    capture_output=True,
    text=True,
    check=True,
).stdout

# One entry per family: the latin subset only (skip latin-ext/cyrillic/greek/vietnamese).
urls: dict[str, str] = {}
for block in re.findall(r"@font-face\s*\{(.*?)\}", css, re.S):
    rng = re.search(r"unicode-range:\s*([^;]+);", block)
    if not rng or not rng.group(1).strip().startswith("U+0000-00FF"):
        continue
    family = re.search(r"font-family:\s*'([^']+)'", block).group(1)
    url = re.search(r"url\((https://[^)]+\.woff2)\)", block).group(1)
    urls.setdefault(family, url)

missing = set(RANGES) - set(urls)
if missing:
    raise SystemExit(f"no latin subset found for: {sorted(missing)}")

faces = []
for family, url in sorted(urls.items()):
    name = f"{family.lower().replace(' ', '-')}.woff2"
    target = out / name
    subprocess.run(["curl", "-sS", "--fail", "-o", str(target), url], check=True)
    size = target.stat().st_size
    if size < 2000:
        raise SystemExit(f"{name} looks truncated ({size} bytes)")
    digest = hashlib.sha256(target.read_bytes()).hexdigest()[:12]
    faces.append((family, name, size, digest))

lines = [
    "/* Self-hosted brochure webfonts (SPEC §4). GENERATED — see scripts/fetch-fonts.py.",
    " *",
    " * Latin subsets of Oswald (condensed caps: ribbon, headings, stop names) and",
    " * Source Sans 3 (body). Served from our own origin rather than the Google CDN:",
    " * a Pages build should be self-contained, and a third-party font request is a",
    " * GDPR nuisance. Both are variable fonts, so one file covers the weight range.",
    " *",
    " * `font-display: swap` plus the system fallbacks in --brochure-font-* keep text",
    " * readable before the fonts land — including a print that starts early.",
    " */",
    "",
]
for family, name, _size, _digest in faces:
    lines += [
        "@font-face {",
        f'  font-family: "{family}";',
        "  font-style: normal;",
        f"  font-weight: {RANGES[family]};",
        "  font-display: swap;",
        f'  src: url("./{name}") format("woff2");',
        f"  {LATIN_RANGE};",
        "}",
        "",
    ]
(out / "fonts.css").write_text("\n".join(lines))

for family, name, size, digest in faces:
    print(f"{family:<14} -> {name} ({size} bytes, sha256:{digest})")
print(f"wrote {out / 'fonts.css'}")
