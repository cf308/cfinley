(function () {
  var POLL_MS = 15000;

  document.addEventListener('DOMContentLoaded', function () {
    var mount = document.getElementById('adsb-map');
    if (!mount || typeof L === 'undefined') return;

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
        map = L.map(mount, {
          center: [lat, lon],
          zoom: 8,
          zoomControl: false,
          dragging: false,
          touchZoom: false,
          scrollWheelZoom: false,
          doubleClickZoom: false,
          boxZoom: false,
          keyboard: false,
          tap: false,
          fadeAnimation: false,
        });

        map.attributionControl.setPosition('bottomleft');

        L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png', {
          subdomains: 'abcd',
          maxZoom: 19,
          attribution: '&copy; OpenStreetMap &copy; CARTO',
        }).addTo(map);

        // A dedicated pane sits between the tiles and the marker/tooltip panes,
        // so the geography gets crushed dark while aircraft and their tooltips
        // stay legible on top of it.
        var dimPane = map.createPane('dim');
        dimPane.style.zIndex = 450;
        dimPane.style.pointerEvents = 'none';
        L.DomUtil.create('div', 'adsb-map-dim', dimPane);
      } catch (e) {
        return;
      }

      var markers = {};

      function tooltipHtml(ac) {
        var parts = [];
        if (ac.callsign) parts.push(ac.callsign);
        if (ac.type) parts.push(ac.type);
        if (typeof ac.altitude === 'number') parts.push(ac.altitude.toLocaleString() + ' ft');
        return parts.length ? parts.join(' &middot; ') : ac.hex;
      }

      function planeIcon(track) {
        return L.divIcon({
          className: 'adsb-plane',
          html:
            '<svg viewBox="0 0 24 24" width="12" height="12" style="transform:rotate(' +
            track +
            'deg)"><path d="M12 1 L15 9.5 L23 12 L15 14.5 L12 23 L9 14.5 L1 12 L9 9.5 Z"/></svg>',
          iconSize: [12, 12],
          iconAnchor: [6, 6],
        });
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

              var existing = markers[ac.hex];
              if (existing) {
                existing.setLatLng([ac.lat, ac.lon]);
                var el = existing.getElement();
                var svg = el && el.querySelector('svg');
                if (svg) svg.style.transform = 'rotate(' + ac.track + 'deg)';
                existing.setTooltipContent(tooltipHtml(ac));
              } else {
                var marker = L.marker([ac.lat, ac.lon], { icon: planeIcon(ac.track) }).addTo(map);
                marker.bindTooltip(tooltipHtml(ac), {
                  direction: 'top',
                  opacity: 0.95,
                  className: 'adsb-tooltip',
                });
                markers[ac.hex] = marker;
              }
            });

            Object.keys(markers).forEach(function (hex) {
              if (!seen[hex]) {
                map.removeLayer(markers[hex]);
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
