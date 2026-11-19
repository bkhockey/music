// TrackTime prototype. Static GitHub Pages app; no server or API key required.
const SEEDS = [
  ["Bohemian Rhapsody","Queen"],["Billie Jean","Michael Jackson"],["Like a Prayer","Madonna"],
  ["Smells Like Teen Spirit","Nirvana"],["...Baby One More Time","Britney Spears"],
  ["Crazy in Love","Beyoncé"],["Rolling in the Deep","Adele"],["Blinding Lights","The Weeknd"],
  ["Take On Me","a-ha"],["Wonderwall","Oasis"],["Dancing Queen","ABBA"],
  ["Lose Yourself","Eminem"],["Shape of You","Ed Sheeran"],["Bad Romance","Lady Gaga"],
  ["Sweet Child O' Mine","Guns N' Roses"],["I Want It That Way","Backstreet Boys"],
  ["Seven Nation Army","The White Stripes"],["Get Lucky","Daft Punk"],["Waterloo","ABBA"],
  ["Umbrella","Rihanna"],["Hotel California","Eagles"],["Thriller","Michael Jackson"],
  ["Hips Don't Lie","Shakira"],["Mr. Brightside","The Killers"],["Respect","Aretha Franklin"],
  ["Hey Ya!","Outkast"],["Africa","Toto"],["Poker Face","Lady Gaga"],
  ["Wonder","Shawn Mendes"],["Flowers","Miley Cyrus"]
];

const $ = id => document.getElementById(id);
const audio = $("audio");
let timeline = [], current = null, round = 1, score = 0, hearts = 3, answered = false, fadeFrame = null, fadingOut = false, autoplayBlocked = false;
// A game may use several songs from one album, but never different albums for the same year.
let albumByYear = new Map();
const TARGET_VOLUME = 0.62;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const shuffle = arr => [...arr].sort(() => Math.random() - .5);
const validDate = d => /^\d{4}(-\d{2}(-\d{2})?)?$/.test(d || "") && Number(d.slice(0,4)) > 1900;
const yearOf = d => Number((d || "").slice(0,4));

async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return res.json();
}

function normalize(s) { return (s || "").toLowerCase().replace(/[^a-z0-9]/g, ""); }

