
// App State
let playlists = { timeline: [], all: [], bonus: [] };
let currentPlaylist = 'timeline';
let currentTrackIndex = 0;
let isPlaying = false;
let isShuffle = false;
let repeatMode = 0; // 0: off, 1: all, 2: one
let currentMode = 'audio'; // 'audio' | 'video'

// Audio Engine State
let audioContext;
let audioSource; // For Video Element
let gainNode;
let compressor;
let currentAudioObj = null; // For Audio() objects
let fadeInterval = null;

// DOM Elements
const videoElement = document.getElementById('video-player');
const trackListEl = document.getElementById('track-list');
const playlistTitleEl = document.getElementById('playlist-title');
const playlistCountEl = document.getElementById('playlist-count');
const playBtn = document.getElementById('play-btn');
const prevBtn = document.getElementById('prev-btn');
const nextBtn = document.getElementById('next-btn');
const progressBar = document.getElementById('progress-bar');
const currTimeEl = document.getElementById('current-time');
const totalTimeEl = document.getElementById('total-time');
const volumeBar = document.getElementById('volume-bar');
const navItems = document.querySelectorAll('.nav-item');
const mobileNavBtns = document.querySelectorAll('.mobile-nav .nav-btn');
const currentTitleEl = document.getElementById('current-title');
const currentArtistEl = document.getElementById('current-artist');
const albumArtPlaceholder = document.getElementById('album-art');
const mediaContainer = document.getElementById('media-container');
const footerCoverEl = document.getElementById('footer-cover');

// DOM Elements - Full Screen Controls
const fsTitleEl = document.getElementById('fs-title');
const fsArtistEl = document.getElementById('fs-artist');
const fsProgressBar = document.getElementById('fs-progress-bar');
const fsCurrentTimeEl = document.getElementById('fs-current-time');
const fsTotalTimeEl = document.getElementById('fs-total-time');
const fsPlayBtn = document.getElementById('fs-play-btn');
const fsPrevBtn = document.getElementById('fs-prev-btn');
const fsNextBtn = document.getElementById('fs-next-btn');
const fsVolumeBar = document.getElementById('fs-volume-bar');
const modeAudioBtn = document.getElementById('mode-audio');
const modeVideoBtn = document.getElementById('mode-video');
const shuffleBtn = document.getElementById('shuffle-btn');
const queueListEl = document.getElementById('queue-list');

// Helper: Format Time
function formatTime(seconds) {
    if (isNaN(seconds)) return "0:00";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
}

// Helper: Update Range Background
function updateRangeBackground(rangeInput) {
    if (!rangeInput) return;
    const min = parseFloat(rangeInput.min) || 0;
    const max = parseFloat(rangeInput.max) || 100;
    const val = parseFloat(rangeInput.value) || 0;
    const percentage = max > min ? ((val - min) / (max - min)) * 100 : 0;
    rangeInput.style.background = `linear-gradient(to right, var(--text-primary) ${percentage}%, rgba(0,0,0,0.1) ${percentage}%)`;
}

// Initialization
async function init() {
    try {
        const response = await fetch('media_data.json');
        if (!response.ok) throw new Error('Network response was not ok');
        const data = await response.json();
        if (data && typeof data === 'object') {
            playlists = { timeline: data.timeline || [], all: data.all || [], bonus: data.bonus || [] };
        }

        // Enforce Sorting: Newest (Year High) -> Oldest (Year Low)
        Object.keys(playlists).forEach(key => {
            if (Array.isArray(playlists[key])) {
                playlists[key].sort((a, b) => (b.year || 0) - (a.year || 0));
            }
        });

        // Initial Render
        renderPlaylist(currentPlaylist);

        // Deep Link Logic
        const urlParams = new URLSearchParams(window.location.search);
        const sharedTitle = urlParams.get('title');
        let initialTrackLoaded = false;

        if (sharedTitle) {
            // Find track across all playlists
            for (const key of ['timeline', 'all', 'bonus']) {
                const idx = playlists[key].findIndex(t => t.title === sharedTitle);
                if (idx !== -1) {
                    currentPlaylist = key;
                    currentTrackIndex = idx;
                    // Update Nav UI
                    updateNavState();
                    renderPlaylist(currentPlaylist);
                    // Load found track (autoplay might be blocked, but we load it)
                    loadTrack(currentTrackIndex, currentPlaylist, false);
                    initialTrackLoaded = true;
                    // Open full screen player for visibility
                    openFullScreenPlayer();
                    break;
                }
            }
        }

        // Auto-load first track (paused) if no deep link found or deep link failed
        if (!initialTrackLoaded && playlists[currentPlaylist].length > 0) {
            preloadTrack(0, currentPlaylist);
            // Ensure URL is clean or reflects first track? 
            // Better to keep clean until user interaction or just default.
            // Let's set it to the first track's title so the link is always shareable.
            const firstTrack = playlists[currentPlaylist][0];
            const newUrl = `${window.location.pathname}?title=${encodeURIComponent(firstTrack.title)}`;
            history.replaceState(null, '', newUrl);
        }

        renderQueue();

        setupEventListeners();
        setupAudioContext();
        updateModeUI();

        // Init Volume Bar UI
        updateRangeBackground(volumeBar);
        updateRangeBackground(progressBar);
    } catch (e) {
        console.error("Failed to load playlist data:", e);
        if (playlistTitleEl) playlistTitleEl.textContent = "Error Loading Data";
        if (playlistCountEl) playlistCountEl.textContent = "0 songs";
    }
}

