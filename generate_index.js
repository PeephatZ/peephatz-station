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
    const relativePath = path.relative(MEDIA_ROOT, filePath).replace(/\\/g, '/');

    // Extract Year: Look for [20xx]
    const yearMatch = fileName.match(/\[(\d{4})\]/);
    const year = yearMatch ? parseInt(yearMatch[1]) : 0; // Default to 0 if not found

    // Extract Title: Remove [Year], extension, and common tags
    let title = fileName
        .replace(/\[\d{4}\]/, '')
        .replace(/\.(mp3|mp4|m4a|wav)$/i, '')
        .replace(/\((Music Video|Audio|Official Video|Video|Official Audio)\)/gi, '')
        .trim();

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

    // Sort All: Alphabetical? Or Year? Let's do Year Descending.
    allTracks.sort((a, b) => b.year - a.year);

    const data = {
        timeline: timelineTracks,
        bonus: bonusTracks,
        all: allTracks
    };

    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(data, null, 2));
    console.log(`Index generated at ${OUTPUT_FILE}`);
    console.log(`Timeline: ${timelineTracks.length} tracks`);
    console.log(`Bonus: ${bonusTracks.length} tracks`);
    console.log(`All: ${allTracks.length} tracks`);
}

generateIndex();
