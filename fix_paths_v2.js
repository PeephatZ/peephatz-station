const fs = require('fs');
const path = require('path');

// Read the existing media data
const mediaData = require('./media_data.json');

// Function to update file paths
function updatePaths(obj) {
    Object.keys(obj).forEach(playlist => {
        obj[playlist].forEach(track => {
            // Add 'all/' prefix to all file paths
            if (!track.file.startsWith('all/') && !track.file.startsWith('Timeline/') && !track.file.startsWith('bonus/')) {
                track.file = 'all/' + track.file;
            }
            // Ensure Timeline/ and bonus/ are also under all/
            else if (track.file.startsWith('Timeline/')) {
                track.file = 'all/Timeline/' + track.file.split('Timeline/')[1];
            }
            else if (track.file.startsWith('bonus/')) {
                track.file = 'all/bonus/' + track.file.split('bonus/')[1];
            }
        });
    });
    return obj;
}

// Update the paths
const updatedData = updatePaths(mediaData);

// Write the updated data back to the file
fs.writeFileSync('media_data_fixed_v2.json', JSON.stringify(updatedData, null, 2));

console.log('Fixed file paths have been written to media_data_fixed_v2.json');
console.log('Please rename it to media_data.json after verifying the changes.');
