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

// Add new imports for authentication
const mongoose = require('mongoose');
const { Performance } = require('./features/metrics');
const { ErrorLog, logError } = require('./features/errorLogger');
const transitions = require('./features/transitions');

const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const SmartTimer = require('./features/smartTimer');
const smartTimer = new SmartTimer();
const { Theme } = require('./features/themes');
const ScreensaverScheduler = require('./features/scheduler');
const { Analytics, AnalyticsManager } = require('./features/analytics');

// MongoDB connection
mongoose.connect('mongodb://localhost:27017/screensaver')
    .then(() => console.log('Connected to MongoDB'))
    .catch(err => console.error('MongoDB connection error:', err));



// User Schema
const userSchema = new mongoose.Schema({
    username: { type: String, unique: true },
    password: String,
    settings: {
        resolution: { type: String, default: 'auto' },
        fitMode: { type: String, default: 'cover' },
        showClock: { type: Boolean, default: true },
        clockStyle: { type: String, default: 'digital' },
        clockFormat: { type: String, default: '24' },
        clockPosition: { type: String, default: 'bottom-right' },
        clockColor: { type: String, default: '#ffffff' },
        clockSize: { type: String, default: 'medium' },
        interval: { type: Number, default: 30 },
        transition: { type: String, default: 'fade' },
        transitionDuration: { type: Number, default: 1 },
        shuffle: { type: Boolean, default: true },
        enableSchedule: { type: Boolean, default: false },
        startTime: { type: String, default: '09:00' },
        endTime: { type: String, default: '17:00' },
        daysActive: { type: [Number], default: [1,2,3,4,5] },
        showWeather: { type: Boolean, default: true },
        weatherCity: { type: String, default: 'London' },
        weatherPosition: { type: String, default: 'top-right' },
        showForecast: { type: Boolean, default: false },
        kioskMode: { type: Boolean, default: false }
    }
});

const User = mongoose.model('User', userSchema);

const analyticsManager = new AnalyticsManager();
const screensaverScheduler = new ScreensaverScheduler();

const app = express();
// Add CORS middleware
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', 'https://screensaver.cybu.site');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, DELETE');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Convert fs functions to promises
const writeFile = promisify(fs.writeFile);
const readFile = promisify(fs.readFile);

const PORT = 3000;

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

// Authentication middleware
const authenticateToken = (req, res, next) => {
    const token = req.headers['authorization']?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Authentication required' });
    
    jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key', (err, user) => {
        if (err) return res.status(403).json({ error: 'Invalid token' });
        req.user = user;
        next();
    });
};

app.get('/api/photo-info/:photoId', async (req, res) => {
    try {
        const photoInfo = await PhotoInfo.findOne({ photoId: req.params.photoId });
        res.json(photoInfo);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch photo info' });
    }
});

app.post('/api/themes', async (req, res) => {
    try {
        const theme = new Theme(req.body);
        await theme.save();
        res.json(theme);
    } catch (error) {
        res.status(500).json({ error: 'Failed to save theme' });
    }
});

// Theme endpoints
app.post('/api/themes', authenticateToken, async (req, res) => {
    try {
        const theme = new Theme({
            ...req.body,
            userId: req.user.username
        });
        await theme.save();
        res.json(theme);
    } catch (error) {
        console.error('Failed to save theme:', error);
        res.status(500).json({ error: 'Failed to save theme' });
    }
});

app.get('/api/themes', authenticateToken, async (req, res) => {
    try {
        const themes = await Theme.find({ userId: req.user.username });
        res.json(themes);
    } catch (error) {
        console.error('Failed to fetch themes:', error);
        res.status(500).json({ error: 'Failed to fetch themes' });
    }
});

// Register endpoint
app.post('/api/register', async (req, res) => {
    try {
        const { username, password } = req.body;
        const existingUser = await User.findOne({ username });
        
        if (existingUser) {
            return res.status(400).json({ error: 'Username already exists' });
        }
        
        const hashedPassword = await bcrypt.hash(password, 10);
        const user = new User({
            username,
            password: hashedPassword
        });
        
        await user.save();
        res.status(201).json({ message: 'User created successfully' });
    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({ error: 'Registration failed' });
    }
});

