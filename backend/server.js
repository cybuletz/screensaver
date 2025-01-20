//Add DNS configuration at the top
const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');
dns.setServers(['8.8.8.8', '8.8.4.4']); // Use Google's DNS servers

const express = require('express');
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
require('dotenv').config();

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

// Add retry function for network operations
async function retryOperation(operation, maxRetries = 3) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            return await operation();
        } catch (error) {
            log(`Attempt ${attempt}/${maxRetries} failed: ${error.message}`, true);
            if (attempt === maxRetries) throw error;
            // Wait before retrying (exponential backoff)
            await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
        }
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

// Add OpenWeatherMap configuration
require('dotenv').config();
const DEFAULT_CITY = 'Bucharest';

app.get('/weather.js', (req, res) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.sendFile(path.join(__dirname, '../weather.js'));
});

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
        // Use retry for token fetch
        const { tokens } = await retryOperation(() => oAuth2Client.getToken(code));
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

function getOptimalImageSize(baseUrl, targetWidth, targetHeight) {
    return `${baseUrl}=w${targetWidth}-h${targetHeight}-c`;
}

// Add token refresh function with retry
async function refreshTokenWithRetry(tokens) {
    return await retryOperation(async () => {
        const { credentials } = await oAuth2Client.refreshToken(tokens.refresh_token);
        return credentials;
    });
}

