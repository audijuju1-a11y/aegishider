"""Download the self-hosted webfonts used by the Aegishider landing page.

Fetches Google Fonts CSS with a modern Chrome UA (woff2 + unicode-range), keeps only
the subsets we actually ship, stores the files next to the site and rewrites a local
@font-face stylesheet.

Anuphan is served as a variable font (one file per subset); Google repeats the same
URL for every requested weight, so equal URLs are collapsed into one rule with the
full weight range. IBM Plex Mono is static and keeps one rule per weight.
"""
from __future__ import annotations

import pathlib
import re
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[1]
FONT_DIR = ROOT / "public" / "assets" / "fonts"
CSS_OUT = ROOT / "public" / "assets" / "css" / "fonts.css"

UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
)
URL = (
    "https://fonts.googleapis.com/css2"
    "?family=Anuphan:wght@300;400;500;600;700"
    "&family=IBM+Plex+Mono:wght@400;500"
    "&display=swap"
)
WANTED = {
    "Anuphan": {"thai", "latin", "latin-ext"},
    "IBM Plex Mono": {"latin", "latin-ext"},
}


def fetch(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=45) as resp:
        return resp.read()


def main() -> None:
    FONT_DIR.mkdir(parents=True, exist_ok=True)
    css = fetch(URL).decode("utf-8")
    blocks = re.findall(r"/\*\s*([a-z0-9-]+)\s*\*/\s*(@font-face\s*\{[^}]+\})", css)
    if not blocks:
        blocks = [("all", m) for m in re.findall(r"(@font-face\s*\{[^}]+\})", css)]

    groups: dict[tuple[str, str, str, str], dict] = {}
    for subset, block in blocks:
        family_m = re.search(r"font-family:\s*'([^']+)'", block)
        weight_m = re.search(r"font-weight:\s*(\d+)", block)
        style_m = re.search(r"font-style:\s*(\w+)", block)
        url_m = re.search(r"url\((https://[^)]+\.woff2)\)", block)
        if not (family_m and weight_m and url_m):
            continue
        family = family_m.group(1)
        if subset not in WANTED.get(family, set()):
            continue
        style = style_m.group(1) if style_m else "normal"
        src = url_m.group(1)
        key = (family, style, subset, src)
        group = groups.setdefault(
            key, {"weights": set(), "range": "", "block": block}
        )
        group["weights"].add(int(weight_m.group(1)))
        range_m = re.search(r"unicode-range:\s*([^;}]+);", block)
        if range_m and not group["range"]:
            group["range"] = range_m.group(1).strip()

    out_rules: list[str] = []
    total = 0
    for (family, style, subset, src), group in groups.items():
        weights = sorted(group["weights"])
        variable = len(weights) > 1
        slug = family.lower().replace(" ", "-")
        if variable:
            name = f"{slug}-var-{subset}.woff2"
            weight_desc = f"{weights[0]} {weights[-1]}"
        else:
            name = f"{slug}-{weights[0]}-{subset}.woff2"
            weight_desc = str(weights[0])
        target = FONT_DIR / name
        if not target.exists():
            data = fetch(src)
            target.write_bytes(data)
            total += len(data)
        urange = f"\n  unicode-range: {group['range']};" if group["range"] else ""
        out_rules.append(
            "@font-face {\n"
            f"  font-family: '{family}';\n"
            f"  font-style: {style};\n"
            f"  font-weight: {weight_desc};\n"
            "  font-display: swap;\n"
            f"  src: url('../fonts/{name}') format('woff2');{urange}\n"
            "}"
        )

    CSS_OUT.parent.mkdir(parents=True, exist_ok=True)
    CSS_OUT.write_text(
        "/* Self-hosted webfonts (SIL Open Font License 1.1).\n"
        "   Anuphan - Thai/Latin display + text (variable), IBM Plex Mono - labels. */\n\n"
        + "\n\n".join(out_rules)
        + "\n",
        encoding="utf-8",
    )
    print(f"wrote {len(out_rules)} @font-face rules")
    for path in sorted(FONT_DIR.glob("*.woff2")):
        print(f"  {path.name} {path.stat().st_size/1024:.1f} KiB")


if __name__ == "__main__":
    main()