// Audio Context Setup
function setupAudioContext() {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    audioContext = new AudioContext();

    // Compressor Node (Normalization)
    compressor = audioContext.createDynamicsCompressor();
    compressor.threshold.setValueAtTime(-24, audioContext.currentTime);
    compressor.knee.setValueAtTime(30, audioContext.currentTime);
    compressor.ratio.setValueAtTime(12, audioContext.currentTime);
    compressor.attack.setValueAtTime(0.003, audioContext.currentTime);
    compressor.release.setValueAtTime(0.25, audioContext.currentTime);

    // Master Gain
    gainNode = audioContext.createGain();

    // Graph: Source -> Compressor -> Gain -> Dest
    compressor.connect(gainNode);
    gainNode.connect(audioContext.destination);

    // Setup Video Element Source
    // Note: Audio() objects need their own source nodes created on demand
    const videoSource = audioContext.createMediaElementSource(videoElement);
    videoSource.connect(compressor);
}

// App State for Rendering
let currentRenderTracks = [];
const BATCH_SIZE = 50;
let renderedCount = 0;

// Render Playlist (Modified for Performance)
function renderPlaylist(playlistKey, searchQuery = '') {
    const tracks = playlists[playlistKey] || [];
    trackListEl.innerHTML = '';

    // reset rendering state
    currentRenderTracks = tracks.filter(t => t.title.toLowerCase().includes(searchQuery.toLowerCase()));
    playlistTitleEl.textContent = playlistKey === 'timeline' ? 'สถานีพีรภัทร' : (playlistKey.charAt(0).toUpperCase() + playlistKey.slice(1));
    playlistCountEl.textContent = `${currentRenderTracks.length} songs`;

    renderedCount = 0;
    renderNextBatch(playlistKey);
}

function renderNextBatch(playlistKey) {
    if (renderedCount >= currentRenderTracks.length) return;

    const fragment = document.createDocumentFragment();
    const limit = Math.min(renderedCount + BATCH_SIZE, currentRenderTracks.length);

    for (let i = renderedCount; i < limit; i++) {
        const track = currentRenderTracks[i];
        // Find original index relative to the main playlists object for click handler
        // Optimization: For filtered searches, indexOf is fine.
        // For full playlists, it's just 'i' if not filtered, but we always use indexOf to be safe with sorting.
        // Since we sort the main 'playlists' object directly, indexOf is reliable.
        const originalIndex = playlists[playlistKey].indexOf(track);

        const div = document.createElement('div');
        div.className = `track-item ${originalIndex === currentTrackIndex && currentPlaylist === playlistKey ? 'active' : ''}`;
        div.dataset.index = String(originalIndex);
        div.dataset.playlist = playlistKey;

        const yearBadge = track.year ? `<span class="track-year">${track.year}</span>` : '';
        const titleEscaped = track.title.replace(/</g, '&lt;').replace(/>/g, '&gt;');

        div.innerHTML = `
            <div class="track-number">${originalIndex + 1}</div>
            <div class="track-details">
                <div class="track-title-row">
                    <div class="track-title"><span class="track-title-inner">${titleEscaped}</span></div>
                    <button type="button" class="track-open-control-btn" aria-label="เปิดหน้าคอนโทรล" title="เปิดหน้าคอนโทรล"><span class="material-icons-round">open_in_full</span></button>
                </div>
                <div class="track-artist">
                    <span>PeephatZ Studio</span>
                    ${yearBadge}
                </div>
            </div>
            <div class="track-duration"></div> 
        `;
        fragment.appendChild(div);
    }

    trackListEl.appendChild(fragment);
    renderedCount = limit;
    applyMarqueeToVisibleTitles();
}