// Login endpoint
app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const user = await User.findOne({ username });
        
        if (!user || !(await bcrypt.compare(password, user.password))) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        
        const token = jwt.sign(
            { username: user.username },
            process.env.JWT_SECRET || 'your-secret-key',
            { expiresIn: '24h' }
        );
        
        res.json({
            token,
            settings: user.settings
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Login failed' });
    }
});

// Update settings endpoint
app.put('/api/settings', authenticateToken, async (req, res) => {
    try {
        const { settings } = req.body;
        const username = req.user.username;
        
        await User.findOneAndUpdate(
            { username },
            { $set: { settings } }
        );
        
        res.json({ message: 'Settings updated successfully' });
    } catch (error) {
        console.error('Settings update error:', error);
        res.status(500).json({ error: 'Failed to update settings' });
    }
});

// Get settings endpoint
app.get('/api/settings', authenticateToken, async (req, res) => {
    try {
        const username = req.user.username;
        const user = await User.findOne({ username });
        
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        res.json({ settings: user.settings || {
            resolution: 'auto',
            fitMode: 'cover',
            showClock: true,
            clockStyle: 'digital',
            clockFormat: '24',
            clockPosition: 'bottom-right',
            clockColor: '#ffffff',
            clockSize: 'medium',
            interval: 30,
            transition: 'fade',
            transitionDuration: 1,
            shuffle: true,
            enableSchedule: false,
            startTime: '09:00',
            endTime: '17:00',
            daysActive: [1, 2, 3, 4, 5],
            showWeather: true,
            weatherCity: 'Bucharest',
            weatherPosition: 'top-right',
            showForecast: false,
            kioskMode: false
        }});
    } catch (error) {
        console.error('Settings fetch error:', error);
        res.status(500).json({ error: 'Failed to fetch settings' });
    }
});

app.get('/weather.js', (req, res) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.sendFile(path.join(__dirname, '../weather.js'));
});

// Serve static files from public directory
app.use('/public', express.static(path.join(__dirname, '../public')));

app.use(express.static(path.join(__dirname, '../')));

app.get('/', (req, res) => {
    try {
        if (fs.existsSync('tokens.json')) {
            const tokens = JSON.parse(fs.readFileSync('tokens.json'));
            if (Date.now() < tokens.expiry_date) {
                res.sendFile(path.join(__dirname, '../index.html'));
                return;
            }
        }
        res.redirect('/login');
    } catch (error) {
        console.error('Error checking authentication:', error);
        res.redirect('/login');
    }
});

app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, '../login.html'));
});

app.get('/auth', (req, res) => {
    log('Auth route called');
    try {
        const authUrl = oAuth2Client.generateAuthUrl({
            access_type: 'offline',
            scope: SCOPES,
            prompt: 'consent'
        });
        log(`Generated auth URL: ${authUrl}`);
        res.json({ url: authUrl }); // Return URL instead of redirecting
    } catch (error) {
        log(`Error generating auth URL: ${error.message}`, true);
        res.status(500).json({ error: 'Error generating auth URL' });
    }
});

