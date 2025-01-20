class WeatherService {
    constructor() {
        this.cache = new Map();
        this.cacheTimeout = 30 * 60 * 1000; // 30 minutes
        console.log('[Weather] Service initialized');
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
            // Using proxy endpoint on your server
            const url = `/api/weather?city=${encodeURIComponent(city)}`;
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

            const weather = {
                temperature: Math.round(data.main.temp),
                condition: data.weather[0].main,
                icon: data.weather[0].icon
            };
            console.log('[Weather] Processed weather data:', weather);

            this.cache.set(cacheKey, {
                data: weather,
                timestamp: Date.now()
            });

            return weather;
        } catch (error) {
            console.error('[Weather] Error fetching weather:', error);
            throw error;
        }
    }

    clearCache() {
        this.cache.clear();
    }
}