class WeatherService {
    constructor() {
        this.cache = new Map();
        this.cacheTimeout = 30 * 60 * 1000; // 30 minutes
        console.log('[Weather] Service initialized');
    }

    async getWeather(city) {
        console.log(`[Weather] Attempting to get weather for city: ${city}`);
        const cacheKey = `weather_${city}`;
        const cachedData = this.cache.get(cacheKey);
        
        if (cachedData && Date.now() - cachedData.timestamp < this.cacheTimeout) {
            console.log('[Weather] Returning cached weather data:', cachedData.data);
            return cachedData.data;
        }

        console.log('[Weather] No cache or expired, fetching new data');
        try {
            const url = `/weather?city=${encodeURIComponent(city)}`;
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

            this.cache.set(cacheKey, {
                data,
                timestamp: Date.now()
            });

            console.log('[Weather] Weather data cached for:', city);
            return data;
        } catch (error) {
            console.error('[Weather] Error fetching weather:', error);
            throw error;
        }
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
