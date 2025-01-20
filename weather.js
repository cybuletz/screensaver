class WeatherService {
    constructor() {
        this.cache = new Map();
        this.cacheTimeout = 30 * 60 * 1000; // 30 minutes
        console.log('[Weather] Service initialized (v3)');
    }

    async getWeather(city) {
        if (!city) {
            throw new Error('City name is required');
        }

        console.log(`[Weather] Attempting to get weather for city: ${city}`);
        const cacheKey = `weather_${city}`;
        const cachedData = this.cache.get(cacheKey);
        
        if (cachedData && Date.now() - cachedData.timestamp < this.cacheTimeout) {
            console.log('[Weather] Returning cached weather data:', cachedData.data);
            return cachedData.data;
        }

        console.log('[Weather] No cache or expired, fetching new data');
        try {
            const url = `/api/weather?city=${encodeURIComponent(city)}`;
            console.log('[Weather] Full URL:', window.location.origin + url);  
            console.log('[Weather] Fetching from URL:', url);
            
            const response = await fetch(url);
            console.log('[Weather] Response status:', response.status);
            
            if (!response.ok) {
                const errorText = await response.text();
                console.error('[Weather] API Error:', errorText);
                throw new Error(`Weather API error: ${response.statusText}`);
            }

            const data = await response.json();
            console.log('[Weather] Raw API response:', data);

            if (data.error) {
                throw new Error(data.error);
            }

            const weather = {
                temperature: data.temperature,
                condition: data.condition,
                icon: data.icon,
                city: city // Adding city to the response
            };
            console.log('[Weather] Processed weather data:', weather);

            this.cache.set(cacheKey, {
                data: weather,
                timestamp: Date.now()
            });

            console.log('[Weather] Weather data cached for:', city);
            return weather;
        } catch (error) {
            console.error('[Weather] Error fetching weather:', error);
            throw error;
        }
    }

    async getForecast(city) {
        if (!city) {
            throw new Error('City name is required');
        }

        console.log(`[Weather] Attempting to get forecast for city: ${city}`);
        const cacheKey = `forecast_${city}`;
        const cachedData = this.cache.get(cacheKey);
        
        if (cachedData && Date.now() - cachedData.timestamp < this.cacheTimeout) {
            console.log('[Weather] Returning cached forecast data:', cachedData.data);
            return cachedData.data;
        }

        console.log('[Weather] No cache or expired, fetching new forecast data');
        try {
            const url = `/api/forecast?city=${encodeURIComponent(city)}`;
            console.log('[Weather] Full URL:', window.location.origin + url);
            
            const response = await fetch(url);
            console.log('[Weather] Forecast response status:', response.status);
            
            if (!response.ok) {
                const errorText = await response.text();
                console.error('[Weather] Forecast API Error:', errorText);
                throw new Error(`Forecast API error: ${response.statusText}`);
            }

            const data = await response.json();
            this.cache.set(cacheKey, {
                data: data,
                timestamp: Date.now()
            });

            return data;
        } catch (error) {
            console.error('[Weather] Error fetching forecast:', error);
            throw error;
        }
    }

    getWeatherAnimation(condition, isNight = false) {
        const animations = {
            'Clear': isNight ? 'weather-clear-night' : 'weather-clear',
            'Clouds': 'weather-cloudy',
            'Rain': 'weather-rain',
            'Drizzle': 'weather-rain',
            'Thunderstorm': 'weather-storm',
            'Snow': 'weather-snow',
            'Mist': 'weather-mist',
            'Fog': 'weather-mist',
            'Haze': 'weather-mist'
        };
        return animations[condition] || 'weather-default';
    }

    clearCache() {
        console.log('[Weather] Clearing weather cache');
        this.cache.clear();
    }

    getCacheStatus() {
        return {
            size: this.cache.size,
            entries: Array.from(this.cache.entries()).map(([key, value]) => ({
                key,
                age: Date.now() - value.timestamp,
                data: value.data
            }))
        };
    }
}

// Export the class for use in other files
if (typeof module !== 'undefined' && module.exports) {
    module.exports = WeatherService;
}