app.get('/oauth2callback', async (req, res) => {
    const code = req.query.code;
    log(`OAuth2 callback received with code: ${code ? 'present' : 'missing'}`);

    try {
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

// Smart Timer endpoint
app.post('/api/viewing-stats', authenticateToken, async (req, res) => {
    try {
        const { photoId, viewDuration } = req.body;
        const userId = req.user.username;

        if (!photoId || typeof viewDuration !== 'number') {
            return res.status(400).json({ 
                error: 'Invalid parameters. Required: photoId (string) and viewDuration (number)' 
            });
        }

        const nextInterval = await smartTimer.updateStats(userId, photoId, viewDuration);
        
        res.json({ nextInterval });
    } catch (error) {
        console.error('Smart timer error:', error);
        res.status(500).json({ error: 'Failed to update viewing stats' });
    }
});

// Weather API endpoint
app.get('/api/weather', async (req, res) => {
    log('Weather API endpoint called');
    try {
        const { city, units = 'metric' } = req.query;
        if (!city) {
            log('Weather API called without city parameter', true);
            return res.status(400).json({ error: 'City parameter is required' });
        }

        const apiKey = process.env.OPENWEATHER_API_KEY;
        if (!apiKey) {
            log('Weather API key not configured', true);
            return res.status(500).json({ error: 'Weather API key not configured' });
        }

        log(`Fetching weather data for city: ${city}, units: ${units}`);
        
        const response = await retryOperation(async () => {
            return await fetch(`https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(city)}&units=${units}&appid=${apiKey}`);
        });

        if (!response.ok) {
            const errorData = await response.text();
            log(`Weather API Error Response: ${errorData}`, true);
            throw new Error(`Weather API request failed with status ${response.status}`);
        }

        const data = await response.json();
        log(`Successfully fetched weather data for ${city}`);

        // Enhanced weather data response
        const weatherData = {
            temperature: Math.round(data.main.temp),
            feelsLike: Math.round(data.main.feels_like),
            humidity: data.main.humidity,
            windSpeed: data.wind.speed,
            windDirection: data.wind.deg,
            pressure: data.main.pressure,
            condition: data.weather[0].main,
            description: data.weather[0].description,
            icon: data.weather[0].icon,
            sunrise: data.sys.sunrise * 1000, // Convert to milliseconds
            sunset: data.sys.sunset * 1000,
            units: units,
            city: city
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
        const { city, units = 'metric', days = 3 } = req.query;
        if (!city) {
            log('Forecast API called without city parameter', true);
            return res.status(400).json({ error: 'City parameter is required' });
        }

        const apiKey = process.env.OPENWEATHER_API_KEY;
        if (!apiKey) {
            log('Weather API key not configured', true);
            return res.status(500).json({ error: 'Weather API key not configured' });
        }

        log(`Fetching forecast data for city: ${city}, units: ${units}, days: ${days}`);
        
        const response = await retryOperation(async () => {
            return await fetch(`https://api.openweathermap.org/data/2.5/forecast?q=${encodeURIComponent(city)}&units=${units}&appid=${apiKey}`);
        });

        if (!response.ok) {
            const errorData = await response.text();
            log(`Forecast API Error Response: ${errorData}`, true);
            throw new Error(`Forecast API request failed with status ${response.status}`);
        }

        const data = await response.json();
        log(`Successfully fetched forecast data for ${city}`);

        // Enhanced forecast data processing
        const forecast = data.list
            .filter((item, index) => index % 8 === 0) // Get one reading per day
            .slice(0, parseInt(days)) // Get requested number of days
            .map(item => ({
                date: item.dt * 1000,
                temperature: Math.round(item.main.temp),
                feelsLike: Math.round(item.main.feels_like),
                humidity: item.main.humidity,
                windSpeed: item.wind.speed,
                windDirection: item.wind.deg,
                pressure: item.main.pressure,
                condition: item.weather[0].main,
                description: item.weather[0].description,
                icon: item.weather[0].icon
            }));

        res.json(forecast);
    } catch (error) {
        log(`Error fetching forecast: ${error.message}`, true);
        res.status(500).json({ error: 'Failed to fetch forecast data' });
    }
});

// Smart Timer endpoint
app.post('/api/viewing-stats', authenticateToken, async (req, res) => {
    try {
        const { photoId, viewDuration } = req.body;
        const userId = req.user.username;

        if (!photoId || typeof viewDuration !== 'number') {
            return res.status(400).json({ 
                error: 'Invalid parameters. Required: photoId (string) and viewDuration (number)' 
            });
        }

        const smartTimer = new SmartTimer();
        const nextInterval = await smartTimer.updateStats(userId, photoId, viewDuration);
        
        res.json({ nextInterval });
    } catch (error) {
        console.error('Smart timer error:', error);
        res.status(500).json({ error: 'Failed to update viewing stats' });
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