function applyMarqueeToVisibleTitles() {
    trackListEl.querySelectorAll('.track-item').forEach((item) => {
        const title = item.querySelector('.track-title');
        const inner = item.querySelector('.track-title-inner');
        if (!title || !inner) return;
        if (title.scrollWidth > title.offsetWidth) {
            const offset = -(title.scrollWidth - title.offsetWidth);
            inner.style.setProperty('--marquee-offset', offset + 'px');
            inner.classList.add('marquee');
        } else {
            inner.classList.remove('marquee');
            inner.style.removeProperty('--marquee-offset');
        }
    });
}

function applyFooterTitleMarquee() {
    const wrap = document.querySelector('.now-playing-title-wrap');
    if (!currentTitleEl || !wrap) return;
    if (currentTitleEl.scrollWidth > wrap.offsetWidth) {
        const offset = -(currentTitleEl.scrollWidth - wrap.offsetWidth);
        currentTitleEl.style.setProperty('--marquee-offset', offset + 'px');
        currentTitleEl.classList.add('marquee');
    } else {
        currentTitleEl.classList.remove('marquee');
        currentTitleEl.style.removeProperty('--marquee-offset');
    }
}

// Preload Track (Metadata only) - แสดงปกทั้งพื้นที่หลักและ footer ทันที
function preloadTrack(index, playlistKey) {
    const track = playlists[playlistKey][index];
    if (!track) return;

    currentTitleEl.textContent = track.title;
    currentArtistEl.textContent = `PeephatZ Studio • ${track.year || ''}`;

    const coverPath = track.cover ? track.cover.replace(/\\/g, '/') : '';
    const coverUrl = coverPath ? `url('${coverPath}')` : '';

    // ปกพื้นที่หลัก (อัลบั้มใหญ่)
    if (albumArtPlaceholder) {
        albumArtPlaceholder.style.backgroundImage = coverUrl;
        if (coverPath) {
            albumArtPlaceholder.style.backgroundSize = 'cover';
            albumArtPlaceholder.style.backgroundPosition = 'center';
            const icon = albumArtPlaceholder.querySelector('.material-icons-round');
            if (icon) icon.style.display = 'none';
        } else {
            const icon = albumArtPlaceholder.querySelector('.material-icons-round');
            if (icon) icon.style.display = 'block';
        }
    }

    // ปกแถบด้านล่าง
    if (footerCoverEl) {
        footerCoverEl.style.backgroundImage = coverUrl;
        if (coverPath) {
            footerCoverEl.style.backgroundSize = 'cover';
            footerCoverEl.style.backgroundPosition = 'center';
            const footerIcon = footerCoverEl.querySelector('.material-icons-round');
            if (footerIcon) footerIcon.style.display = 'none';
        } else {
            const footerIcon = footerCoverEl.querySelector('.material-icons-round');
            if (footerIcon) footerIcon.style.display = 'block';
        }
    }

    updateActiveItemInList(index, playlistKey);
    updateModeAvailability(track);
    requestAnimationFrame(() => applyFooterTitleMarquee());
}

function updateActiveItemInList(index, playlistKey) {
    if (currentPlaylist !== playlistKey) return;
    document.querySelectorAll('.track-item').forEach(el => el.classList.remove('active'));
    const items = trackListEl.querySelectorAll('.track-item');
    items.forEach((el, i) => {
        if (Number(el.dataset.index) === index) el.classList.add('active');
    });
}

function openFullScreenPlayer() {
    const fsPlayer = document.getElementById('full-screen-player');
    const fsMediaSlot = document.getElementById('fs-media-slot');
    const mediaWrapper = document.querySelector('.media-container-wrapper');
    if (fsMediaSlot && mediaWrapper) fsMediaSlot.appendChild(mediaWrapper);
    if (fsPlayer) fsPlayer.classList.add('active');
}

function handleTrackListClick(e) {
    if (e.target.closest('.track-open-control-btn')) {
        e.preventDefault();
        const item = e.target.closest('.track-item');
        if (!item) return;
        const index = parseInt(item.dataset.index, 10);
        const playlistKey = item.dataset.playlist;
        if (isNaN(index) || !playlistKey) return;
        loadTrack(index, playlistKey, true);
        openFullScreenPlayer();
        renderQueue();
        return;
    }
    const item = e.target.closest('.track-item');
    if (!item) return;
    const index = parseInt(item.dataset.index, 10);
    const playlistKey = item.dataset.playlist;
    if (isNaN(index) || !playlistKey) return;
    loadTrack(index, playlistKey, true);
    renderQueue();
}

