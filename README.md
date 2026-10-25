# Goblox website

The Goblox website: browse games, the catalog, player profiles and friends, and download the Goblox app.
It is a static site (HTML, CSS and JavaScript, no build step) that talks to the Goblox Supabase backend,
so it can be hosted anywhere, here on GitHub Pages.

- `index.html`, `style.css`, `app.js`: the site.
- `img/`: logo, app icon and avatar face.
- `download/Goblox.zip`: the Windows app (Goblox.exe and its assets).

Play buttons open `goblox://play/<game id>`, which Goblox.exe registers the first time it runs.
