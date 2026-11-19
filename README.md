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
- MusicBrainz recording search is used to retrieve `first-release-date` when available.
- Apple search results marked Deluxe, Remastered, Anniversary, Expanded, Reissue, Special Edition, Legacy Edition, Super Deluxe or Bonus Tracks are excluded.
- If MusicBrainz has no matching date or is unavailable, the prototype falls back to Apple's catalog `releaseDate` from a non-excluded edition.

## Important limitations

- This is a prototype with a small hand-picked seed list, not a complete music catalog.
- Apple preview availability varies by country and track. Tracks without a preview are skipped.
- MusicBrainz dates may be missing or incomplete. A recording's first-release date is not always the original commercial single release date.
- The prototype compares by year, because many songs have incomplete month/day data. Songs from the same year can therefore be placed in either order.
- Players start with three hearts. An incorrect placement costs one heart; the game ends at zero hearts.
- Previews fade in over 1.4 seconds and fade out during the final 1.5 seconds of the 30-second clip. Browsers generally block audible autoplay until the player clicks once; after that, the next previews attempt to start automatically.
- The MusicBrainz API asks clients not to exceed one request per second. This prototype waits between MusicBrainz lookups.
- Browser access to third-party APIs depends on their current CORS policies, network availability and service terms. If a provider blocks browser requests, a small proxy/backend will be needed.
- Apple preview URLs and artwork are supplied by Apple. Review Apple's terms before commercial use. MusicBrainz data is available under its applicable database/content licenses; retain attribution and review the terms for your use case.

## Next improvements

- Add a server-side cache to avoid repeated MusicBrainz lookups and respect rate limits.
- Expand the seed catalog and pre-validate song/artist matches.
- Add genre, decade, difficulty and multiplayer modes.
- Use a curated dataset with verified original release dates.
