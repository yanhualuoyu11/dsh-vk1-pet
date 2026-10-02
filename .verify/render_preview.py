#!/usr/bin/env python3
"""Render offline previews of the pet overlay from the shipped geometry.

This is a documentation and sanity-check tool, not part of the plugin: it
re-composites what the browser half paints (sprite + tablet readout + flash +
floating label) so the geometry can be eyeballed without a browser.

    node .verify/preview-geometry.mjs > .verify/geometry.json
    PYTHONPATH=.verify/pylibs python3 .verify/render_preview.py
"""
import json
import os
import sys

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VERIFY = os.path.join(ROOT, ".verify")
PLUGIN = os.path.join(ROOT, "dsh-vk1-pet")
OUT = os.path.join(VERIFY, "previews")
FONT_BOLD = os.path.join(VERIFY, "fonts", "NotoSansSC-Bold.otf")
FONT_MONO = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf"
SCALE = 2  # supersample for legibility


def font(path, size):
    return ImageFont.truetype(path, max(1, int(round(size))))


def draw_text_with_shadow(draw, xy, text, fnt, fill, anchor="mm"):
    draw.text((xy[0] + 1.5, xy[1] + 1.5), text, font=fnt, fill=(0, 0, 0, 166), anchor=anchor)
    draw.text(xy, text, font=fnt, fill=fill, anchor=anchor)


def render_panel(frame):
    """Draw the 400x220 tablet readout exactly as the CSS lays it out."""
    panel_geom = frame["panel"]
    width, height = panel_geom["width"], panel_geom["height"]
    panel = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(panel)

    title = panel_geom["title"]
    draw_text_with_shadow(
        draw, (width / 2, title["centerY"]), title["text"],
        font(FONT_BOLD, title["fontSize"]), tuple(frame["colors"]["title"]) + (255,),
    )

    amount = panel_geom["amount"]
    balance = frame["balance"]
    number_font = font(FONT_MONO, amount["numberFontSize"])
    currency_font = font(FONT_BOLD, amount["currencyFontSize"])
    currency, number = "\u00a5 ", balance
    full = currency_font.getlength(currency) + number_font.getlength(number)
    factor = min(1.0, amount["maxWidth"] / full) if full > 0 else 1.0
    if factor < 1.0:
        number_font = font(FONT_MONO, amount["numberFontSize"] * factor)
        currency_font = font(FONT_BOLD, amount["currencyFontSize"] * factor)
        full = currency_font.getlength(currency) + number_font.getlength(number)

    color = tuple(frame["colors"]["amountOn" if frame["connected"] else "amountOff"]) + (255,)
    left = width / 2 - full / 2
    draw_text_with_shadow(draw, (left, amount["centerY"]), currency, currency_font, color, anchor="lm")
    draw_text_with_shadow(draw, (left + currency_font.getlength(currency), amount["centerY"]), number, number_font, color, anchor="lm")

    dot = panel_geom["dot"]
    dot_color = tuple(frame["colors"]["dotOn" if frame["connected"] else "dotOff"]) + (255,)
    draw.ellipse(
        [dot["left"], dot["top"], dot["left"] + dot["size"], dot["top"] + dot["size"]],
        fill=dot_color,
    )
    return panel


def inverse_affine(m):
    """Invert a CSS matrix(a,b,c,d,e,f) for Pillow's AFFINE transform."""
    a, b, c, d, e, f = m["a"], m["b"], m["c"], m["d"], m["e"], m["f"]
    det = a * d - b * c
    if abs(det) < 1e-12:
        raise ValueError("degenerate tablet transform")
    return (
        d / det,
        -c / det,
        (c * f - d * e) / det,
        -b / det,
        a / det,
        (b * e - a * f) / det,
    )


