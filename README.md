# TrackTime — Song Timeline prototype

A static browser-game prototype designed for GitHub Pages. No backend, build step, API key, or paid hosting is required.

## Run locally

Open `index.html` in a browser, or serve this folder with a local static server:

```bash
python -m http.server 8000
```

Then visit http://localhost:8000.

## Publish on GitHub Pages

1. Create a new GitHub repository (for example `tracktime`).
2. Upload `index.html`, `styles.css`, `app.js`, and `README.md` to the repository root.
3. Open **Settings → Pages**.
4. Under **Build and deployment**, choose **Deploy from a branch**.
5. Select branch `main`, folder `/ (root)`, then Save.
6. Wait for GitHub Pages to publish the site.

## Data flow

- Apple iTunes Search API is used to find a playable preview URL and artwork.
- Apple results from Platinum, Gold, Diamond, Deluxe, Remastered, Anniversary, Expanded, Reissue, Special/Limited/Collector’s Edition, Legacy Edition, Greatest Hits/Best Of, box sets and bonus-track releases are filtered out. Remaster/re-recording markers in track titles are filtered too. Tracks without an album title are skipped.
- Apple's catalog `releaseDate` is the sole source of the year used in gameplay. MusicBrainz is no longer queried, avoiding mismatches between recording-level first-release dates and the Apple album/preview entry.

## Gameplay controls

- Drag the mystery-track card onto one of the marked gaps in the timeline to place it before, between, or after revealed songs.
- Dragging uses pointer events, so it supports mouse, pen, and touch input. Keyboard users can focus a timeline gap and press Enter or Space to place the track there.
- The old row of placement buttons has been removed; the timeline gaps are the placement targets.

## Important limitations

- This is a prototype with a small hand-picked seed list, not a complete music catalog.
- Apple preview availability varies by country and track. Tracks without a preview are skipped.
- Apple catalog dates are consistent with the selected Apple entry, but may still represent a later catalog edition rather than the original commercial release. Edition filtering relies on Apple catalog naming, so an oddly named special edition can still slip through, and an ordinary album whose title contains one of the edition markers can be excluded.
- The prototype compares by year, because many songs have incomplete month/day data. Songs from the same year can therefore be placed in either order.
- Players start with three hearts. An incorrect placement costs one heart; the game ends at zero hearts. During a game, only one distinct album is allowed for each release year; additional songs from that same album are allowed. The year is reserved when a track is presented, even if the guess is incorrect.
- Previews fade in over 1.4 seconds and fade out during the final 1.5 seconds of the 30-second clip. Browsers generally block audible autoplay until the player clicks once; after that, the next previews attempt to start automatically.
- Browser access to third-party APIs depends on their current CORS policies, network availability and service terms. If a provider blocks browser requests, a small proxy/backend will be needed.
- Apple preview URLs and artwork are supplied by Apple. Review Apple's terms before commercial use. 

## Next improvements

- Build a curated dataset with verified original release dates and album editions.
- Expand the seed catalog and pre-validate song/artist matches.
- Add genre, decade, difficulty and multiplayer modes.
- Use a curated dataset with verified original release dates.
