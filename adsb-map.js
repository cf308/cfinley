(function () {
  var POLL_MS = 15000;

  document.addEventListener('DOMContentLoaded', function () {
    var mount = document.getElementById('adsb-map');
    if (!mount || typeof maplibregl === 'undefined') return;

    fetch('/api/location')
      .then(function (r) {
        return r.ok ? r.json() : Promise.reject(new Error('location http ' + r.status));
      })
      .then(function (loc) {
        if (typeof loc.latitude !== 'number' || typeof loc.longitude !== 'number') {
          throw new Error('missing coordinates');
        }
        initMap(loc.latitude, loc.longitude);
      })
      .catch(function () {
        // No configured location - leave the plain dark background, no map.
      });

    function initMap(lat, lon) {
      var map;
      try {
        map = new maplibregl.Map({
          container: mount,
          style: 'https://tiles.openfreemap.org/styles/dark',
          center: [lon, lat], // MapLibre is [lng, lat], not Leaflet's [lat, lng]
          zoom: 8,
          interactive: false,
          attributionControl: { compact: true },
        });
      } catch (e) {
        return;
      }

      map.on('load', function () {
        try {
          // A solid low-opacity layer on top of the whole style, so geography
          // reads as barely-there. Markers/popups are DOM elements above the
          // canvas regardless, so this never touches their legibility.
          map.addLayer({
            id: 'adsb-dim',
            type: 'background',
            paint: { 'background-color': '#0a0b0d', 'background-opacity': 0.45 },
          });
        } catch (e) {
          // Style loaded but layer insertion failed - map still shows, just undimmed.
        }
      });

      map.on('error', function () {
        // Swallow tile/style errors - the container's own dark background
        // is an acceptable fallback and the rest of the page is unaffected.
      });

      var markers = {};

      function tooltipHtml(ac) {
        var parts = [];
        if (ac.callsign) parts.push(ac.callsign);
        if (ac.type) parts.push(ac.type);
        if (typeof ac.altitude === 'number') parts.push(ac.altitude.toLocaleString() + ' ft');
        return parts.length ? parts.join(' &middot; ') : ac.hex;
      }

      function createEntry(ac) {
        var el = document.createElement('div');
        el.className = 'adsb-plane';
        el.innerHTML =
          '<svg viewBox="0 0 24 24" width="12" height="12"><path d="M12 1 L15 9.5 L23 12 L15 14.5 L12 23 L9 14.5 L1 12 L9 9.5 Z"/></svg>';

        var marker = new maplibregl.Marker({ element: el, rotationAlignment: 'map' })
          .setLngLat([ac.lon, ac.lat])
          .setRotation(ac.track)
          .addTo(map);

        var popup = new maplibregl.Popup({
          closeButton: false,
          closeOnClick: false,
          offset: 10,
          className: 'adsb-tooltip',
        }).setHTML(tooltipHtml(ac));

        el.addEventListener('mouseenter', function () {
          popup.setLngLat(marker.getLngLat()).addTo(map);
        });
        el.addEventListener('mouseleave', function () {
          popup.remove();
        });

        return { marker: marker, popup: popup };
      }

      function refresh() {
        fetch('/api/adsb')
          .then(function (r) {
            return r.ok ? r.json() : Promise.reject(new Error('adsb http ' + r.status));
          })
          .then(function (data) {
            var seen = {};

            (data.aircraft || []).forEach(function (ac) {
              if (typeof ac.lat !== 'number' || typeof ac.lon !== 'number') return;
              seen[ac.hex] = true;

              var entry = markers[ac.hex];
              if (entry) {
                entry.marker.setLngLat([ac.lon, ac.lat]).setRotation(ac.track);
                entry.popup.setHTML(tooltipHtml(ac));
              } else {
                markers[ac.hex] = createEntry(ac);
              }
            });

            Object.keys(markers).forEach(function (hex) {
              if (!seen[hex]) {
                markers[hex].popup.remove();
                markers[hex].marker.remove();
                delete markers[hex];
              }
            });
          })
          .catch(function () {
            // Leave existing markers in place; the next poll will retry.
          });
      }

      refresh();
      setInterval(refresh, POLL_MS);
    }
  });
})();