// Mode Logic
function toggleMode(mode) {
    if (currentMode === mode) return;

    const track = playlists[currentPlaylist][currentTrackIndex];
    if (mode === 'video' && track.type !== 'video') {
        // Cannot switch to video mode for audio tracks
        return;
    }

    currentMode = mode;
    updateModeUI();

    // Apply visibility changes immediately
    if (track.type === 'video') {
        if (currentMode === 'video') {
            videoElement.style.display = 'block';
            albumArtPlaceholder.style.display = 'none';
            if (mediaContainer) { mediaContainer.classList.remove('is-cover'); mediaContainer.classList.add('is-video'); }
        } else {
            videoElement.style.display = 'none';
            albumArtPlaceholder.style.display = 'flex';
            if (mediaContainer) { mediaContainer.classList.remove('is-video'); mediaContainer.classList.add('is-cover'); }
        }
    }
}

function updateModeUI() {
    if (!modeAudioBtn || !modeVideoBtn) return;
    if (currentMode === 'audio') {
        modeAudioBtn.classList.add('active');
        modeVideoBtn.classList.remove('active');
    } else {
        modeAudioBtn.classList.remove('active');
        modeVideoBtn.classList.add('active');
    }
}

function updateModeAvailability(track) {
    if (!modeVideoBtn) return;
    if (track.type === 'video') {
        modeVideoBtn.disabled = false;
        modeVideoBtn.style.opacity = '1';
    } else {
        modeVideoBtn.disabled = true;
        modeVideoBtn.style.opacity = '0.3';
        if (currentMode === 'video') toggleMode('audio');
    }
}

// Queue / Up Next (indices in playlist order or shuffle order)
function getUpNextIndices(count = 8, currentIdx = null) {
    const list = playlists[currentPlaylist] || [];
    if (!list.length) return [];
    const cur = currentIdx !== null ? currentIdx : currentTrackIndex;
    const safeCur = Math.min(Math.max(0, cur), list.length - 1);
    const result = [];
    if (isShuffle) {
        const others = list.map((_, i) => i).filter(i => i !== safeCur);
        for (let i = 0; i < count && others.length > 0; i++) {
            const r = Math.floor(Math.random() * others.length);
            result.push(others.splice(r, 1)[0]);
        }
    } else {
        for (let i = 1; i <= count; i++) {
            result.push((safeCur + i) % list.length);
        }
    }
    return result;
}

function renderQueue() {
    if (!queueListEl) return;
    const list = playlists[currentPlaylist] || [];
    const safeIndex = list.length ? Math.min(currentTrackIndex, list.length - 1) : 0;
    const upNext = getUpNextIndices(10, safeIndex);
    queueListEl.innerHTML = '';
    // Current
    const cur = list[safeIndex];
    if (cur) {
        const li = document.createElement('li');
        li.className = 'playing';
        li.dataset.index = String(safeIndex);
        li.innerHTML = `<span class="queue-item-num">▶</span><span class="queue-item-title">${escapeHtml(cur.title)}</span>`;
        queueListEl.appendChild(li);
    }
    upNext.forEach((idx, i) => {
        const t = list[idx];
        if (!t) return;
        const li = document.createElement('li');
        li.dataset.index = String(idx);
        li.innerHTML = `<span class="queue-item-num">${i + 1}</span><span class="queue-item-title">${escapeHtml(t.title)}</span>`;
        queueListEl.appendChild(li);
    });
    if (shuffleBtn) shuffleBtn.classList.toggle('active', isShuffle);
}

function escapeHtml(s) {
    if (!s) return '';
    const div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
}

