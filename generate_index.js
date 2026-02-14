const fs = require('fs');
const path = require('path');

const MEDIA_ROOT = path.join(__dirname, 'all'); // Adjust if 'all' is not in root
const OUTPUT_FILE = path.join(__dirname, 'media_data.json');

const VALID_EXTENSIONS = ['.mp3', '.mp4', '.m4a', '.wav'];

// Helper to recursively get files
function getFiles(dir, fileList = []) {
    if (!fs.existsSync(dir)) return fileList;
    const files = fs.readdirSync(dir);

    files.forEach(file => {
        const filePath = path.join(dir, file);

        if (fs.statSync(filePath).isDirectory()) {
            getFiles(filePath, fileList);
        } else {
            if (VALID_EXTENSIONS.includes(path.extname(file).toLowerCase())) {
                fileList.push(filePath);
            }
        }
    });
    return fileList;
}

// Function to parse metadata from filename
function parseMetadata(filePath) {
    const fileName = path.basename(filePath);
    // Calculate relative path from MEDIA_ROOT ('all' folder)
    // This allows app.js to simply prepend 'all/' or use the path directly if served from root
    // Current app.js does: const fullPath = 'all/' + track.file;
    // So track.file should be relative to 'all/' folder.
    const relativePath = 'all/' + path.relative(MEDIA_ROOT, filePath).replace(/\\/g, '/');

    // Extract Year: Look for [20xx]
    const yearMatch = fileName.match(/\[(\d{4})\]/);
    const year = yearMatch ? parseInt(yearMatch[1]) : 0; // Default to 0 if not found

    // Extract Title: Remove [Year], extension, and common tags
    let title = fileName
        .replace(/\[\d{4}\]/, '')
        .replace(/\.(mp3|mp4|m4a|wav)$/i, '')
        .replace(/\((Music Video|Audio|Official Video|Video|Official Audio)\)/gi, '')
        .trim();

    // Special case: User wants [2022] in the title for this track
    if (fileName.includes('Aquanaut Band - คนน่ารัก')) {
        title = 'Aquanaut Band - คนน่ารัก “ไม่อยากแค่จะมอง” [2022]';
    }

    return {
        title: title,
        file: relativePath,
        year: year,
        type: path.extname(filePath).toLowerCase() === '.mp4' ? 'video' : 'audio',
        cover: 'cover.jpg', // Global default cover
        // Helper for debugging/sorting
        fullPath: filePath
    };
}

function generateIndex() {
    console.log("Scanning media files...");

    const allFiles = getFiles(MEDIA_ROOT);

    // Process All Tracks
    let allTracks = allFiles.map(parseMetadata);

    // Create Timeline Playlist (Filter by path including 'Timeline')
    const timelineTracks = allTracks.filter(t => t.file.includes('Timeline/'));

    // Create Bonus Playlist (Filter by path including 'bonus')
    const bonusTracks = allTracks.filter(t => t.file.includes('bonus/'));

    // Sort Timeline: Newest -> Oldest (Descending)
    timelineTracks.sort((a, b) => b.year - a.year);

    // Sort Bonus: Alphabetical? Or Year? Let's use Year Descending too for consistency, or Alphabetical.
    // User requested "ไล่ปีใหม่สุดไปเก่าสุดด้วย" (Sort newest to oldest year) broadly.
    bonusTracks.sort((a, b) => b.year - a.year);

    // Deduplicate All Tracks based on Title
    const uniqueTracksMap = new Map();
    allTracks.forEach(track => {
        // Normalize title for comparison (optional, but good practice)
        const key = track.title.trim();
        if (!uniqueTracksMap.has(key)) {
            uniqueTracksMap.set(key, track);
        } else {
            // Optional: If we want to prioritize files from 'Timeline' or 'bonus' over generic 'all' folder
            // we could check the path here. For now, simple deduplication.
            const existing = uniqueTracksMap.get(key);
            // If the new one is in Timeline/Bonus and existing is not, maybe swap? 
            // Let's stick to simple first found for now unless requested.
        }
    });
    const uniqueAllTracks = Array.from(uniqueTracksMap.values());

    // Sort All: Year Descending
    uniqueAllTracks.sort((a, b) => b.year - a.year);

    const data = {
        timeline: timelineTracks,
        bonus: bonusTracks,
        all: uniqueAllTracks
    };

    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(data, null, 2));
    console.log(`Index generated at ${OUTPUT_FILE}`);
    console.log(`Timeline: ${timelineTracks.length} tracks`);
    console.log(`Bonus: ${bonusTracks.length} tracks`);
    console.log(`All: ${allTracks.length} tracks`);
}

generateIndex();
