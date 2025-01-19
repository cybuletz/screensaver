const express = require('express');
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');

const app = express();
const PORT = 3000;

// Convert fs functions to promises
const writeFile = promisify(fs.writeFile);
const readFile = promisify(fs.readFile);

function log(message, error = false) {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] [cybuletz] ${message}`;
    if (error) {
        console.error(logMessage);
    } else {
        console.log(logMessage);
    }
}

const CLIENT_ID = '152249287118-fi7fcltpcs5dol05serg7frpql2ameiu.apps.googleusercontent.com';
const CLIENT_SECRET = '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';
const REDIRECT_URI = 'https://screensaver.cybu.site/oauth2callback';
const SCOPES = [
    'https://www.googleapis.com/auth/photoslibrary.readonly',
    'https://www.googleapis.com/auth/photoslibrary.sharing'
];

const oAuth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

app.use(express.static(path.join(__dirname, '../')));

app.get('/auth', (req, res) => {
    log('Auth route called');
    try {
        const authUrl = oAuth2Client.generateAuthUrl({
            access_type: 'offline',
            scope: SCOPES,
            prompt: 'consent'
        });
        log(`Generated auth URL: ${authUrl}`);
        res.redirect(authUrl);
    } catch (error) {
        log(`Error generating auth URL: ${error.message}`, true);
        res.status(500).send('Error generating auth URL');
    }
});

app.get('/oauth2callback', async (req, res) => {
    const code = req.query.code;
    log(`OAuth2 callback received with code: ${code ? 'present' : 'missing'}`);

    try {
        const { tokens } = await oAuth2Client.getToken(code);
        log('Tokens received from Google');
        log(`Access token present: ${!!tokens.access_token}`);
        log(`Refresh token present: ${!!tokens.refresh_token}`);
        log(`Token expiry: ${new Date(tokens.expiry_date).toISOString()}`);

        oAuth2Client.setCredentials(tokens);
        log('Credentials set on OAuth2 client');

        await writeFile('tokens.json', JSON.stringify(tokens, null, 2));
        log('Tokens saved to file');

        res.redirect('/settings.html');
    } catch (error) {
        log(`Error in OAuth callback: ${error.message}`, true);
        res.status(500).send(`Error in OAuth process: ${error.message}`);
    }
});

// In server.js - Add this helper function
function getOptimalImageSize(baseUrl, targetWidth, targetHeight) {
    // Google Photos API supports =w{width}-h{height} parameters
    // Add -c for crop, -n for no-crop
    return `${baseUrl}=w${targetWidth}-h${targetHeight}-c`;
}

// Modify the fetch-photos endpoint in server.js
app.get('/fetch-photos', async (req, res) => {
    const albumId = req.query.albumId;
    const screenWidth = parseInt(req.query.width) || 1920;  // Default to 1920
    const screenHeight = parseInt(req.query.height) || 1080; // Default to 1080
    
    log(`Fetch photos called for album ID: ${albumId} (${screenWidth}x${screenHeight})`);

    try {
        // ... existing token validation code ...

        const response = await fetch('https://photoslibrary.googleapis.com/v1/mediaItems:search', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${tokens.access_token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                albumId: albumId,
                pageSize: 100,
                // Request additional media metadata
                pageToken: req.query.pageToken,
                fields: "mediaItems(baseUrl,filename,mediaMetadata)"
            })
        });

        if (!response.ok) {
            throw new Error(`Photos API request failed with status ${response.status}`);
        }

        const data = await response.json();
        
        // Process and enhance each photo's URL
        if (data.mediaItems) {
            data.mediaItems = data.mediaItems.map(item => {
                // Calculate optimal size based on media metadata and screen size
                const mediaWidth = parseInt(item.mediaMetadata?.width) || screenWidth;
                const mediaHeight = parseInt(item.mediaMetadata?.height) || screenHeight;
                
                // Calculate optimal dimensions maintaining aspect ratio
                let targetWidth = screenWidth;
                let targetHeight = screenHeight;
                
                const screenRatio = screenWidth / screenHeight;
                const mediaRatio = mediaWidth / mediaHeight;
                
                if (mediaRatio > screenRatio) {
                    // Image is wider than screen ratio
                    targetWidth = Math.round(screenHeight * mediaRatio);
                } else {
                    // Image is taller than screen ratio
                    targetHeight = Math.round(screenWidth / mediaRatio);
                }
                
                // Increase dimensions by 20% to account for transitions and zooming
                targetWidth = Math.round(targetWidth * 1.2);
                targetHeight = Math.round(targetHeight * 1.2);
                
                return {
                    ...item,
                    baseUrl: getOptimalImageSize(item.baseUrl, targetWidth, targetHeight),
                    mediaMetadata: {
                        ...item.mediaMetadata,
                        originalWidth: mediaWidth,
                        originalHeight: mediaHeight
                    }
                };
            });
        }

        log(`Successfully fetched ${data.mediaItems ? data.mediaItems.length : 0} photos for album ${albumId}`);
        res.json(data.mediaItems || []);

    } catch (error) {
        log(`Error fetching photos: ${error.message}`, true);
        // ... existing error handling ...
    }
});

app.get('/fetch-albums', async (req, res) => {
    log('Fetch albums route called');

    try {
        if (!fs.existsSync('tokens.json')) {
            log('No tokens file found, redirecting to auth', true);
            return res.redirect('/auth');
        }

        const tokens = JSON.parse(await readFile('tokens.json'));
        log('Read tokens from file');

        // Check if token is expired
        if (Date.now() >= tokens.expiry_date) {
            log('Token expired, attempting refresh');
            const { credentials } = await oAuth2Client.refreshToken(tokens.refresh_token);
            await writeFile('tokens.json', JSON.stringify(credentials, null, 2));
            log('Token refreshed and saved');
            oAuth2Client.setCredentials(credentials);
        } else {
            oAuth2Client.setCredentials(tokens);
        }

        log('Making request to Google Photos API');
        
        const response = await fetch('https://photoslibrary.googleapis.com/v1/albums', {
            headers: {
                'Authorization': `Bearer ${tokens.access_token}`,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error(`Albums API request failed with status ${response.status}`);
        }

        const data = await response.json();
        log(`Successfully fetched ${data.albums ? data.albums.length : 0} albums`);
        res.json(data.albums || []);

    } catch (error) {
        log(`Error fetching albums: ${error.message}`, true);
        
        if (error.message.includes('401')) {
            log('Authorization error, redirecting to auth', true);
            return res.redirect('/auth');
        }
        
        res.status(500).send(`Error fetching albums: ${error.message}`);
    }
});

app.get('/fetch-photos', async (req, res) => {
    const albumId = req.query.albumId;
    log(`Fetch photos called for album ID: ${albumId}`);

    try {
        if (!albumId) {
            throw new Error('Album ID is required');
        }

        if (!fs.existsSync('tokens.json')) {
            log('No tokens file found, redirecting to auth', true);
            return res.redirect('/auth');
        }

        const tokens = JSON.parse(await readFile('tokens.json'));
        
        if (Date.now() >= tokens.expiry_date) {
            log('Token expired, attempting refresh');
            const { credentials } = await oAuth2Client.refreshToken(tokens.refresh_token);
            await writeFile('tokens.json', JSON.stringify(credentials, null, 2));
            log('Token refreshed and saved');
            oAuth2Client.setCredentials(credentials);
        } else {
            oAuth2Client.setCredentials(tokens);
        }

        log('Making request to Google Photos API');

        const response = await fetch('https://photoslibrary.googleapis.com/v1/mediaItems:search', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${tokens.access_token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                albumId: albumId,
                pageSize: 100
            })
        });

        if (!response.ok) {
            throw new Error(`Photos API request failed with status ${response.status}`);
        }

        const data = await response.json();
        log(`Successfully fetched ${data.mediaItems ? data.mediaItems.length : 0} photos for album ${albumId}`);
        res.json(data.mediaItems || []);

    } catch (error) {
        log(`Error fetching photos: ${error.message}`, true);
        
        if (error.message.includes('401')) {
            log('Authorization error, redirecting to auth', true);
            return res.redirect('/auth');
        }
        
        res.status(500).send(`Error fetching photos: ${error.message}`);
    }
});

app.get('/test', (req, res) => {
    log('Test route called');
    res.send('Server is running correctly');
});

app.listen(PORT, '0.0.0.0', () => {
    log(`Server started on port ${PORT}`);
    
    try {
        const testWrite = fs.writeFileSync('test.txt', 'test');
        fs.unlinkSync('test.txt');
        log('File system permissions verified');
    } catch (error) {
        log(`File system permission error: ${error.message}`, true);
    }
    
    try {
        if (fs.existsSync('tokens.json')) {
            const tokens = JSON.parse(fs.readFileSync('tokens.json'));
            log('Existing tokens found and verified');
            log(`Token expiry: ${new Date(tokens.expiry_date).toISOString()}`);
        } else {
            log('No existing tokens found');
        }
    } catch (error) {
        log(`Error checking existing tokens: ${error.message}`, true);
    }
});
