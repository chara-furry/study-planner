"""
build_font.py — packs the font the PDF report embeds into fonts/noto-sans-tc.js.

The PDF export writes its text in Noto Sans TC, which covers English, German
and Traditional Chinese (plus Greek, Cyrillic and most symbols). The browser
reads it from a script file rather than the .ttf itself, because browsers
don't let a page opened straight from disk (file://) load other files, but
they do let it load scripts. The font is gzipped, then base64-encoded, into:

    window.PDF_FONT_DATA = "H4sI...";

Run it from the website folder, with the font's path if it's elsewhere:

    python tools/build_font.py [path/to/NotoSansTC-VF.ttf]

Noto Sans TC is free under the SIL Open Font License 1.1: it may be bundled
and shared. Get it from https://fonts.google.com/noto/specimen/Noto+Sans+TC
(Windows 11 also installs it as C:\\Windows\\Fonts\\NotoSansTC-VF.ttf).
"""

import base64
import gzip
import os
import sys

DEFAULT_FONT = r"C:\Windows\Fonts\NotoSansTC-VF.ttf"
OUTPUT = os.path.join(os.path.dirname(__file__), "..", "fonts", "noto-sans-tc.js")

font_path = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_FONT
font = open(font_path, "rb").read()
packed = base64.b64encode(gzip.compress(font, compresslevel=9, mtime=0)).decode("ascii")

os.makedirs(os.path.dirname(OUTPUT), exist_ok=True)
with open(OUTPUT, "w", encoding="ascii", newline="\n") as f:
    f.write("// Noto Sans TC (SIL Open Font License 1.1), gzipped and base64-encoded\n")
    f.write("// by tools/build_font.py for the PDF export. See fonts/README.md.\n")
    f.write(f'window.PDF_FONT_DATA = "{packed}";\n')

print(f"wrote {os.path.normpath(OUTPUT)}: {len(font) // 1024} KB font -> {len(packed) // 1024} KB")
