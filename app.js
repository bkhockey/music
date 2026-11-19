(() => {
  "use strict";

  const APPLE = "https://itunes.apple.com";
  const CACHE_KEY = "tracktime_catalog_v1";
  const HISTORY_KEY = "tracktime_recent_tracks_v1";
  const CACHE_TTL = 24 * 60 * 60 * 1000;
  const SEARCH_TERMS = ["pop", "rock", "hip hop", "country", "jazz", "electronic", "alternative", "metal", "soul", "indie"];
  const EXCLUDED_TERMS = [
    "deluxe", "remaster", "remastered", "anniversary", "platinum", "gold edition",
    "diamond", "expanded edition", "reissue", "greatest hits", "best of", "gold",
    "compilation", "karaoke", "tribute", "soundtrack", "live at", "live:"
  ];
  const MAX_RECENT = 35;
  const $ = (id) => document.getElementById(id);

  const ui = {
    hearts: $("hearts"), round: $("round-count"), mystery: $("mystery-card"),
    artwork: $("mystery-artwork"),
    audioStatus: $("audio-status"), timeline: $("timeline"), viewport: $("timeline-viewport"),
    hint: $("timeline-hint"), feedback: $("feedback"), audio: $("preview-audio"),
    loading: $("loading-screen"), loadingMessage: $("loading-message"),
    gameOver: $("game-over"), finalScore: $("final-score"), summary: $("game-summary"),
    restart: $("restart-button"), error: $("error-screen"),
    errorMessage: $("error-message"), retry: $("retry-button")
  };

  const state = {
    catalog: [], timeline: [], current: null, hearts: 3, rounds: 1,
    score: 0, busy: false, insertion: null, autoplayBlocked: false,
    audioToken: 0, recent: [], started: false, history: []
  };

  function safeJSON(value, fallback) {
    try { return JSON.parse(value) ?? fallback; } catch { return fallback; }
  }

  function readRecent() {
    const data = safeJSON(localStorage.getItem(HISTORY_KEY), []);
    return Array.isArray(data) ? data : [];
  }

  function saveRecent(trackId) {
    const list = [String(trackId), ...state.recent.filter(id => String(id) !== String(trackId))].slice(0, MAX_RECENT);
    state.recent = list;
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(list)); } catch { /* storage is optional */ }
  }

  function normalizeText(value) {
    return String(value || "").toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9]+/g, " ").trim();
  }

  function hasExcludedMetadata(album) {
    const haystack = normalizeText([
      album.collectionName, album.artistName, album.collectionType,
      album.copyright, album.primaryGenreName
    ].join(" "));
    return EXCLUDED_TERMS.some(term => haystack.includes(normalizeText(term)));
  }

  function validYear(dateString) {
    const date = new Date(dateString);
    if (!Number.isFinite(date.getTime())) return null;
    const year = date.getUTCFullYear();
    const currentYear = new Date().getFullYear();
    if (year < 1950 || year > currentYear) return null;
    return year;
  }

  async function fetchJSON(url) {
    const response = await fetch(url, { mode: "cors", cache: "no-store" });
    if (!response.ok) throw new Error(`Apple catalogue returned ${response.status}`);
    return response.json();
  }

  async function searchTracks(term) {
    const url = `${APPLE}/search?term=${encodeURIComponent(term)}&entity=song&limit=50&country=US`;
    const data = await fetchJSON(url);
    return (data.results || []).filter(item =>
      item.wrapperType === "track" &&
      item.kind === "song" &&
      item.collectionId &&
      item.trackId &&
      item.previewUrl &&
      item.artworkUrl100
    );
  }

  async function lookupAlbums(ids) {
    const batches = [];
    for (let i = 0; i < ids.length; i += 80) batches.push(ids.slice(i, i + 80));
    const results = [];
    for (const batch of batches) {
      const url = `${APPLE}/lookup?id=${batch.join(",")}&country=US`;
      const data = await fetchJSON(url);
      results.push(...(data.results || []).filter(item => item.wrapperType === "collection"));
    }
    return results;
  }

  async function loadCatalog(force = false) {
    if (!force) {
      const cached = safeJSON(localStorage.getItem(CACHE_KEY), null);
      if (cached && cached.savedAt && Date.now() - cached.savedAt < CACHE_TTL &&
          Array.isArray(cached.catalog) && cached.catalog.length > 15) return cached.catalog;
    }

    const responses = await Promise.allSettled(SEARCH_TERMS.map(searchTracks));
    const tracks = responses.flatMap(result => result.status === "fulfilled" ? result.value : []);
    if (tracks.length < 10) throw new Error("Apple's search service returned too few tracks. Please try again.");

    const trackGroups = new Map();
    for (const track of tracks) {
      const key = String(track.collectionId);
      if (!trackGroups.has(key)) trackGroups.set(key, []);
      const group = trackGroups.get(key);
      if (!group.some(item => String(item.trackId) === String(track.trackId))) group.push(track);
    }

    const ids = [...trackGroups.keys()];
    const albums = await lookupAlbums(ids);
    const albumById = new Map(albums.map(album => [String(album.collectionId), album]));
    const catalog = [];

    for (const [collectionId, albumTracks] of trackGroups) {
      const album = albumById.get(collectionId);
      if (!album || hasExcludedMetadata(album)) continue;
      if (album.collectionType && !/album/i.test(album.collectionType)) continue;
      const year = validYear(album.releaseDate);
      if (!year || !album.collectionName || !album.artistName) continue;

      const cleanTracks = albumTracks.filter(track => {
        const trackHaystack = normalizeText(`${track.trackName} ${track.collectionName}`);
        return track.previewUrl && !trackHaystack.includes("karaoke") &&
          !trackHaystack.includes("tribute") && !trackHaystack.includes("remix");
      });
      if (!cleanTracks.length) continue;

      const art = album.artworkUrl100 || albumTracks[0].artworkUrl100;
      const artwork = art ? art.replace(/100x100bb\./, "600x600bb.") : "";
      if (!artwork) continue;

      catalog.push({
        collectionId: String(album.collectionId),
        album: album.collectionName,
        artist: album.artistName,
        year,
        artwork,
        genre: album.primaryGenreName || albumTracks[0].primaryGenreName || "Other",
        albumUrl: album.collectionViewUrl || `https://music.apple.com/album/id${album.collectionId}`,
        tracks: cleanTracks.map(track => ({
          id: String(track.trackId),
          title: track.trackName,
          artist: track.artistName || album.artistName,
          preview: track.previewUrl
        }))
      });
    }

    if (catalog.length < 12) {
      throw new Error("Not enough verified albums were found. Please try again later.");
    }

    try { localStorage.setItem(CACHE_KEY, JSON.stringify({ savedAt: Date.now(), catalog })); } catch { /* cache is optional */ }
    return catalog;
  }

  function chooseTrack(album) {
    const recentSet = new Set(state.recent.map(String));
    const fresh = album.tracks.filter(track => !recentSet.has(String(track.id)));
    const choices = fresh.length ? fresh : album.tracks;
    return choices[Math.floor(Math.random() * choices.length)];
  }

  function pickAlbum(excludeRecent = true) {
    const usedYears = new Map(state.timeline.map(item => [item.year, item.collectionId]));
    const recentSet = new Set(state.recent.map(String));
    let candidates = state.catalog.filter(album => {
      return !usedYears.has(album.year);
    });
    if (excludeRecent) {
      const freshCandidates = candidates.filter(album => album.tracks.some(track => !recentSet.has(track.id)));
      if (freshCandidates.length > 5) candidates = freshCandidates;
    }
    if (!candidates.length) return null;

    // Prefer decade and artist variety without making the pool deterministic.
    const lastArtist = state.timeline.length ? state.timeline[state.timeline.length - 1].artist : "";
    const artistVariety = candidates.filter(album => normalizeText(album.artist) !== normalizeText(lastArtist));
    if (artistVariety.length > 4) candidates = artistVariety;
    const decades = new Map();
    for (const album of candidates) decades.set(Math.floor(album.year / 10), (decades.get(Math.floor(album.year / 10)) || 0) + 1);
    const decadeKeys = [...decades.keys()];
    const chosenDecade = decadeKeys[Math.floor(Math.random() * decadeKeys.length)];
    const decadePool = candidates.filter(album => Math.floor(album.year / 10) === chosenDecade);
    const album = (decadePool.length ? decadePool : candidates)[Math.floor(Math.random() * (decadePool.length ? decadePool : candidates).length)];
    const track = chooseTrack(album);
    return { ...album, track };
  }

  function setLoading(show, message = "Building your music timeline…") {
    ui.loadingMessage.textContent = message;
    ui.loading.classList.toggle("hidden", !show);
  }

  function renderHearts() {
    [...ui.hearts.children].forEach((heart, index) => heart.classList.toggle("lost", index >= state.hearts));
    ui.hearts.setAttribute("aria-label", `${state.hearts} hearts remaining`);
  }

  function renderTimeline() {
    ui.timeline.replaceChildren();
    state.insertion = null;

    // Every possible chronological position has a hidden placement box.
    // Hovering either half of an album reveals its neighbouring box.
    for (let index = 0; index <= state.timeline.length; index++) {
      const placement = document.createElement("button");
      placement.type = "button";
      placement.className = "placement-slot";
      placement.dataset.insertIndex = String(index);
      placement.disabled = true;
      placement.tabIndex = -1;
      placement.setAttribute("aria-hidden", "true");
      const previous = state.timeline[index - 1];
      const next = state.timeline[index];
      placement.setAttribute("aria-label", previous && next
        ? `Place between ${previous.album} and ${next.album}`
        : previous ? `Place after ${previous.album}`
        : next ? `Place before ${next.album}` : "Place the mystery track");

      const box = document.createElement("span");
      box.className = "placement-box";
      box.setAttribute("aria-hidden", "true");
      const plus = document.createElement("span");
      plus.className = "placement-plus";
      plus.textContent = "+";
      const caption = document.createElement("span");
      caption.className = "placement-caption";
      caption.textContent = "PLACE HERE";
      box.append(plus, caption);
      placement.append(box);
      ui.timeline.append(placement);

      const album = state.timeline[index];
      if (!album) continue;
      const slot = document.createElement("button");
      slot.type = "button";
      slot.className = "album-slot";
      slot.dataset.index = String(index);
      slot.setAttribute("aria-label", `${album.album}, ${album.artist}, ${album.year}. Hover left or right to choose a position. Use arrow keys to choose a side and Enter to place.`);
      slot.title = `${album.album} — ${album.artist} (${album.year})`;
      const img = document.createElement("img");
      img.src = album.artwork;
      img.alt = "";
      img.loading = "lazy";
      img.draggable = false;
      img.onerror = () => { img.src = fallbackArtwork(); };
      const year = document.createElement("span");
      year.className = "album-year";
      year.textContent = album.year;
      slot.append(img, year);
      ui.timeline.append(slot);
    }
  }

  function fallbackArtwork() {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600"><rect width="100%" height="100%" fill="#292b32"/><circle cx="300" cy="300" r="120" fill="none" stroke="#c8f36a" stroke-width="12"/><circle cx="300" cy="300" r="22" fill="#c8f36a"/></svg>`;
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  }

  function setMystery(album) {
    state.current = album;
    ui.artwork.src = album.artwork;
    ui.artwork.onerror = () => { ui.artwork.src = fallbackArtwork(); };
    ui.hint.textContent = window.matchMedia("(hover: none)").matches
      ? "Tap beside an album, then tap the box"
      : "Hover beside an album, then click the box";
    clearPlacement();
    ui.feedback.textContent = "";
    ui.feedback.className = "feedback";
    startPreview(album.track.preview);
  }

  function stopPreview() {
    state.audioToken++;
    ui.audio.pause();
    ui.audio.removeAttribute("src");
    ui.audio.load();
  }

  async function startPreview(url) {
    stopPreview();
    const token = state.audioToken;
    ui.audioStatus.textContent = "Loading preview";
    ui.audioStatus.classList.remove("muted");
    if (!url) {
      ui.audioStatus.textContent = "Preview unavailable";
      ui.audioStatus.classList.add("muted");
      return;
    }
    ui.audio.src = url;
    ui.audio.load();
    try {
      await ui.audio.play();
      if (token === state.audioToken) {
        state.autoplayBlocked = false;
        ui.audioStatus.textContent = "Now playing preview";
      }
    } catch {
      if (token === state.audioToken) {
        state.autoplayBlocked = true;
        ui.audioStatus.textContent = "Preview ready — click or tap to listen";
        ui.audioStatus.classList.add("muted");
      }
    }
  }

  async function resumeAudio() {
    if (!state.autoplayBlocked || !state.current) return;
    try {
      await ui.audio.play();
      state.autoplayBlocked = false;
      ui.audioStatus.textContent = "Now playing preview";
      ui.audioStatus.classList.remove("muted");
    } catch {
      ui.audioStatus.textContent = "Preview could not be played";
      ui.audioStatus.classList.add("muted");
    }
  }

  function setActivePlacement(index) {
    if (state.busy || !state.current || index === state.insertion ||
        index < 0 || index > state.timeline.length) return;
    state.insertion = index;
    ui.timeline.querySelectorAll(".placement-slot").forEach(button => {
      const active = Number(button.dataset.insertIndex) === index;
      button.classList.toggle("active", active);
      button.disabled = !active;
      button.tabIndex = active ? 0 : -1;
      button.setAttribute("aria-hidden", active ? "false" : "true");
    });
  }

  function clearPlacement() {
    state.insertion = null;
    ui.timeline.querySelectorAll(".placement-slot").forEach(button => {
      button.classList.remove("active");
      button.disabled = true;
      button.tabIndex = -1;
      button.setAttribute("aria-hidden", "true");
    });
  }

  function positionBesideAlbum(album, clientX) {
    const rect = album.getBoundingClientRect();
    const index = Number(album.dataset.index);
    return index + (clientX >= rect.left + rect.width / 2 ? 1 : 0);
  }

  function onTimelinePointerMove(event) {
    if (event.pointerType === "touch" || state.busy || !state.current) return;
    const album = event.target.closest(".album-slot");
    // Keep a revealed box open while moving the pointer onto it.
    if (album) setActivePlacement(positionBesideAlbum(album, event.clientX));
  }

  function onTimelineClick(event) {
    if (state.busy || !state.current) return;
    const placement = event.target.closest(".placement-slot");
    if (placement && !placement.disabled) {
      submitGuess(Number(placement.dataset.insertIndex));
      return;
    }
    // Touch screens have no hover: first tap beside an album reveals the box,
    // and the next tap on that box confirms the placement.
    const album = event.target.closest(".album-slot");
    if (album) setActivePlacement(positionBesideAlbum(album, event.clientX));
  }

  function onTimelineKeyDown(event) {
    if (state.busy || !state.current) return;
    const album = event.target.closest(".album-slot");
    if (!album) return;
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      setActivePlacement(Number(album.dataset.index) + (event.key === "ArrowRight" ? 1 : 0));
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      const left = Number(album.dataset.index);
      const selected = state.insertion === left || state.insertion === left + 1
        ? state.insertion : left + 1;
      if (state.insertion !== selected) setActivePlacement(selected);
      else submitGuess(selected);
    }
  }

  async function replayPreview() {
    if (state.busy || !state.current || !ui.audio.src) return;
    try {
      ui.audio.currentTime = 0;
      await ui.audio.play();
      state.autoplayBlocked = false;
      ui.audioStatus.textContent = "Now playing preview";
      ui.audioStatus.classList.remove("muted");
    } catch {
      ui.audioStatus.textContent = "Preview could not be played";
      ui.audioStatus.classList.add("muted");
    }
  }

  function correctInsertion(index, album) {
    const before = state.timeline[index - 1];
    const after = state.timeline[index];
    return (!before || before.year <= album.year) && (!after || album.year <= after.year);
  }

  function submitGuess(index) {
    if (state.busy || !state.current) return;
    state.busy = true;
    clearPlacement();
    stopPreview();
    const album = state.current;
    const correct = correctInsertion(index, album);
    saveRecent(album.track.id);

    state.history.push({ ...album, result: correct ? "correct" : "incorrect" });
    if (correct) {
      state.timeline.splice(index, 0, album);
      state.score++;
      ui.feedback.textContent = `Correct! ${album.album} — ${album.year}`;
      ui.feedback.className = "feedback";
      renderTimeline();
      state.rounds++;
      ui.round.textContent = String(state.rounds);
      if (state.hearts > 0) setTimeout(() => nextRound(), 850);
      return;
    }

    state.hearts--;
    const actualIndex = state.timeline.findIndex(item => item.year > album.year);
    state.timeline.splice(actualIndex < 0 ? state.timeline.length : actualIndex, 0, album);
    renderTimeline();
    renderHearts();
    ui.feedback.textContent = `Not quite — ${album.album} was released in ${album.year}.`;
    ui.feedback.className = "feedback wrong";
    if (state.hearts <= 0) {
      setTimeout(endGame, 1100);
    } else {
      state.rounds++;
      ui.round.textContent = String(state.rounds);
      setTimeout(() => nextRound(), 1100);
    }
  }

  function nextRound() {
    if (state.hearts <= 0) return endGame();
    const next = pickAlbum(true);
    if (!next) {
      ui.feedback.textContent = "You've explored all available albums. Great run!";
      setTimeout(endGame, 900);
      return;
    }
    state.busy = false;
    setMystery(next);
  }

  function endGame() {
    state.busy = true;
    stopPreview();
    ui.finalScore.textContent = `You placed ${state.score} ${state.score === 1 ? "album" : "albums"} and reached round ${state.rounds}.`;
    renderSummary();
    ui.gameOver.classList.remove("hidden");
  }

  function renderSummary() {
    ui.summary.replaceChildren();
    for (const album of [...state.history].sort((a, b) => a.year - b.year)) {
      const item = document.createElement("li");
      item.className = "summary-item";
      const img = document.createElement("img");
      img.src = album.artwork;
      img.alt = "";
      img.onerror = () => { img.src = fallbackArtwork(); };
      const details = document.createElement("div");
      details.className = "summary-details";
      const name = document.createElement("strong");
      name.textContent = album.track?.title || album.album;
      const description = document.createElement("span");
      description.textContent = `${album.artist} · ${album.album} · ${album.year}`;
      const result = document.createElement("span");
      result.className = `summary-result ${album.result}`;
      result.textContent = album.result === "starter" ? "Starting album" : album.result === "correct" ? "✓ Correct" : "✕ Missed";
      details.append(name, description, result);
      item.append(img, details);
      if (album.albumUrl) {
        const link = document.createElement("a");
        link.href = album.albumUrl;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = "Album ↗";
        link.setAttribute("aria-label", `Open ${album.album} on Apple Music`);
        item.append(link);
      }
      ui.summary.append(item);
    }
  }

  async function startGame() {
    state.busy = true;
    state.insertion = null;
    state.timeline = [];
    state.history = [];
    ui.summary.replaceChildren();
    state.current = null;
    state.hearts = 3;
    state.rounds = 1;
    state.score = 0;
    state.recent = readRecent();
    ui.round.textContent = "1";
    renderHearts();
    ui.gameOver.classList.add("hidden");
    ui.error.classList.add("hidden");
    setLoading(true);
    stopPreview();

    try {
      state.catalog = await loadCatalog();
      const starter = pickAlbum(false);
      if (!starter) throw new Error("No suitable starting album could be selected.");
      state.timeline = [{ ...starter, track: starter.track }];
      state.history.push({ ...starter, result: "starter" });
      renderTimeline();
      const mystery = pickAlbum(true);
      if (!mystery) throw new Error("Not enough different album years are available.");
      setMystery(mystery);
      state.busy = false;
      state.started = true;
      setLoading(false);
    } catch (error) {
      setLoading(false);
      ui.errorMessage.textContent = error.message || "Apple's music catalogue is temporarily unavailable.";
      ui.error.classList.remove("hidden");
    }
  }

  function onAudioEnded() {
    if (state.current) {
      ui.audioStatus.textContent = "Preview finished";
      ui.audioStatus.classList.add("muted");
    }
  }

  function init() {
    ui.timeline.addEventListener("pointermove", onTimelinePointerMove);
    ui.timeline.addEventListener("click", onTimelineClick);
    ui.timeline.addEventListener("keydown", onTimelineKeyDown);
    ui.timeline.addEventListener("pointerleave", event => {
      if (event.pointerType !== "touch" && !ui.timeline.contains(document.activeElement)) {
        clearPlacement();
      }
    });
    ui.timeline.addEventListener("focusout", event => {
      // Moving focus from an album to its placement box must not close it.
      if (event.relatedTarget && ui.timeline.contains(event.relatedTarget)) return;
      queueMicrotask(() => {
        if (!ui.timeline.contains(document.activeElement)) clearPlacement();
      });
    });
    ui.mystery.addEventListener("click", replayPreview);
    ui.mystery.addEventListener("keydown", event => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        replayPreview();
      }
    });
    ui.audio.addEventListener("ended", onAudioEnded);
    ui.audio.addEventListener("error", () => {
      ui.audioStatus.textContent = "Preview unavailable";
      ui.audioStatus.classList.add("muted");
    });
    ui.restart.addEventListener("click", () => startGame());
    ui.retry.addEventListener("click", () => startGame(true));
    // Browsers may block autoplay. Any first interaction is a playback retry.
    document.addEventListener("pointerdown", resumeAudio, { passive: true });
    document.addEventListener("keydown", resumeAudio);
    startGame();
  }

  document.addEventListener("DOMContentLoaded", init, { once: true });
})();