// Load & Play Logic
async function loadTrack(index, playlistKey, autoPlay = false) {
    // Ensure AudioContext is resumed
    if (audioContext && audioContext.state === 'suspended') {
        await audioContext.resume();
    }

    if (currentPlaylist !== playlistKey) {
        currentPlaylist = playlistKey;
        updateNavState();
        renderPlaylist(currentPlaylist);
    }

    currentTrackIndex = index;
    updateActiveItemInList(index, playlistKey);

    const track = playlists[currentPlaylist][currentTrackIndex];
    if (!track) return;

    updateModeAvailability(track);

    // Crossfade Logic
    // 1. If playing, fade out current
    // 2. Start new track (fade in)
    const previousAudio = currentAudioObj;
    // Fix: Check if video is playing regardless of visibility (Song Mode)
    const previousVideoPlaying = !videoElement.paused;

    // Clear any pending video fades to prevent fighting
    if (fadeInterval) {
        clearInterval(fadeInterval);
        fadeInterval = null;
    }

    // Stop previous media
    if (previousAudio) {
        fadeOut(previousAudio, () => {
            previousAudio.pause();
            previousAudio.src = ""; // Clean up
        });
        currentAudioObj = null;
    }
    if (previousVideoPlaying) {
        if (track.type === 'video') {
            // Video -> Video: Hard cut (cannot crossfade same element easily)
            videoElement.pause();
            videoElement.volume = 1.0;
        } else {
            // Video -> Audio: Fade out video
            fadeOutVideo(videoElement, () => {
                videoElement.pause();
            });
        }
    }

    // Prepare New Media
    currentTitleEl.textContent = track.title;
    currentArtistEl.textContent = `PeephatZ Studio • ${track.year || ''}`;

    // Sync FS Info
    if (fsTitleEl) fsTitleEl.textContent = track.title;
    if (fsArtistEl) fsArtistEl.textContent = `PeephatZ Studio • ${track.year || ''}`;

    const src = track.file;
    const fullPath = track.file;

    // Handle Cover Art (main + footer bar)
    if (track.cover) {
        const coverPath = track.cover.replace(/\\/g, '/');
        const coverUrl = `url('${coverPath}')`;
        albumArtPlaceholder.style.backgroundImage = coverUrl;
        albumArtPlaceholder.style.backgroundSize = 'cover';
        albumArtPlaceholder.style.backgroundPosition = 'center';
        const icon = albumArtPlaceholder.querySelector('.material-icons-round');
        if (icon) icon.style.display = 'none';
        if (footerCoverEl) {
            footerCoverEl.style.backgroundImage = coverUrl;
            footerCoverEl.style.backgroundSize = 'cover';
            footerCoverEl.style.backgroundPosition = 'center';
            const footerIcon = footerCoverEl.querySelector('.material-icons-round');
            if (footerIcon) footerIcon.style.display = 'none';
        }
    } else {
        albumArtPlaceholder.style.backgroundImage = '';
        const icon = albumArtPlaceholder.querySelector('.material-icons-round');
        if (icon) icon.style.display = 'block';
        if (footerCoverEl) {
            footerCoverEl.style.backgroundImage = '';
            const footerIcon = footerCoverEl.querySelector('.material-icons-round');
            if (footerIcon) footerIcon.style.display = 'block';
        }
    }

    // Aspect: cover = 1:1, video = 16:9
    if (mediaContainer) {
        mediaContainer.classList.remove('is-cover', 'is-video');
        if (track.type === 'video' && currentMode === 'video') {
            mediaContainer.classList.add('is-video');
        } else {
            mediaContainer.classList.add('is-cover');
        }
    }

    if (track.type === 'video') {
        // Video Handling
        const isVideoMode = currentMode === 'video';

        videoElement.src = fullPath;
        videoElement.load();
        videoElement.volume = 1.0;

        if (isVideoMode) {
            videoElement.style.display = 'block';
            albumArtPlaceholder.style.display = 'none';
        } else {
            videoElement.style.display = 'none';
            albumArtPlaceholder.style.display = 'flex';
        }

        if (autoPlay) {
            videoElement.play();
            isPlaying = true;
            // fadeInVideo(videoElement);
        }
    } else {
        // Audio Handling
        albumArtPlaceholder.style.display = 'flex';
        videoElement.style.display = 'none';

        const audio = new Audio(fullPath);
        // Connect to AudioContext
        const source = audioContext.createMediaElementSource(audio);
        source.connect(compressor); // Connect to common graph

        currentAudioObj = audio;

        // Events for Audio Object
        audio.addEventListener('ended', nextTrack);
        audio.addEventListener('timeupdate', () => updateProgress(audio));
        audio.addEventListener('loadedmetadata', () => {
            const d = formatTime(audio.duration);
            if (totalTimeEl) totalTimeEl.textContent = d;
            if (fsTotalTimeEl) fsTotalTimeEl.textContent = d;
        });

        if (autoPlay) {
            audio.play();
            isPlaying = true;

            const trackGain = audioContext.createGain();
            source.disconnect();
            source.connect(trackGain);
            trackGain.connect(compressor);

            audio.trackGain = trackGain; // Store reference

            fadeIn(trackGain);
        }
    }
    updatePlayButton();
    updateMediaSession(track);

    // Update Browser URL for Deep Linking
    const newUrl = `${window.location.pathname}?title=${encodeURIComponent(track.title)}`;
    history.replaceState(null, '', newUrl);

    renderQueue();
    requestAnimationFrame(() => applyFooterTitleMarquee());
}

function fadeOut(audioObj, callback) {
    if (!audioObj || !audioObj.trackGain) {
        if (callback) callback();
        return;
    }
    const gain = audioObj.trackGain.gain;
    gain.cancelScheduledValues(audioContext.currentTime);
    gain.setValueAtTime(gain.value, audioContext.currentTime);
    gain.linearRampToValueAtTime(0, audioContext.currentTime + 1.0); // 1s fade
    setTimeout(() => {
        if (callback) callback();
    }, 1000);
}