// Reject alternate/compilation editions because their catalog dates can be years
// later than the album's original release. Check both song and album names.
function isEditionWeShouldSkip(track) {
  const trackName = track.trackName || "";
  const albumName = track.collectionName || "";
  const albumEditionPatterns = [
    /\bplatinum\b/i, /\bgold\b/i, /\bdiamond\b/i,
    /\b(deluxe|super deluxe)(?:\s+(?:edition|version))?\b/i,
    /\banniversary(?:\s+(?:edition|version|remaster))?\b/i,
    /\bexpanded(?:\s+(?:edition|version))?\b/i,
    /\b(reissue|re-issue|reissued)\b/i,
    /\b(special|limited|collector'?s)\s+(?:album\s+)?edition\b/i,
    /\blegacy edition\b/i, /\bbonus tracks?\b/i,
    /\b(greatest hits|best of|essential|the collection|complete collection)\b/i,
    /\b(box set|soundtrack edition)\b/i
  ];
  const trackEditionPatterns = [
    /\bremaster(?:ed|ing)?\b/i, /\bre-recorded|re-recording\b/i,
    /\b(deluxe|anniversary|expanded)\s+(?:edition|version)\b/i
  ];
  return albumEditionPatterns.some(pattern => pattern.test(albumName)) ||
    trackEditionPatterns.some(pattern => pattern.test(trackName));
}

function albumKey(album) { return normalize(album); }

function conflictsWithYearAlbum(track) {
  const existingAlbum = albumByYear.get(track.year);
  return Boolean(existingAlbum && existingAlbum !== albumKey(track.album));
}

async function findAppleTrack(title, artist) {
  const term = encodeURIComponent(`${title} ${artist}`);
  const data = await fetchJSON(`https://itunes.apple.com/search?term=${term}&entity=song&limit=25`);
  const results = (data.results || []).filter(x => x.previewUrl && x.trackName && x.artistName && !isEditionWeShouldSkip(x));
  if (!results.length) return null;
  results.sort((a,b) => {
    const score = x => (normalize(x.trackName) === normalize(title) ? 4 : 0) + (normalize(x.artistName) === normalize(artist) ? 4 : 0);
    return score(b)-score(a);
  });
  return results[0];
}

async function getTrack(seed) {
  const [title, artist] = seed;
  const apple = await findAppleTrack(title, artist);
  if (!apple || !apple.collectionName) return null;
  // Use Apple's catalog release date consistently. MusicBrainz recording-level
  // first-release dates can point to a different recording/release and distort play.
  const date = apple.releaseDate ? apple.releaseDate.slice(0,10) : null;
  if (!validDate(date)) return null;
  return {
    title: apple.trackName, artist: apple.artistName, date, year: yearOf(date),
    preview: apple.previewUrl, artwork: (apple.artworkUrl100 || "").replace("100x100bb", "300x300bb"),
    album: apple.collectionName || "",
    source: "Apple catalog release date"
  };
}

function setCover(url) {
  const img = $("mystery-cover"), placeholder = $("cover-placeholder");
  if (url) { img.src = url; img.style.display = "block"; placeholder.style.display = "none"; }
  else { img.removeAttribute("src"); img.style.display = "none"; placeholder.style.display = "grid"; }
  $("mystery-year").textContent = "";
  $("drag-card").classList.toggle("has-art", Boolean(url));
}

function cancelFade() {
  if (fadeFrame !== null) cancelAnimationFrame(fadeFrame);
  fadeFrame = null;
}

function fadeVolume(to, duration = 1200) {
  cancelFade();
  const from = audio.volume;
  const started = performance.now();
  const step = now => {
    const progress = Math.min(1, (now - started) / duration);
    // Smooth ease-in-out curve; prevents abrupt volume changes.
    const eased = progress * progress * (3 - 2 * progress);
    audio.volume = Math.max(0, Math.min(1, from + (to - from) * eased));
    if (progress < 1) fadeFrame = requestAnimationFrame(step);
    else fadeFrame = null;
  };
  fadeFrame = requestAnimationFrame(step);
}

async function startPreview() {
  if (!audio.src) return false;
  cancelFade();
  fadingOut = false;
  if (audio.ended || audio.currentTime >= 30) audio.currentTime = 0;
  audio.volume = 0;
  try {
    await audio.play();
    autoplayBlocked = false;
    fadeVolume(TARGET_VOLUME, 1400);
    return true;
  } catch (e) {
    audio.volume = TARGET_VOLUME;
    autoplayBlocked = true;
    return false;
  }
}

function resetPlayer() {
  cancelFade();
  audio.pause(); audio.removeAttribute("src"); audio.load(); audio.volume = TARGET_VOLUME;
  fadingOut = false;
}

async function loadNext() {
  current = null;
  answered = false;
  $("next-button").disabled = true;
  $("result").className = "result hidden";
  $("error-box").classList.add("hidden");
  $("round-label").textContent = `ROUND ${round}`;
  $("mystery-title").textContent = "Finding a song…";
  $("mystery-artist").textContent = "Artist and release date are hidden";
  setCover(null); resetPlayer();

  const candidates = shuffle(SEEDS.filter(s => !timeline.some(t => t.seed.join("|") === s.join("|"))));
  for (const seed of candidates) {
    try {
      const track = await getTrack(seed);
      if (track && !conflictsWithYearAlbum(track) &&
          !timeline.some(t => t.title.toLowerCase() === track.title.toLowerCase() && t.artist.toLowerCase() === track.artist.toLowerCase())) {
        current = {...track, seed};
        // Reserve this album/year as soon as the track enters play, even if the guess is wrong.
        if (!albumByYear.has(track.year)) albumByYear.set(track.year, albumKey(track.album));
        break;
      }
    } catch (e) { console.warn(e); }
  }
  if (!current) {
    $("mystery-title").textContent = "Couldn't find another playable track";
    $("mystery-artist").textContent = "Try starting a new game or reload the page.";
    $("error-box").textContent = "The Apple preview catalog may be temporarily unavailable. Try again in a moment.";
    $("error-box").classList.remove("hidden");
    return;
  }
  $("mystery-title").textContent = "Mystery track";
  audio.src = current.preview;
  renderTimeline();
  // Attempt audible autoplay. If the browser blocks it, the first user gesture
  // anywhere on the page retries playback without showing a play button.
  await startPreview();
}

function addTiltEffect(card) {
  if (card.dataset.tiltReady) return;
  card.dataset.tiltReady = "true";
  card.addEventListener("pointermove", event => {
    if (event.pointerType !== "mouse" || dragState) return;
    const rect = card.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;
    const rotateY = (x - 0.5) * 22;
    const rotateX = (0.5 - y) * 22;
    card.style.setProperty("--tilt-x", `${rotateX.toFixed(2)}deg`);
    card.style.setProperty("--tilt-y", `${rotateY.toFixed(2)}deg`);
    card.style.setProperty("--shine-x", `${(x * 100).toFixed(1)}%`);
    card.style.setProperty("--shine-y", `${(y * 100).toFixed(1)}%`);
    card.classList.add("is-tilting");
  });
  card.addEventListener("pointerleave", () => {
    card.style.setProperty("--tilt-x", "0deg");
    card.style.setProperty("--tilt-y", "0deg");
    card.classList.remove("is-tilting");
  });
}

function renderTimeline() {
  const host = $("timeline");
  host.innerHTML = "";
  timeline.forEach(track => {
    const el = document.createElement("div");
    el.className = "album-card timeline-album";
    el.innerHTML = `<div class="cd-case"><img alt="Album artwork" src=""><span class="card-glare" aria-hidden="true"></span></div><div class="year-float"></div>`;
    const image = el.querySelector("img");
    if (track.artwork) image.src = track.artwork;
    el.querySelector(".year-float").textContent = track.year;
    addTiltEffect(el);
    host.appendChild(el);
  });
}


// Pointer-based dragging works with mouse, pen, and touch screens.
let dragState = null;
const dragCard = $("drag-card");
addTiltEffect(dragCard);

dragCard.addEventListener("pointerdown", event => {
  if (answered || !current || event.target.closest("button")) return;
  event.preventDefault();
  const ghost = document.createElement("div");
  ghost.className = "drag-ghost";
  ghost.innerHTML = `<div class="cd-case"><img alt="" src="${current.artwork || ""}"><span class="card-glare"></span></div>`;
  document.body.appendChild(ghost);
  dragState = { pointerId: event.pointerId, ghost, position: null, space: null };
  try { dragCard.setPointerCapture(event.pointerId); } catch (_) {}
  dragCard.classList.add("is-dragging");
  moveDragGhost(event);
  updateDropTarget(event.clientX, event.clientY);
});

function moveDragGhost(event) {
  if (!dragState) return;
  dragState.ghost.style.left = `${event.clientX + 16}px`;
  dragState.ghost.style.top = `${event.clientY + 16}px`;
}

// FLIP animation: measure the album cards before and after changing the
// insertion point, then animate their independent `translate` property.
// This moves the cards without drawing a visible drop target or overriding tilt.
function animateTimelineShift(host, mutate) {
  const cards = [...host.querySelectorAll(".timeline-album")];
  const before = new Map(cards.map(el => [el, el.getBoundingClientRect()]));
  mutate();
  for (const [el, oldRect] of before) {
    const newRect = el.getBoundingClientRect();
    const dx = oldRect.left - newRect.left;
    if (Math.abs(dx) < 1) continue;
    el.style.transition = "none";
    el.style.translate = `${dx}px 0px`;
    // Commit the inverse position before animating it back to the new layout.
    void el.offsetWidth;
    requestAnimationFrame(() => {
      el.style.transition = "translate 280ms cubic-bezier(.2,.8,.2,1)";
      el.style.translate = "0px 0px";
      el.addEventListener("transitionend", event => {
        if (event.propertyName === "translate") {
          el.style.transition = "";
          el.style.translate = "";
        }
      }, { once: true });
    });
  }
}

function updateDropTarget(x, y) {
  if (!dragState) return;
  const host = $("timeline");
  const rect = host.getBoundingClientRect();
  const inside = y >= rect.top - 28 && y <= rect.bottom + 28 && x >= rect.left && x <= rect.right;

  if (!inside) {
    dragState.position = null;
    if (dragState.space) {
      const oldSpace = dragState.space;
      animateTimelineShift(host, () => oldSpace.remove());
      dragState.space = null;
    }
    return;
  }

  const albums = [...host.querySelectorAll(".timeline-album")];
  let position = albums.findIndex(el => {
    const r = el.getBoundingClientRect();
    return x < r.left + r.width / 2;
  });
  if (position < 0) position = albums.length;
  dragState.position = position;

  if (!dragState.space) {
    // The gap is intentionally blank and has no text, border, or icon.
    const space = document.createElement("div");
    space.className = "drop-space";
    space.setAttribute("aria-hidden", "true");
    dragState.space = space;
    const nextAlbum = albums[position] || null;
    animateTimelineShift(host, () => host.insertBefore(space, nextAlbum));
    return;
  }

  const space = dragState.space;
  const nextAlbum = albums[position] || null;
  const alreadyAtPosition = nextAlbum ? space.nextElementSibling === nextAlbum : host.lastElementChild === space;
  if (!alreadyAtPosition) {
    animateTimelineShift(host, () => host.insertBefore(space, nextAlbum));
  }
}


window.addEventListener("pointermove", event => {
  if (!dragState || event.pointerId !== dragState.pointerId) return;
  moveDragGhost(event);
  updateDropTarget(event.clientX, event.clientY);
});

function finishDrag(event) {
  if (!dragState || (event && event.pointerId !== dragState.pointerId)) return;
  const position = dragState.position;
  const space = dragState.space;
  dragState.ghost.remove();
  if (space) space.remove();
  dragState = null;
  dragCard.classList.remove("is-dragging");
  if (position !== null && position !== undefined) placeAt(position);
}
window.addEventListener("pointerup", finishDrag);
window.addEventListener("pointercancel", finishDrag);



function updateHearts() {
  $("hearts").innerHTML = [0,1,2].map(i => `<span class="${i < hearts ? "alive" : "lost"}">♥</span>`).join(" ");
  $("hearts").setAttribute("aria-label", `${hearts} hearts remaining`);
}

function placeAt(position) {
  if (answered || !current) return;
  answered = true;
  const left = timeline[position-1], right = timeline[position];
  const correct = (!left || left.year <= current.year) && (!right || current.year <= right.year);
  if (correct) {
    score++;
    timeline.splice(position, 0, current);
  } else {
    hearts = Math.max(0, hearts - 1);
    updateHearts();
  }
  $("score").textContent = score;
  $("mystery-title").textContent = current.title;
  $("mystery-artist").textContent = `${current.artist} · ${current.album}`;
  setCover(current.artwork);
  $("mystery-year").textContent = current.year;
  const result = $("result");
  result.className = `result ${correct ? "" : "wrong"}`;
  const dateText = current.date.length === 4 ? current.date : current.date;
  result.innerHTML = `<strong>${correct ? "Correct! Nice placement." : "Not quite!"}</strong><br>${escapeHTML(current.title)} by ${escapeHTML(current.artist)} has an Apple catalog release date of <strong>${escapeHTML(dateText)}</strong>.<br><span style="color:#aab6c9;font-size:11px">Date source: ${escapeHTML(current.source)}. ${correct ? "Your timeline grows!" : `You lost a heart. ${hearts} remaining.`}</span>`;
  if (correct) renderTimeline();
  if (hearts === 0) {
    result.classList.add("game-over");
    result.innerHTML += `<br><strong>Game over!</strong> You scored ${score} correct placements.`;
    $("next-button").disabled = false;
    $("next-button").innerHTML = `Play again <span>↻</span>`;
    $("next-button").dataset.action = "restart";
  } else {
    $("next-button").disabled = false;
    $("next-button").innerHTML = `Next track <span>→</span>`;
    $("next-button").dataset.action = "next";
  }
  round++;
}

function escapeHTML(s) {
  return String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}

document.addEventListener("pointerdown", () => {
  if (autoplayBlocked && current && !answered) startPreview();
}, true);
document.addEventListener("keydown", () => {
  if (autoplayBlocked && current && !answered) startPreview();
}, true);
audio.addEventListener("timeupdate", () => {
  if (audio.currentTime >= 28.5 && !fadingOut) {
    fadingOut = true;
    fadeVolume(0, 1500);
  }
  if (audio.currentTime >= 30) audio.pause();
});
audio.addEventListener("ended", () => {
  cancelFade(); audio.volume = TARGET_VOLUME; fadingOut = false;
});
async function loadStartingTrack() {
  const candidates = shuffle(SEEDS);
  for (const seed of candidates) {
    try {
      const track = await getTrack(seed);
      if (track) {
        const starter = {...track, seed};
        timeline = [starter];
        albumByYear.set(track.year, albumKey(track.album));
        renderTimeline();
        return true;
      }
    } catch (e) { console.warn(e); }
  }
  $("error-box").textContent = "Couldn't load a starting song from Apple's catalog. Please try a new game in a moment.";
  $("error-box").classList.remove("hidden");
  return false;
}

async function startNewGame() {
  timeline = []; albumByYear = new Map(); score = 0; hearts = 3; round = 1; current = null;
  answered = false; autoplayBlocked = false;
  setCover(null); resetPlayer();
  $("score").textContent = "0"; updateHearts();
  $("next-button").disabled = true;
  $("next-button").dataset.action = "next";
  $("next-button").innerHTML = `Next track <span>→</span>`;
  $("result").className = "result hidden";
  $("error-box").classList.add("hidden");
  $("round-label").textContent = "ROUND 1";
  renderTimeline();
  await loadStartingTrack();
  await loadNext();
}

$("next-button").addEventListener("click", () => {
  if ($("next-button").dataset.action === "restart") startNewGame();
  else loadNext();
});
$("new-game").addEventListener("click", startNewGame);

updateHearts();
startNewGame();
