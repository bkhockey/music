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
let timeline = [], current = null, round = 1, score = 0, hearts = 3, answered = false, audioUnlocked = false, fadeFrame = null, fadingOut = false;
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

// Avoid edition-specific dates: deluxe/remastered/reissue albums are not valid
// fallbacks for a song's original release year.
function isEditionWeShouldSkip(track) {
  const text = `${track.trackName || ""} ${track.collectionName || ""}`;
  return /\b(deluxe|remaster(?:ed)?|anniversary|expanded|reissue|re-issue|special edition|legacy edition|super deluxe|bonus tracks)\b/i.test(text);
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

async function findMusicBrainzDate(title, artist) {
  const cleanTitle = title.replace(/"/g, "");
  const cleanArtist = artist.replace(/"/g, "");
  const query = `recording:"${cleanTitle}" AND artist:"${cleanArtist}"`;
  const url = `https://musicbrainz.org/ws/2/recording/?query=${encodeURIComponent(query)}&fmt=json&limit=5`;
  try {
    const data = await fetchJSON(url);
    const recordings = data.recordings || [];
    const best = recordings
      .filter(r => r["first-release-date"] && validDate(r["first-release-date"]))
      .sort((a,b) => {
        const exactA = normalize(a.title) === normalize(title) ? 1 : 0;
        const exactB = normalize(b.title) === normalize(title) ? 1 : 0;
        return exactB - exactA;
      })[0];
    if (best) return {date: best["first-release-date"], mbid: best.id};
  } catch (e) {
    console.warn("MusicBrainz lookup unavailable; falling back to Apple release date.", e);
  }
  return null;
}

async function getTrack(seed) {
  const [title, artist] = seed;
  const apple = await findAppleTrack(title, artist);
  if (!apple) return null;
  const mb = await findMusicBrainzDate(title, artist);
  const date = mb?.date || (apple.releaseDate ? apple.releaseDate.slice(0,10) : null);
  if (!validDate(date)) return null;
  return {
    title: apple.trackName, artist: apple.artistName, date, year: yearOf(date),
    preview: apple.previewUrl, artwork: (apple.artworkUrl100 || "").replace("100x100bb", "300x300bb"),
    album: apple.collectionName || "", mbid: mb?.mbid || null,
    source: mb ? "MusicBrainz first-release date" : "Apple catalog release date"
  };
}

function setCover(url) {
  const img = $("mystery-cover"), placeholder = $("cover-placeholder");
  if (url) { img.src = url; img.style.display = "block"; placeholder.style.display = "none"; }
  else { img.style.display = "none"; placeholder.style.display = "block"; }
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
    audioUnlocked = true;
    fadeVolume(TARGET_VOLUME, 1400);
    $("play-button").textContent = "Ⅱ";
    $("player-status").textContent = "Playing preview · gentle fade-in";
    return true;
  } catch (e) {
    audio.volume = TARGET_VOLUME;
    $("play-button").textContent = "▶";
    $("player-status").textContent = "Tap play once to enable automatic previews";
    return false;
  }
}

function resetPlayer() {
  cancelFade();
  audio.pause(); audio.removeAttribute("src"); audio.load(); audio.volume = TARGET_VOLUME;
  fadingOut = false;
  $("play-button").disabled = true; $("play-button").textContent = "▶";
  $("player-status").textContent = "Finding a playable preview…";
  $("player-time").textContent = "0:00 / 0:30"; $("progress").style.width = "0%";
}

async function loadNext() {
  answered = false;
  $("next-button").disabled = true;
  $("result").className = "result hidden";
  $("placement-controls").classList.remove("hidden");
  $("error-box").classList.add("hidden");
  $("round-label").textContent = `ROUND ${round}`;
  $("mystery-title").textContent = "Finding a song…";
  $("mystery-artist").textContent = "Artist and release date are hidden";
  setCover(null); resetPlayer();

  const candidates = shuffle(SEEDS.filter(s => !timeline.some(t => t.seed.join("|") === s.join("|"))));
  for (const seed of candidates.slice(0, 12)) {
    try {
      const track = await getTrack(seed);
      if (track && !timeline.some(t => t.title.toLowerCase() === track.title.toLowerCase() && t.artist.toLowerCase() === track.artist.toLowerCase())) {
        current = {...track, seed};
        break;
      }
    } catch (e) { console.warn(e); }
    await sleep(1100); // Respect MusicBrainz's one-request-per-second guideline.
  }
  if (!current) {
    $("mystery-title").textContent = "Couldn't find another playable track";
    $("mystery-artist").textContent = "Try starting a new game or reload the page.";
    $("error-box").textContent = "The preview catalog or MusicBrainz may be temporarily unavailable. Try again in a moment.";
    $("error-box").classList.remove("hidden");
    $("placement-controls").classList.add("hidden");
    return;
  }
  $("mystery-title").textContent = "Mystery track";
  $("player-status").textContent = "Preview ready — listen and make your guess";
  audio.src = current.preview;
  $("play-button").disabled = false;
  renderTimeline();
  updatePlacementButtons();
  // Browsers may block audible autoplay until the player has received a user gesture.
  // Once unlocked, previews start automatically on every subsequent round.
  await startPreview();
}

function renderTimeline() {
  const host = $("timeline");
  host.innerHTML = "";
  if (!timeline.length) {
    host.innerHTML = `<div class="song-tile" style="width:100%;align-items:center;justify-content:center;text-align:center"><div class="year">Your timeline is empty</div><div class="artist">Your first correct placement will start it.</div></div>`;
    return;
  }
  timeline.forEach(track => {
    const el = document.createElement("div");
    el.className = "song-tile";
    el.innerHTML = `<div><div class="year">${track.year}</div><div class="song-name"></div><div class="artist"></div></div><img class="tiny-cover" alt="" src="">`;
    el.querySelector(".song-name").textContent = track.title;
    el.querySelector(".artist").textContent = track.artist;
    if (track.artwork) el.querySelector("img").src = track.artwork;
    else el.querySelector("img").style.visibility = "hidden";
    host.appendChild(el);
  });
}

function updatePlacementButtons() {
  const controls = $("placement-controls");
  controls.innerHTML = "";
  const positions = timeline.length + 1;
  for (let i=0;i<positions;i++) {
    const btn = document.createElement("button");
    btn.className = "place-button";
    btn.dataset.position = i;
    if (!timeline.length) btn.textContent = "Place as first song";
    else if (i === 0) btn.textContent = "← Before all";
    else if (i === timeline.length) btn.textContent = "After all →";
    else btn.textContent = `Between ${timeline[i-1].year} and ${timeline[i].year}`;
    btn.addEventListener("click", () => placeAt(i));
    controls.appendChild(btn);
  }
}

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
  const result = $("result");
  result.className = `result ${correct ? "" : "wrong"}`;
  const dateText = current.date.length === 4 ? current.date : current.date;
  result.innerHTML = `<strong>${correct ? "Correct! Nice placement." : "Not quite!"}</strong><br>${escapeHTML(current.title)} by ${escapeHTML(current.artist)} was first released on <strong>${escapeHTML(dateText)}</strong>.<br><span style="color:#aab6c9;font-size:11px">Date source: ${escapeHTML(current.source)}. ${correct ? "Your timeline grows!" : `You lost a heart. ${hearts} remaining.`}</span>`;
  $("placement-controls").classList.add("hidden");
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

$("play-button").addEventListener("click", async () => {
  if (!audio.src) return;
  if (audio.paused) await startPreview();
  else {
    cancelFade();
    audio.pause();
    audio.volume = TARGET_VOLUME;
    $("play-button").textContent = "▶";
    $("player-status").textContent = "Preview paused";
  }
});
audio.addEventListener("timeupdate", () => {
  const t = Math.min(audio.currentTime, 30), duration = Math.min(audio.duration || 30, 30);
  $("progress").style.width = `${(t/duration)*100}%`;
  const fmt = n => `0:${String(Math.floor(n)).padStart(2,"0")}`;
  $("player-time").textContent = `${fmt(t)} / 0:30`;
  if (audio.currentTime >= 28.5 && !fadingOut) {
    fadingOut = true;
    fadeVolume(0, 1500);
  }
  if (audio.currentTime >= 30) audio.pause();
});
audio.addEventListener("ended", () => {
  cancelFade(); audio.volume = TARGET_VOLUME; fadingOut = false;
  $("play-button").textContent = "▶"; $("player-status").textContent = "Preview finished";
});
audio.addEventListener("pause", () => { $("play-button").textContent = "▶"; });
$("next-button").addEventListener("click", () => {
  if ($("next-button").dataset.action === "restart") {
    timeline = []; score = 0; hearts = 3; round = 1; current = null;
    $("score").textContent = "0"; updateHearts();
    $("next-button").dataset.action = "next";
    $("next-button").innerHTML = `Next track <span>→</span>`;
    renderTimeline(); loadNext();
  } else loadNext();
});
$("new-game").addEventListener("click", () => {
  timeline = []; score = 0; hearts = 3; round = 1; current = null;
  $("score").textContent = "0"; updateHearts();
  $("next-button").dataset.action = "next";
  $("next-button").innerHTML = `Next track <span>→</span>`;
  renderTimeline(); loadNext();
});

updateHearts();
renderTimeline();
loadNext();
