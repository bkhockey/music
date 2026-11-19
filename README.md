# TrackTime

A static browser-based music release-year guessing game. Built with plain HTML, CSS and JavaScript for GitHub Pages.

## Files

- `index.html` — page structure and accessible game overlays
- `styles.css` — responsive layout, artwork styling and timeline animations
- `app.js` — Apple iTunes Search/Lookup integration, game state, audio and hover/click placement

## Run locally

Because the game uses browser `fetch()` requests to Apple's catalogue, run it from a local web server rather than opening `index.html` as a `file://` URL.

For example, with Python installed:

```bash
python -m http.server 8000
```

Then open <http://localhost:8000>.

## Deploy to GitHub Pages

1. Create or open the repository that publishes `https://bkhockey.github.io/music/`.
2. Upload the four project files to the repository's publishing root.
3. Commit the changes.
4. In GitHub, open **Settings → Pages** and confirm the publishing source points to the correct branch and folder.
5. Visit `https://bkhockey.github.io/music/`.

No build step, backend, API key or paid service is required.

## Music catalogue

TrackTime uses Apple's public iTunes Search API:

- Search endpoint: `https://itunes.apple.com/search`
- Lookup endpoint: `https://itunes.apple.com/lookup`

Search results supply tracks and preview URLs. Album release years are taken from the album collection's own `releaseDate` returned by Lookup, rather than the individual track release date.

The browser caches the verified catalogue in local storage for 24 hours and keeps a small recent-track history to reduce repetition. The game also avoids placing a different album in a year already occupied by the timeline.

### Catalogue limitations

Apple's public catalogue does not provide a definitive original-first-release flag. TrackTime filters common reissue, deluxe and compilation wording, but metadata quality varies by country and album. It is possible for an unusual edition to pass the filter.

Apple preview availability and autoplay are controlled by the browser and Apple catalogue. If autoplay is blocked, the game retries playback after the first user interaction. A missing preview does not stop the game.

## Timeline layout (v4)

The hover-to-place box aligns with the top and horizontal spacing of album artwork. Timeline covers are 20% larger than in v3 (112.8px desktop, 91.2px mobile), and the release-year labels are slightly larger (14px desktop, 13px mobile).

## Interaction

Hover on the left or right side of an album to reveal a green **PLACE HERE** box in the corresponding chronological gap. The timeline makes room for it, without moving the large mystery cover. Click the box to submit a guess. On touch screens, tap the left or right half of an album first, then tap the revealed box. For keyboard navigation, focus an album, use Left/Right Arrow to choose a side, and press Enter to confirm. The mystery cover can be clicked to replay the preview.

Correct guesses and missed guesses both add their albums in chronological order to the timeline; missed guesses still cost one heart. After the game, the final recap lists every encountered track with its album, artist, year, guess result, and a link to Apple Music where available.

## Validation

The project is dependency-free. Syntax validation can be run with:

```bash
node --check app.js
```

A syntax check does not replace testing in a live browser. Verify Apple API access, preview playback, touch behavior and GitHub Pages deployment in the target browsers.
