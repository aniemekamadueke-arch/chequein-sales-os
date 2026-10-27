#!/usr/bin/env python3
"""Build the single-file local app and the hosted (shared) version."""
from pathlib import Path

ROOT = Path(__file__).parent
html = (ROOT / "index.html").read_text()
css = (ROOT / "styles.css").read_text()
data = (ROOT / "data.js").read_text()
app = (ROOT / "app.js").read_text()

html = html.replace('<link rel="stylesheet" href="styles.css">', "<style>\n" + css + "\n</style>")
html = html.replace(
    '<script src="data.js"></script>\n<script src="app.js"></script>',
    "<script>\n" + data + "\n</script>\n<script>\n" + app + "\n</script>",
)

# Local, offline build: no shared workspace.
(ROOT / "ChequeIn-Sales-OS.html").write_text(html)
print(f"local  {ROOT / 'ChequeIn-Sales-OS.html'}  {len(html):,} bytes")

# Hosted build: enables the team gate and sync. Add noindex so the seeded
# employer data does not end up in search results.
hosted = html.replace("<body>", '<body>\n<script>window.CHEQUEIN_SYNC=true;</script>', 1)
hosted = hosted.replace(
    '<meta name="viewport"',
    '<meta name="robots" content="noindex,nofollow">\n<meta name="viewport"',
    1,
)
dist = ROOT / "dist"
dist.mkdir(exist_ok=True)
(dist / "index.html").write_text(hosted)
print(f"hosted {dist / 'index.html'}  {len(hosted):,} bytes")