function fadeIn(gainNodeTarget) {
    const gain = gainNodeTarget.gain;
    gain.cancelScheduledValues(audioContext.currentTime);
    gain.setValueAtTime(0, audioContext.currentTime);
    gain.linearRampToValueAtTime(1, audioContext.currentTime + 1.0);
}

// Video Fades (Direct Volume manipulation)
function fadeOutVideo(vid, callback) {
    let vol = vid.volume; // Start from current volume
    if (fadeInterval) clearInterval(fadeInterval);

    fadeInterval = setInterval(() => {
        if (vol > 0) {
            vol -= 0.1;
            vid.volume = Math.max(0, vol);
        } else {
            clearInterval(fadeInterval);
            fadeInterval = null;
            if (callback) callback();
        }
    }, 50); // 50ms * 10 = 500ms
}

function fadeInVideo(vid) {
    vid.volume = 0;
    let vol = 0;
    if (fadeInterval) clearInterval(fadeInterval);

    fadeInterval = setInterval(() => {
        if (vol < 1.0) {
            vol += 0.1;
            vid.volume = Math.min(1.0, vol);
        } else {
            clearInterval(fadeInterval);
            fadeInterval = null;
        }
    }, 50);
}

// Controls
function togglePlay() {
    const activeMedia = currentAudioObj || videoElement;
    const hasSource = currentAudioObj ? (currentAudioObj.src || currentAudioObj.currentSrc) : (videoElement.currentSrc || videoElement.src);
    if (!hasSource) {
        if (playlists[currentPlaylist].length > 0) {
            loadTrack(0, currentPlaylist, true);
        }
        return;
    }

    if (isPlaying) {
        activeMedia.pause();
        isPlaying = false;
    } else {
        if (audioContext && audioContext.state === 'suspended') audioContext.resume();
        activeMedia.play();
        isPlaying = true;
    }
    updatePlayButton();
}

function updatePlayButton() {
    const icon = isPlaying ? 'pause' : 'play_arrow';
    if (playBtn) {
        const span = playBtn.querySelector('span');
        if (span) span.textContent = icon;
    }
    if (fsPlayBtn) {
        const span = fsPlayBtn.querySelector('span');
        if (span) span.textContent = icon;
    }
}

function nextTrack() {
    const list = playlists[currentPlaylist] || [];
    if (!list.length) return;
    let newIndex;
    if (isShuffle && list.length > 1) {
        do { newIndex = Math.floor(Math.random() * list.length); } while (newIndex === currentTrackIndex);
    } else {
        newIndex = currentTrackIndex + 1;
        if (newIndex >= list.length) newIndex = 0;
    }
    loadTrack(newIndex, currentPlaylist, true);
    renderQueue();
}

function prevTrack() {
    let newIndex = currentTrackIndex - 1;
    if (newIndex < 0) newIndex = playlists[currentPlaylist].length - 1;
    loadTrack(newIndex, currentPlaylist, true);
}

// UI Updates
function updateProgress(media) {
    if (!media || !media.duration) return;
    const progress = (media.currentTime / media.duration) * 100;
    if (progressBar) {
        progressBar.value = progress;
        updateRangeBackground(progressBar);
    }
    if (currTimeEl) currTimeEl.textContent = formatTime(media.currentTime);
    if (fsProgressBar) {
        fsProgressBar.value = progress;
        updateRangeBackground(fsProgressBar);
    }
    if (fsCurrentTimeEl) fsCurrentTimeEl.textContent = formatTime(media.currentTime);
    if (fsTotalTimeEl && !isNaN(media.duration)) {
        fsTotalTimeEl.textContent = formatTime(media.duration);
    }
}

function updateNavState() {
    navItems.forEach(item => {
        if (item.dataset.playlist === currentPlaylist) item.classList.add('active');
        else item.classList.remove('active');
    });
    mobileNavBtns.forEach(btn => {
        if (btn.dataset.playlist === currentPlaylist) btn.classList.add('active');
        else btn.classList.remove('active');
    });
}

