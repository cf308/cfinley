(function () {
  var WEATHER_REFRESH_MS = 10 * 60 * 1000;
  var CLOCK_TICK_MS = 30 * 1000;

  function weatherEmoji(code, isDay) {
    if (code === 0) return isDay ? '☀️' : '🌙';
    if (code === 1 || code === 2) return '⛅';
    if (code === 3) return '☁️';
    if (code === 45 || code === 48) return '🌫️';
    if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82].indexOf(code) !== -1) return '🌧️';
    if ([71, 73, 75, 77, 85, 86].indexOf(code) !== -1) return '🌨️';
    if ([95, 96, 99].indexOf(code) !== -1) return '⛈️';
    return '☁️';
  }

  function fetchLocation() {
    return fetch('/api/location').then(function (r) {
      return r.ok ? r.json() : Promise.reject(new Error('location http ' + r.status));
    });
  }

  function fetchWeather(coords) {
    var url =
      'https://api.open-meteo.com/v1/forecast?latitude=' +
      coords.latitude +
      '&longitude=' +
      coords.longitude +
      '&current=temperature_2m,weather_code,is_day&temperature_unit=fahrenheit&timezone=auto';

    return fetch(url).then(function (r) {
      return r.ok ? r.json() : Promise.reject(new Error('forecast http ' + r.status));
    });
  }

  function formatTime(timeZone) {
    try {
      return new Date().toLocaleTimeString('en-US', {
        timeZone: timeZone,
        hour: 'numeric',
        minute: '2-digit',
      });
    } catch (e) {
      return '';
    }
  }

  document.addEventListener('DOMContentLoaded', function () {
    var page = document.querySelector('.page');
    if (!page) return;

    var bar = document.createElement('div');
    bar.className = 'status-bar';
    page.insertBefore(bar, page.firstChild);

    var state = { label: '', timeZone: null, emoji: '', temp: null };
    var clockTimer = null;
    var weatherTimer = null;

    function render() {
      if (!state.timeZone || state.temp == null) return;
      bar.textContent =
        state.label + ' · ' + formatTime(state.timeZone) + ' · ' + state.emoji + ' ' + Math.round(state.temp) + '°F';
    }

    function refreshWeather(coords) {
      return fetchWeather(coords)
        .then(function (data) {
          var current = data && data.current;
          var timeZone = data && data.timezone;
          if (!current || !timeZone) return Promise.reject(new Error('malformed forecast response'));

          state.timeZone = timeZone;
          state.emoji = weatherEmoji(current.weather_code, current.is_day === 1);
          state.temp = current.temperature_2m;
          render();
        })
        .catch(function () {
          // A single failed refresh shouldn't take down an already-working bar.
        });
    }

    fetchLocation()
      .then(function (loc) {
        state.label = loc.label;
        var coords = { latitude: loc.latitude, longitude: loc.longitude };

        return refreshWeather(coords).then(function () {
          if (!state.timeZone) return Promise.reject(new Error('initial weather fetch failed'));

          clockTimer = setInterval(render, CLOCK_TICK_MS);
          weatherTimer = setInterval(function () {
            refreshWeather(coords);
          }, WEATHER_REFRESH_MS);
        });
      })
      .catch(function () {
        // Fail gracefully: remove the bar, the rest of the site is unaffected.
        if (clockTimer) clearInterval(clockTimer);
        if (weatherTimer) clearInterval(weatherTimer);
        bar.remove();
      });
  });
})();
