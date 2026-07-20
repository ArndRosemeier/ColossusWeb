"""Install Abyss.gif (text above) and Abyss_i.gif (text below) — Colossus Brush-style pair."""
from __future__ import annotations

from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
ASSETS_CURSOR = Path(r"C:\Users\windo\.cursor\projects\c-Projekte-ColossusWeb\assets")
ASSET_DIR = ROOT / "web" / "scripts" / "terrain-assets"
WEB_IMAGES = [
    ROOT / "web" / "public" / "variants" / "Abyssal6" / "images",
    ROOT / "web" / "public" / "variants" / "Abyssal3" / "images",
    ROOT / "web" / "public" / "variants" / "Abyssal9" / "images",
]

# Colossus naming: Terrain.gif = label above art; Terrain_i.gif = label below art
# (MasterBoardView: inverted hexes use .gif, upright hexes use _i.gif)
SOURCES = {
    "Abyss.gif": [
        ASSETS_CURSOR / "Abyss_text_above.png",
        ASSET_DIR / "Abyss_source_above.png",
    ],
    "Abyss_i.gif": [
        ASSETS_CURSOR / "Abyss_text_below.png",
        ASSET_DIR / "Abyss_source_below.png",
    ],
}


# Hex tiles clip corners; keep art inset so the label/icon stay inside the flat sides.
SCALE = 0.80
CANVAS = 255


def prepare(src: Path) -> Image.Image:
    im = Image.open(src).convert("RGB")
    px = im.load()
    w, h = im.size
    for y in range(h):
        for x in range(w):
            r, g, b = px[x, y]
            if r < 35 and g < 35 and b < 35:
                px[x, y] = (0, 0, 0)
    side = max(1, int(round(CANVAS * SCALE)))
    art = im.resize((side, side), Image.Resampling.NEAREST)
    canvas = Image.new("RGB", (CANVAS, CANVAS), (0, 0, 0))
    ox = (CANVAS - side) // 2
    oy = (CANVAS - side) // 2
    canvas.paste(art, (ox, oy))
    return canvas


def save_gif(img: Image.Image, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    img.convert("P", palette=Image.Palette.ADAPTIVE, colors=48).save(dest, format="GIF")


def resolve_source(candidates: list[Path]) -> Path:
    for p in candidates:
        if p.is_file():
            return p
    raise SystemExit(f"Missing Abyss art; tried: {candidates}")


def main() -> None:
    ASSET_DIR.mkdir(parents=True, exist_ok=True)
    prepared: dict[str, Image.Image] = {}
    for dest_name, candidates in SOURCES.items():
        src = resolve_source(candidates)
        img = prepare(src)
        prepared[dest_name] = img
        # Stable copies inside the repo for convert
        stable = ASSET_DIR / (
            "Abyss_source_above.png" if dest_name == "Abyss.gif" else "Abyss_source_below.png"
        )
        if src.resolve() != stable.resolve():
            Image.open(src).convert("RGB").save(stable)
        save_gif(img, ASSET_DIR / dest_name)
        print(dest_name, "<-", src.name)

    for folder in WEB_IMAGES:
        if not folder.is_dir():
            continue
        for dest_name, img in prepared.items():
            save_gif(img, folder / dest_name)
        print("updated", folder)


if __name__ == "__main__":
    main()