// Event Listeners
function setupEventListeners() {
    // DOM Elements for Full Screen
    const fullScreenPlayer = document.getElementById('full-screen-player');
    const closePlayerBtn = document.getElementById('close-player');
    const nowPlayingArea = document.querySelector('.now-playing');

    // Dynamic Positioning Elements
    const inlineContainer = document.getElementById('inline-player-container');
    const fsMediaSlot = document.getElementById('fs-media-slot');
    const mediaWrapper = document.querySelector('.media-container-wrapper');

    function movePlayerToFullScreen() {
        if (fsMediaSlot && mediaWrapper) {
            fsMediaSlot.appendChild(mediaWrapper);
        }
    }

    function movePlayerToInline() {
        if (inlineContainer && mediaWrapper) {
            inlineContainer.appendChild(mediaWrapper);
        }
    }

    // Open Full Screen Player
    if (nowPlayingArea) {
        nowPlayingArea.addEventListener('click', () => {
            if (fullScreenPlayer) {
                movePlayerToFullScreen();
                fullScreenPlayer.classList.add('active');
                renderQueue();
            }
        });
    }

    // Track list: title click → open control screen; row (empty) click → play only
    if (trackListEl) {
        trackListEl.addEventListener('click', handleTrackListClick);
    }

    // Shuffle toggle
    if (shuffleBtn) {
        shuffleBtn.addEventListener('click', () => {
            isShuffle = !isShuffle;
            renderQueue();
        });
    }

    // Queue list: click song to play
    if (queueListEl) {
        queueListEl.addEventListener('click', (e) => {
            const li = e.target.closest('li');
            if (!li || li.dataset.index === undefined) return;
            const index = parseInt(li.dataset.index, 10);
            if (isNaN(index)) return;
            loadTrack(index, currentPlaylist, true);
            renderQueue();
        });
    }

    // Close Full Screen Player
    if (closePlayerBtn) {
        closePlayerBtn.addEventListener('click', () => {
            if (fullScreenPlayer) {
                fullScreenPlayer.classList.remove('active');
                // Wait for transition to finish (approx 400ms) before moving back
                setTimeout(() => {
                    movePlayerToInline();
                }, 400);
            }
        });
    }

    // FS Media Controls
    if (fsPlayBtn) fsPlayBtn.addEventListener('click', togglePlay);
    if (fsNextBtn) fsNextBtn.addEventListener('click', nextTrack);
    if (fsPrevBtn) fsPrevBtn.addEventListener('click', prevTrack);

    // FS Seek
    if (fsProgressBar) {
        fsProgressBar.addEventListener('input', (e) => {
            const activeMedia = currentAudioObj || videoElement;
            if (activeMedia && activeMedia.duration) {
                const seekTime = (e.target.value / 100) * activeMedia.duration;
                activeMedia.currentTime = seekTime;
                updateRangeBackground(e.target);
            }
        });
    }

    // Share Button
    const shareBtn = document.getElementById('share-btn');
    if (shareBtn) {
        shareBtn.addEventListener('click', shareCurrentTrack);
    }

    // Media Session Action Handlers
    if ('mediaSession' in navigator) {
        navigator.mediaSession.setActionHandler('play', () => togglePlay());
        navigator.mediaSession.setActionHandler('pause', () => togglePlay());
        navigator.mediaSession.setActionHandler('previoustrack', () => prevTrack());
        navigator.mediaSession.setActionHandler('nexttrack', () => nextTrack());
        navigator.mediaSession.setActionHandler('seekto', (details) => {
            const activeMedia = currentAudioObj || videoElement;
            if (activeMedia && details.seekTime !== undefined) {
                activeMedia.currentTime = details.seekTime;
            }
        });
    }
}

// Media Session API Update
function updateMediaSession(track) {
    if ('mediaSession' in navigator) {
        const coverPath = track.cover ? track.cover.replace(/\\/g, '/') : 'cover.jpg';

        navigator.mediaSession.metadata = new MediaMetadata({
            title: track.title,
            artist: `PeephatZ Studio • ${track.year || ''}`,
            artwork: [
                { src: coverPath, sizes: '512x512', type: 'image/jpeg' },
                { src: coverPath, sizes: '96x96', type: 'image/jpeg' }
            ]
        });
    }
}

// Share Modal Logic
const shareModal = document.getElementById('share-modal');
const closeShareModalBtn = document.getElementById('close-share-modal');
const copyLinkBtn = document.getElementById('copy-link-btn');
const systemShareBtn = document.getElementById('system-share-btn');

if (closeShareModalBtn) {
    closeShareModalBtn.addEventListener('click', () => {
        shareModal.classList.remove('active');
    });
}

