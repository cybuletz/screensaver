class WeatherService {
    constructor(options = {}) {
        this.cache = new Map();
        this.cacheTimeout = options.cacheTimeout || 30 * 60 * 1000; // 30 minutes
        this.units = options.units || 'metric'; // 'metric' or 'imperial'
        this.updateFrequency = options.updateFrequency || 30 * 60 * 1000; // 30 minutes
        this.forecastDays = options.forecastDays || 3; // Number of forecast days (1-5)
        console.log('[Weather] Service initialized (v4)');
    }

    async getWeather(city) {
        if (!city) {
            throw new Error('City name is required');
        }

        console.log(`[Weather] Attempting to get weather for city: ${city}`);
        const cacheKey = `weather_${city}_${this.units}`;
        const cachedData = this.cache.get(cacheKey);
        
        if (cachedData && Date.now() - cachedData.timestamp < this.cacheTimeout) {
            console.log('[Weather] Returning cached weather data:', cachedData.data);
            return cachedData.data;
        }

        console.log('[Weather] No cache or expired, fetching new data');
        try {
            const url = `/api/weather?city=${encodeURIComponent(city)}&units=${this.units}`;
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

            // Enhanced weather object with more information
            const weather = {
                temperature: data.temperature,
                feelsLike: data.feelsLike,
                humidity: data.humidity,
                windSpeed: data.windSpeed,
                windDirection: this.getWindDirection(data.windDirection),
                pressure: data.pressure,
                condition: data.condition,
                description: data.description,
                icon: data.icon,
                sunrise: new Date(data.sunrise).toLocaleTimeString(),
                sunset: new Date(data.sunset).toLocaleTimeString(),
                units: this.units,
                city: city
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
        const cacheKey = `forecast_${city}_${this.units}_${this.forecastDays}`;
        const cachedData = this.cache.get(cacheKey);
        
        if (cachedData && Date.now() - cachedData.timestamp < this.cacheTimeout) {
            console.log('[Weather] Returning cached forecast data:', cachedData.data);
            return cachedData.data;
        }

        console.log('[Weather] No cache or expired, fetching new forecast data');
        try {
            const url = `/api/forecast?city=${encodeURIComponent(city)}&units=${this.units}&days=${this.forecastDays}`;
            console.log('[Weather] Full URL:', window.location.origin + url);
            
            const response = await fetch(url);
            console.log('[Weather] Forecast response status:', response.status);
            
            if (!response.ok) {
                const errorText = await response.text();
                console.error('[Weather] Forecast API Error:', errorText);
                throw new Error(`Forecast API error: ${response.statusText}`);
            }

            const data = await response.json();
            
            // Enhanced forecast data processing
            const forecast = data.map(day => ({
                date: new Date(day.date).toLocaleDateString(),
                temperature: day.temperature,
                feelsLike: day.feelsLike,
                humidity: day.humidity,
                windSpeed: day.windSpeed,
                windDirection: this.getWindDirection(day.windDirection),
                pressure: day.pressure,
                condition: day.condition,
                description: day.description,
                icon: day.icon
            }));

            this.cache.set(cacheKey, {
                data: forecast,
                timestamp: Date.now()
            });

            return forecast;
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

    // New helper method to convert wind direction degrees to cardinal directions
    getWindDirection(degrees) {
        const directions = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
                          'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
        const index = Math.round(((degrees % 360) / 22.5));
        return directions[index % 16];
    }

    // New method to set temperature units
    setUnits(units) {
        if (units !== 'metric' && units !== 'imperial') {
            throw new Error('Units must be either "metric" or "imperial"');
        }
        if (this.units !== units) {
            this.units = units;
            this.clearCache(); // Clear cache when units change
            console.log(`[Weather] Units changed to ${units}`);
        }
    }

    // New method to set update frequency
    setUpdateFrequency(frequency) {
        if (frequency < 5 * 60 * 1000) { // Minimum 5 minutes
            frequency = 5 * 60 * 1000;
        }
        this.updateFrequency = frequency;
        console.log(`[Weather] Update frequency set to ${frequency}ms`);
    }

    // New method to set forecast days
    setForecastDays(days) {
        if (days < 1 || days > 5) {
            throw new Error('Forecast days must be between 1 and 5');
        }
        if (this.forecastDays !== days) {
            this.forecastDays = days;
            this.clearCache(); // Clear cache when forecast days change
            console.log(`[Weather] Forecast days set to ${days}`);
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