app.get('/fetch-photos', async (req, res) => {
    const albumId = req.query.albumId;
    const screenWidth = parseInt(req.query.width) || 1920;
    const screenHeight = parseInt(req.query.height) || 1080;
    
    log(`Fetch photos called for album ID: ${albumId} (${screenWidth}x${screenHeight})`);

    try {
        if (!albumId) {
            throw new Error('Album ID is required');
        }

        if (!fs.existsSync('tokens.json')) {
            log('No tokens file found, redirecting to auth', true);
            return res.redirect('/auth');
        }

        let tokens = JSON.parse(await readFile('tokens.json'));
        log('Read tokens from file');
        
        if (Date.now() >= tokens.expiry_date) {
            log('Token expired, attempting refresh');
            try {
                tokens = await refreshTokenWithRetry(tokens);
                await writeFile('tokens.json', JSON.stringify(tokens, null, 2));
                log('Token refreshed and saved');
                oAuth2Client.setCredentials(tokens);
            } catch (error) {
                log(`Token refresh failed: ${error.message}`, true);
                return res.redirect('/auth');
            }
        } else {
            oAuth2Client.setCredentials(tokens);
        }

        log('Making request to Google Photos API');
        
        // Use retry for API request
        const response = await retryOperation(async () => {
            return await fetch('https://photoslibrary.googleapis.com/v1/mediaItems:search', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${tokens.access_token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    "albumId": albumId,
                    "pageSize": 100,
                    "orderBy": "MediaMetadata.creation_time desc"
                })
            });
        });

        if (!response.ok) {
            const errorData = await response.text();
            log(`API Error Response: ${errorData}`, true);
            throw new Error(`Photos API request failed with status ${response.status}`);
        }

        const data = await response.json();
        
        if (data.mediaItems) {
            data.mediaItems = data.mediaItems.map(item => {
                const mediaWidth = parseInt(item.mediaMetadata?.width) || screenWidth;
                const mediaHeight = parseInt(item.mediaMetadata?.height) || screenHeight;
                
                let targetWidth = screenWidth;
                let targetHeight = screenHeight;
                
                const screenRatio = screenWidth / screenHeight;
                const mediaRatio = mediaWidth / mediaHeight;
                
                if (mediaRatio > screenRatio) {
                    targetWidth = Math.round(screenHeight * mediaRatio);
                } else {
                    targetHeight = Math.round(screenWidth / mediaRatio);
                }
                
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
        
        if (error.message.includes('401')) {
            log('Authorization error, redirecting to auth', true);
            return res.redirect('/auth');
        }
        
        res.status(500).send(`Error fetching photos: ${error.message}`);
    }
});

app.get('/fetch-albums', async (req, res) => {
    log('Fetch albums route called');

    try {
        if (!fs.existsSync('tokens.json')) {
            log('No tokens file found, redirecting to auth', true);
            return res.redirect('/auth');
        }

        let tokens = JSON.parse(await readFile('tokens.json'));
        log('Read tokens from file');

        if (Date.now() >= tokens.expiry_date) {
            log('Token expired, attempting refresh');
            try {
                tokens = await refreshTokenWithRetry(tokens);
                await writeFile('tokens.json', JSON.stringify(tokens, null, 2));
                log('Token refreshed and saved');
                oAuth2Client.setCredentials(tokens);
            } catch (error) {
                log(`Token refresh failed: ${error.message}`, true);
                return res.redirect('/auth');
            }
        } else {
            oAuth2Client.setCredentials(tokens);
        }

        log('Making request to Google Photos API');
        
        // Use retry for API request
        const response = await retryOperation(async () => {
            return await fetch('https://photoslibrary.googleapis.com/v1/albums', {
                headers: {
                    'Authorization': `Bearer ${tokens.access_token}`,
                    'Content-Type': 'application/json'
                }
            });
        });

        if (!response.ok) {
            const errorData = await response.text();
            log(`API Error Response: ${errorData}`, true);
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

app.get('/test', (req, res) => {
    log('Test route called');
    res.send('Server is running correctly');
});

// Add health check endpoint
app.get('/health', (req, res) => {
    log('Health check called');
    try {
        // Test DNS resolution
        dns.lookup('oauth2.googleapis.com', (err) => {
            if (err) {
                log(`DNS resolution failed: ${err.message}`, true);
                res.status(500).json({ status: 'error', message: 'DNS resolution failed' });
            } else {
                res.json({ status: 'healthy', timestamp: new Date().toISOString() });
            }
        });
    } catch (error) {
        log(`Health check failed: ${error.message}`, true);
        res.status(500).json({ status: 'error', message: error.message });
    }
});

// Weather API endpoint
app.get('/api/weather', async (req, res) => {
    log('Weather API endpoint called'); // Add this line
    try {
        const { city } = req.query;
        if (!city) {
            log('Weather API called without city parameter', true);
            return res.status(400).json({ error: 'City parameter is required' });
        }

        const apiKey = process.env.OPENWEATHER_API_KEY;
        if (!apiKey) {
            log('Weather API key not configured', true);
            return res.status(500).json({ error: 'Weather API key not configured' });
        }

        log(`Fetching weather data for city: ${city}`);
        
        // Use the existing retryOperation function for weather API calls
        const response = await retryOperation(async () => {
            return await fetch(`https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(city)}&units=metric&appid=${apiKey}`);
        });

        if (!response.ok) {
            const errorData = await response.text();
            log(`Weather API Error Response: ${errorData}`, true);
            throw new Error(`Weather API request failed with status ${response.status}`);
        }

        const data = await response.json();
        log(`Successfully fetched weather data for ${city}`);

        // Format the response
        const weatherData = {
            temperature: Math.round(data.main.temp),
            condition: data.weather[0].main,
            icon: data.weather[0].icon
        };

        res.json(weatherData);
    } catch (error) {
        log(`Error fetching weather: ${error.message}`, true);
        res.status(500).json({ error: 'Failed to fetch weather data' });
    }
});

// Forecast API endpoint
app.get('/api/forecast', async (req, res) => {
    log('Forecast API endpoint called');
    try {
        const { city } = req.query;
        if (!city) {
            log('Forecast API called without city parameter', true);
            return res.status(400).json({ error: 'City parameter is required' });
        }

        const apiKey = process.env.OPENWEATHER_API_KEY;
        if (!apiKey) {
            log('Weather API key not configured', true);
            return res.status(500).json({ error: 'Weather API key not configured' });
        }

        log(`Fetching forecast data for city: ${city}`);
        
        // Use the existing retryOperation function for forecast API calls
        const response = await retryOperation(async () => {
            return await fetch(`https://api.openweathermap.org/data/2.5/forecast?q=${encodeURIComponent(city)}&units=metric&appid=${apiKey}`);
        });

        if (!response.ok) {
            const errorData = await response.text();
            log(`Forecast API Error Response: ${errorData}`, true);
            throw new Error(`Forecast API request failed with status ${response.status}`);
        }

        const data = await response.json();
        log(`Successfully fetched forecast data for ${city}`);

        // Process forecast data - get next 3 days
        const forecast = data.list
            .filter((item, index) => index % 8 === 0) // Get one reading per day (every 24 hours)
            .slice(0, 3) // Get next 3 days
            .map(item => ({
                date: item.dt * 1000, // Convert to milliseconds
                temperature: Math.round(item.main.temp),
                condition: item.weather[0].main,
                icon: item.weather[0].icon
            }));

        res.json(forecast);
    } catch (error) {
        log(`Error fetching forecast: ${error.message}`, true);
        res.status(500).json({ error: 'Failed to fetch forecast data' });
    }
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
