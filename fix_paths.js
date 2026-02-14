const fs = require('fs');
const path = require('path');

// Read the existing media data
const mediaData = require('./media_data.json');

// Function to update file paths
function updatePaths(obj) {
    Object.keys(obj).forEach(playlist => {
        obj[playlist].forEach(track => {
            // Only update paths that don't already have the correct prefix
            if (!track.file.startsWith('all/') && !track.file.startsWith('Timeline/') && !track.file.startsWith('bonus/')) {
                // Determine the correct prefix based on the playlist
                let prefix = 'all/';
                if (playlist === 'timeline') {
                    prefix = 'Timeline/';
                } else if (playlist === 'bonus') {
                    prefix = 'bonus/';
                }
                track.file = prefix + track.file;
            }
        });
    });
    return obj;
}

// Update the paths
const updatedData = updatePaths(mediaData);

// Write the updated data back to the file
fs.writeFileSync('media_data_fixed.json', JSON.stringify(updatedData, null, 2));

console.log('Fixed file paths have been written to media_data_fixed.json');
console.log('Please rename it to media_data.json after verifying the changes.');