def compose(frame):
    layout = frame["layout"]
    canvas_w = int(round(layout["width"] * SCALE))
    canvas_h = int(round(layout["height"] * SCALE))
    sprite_w = int(round(layout["spriteWidth"] * SCALE))
    sprite_h = int(round(layout["spriteHeight"] * SCALE))
    sprite_left = int(round(layout["spriteLeft"] * SCALE))
    sprite_top = int(round(layout["spriteTop"] * SCALE))

    sprite = Image.open(os.path.join(PLUGIN, "assets", frame["sprite"])).convert("RGBA")
    sprite = sprite.resize((sprite_w, sprite_h), Image.LANCZOS)

    shake = frame.get("shake", {"x": 0.0, "y": 0.0})
    shake_px = (int(round(shake["x"] * SCALE)), int(round(shake["y"] * SCALE)))

    group = Image.new("RGBA", (sprite_w, sprite_h), (0, 0, 0, 0))
    group.alpha_composite(sprite, (0, 0))

    if frame.get("connected") and frame.get("balance") is not None:
        panel = render_panel(frame).resize(
            (int(round(400 * SCALE)), int(round(220 * SCALE))), Image.LANCZOS
        )
        # The shipped matrix maps 1x panel coordinates into the 1x sprite box.
        # Both the panel and the sprite box are supersampled here, so the linear
        # part is unchanged while the translation doubles: out = M·(2p) + 2t.
        matrix = dict(frame["matrix"])
        matrix["e"] *= SCALE
        matrix["f"] *= SCALE
        warped = panel.transform(
            (sprite_w, sprite_h), Image.AFFINE, inverse_affine(matrix), resample=Image.BICUBIC
        )
        group.alpha_composite(warped, (0, 0))

    impact = frame.get("impact")
    if impact:
        red, green, blue = frame["colors"]["flash"]
        tint = Image.new("RGBA", (sprite_w, sprite_h), (red, green, blue, int(round(255 * impact))))
        masked = Image.new("RGBA", (sprite_w, sprite_h), (0, 0, 0, 0))
        masked.paste(tint, (0, 0), sprite.split()[3])
        group.alpha_composite(masked, (0, 0))

    canvas = Image.new("RGBA", (canvas_w, canvas_h), (0, 0, 0, 0))
    canvas.alpha_composite(group, (sprite_left + shake_px[0], sprite_top + shake_px[1]))

    progress = frame.get("topupProgress")
    if progress is not None:
        inset = frame["side"] * (0.03 + 0.06 * (1 - progress))
        alpha = int(round(255 * 0.8 * (1 - progress)))
        x0 = (layout["spriteLeft"] + inset) * SCALE
        y0 = (layout["spriteTop"] + inset) * SCALE
        x1 = (layout["spriteLeft"] + layout["spriteWidth"] - inset) * SCALE
        y1 = (layout["spriteTop"] + layout["spriteHeight"] - inset) * SCALE
        ring = ImageDraw.Draw(canvas)
        ring.ellipse([x0, y0, x1, y1], outline=tuple(frame["colors"]["topup"]) + (alpha,),
                     width=max(1, int(round(frame["side"] * 0.015 * SCALE))))

    label = frame.get("float")
    if label:
        label_progress = frame.get("floatProgress", 0.0)
        alpha = int(round(255 * max(0.0, 1 - label_progress ** 1.6)))
        fnt = font(FONT_MONO, frame["side"] * 0.08 * SCALE)
        layer = Image.new("RGBA", (canvas_w, canvas_h), (0, 0, 0, 0))
        layer_draw = ImageDraw.Draw(layer)
        x = frame["side"] * SCALE
        y = frame["side"] * (0.55 - 0.45 * label_progress) * SCALE
        layer_draw.text((x + 1, y + 1), label, font=fnt, fill=(0, 0, 0, int(alpha * 0.4)), anchor="mm")
        layer_draw.text((x, y), label, font=fnt, fill=tuple(frame["colors"]["hit"]) + (alpha,), anchor="mm")
        canvas.alpha_composite(layer, (0, 0))

    return canvas


def main():
    with open(os.path.join(VERIFY, "geometry.json"), encoding="utf-8") as handle:
        geometry = json.load(handle)
    os.makedirs(OUT, exist_ok=True)

    strip = []
    for frame in geometry["frames"]:
        canvas = compose(frame)
        backdrop = Image.new("RGB", canvas.size, (24, 26, 32))
        backdrop.paste(canvas, (0, 0), canvas)
        path = os.path.join(OUT, f"{frame['id']}.png")
        backdrop.save(path)
        strip.append((frame["id"], backdrop))
        print(f"wrote {path}  {backdrop.size[0]}x{backdrop.size[1]}")

    # One contact sheet, so every scenario is visible at a glance.
    gap = 16
    width = sum(image.size[0] for _, image in strip) + gap * (len(strip) + 1)
    height = max(image.size[1] for _, image in strip) + gap * 2
    sheet = Image.new("RGB", (width, height), (24, 26, 32))
    x = gap
    for _, image in strip:
        sheet.paste(image, (x, gap))
        x += image.size[0] + gap
    sheet_path = os.path.join(OUT, "contact-sheet.png")
    sheet.save(sheet_path)
    print(f"wrote {sheet_path}  {sheet.size[0]}x{sheet.size[1]}")


if __name__ == "__main__":
    sys.exit(main())
