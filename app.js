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
    gameOver: $("game-over"), finalScore: $("final-score"),
    restart: $("restart-button"), error: $("error-screen"),
    errorMessage: $("error-message"), retry: $("retry-button")
  };

  const state = {
    catalog: [], timeline: [], current: null, hearts: 3, rounds: 1,
    score: 0, busy: false, drag: null, insertion: null, autoplayBlocked: false,
    audioToken: 0, recent: [], started: false
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
      const occupiedBy = usedYears.get(album.year);
      return !occupiedBy || occupiedBy === album.collectionId;
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
    state.timeline.forEach((album, index) => {
      const slot = document.createElement("div");
      slot.className = "album-slot";
      slot.dataset.index = String(index);
      const img = document.createElement("img");
      img.src = album.artwork;
      img.alt = `${album.album} album artwork`;
      img.loading = "lazy";
      img.draggable = false;
      img.onerror = () => { img.src = fallbackArtwork(); };
      const year = document.createElement("div");
      year.className = "album-year";
      year.textContent = album.year;
      slot.append(img, year);
      ui.timeline.append(slot);
    });
  }

  function fallbackArtwork() {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600"><rect width="100%" height="100%" fill="#292b32"/><circle cx="300" cy="300" r="120" fill="none" stroke="#c8f36a" stroke-width="12"/><circle cx="300" cy="300" r="22" fill="#c8f36a"/></svg>`;
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  }

  function setMystery(album) {
    state.current = album;
    ui.artwork.src = album.artwork;
    ui.artwork.onerror = () => { ui.artwork.src = fallbackArtwork(); };
    ui.hint.textContent = "Drag the cover to its place";
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
        ui.audioStatus.textContent = "Preview ready — tap or drag to listen";
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

  function getInsertionIndex(clientX) {
    const slots = [...ui.timeline.querySelectorAll(".album-slot")];
    if (!slots.length) return 0;
    for (let i = 0; i < slots.length; i++) {
      const rect = slots[i].getBoundingClientRect();
      if (clientX < rect.left + rect.width / 2) return i;
    }
    return slots.length;
  }

  function updatePush(index) {
    state.insertion = index;
    const slots = [...ui.timeline.querySelectorAll(".album-slot")];
    const mid = slots.length / 2;
    slots.forEach((slot, i) => {
      slot.classList.toggle("push-left", i < index && i < mid);
      slot.classList.toggle("push-right", i >= index && i >= mid);
    });
    // Push all albums away from the insertion point, including on short timelines.
    slots.forEach((slot, i) => {
      if (i < index) slot.classList.add("push-left");
      else slot.classList.add("push-right");
    });
  }

  function clearPush() {
    ui.timeline.querySelectorAll(".album-slot").forEach(slot => {
      slot.classList.remove("push-left", "push-right");
    });
    state.insertion = null;
  }

  function pointerDown(event) {
    if (state.busy || !state.current || event.button > 0) return;
    resumeAudio();
    event.preventDefault();
    const rect = ui.mystery.getBoundingClientRect();
    state.drag = {
      pointerId: event.pointerId, startX: event.clientX, startY: event.clientY,
      left: rect.left, top: rect.top, moved: false
    };
    ui.mystery.setPointerCapture(event.pointerId);
    ui.mystery.classList.add("dragging");
  }

  function pointerMove(event) {
    if (!state.drag || event.pointerId !== state.drag.pointerId) return;
    const dx = event.clientX - state.drag.startX;
    const dy = event.clientY - state.drag.startY;
    if (Math.abs(dx) + Math.abs(dy) > 5) state.drag.moved = true;
    ui.mystery.style.transform = `translate3d(${dx}px, ${dy}px, 0) scale(1.025)`;
    const index = getInsertionIndex(event.clientX);
    updatePush(index);
    if (state.drag.moved) ui.hint.textContent = "Release to place your guess";
  }

  function pointerUp(event) {
    if (!state.drag || event.pointerId !== state.drag.pointerId) return;
    const moved = state.drag.moved;
    const index = state.insertion ?? getInsertionIndex(event.clientX);
    state.drag = null;
    ui.mystery.releasePointerCapture?.(event.pointerId);
    ui.mystery.classList.remove("dragging");
    ui.mystery.style.transform = "";
    clearPush();
    if (moved) submitGuess(index);
    else ui.hint.textContent = "Drag the cover to its place";
  }

  function pointerCancel() {
    if (!state.drag) return;
    state.drag = null;
    ui.mystery.classList.remove("dragging");
    ui.mystery.style.transform = "";
    clearPush();
    ui.hint.textContent = "Drag the cover to its place";
  }

  function correctInsertion(index, album) {
    const before = state.timeline[index - 1];
    const after = state.timeline[index];
    return (!before || before.year <= album.year) && (!after || album.year <= after.year);
  }

  function submitGuess(index) {
    if (state.busy || !state.current) return;
    state.busy = true;
    stopPreview();
    const album = state.current;
    const correct = correctInsertion(index, album);
    saveRecent(album.track.id);

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
    ui.gameOver.classList.remove("hidden");
  }

  async function startGame() {
    state.busy = true;
    state.drag = null;
    state.timeline = [];
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
    ui.mystery.addEventListener("pointerdown", pointerDown);
    ui.mystery.addEventListener("pointermove", pointerMove);
    ui.mystery.addEventListener("pointerup", pointerUp);
    ui.mystery.addEventListener("pointercancel", pointerCancel);
    ui.mystery.addEventListener("lostpointercapture", pointerCancel);
    ui.mystery.addEventListener("keydown", event => {
      if ((event.key === "Enter" || event.key === " ") && state.current && !state.busy) {
        event.preventDefault();
        resumeAudio();
        const guessed = window.prompt("Enter the album's release year:");
        if (guessed !== null && /^\d{4}$/.test(guessed.trim())) {
          const year = Number(guessed);
          const index = state.timeline.findIndex(item => item.year > year);
          submitGuess(index < 0 ? state.timeline.length : index);
        }
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