function shareCurrentTrack() {
    const track = playlists[currentPlaylist][currentTrackIndex];
    if (!track) return;

    // Populate Modal
    const coverPath = track.cover ? track.cover.replace(/\\/g, '/') : 'cover.jpg';
    document.getElementById('share-cover').src = coverPath;
    document.getElementById('share-title').textContent = track.title;
    document.getElementById('share-artist').textContent = `PeephatZ Studio • ${track.year || ''}`;

    // Create Share Data
    const shareUrl = window.location.href; // Deep link already set in URL
    document.getElementById('share-url').value = shareUrl;

    // Open Modal
    shareModal.classList.add('active');

    // Setup Copy Button
    copyLinkBtn.onclick = () => {
        navigator.clipboard.writeText(shareUrl).then(() => {
            showToast('คัดลอกลิงก์แล้ว', 'check_circle');
        });
    };

    // Setup System Share Button
    systemShareBtn.onclick = async () => {
        const shareData = {
            title: track.title,
            text: `Listen to "${track.title}" by PeephatZ Studio`,
            url: shareUrl
        };

        // Try to fetch image blob to share file
        try {
            const response = await fetch(coverPath);
            const blob = await response.blob();
            const file = new File([blob], 'cover.jpg', { type: 'image/jpeg' });

            if (navigator.canShare && navigator.canShare({ files: [file] })) {
                shareData.files = [file];
            }
        } catch (e) {
            console.log("Could not fetch image for sharing", e);
        }

        try {
            await navigator.share(shareData);
            shareModal.classList.remove('active');
        } catch (err) {
            console.log('Error sharing:', err);
            // Fallback if system share fails (e.g. desktop)
            navigator.clipboard.writeText(shareUrl);
            showToast('คัดลอกลิงก์แล้ว (System Share Unavailable)', 'check_circle');
        }
    };
}

function showToast(message, icon = '') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = 'toast';

    let iconHtml = '';
    if (icon) {
        iconHtml = `<span class="material-icons-round" style="font-size: 18px;">${icon}</span>`;
    }

    toast.innerHTML = `${iconHtml}<span>${message}</span>`;
    container.appendChild(toast);

    // Remove after 3s
    setTimeout(() => {
        toast.classList.add('hiding');
        toast.addEventListener('animationend', () => {
            if (toast.parentNode) toast.parentNode.removeChild(toast);
        });
    }, 3000);
}


// FS Volume
if (fsVolumeBar) {
    fsVolumeBar.addEventListener('input', (e) => {
        const val = e.target.value / 100;
        updateRangeBackground(fsVolumeBar);
        // Sync Mini Volume
        volumeBar.value = e.target.value;
        updateRangeBackground(volumeBar);
        if (gainNode) gainNode.gain.setValueAtTime(val, audioContext.currentTime);
    });
}

// Mode Switchers
if (modeAudioBtn) modeAudioBtn.addEventListener('click', () => toggleMode('audio'));
if (modeVideoBtn) modeVideoBtn.addEventListener('click', () => toggleMode('video'));

// Media Controls
playBtn.addEventListener('click', togglePlay);
nextBtn.addEventListener('click', nextTrack);
prevBtn.addEventListener('click', prevTrack);

// Video Events
videoElement.addEventListener('ended', nextTrack);
videoElement.addEventListener('timeupdate', () => updateProgress(videoElement));
videoElement.addEventListener('play', () => { isPlaying = true; updatePlayButton(); });
videoElement.addEventListener('pause', () => { isPlaying = false; updatePlayButton(); });
videoElement.addEventListener('dblclick', () => {
    if (videoElement.requestFullscreen) videoElement.requestFullscreen();
});

// Seek
progressBar.addEventListener('input', (e) => {
    const activeMedia = currentAudioObj || videoElement;
    updateRangeBackground(progressBar);
    if (activeMedia && activeMedia.duration) {
        const time = (e.target.value / 100) * activeMedia.duration;
        activeMedia.currentTime = time;
    }
});

// Volume
volumeBar.addEventListener('input', (e) => {
    const val = e.target.value / 100;
    updateRangeBackground(volumeBar);
    if (gainNode) gainNode.gain.setValueAtTime(val, audioContext.currentTime);
});

// Navigation
const handleNav = (target) => {
    const playlist = target.dataset.playlist;
    if (currentPlaylist !== playlist) {
        currentPlaylist = playlist;
        currentTrackIndex = 0;
        updateNavState();
        renderPlaylist(playlist);
        if (playlists[playlist].length > 0) preloadTrack(0, playlist);
        renderQueue();
    }
};

navItems.forEach(item => item.addEventListener('click', () => handleNav(item)));
mobileNavBtns.forEach(btn => btn.addEventListener('click', () => handleNav(btn)));

// Spacebar to Play
document.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && e.target.tagName !== 'INPUT') {
        e.preventDefault();
        togglePlay();
    }
});

// Infinite Scroll
const mainContent = document.querySelector('.main-content');
if (mainContent) {
    mainContent.addEventListener('scroll', () => {
        if (mainContent.scrollTop + mainContent.clientHeight >= mainContent.scrollHeight - 200) {
            renderNextBatch(currentPlaylist);
        }
    });
}

// Re-apply marquee on resize
let resizeTimeout;
window.addEventListener('resize', () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
        applyMarqueeToVisibleTitles();
        applyFooterTitleMarquee();
    }, 150);
});


// Start
init();
