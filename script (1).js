

// ---- Carte
const map = L.map('map', { zoomControl:false, attributionControl:false }).setView([46.7, 2.5], 6);
L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
  attribution:'', maxZoom:19
}).addTo(map);

// ---- États
let myMarker=null, myPath=[], lastPos=null, lastSpeed=null, lastHeading=null;
let routing=null, routeLine=null, routeCoords=[], routeDistance=0;
let radarMarkers = L.markerClusterGroup({ disableClusteringAtZoom: 12, maxClusterRadius: 60 }).addTo(map);
let radarsAll=[], radarsOnRoute=[], alertedIds=new Set();
const alertEl = document.getElementById('alert');

// Variables pour la géolocalisation ultra précise
let highAccuracyWatcher = null;
let fallbackWatcher = null;
let lastHighAccuracyTime = 0;
let positionBuffer = [];
let speedBuffer = [];
let headingBuffer = [];
let lastValidGPSHeading = null;
let lastValidGPSSpeed = null;
let isFollowing = false;
let userHasMovedMap = false;

// Variables pour le gyroscope
let gyroscopePermission = false;
let deviceOrientationListener = null;
let magnetometerHeading = null;
let gyroscopeHeading = null;
let isGyroscopeCalibrated = false;
let calibrationOffset = 0;
let useGyroscope = false; // Désactivé par défaut pour éviter les mouvements erratiques

// Détecter quand l'utilisateur déplace la carte manuellement
map.on('dragstart', () => {
  if (isFollowing) {
    userHasMovedMap = true;
    showRecenterButton();
  }
});

map.on('zoomstart', () => {
  if (isFollowing) {
    userHasMovedMap = true;
    showRecenterButton();
  }
});

// ---- Initialisation du gyroscope pour orientation ultra-précise
async function initializeGyroscope() {
  try {
    // Demander la permission pour l'orientation de l'appareil
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
      const permission = await DeviceOrientationEvent.requestPermission();
      gyroscopePermission = permission === 'granted';
    } else {
      gyroscopePermission = true; // Autorisé par défaut sur Android/autres
    }

    if (gyroscopePermission) {
      startGyroscopeTracking();
      console.log('Gyroscope activé pour orientation précise');
    } else {
      console.log('Permission gyroscope refusée');
    }
  } catch (error) {
    console.error('Erreur initialisation gyroscope:', error);
  }
}

function startGyroscopeTracking() {
  if (deviceOrientationListener) {
    window.removeEventListener('deviceorientationabsolute', deviceOrientationListener);
    window.removeEventListener('deviceorientation', deviceOrientationListener);
  }

  deviceOrientationListener = (event) => {
    handleDeviceOrientation(event);
  };

  // Priorité à deviceorientationabsolute (plus précis avec boussole magnétique)
  if ('ondeviceorientationabsolute' in window) {
    window.addEventListener('deviceorientationabsolute', deviceOrientationListener);
  } else {
    window.addEventListener('deviceorientation', deviceOrientationListener);
  }
}

function handleDeviceOrientation(event) {
  if (!isFollowing) return;

  let heading = null;

  // Utiliser alpha pour l'orientation (0° = Nord)
  if (event.alpha !== null) {
    // Sur iOS, alpha commence à 0° au nord et tourne dans le sens horaire
    // Sur Android, cela peut varier selon le navigateur
    heading = event.alpha;

    // Correction pour iOS (inverser si nécessaire)
    if (navigator.platform.includes('iPhone') || navigator.platform.includes('iPad')) {
      heading = 360 - heading;
    }

    // Normaliser entre 0-360°
    heading = ((heading % 360) + 360) % 360;

    // Calibration automatique lors du premier mouvement GPS
    if (!isGyroscopeCalibrated && lastValidGPSHeading !== null && lastSpeed > 3) {
      calibrationOffset = lastValidGPSHeading - heading;
      isGyroscopeCalibrated = true;
      console.log(`Gyroscope calibré: offset ${calibrationOffset.toFixed(1)}°`);
    }

    // Appliquer l'offset de calibration
    if (isGyroscopeCalibrated) {
      heading = ((heading + calibrationOffset) % 360 + 360) % 360;
    }

    gyroscopeHeading = heading;
  }
}

function stopGyroscopeTracking() {
  if (deviceOrientationListener) {
    window.removeEventListener('deviceorientationabsolute', deviceOrientationListener);
    window.removeEventListener('deviceorientation', deviceOrientationListener);
    deviceOrientationListener = null;
  }
  gyroscopeHeading = null;
  isGyroscopeCalibrated = false;
}

// Créer l'icône avec flèche directionnelle
function createDirectionalIcon(heading = 0) {
  const size = 24;
  const color = '#00e1ff';
  const shadowColor = 'rgba(0, 225, 255, 0.6)';

  return L.divIcon({
    className: 'directional-marker',
    html: `
      <div style="
        width: ${size}px; 
        height: ${size}px; 
        position: relative;
        transform: rotate(${heading}deg);
        filter: drop-shadow(0 0 12px ${shadowColor});
      ">
        <!-- Cercle principal -->
        <div style="
          width: ${size}px; 
          height: ${size}px; 
          background: radial-gradient(circle at 50% 40%, ${color}, #0088aa 70%, rgba(0,0,0,0) 71%);
          border: 2px solid ${color};
          border-radius: 50%;
          position: absolute;
          box-shadow: 0 0 20px ${shadowColor};
        "></div>
        <!-- Flèche directionnelle -->
        <div style="
          width: 0;
          height: 0;
          border-left: 5px solid transparent;
          border-right: 5px solid transparent;
          border-bottom: 16px solid ${color};
          position: absolute;
          top: -8px;
          left: 50%;
          transform: translateX(-50%);
          filter: drop-shadow(0 0 6px ${shadowColor});
        "></div>
        <!-- Point central -->
        <div style="
          width: 8px;
          height: 8px;
          background: white;
          border-radius: 50%;
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          z-index: 10;
        "></div>
      </div>
    `,
    iconSize: [size, size],
    iconAnchor: [size/2, size/2]
  });
}

// Bouton de recentrage
function showRecenterButton() {
  const btn = document.getElementById('recenterBtn');
  if (myMarker && isFollowing && userHasMovedMap) {
    btn.classList.add('show');
  }
}

function hideRecenterButton() {
  const btn = document.getElementById('recenterBtn');
  btn.classList.remove('show');
  userHasMovedMap = false;
}

document.getElementById('recenterBtn').onclick = () => {
  if (myMarker) {
    map.setView(myMarker.getLatLng(), Math.max(map.getZoom(), 16));
    hideRecenterButton();
    say("Recentré sur ta position.");
  }
};

// ---- Geocoder - API Adresse française officielle + POI
async function geocodeFrench(query) {
  try {
    // 1. Recherche d'adresses classiques
    const addressResponse = await fetch(`https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(query)}&limit=3`);
    let results = [];

    if (addressResponse.ok) {
      const addressData = await addressResponse.json();
      results = addressData.features.map(feature => ({
        name: feature.properties.label,
        center: L.latLng(feature.geometry.coordinates[1], feature.geometry.coordinates[0]),
        properties: feature.properties,
        type: 'address'
      }));
    }

    // 2. Recherche de POI/commerces via Nominatim
    const nominatimResponse = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query + ' France')}&limit=3&addressdetails=1`);

    if (nominatimResponse.ok) {
      const nominatimData = await nominatimResponse.json();
      const poiResults = nominatimData.map(item => ({
        name: `${item.display_name}`,
        center: L.latLng(parseFloat(item.lat), parseFloat(item.lon)),
        properties: {
          label: item.display_name,
          type: item.type || 'poi',
          category: item.category || 'business'
        },
        type: 'poi'
      }));
      results = results.concat(poiResults);
    }

    const uniqueResults = results.filter((result, index, self) => 
      index === self.findIndex(r => r.name === result.name)
    ).slice(0, 5);

    return uniqueResults;
  } catch (error) {
    console.error("Erreur géocodage:", error);
    return [];
  }
}

// ---- TTS
function say(text){
  try{
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'fr-FR';
    u.rate = 1.0;
    u.pitch = 1.0;
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  }catch(e){}
}

// ---- Temps de trajet
function updateTravelTime(durationSeconds) {
  if (!durationSeconds) {
    document.getElementById('travelTimeValue').textContent = '—';
    return;
  }

  const hours = Math.floor(durationSeconds / 3600);
  const minutes = Math.floor((durationSeconds % 3600) / 60);

  let timeText = '';
  if (hours > 0) {
    timeText = `${hours}h ${minutes}min`;
  } else {
    timeText = `${minutes}min`;
  }

  const distanceKm = routeDistance ? (routeDistance / 1000).toFixed(1) : '—';
  document.getElementById('travelTimeValue').innerHTML = `${timeText}<br><small style="color:var(--muted)">${distanceKm} km</small>`;
}

// ---- Filtrage ultra précis des données GPS
function filterGPSDataUltraPrecise(position) {
  const now = Date.now();
  const coords = position.coords;

  // Filtrage moins strict pour une mise à jour plus rapide
  if (coords.accuracy > 30) {
    console.log('Position ignorée: précision insuffisante', coords.accuracy, 'm');
    return null;
  }

  // Buffer de positions pour analyse de cohérence
  positionBuffer.push({
    lat: coords.latitude,
    lon: coords.longitude,
    accuracy: coords.accuracy,
    timestamp: now,
    speed: coords.speed,
    heading: coords.heading
  });

  // Garder seulement les 4 dernières positions pour une réactivité accrue
  if (positionBuffer.length > 4) {
    positionBuffer.shift();
  }

  const currentPosition = positionBuffer[positionBuffer.length - 1];

  // Calcul de vitesse ultra précis avec validation croisée
  let calculatedSpeed = null;
  if (positionBuffer.length >= 3) {
    const recent = positionBuffer.slice(-3);
    let speeds = [];

    for (let i = 1; i < recent.length; i++) {
      const prev = recent[i-1];
      const curr = recent[i];
      const distance = haversine(prev.lat, prev.lon, curr.lat, curr.lon);
      const timeDiff = (curr.timestamp - prev.timestamp) / 1000;

      if (timeDiff > 0.3 && timeDiff < 2 && distance > 0.3) { // Entre 0.3 et 2 secondes, distance > 0.3m
        const speed = (distance / timeDiff) * 3.6; // km/h
        if (speed <= 200 && speed >= 0) { // Vitesse réaliste
          speeds.push(speed);
        }
      }
    }

    if (speeds.length >= 2) {
      // Moyenne des vitesses calculées récentes pour lisser
      calculatedSpeed = speeds.reduce((a, b) => a + b, 0) / speeds.length;
    }
  }

  // Fusion intelligente vitesse GPS + calculée
  let finalSpeed = null;
  if (coords.speed !== null && coords.speed >= 0) {
    const gpsSpeed = coords.speed * 3.6; // m/s vers km/h
    if (gpsSpeed <= 200) {
      if (calculatedSpeed !== null && Math.abs(gpsSpeed - calculatedSpeed) < 15) {
        // Les deux sources concordent, moyenne pondérée
        finalSpeed = (gpsSpeed * 0.6 + calculatedSpeed * 0.4);
      } else {
        finalSpeed = gpsSpeed;
      }
      lastValidGPSSpeed = finalSpeed;
    }
  } else if (calculatedSpeed !== null) {
    finalSpeed = calculatedSpeed;
  } else if (lastValidGPSSpeed !== null && (now - lastHighAccuracyTime) < 3000) {
    finalSpeed = lastValidGPSSpeed * 0.95; // Décroissance progressive
  }

  // Calcul d'orientation privilégiant le GPS pour plus de stabilité
  let finalHeading = null;

  if (finalSpeed !== null && finalSpeed > 2.0) { // En mouvement (> 2 km/h)
    let gpsHeading = null;

    // 1. Obtenir l'orientation GPS
    if (coords.heading !== null && coords.heading >= 0) {
      gpsHeading = coords.heading;
      lastValidGPSHeading = coords.heading;
    } else if (positionBuffer.length >= 3) {
      // Utiliser plus de points pour un calcul plus stable
      const prev = positionBuffer[positionBuffer.length - 3];
      const curr = currentPosition;
      const distance = haversine(prev.lat, prev.lon, curr.lat, curr.lon);

      if (distance > 15) { // Déplacement plus significatif (> 15m)
        const bearing = calculateBearing(prev.lat, prev.lon, curr.lat, curr.lon);
        gpsHeading = bearing;
        lastValidGPSHeading = bearing;
      }
    }

    // 2. Utiliser principalement le GPS, gyroscope en complément seulement si activé
    if (gpsHeading !== null) {
      finalHeading = gpsHeading;
    } else if (useGyroscope && gyroscopeHeading !== null && isGyroscopeCalibrated) {
      finalHeading = gyroscopeHeading;
    } else if (lastValidGPSHeading !== null && (now - lastHighAccuracyTime) < 5000) {
      // Garder la dernière orientation valide pendant 5 secondes max
      finalHeading = lastValidGPSHeading;
    }
  } else if (lastValidGPSHeading !== null && finalSpeed !== null && finalSpeed <= 2.0) {
    // À l'arrêt ou vitesse faible, garder la dernière orientation connue
    finalHeading = lastValidGPSHeading;
  }

  return {
    position: currentPosition,
    speed: finalSpeed,
    heading: finalHeading,
    accuracy: currentPosition.accuracy
  };
}

// ---- Affichage vitesse ultra stable
const speedEl = document.getElementById('speed');
let speedDisplayBuffer = [];
function setSpeed(kmh){ 
  if (kmh !== null && Number.isFinite(kmh)) {
    speedDisplayBuffer.push(kmh);
    if (speedDisplayBuffer.length > 2) speedDisplayBuffer.shift();

    // Moyenne mobile sur 2 valeurs pour une réactivité accrue
    const avgSpeed = speedDisplayBuffer.reduce((a, b) => a + b, 0) / speedDisplayBuffer.length;
    const displaySpeed = Math.round(avgSpeed);

    speedEl.textContent = `${displaySpeed} km/h`;
  } else {
    speedEl.textContent = '—';
    speedDisplayBuffer = [];
  }
}

// ---- Affichage orientation ultra stable
const headingEl = document.getElementById('heading');
let headingDisplayBuffer = [];
let lastDisplayedHeading = null;
let headingUpdateCounter = 0;

function setHeading(degrees) {
  if (degrees !== null && Number.isFinite(degrees)) {
    const normalizedDegrees = ((degrees % 360) + 360) % 360;

    // Filtrer les changements trop brusques (potentiels glitches)
    if (lastDisplayedHeading !== null) {
      const diff = Math.abs(((normalizedDegrees - lastDisplayedHeading + 180) % 360) - 180);
      if (diff > 45 && headingDisplayBuffer.length > 2) {
        console.log('Changement d\'orientation trop brusque ignoré:', diff, '°');
        return; // Ignorer les changements trop brusques
      }
    }

    headingDisplayBuffer.push(normalizedDegrees);
    if (headingDisplayBuffer.length > 5) headingDisplayBuffer.shift(); // Buffer plus large

    // Moyenne angulaire pour gérer le passage 0°/360°
    let avgHeading;
    if (headingDisplayBuffer.length > 1) {
      let sumSin = 0, sumCos = 0;
      headingDisplayBuffer.forEach(h => {
        sumSin += Math.sin(h * Math.PI / 180);
        sumCos += Math.cos(h * Math.PI / 180);
      });
      avgHeading = Math.atan2(sumSin, sumCos) * 180 / Math.PI;
      if (avgHeading < 0) avgHeading += 360;
    } else {
      avgHeading = normalizedDegrees;
    }

    const displayHeading = Math.round(avgHeading);

    // Mise à jour plus réactive de l'orientation
    if (lastDisplayedHeading === null || Math.abs(displayHeading - lastDisplayedHeading) >= 2) {
      headingEl.textContent = `${displayHeading}°`;
      lastDisplayedHeading = displayHeading;

      // Mettre à jour le marqueur plus fréquemment
      headingUpdateCounter++;
      if (headingUpdateCounter % 2 === 0 && myMarker && myMarker.setIcon) {
        myMarker.setIcon(createDirectionalIcon(displayHeading));
      }
    }

    lastHeading = displayHeading;
  } else {
    headingEl.textContent = '—';
    headingDisplayBuffer = [];
    lastDisplayedHeading = null;
  }
}

// ---- Géolocalisation ultra haute précision
function startUltraHighAccuracyGeolocation() {
  if (!navigator.geolocation) {
    alert('Géolocalisation non supportée.');
    return;
  }

  isFollowing = true;
  positionBuffer = [];
  speedDisplayBuffer = [];
  headingDisplayBuffer = [];
  userHasMovedMap = false;

  // Gyroscope désactivé par défaut pour éviter les mouvements erratiques
  // initializeGyroscope();

  // Configuration ultra précise
  const ultraHighAccuracyOptions = {
    enableHighAccuracy: true,
    maximumAge: 0,
    timeout: 8000
  };

  function handleUltraPrecisePosition(position) {
    const filtered = filterGPSDataUltraPrecise(position);
    if (!filtered) return;

    const { position: pos, speed, heading, accuracy } = filtered;
    const latlng = [pos.lat, pos.lon];

    console.log(`Position ultra-précise: ${accuracy.toFixed(1)}m, vitesse: ${speed?.toFixed(2)} km/h, cap: ${heading?.toFixed(1)}°`);

    // Mettre à jour les affichages
    if (speed !== null) {
      lastSpeed = speed;
      setSpeed(speed);
    }

    if (heading !== null) {
      setHeading(heading);
    }

    lastPos = { lat: pos.lat, lon: pos.lon, t: pos.timestamp };

    // Créer ou mettre à jour le marqueur
    if (!myMarker) {
      myMarker = L.marker(latlng, { 
        icon: createDirectionalIcon(heading || 0)
      }).addTo(map);
      map.setView(latlng, 18);
    } else {
      myMarker.setLatLng(latlng);
      if (heading !== null) {
        myMarker.setIcon(createDirectionalIcon(heading));
      }

      // Navigation style Google Maps : la carte suit le mouvement
      if (!userHasMovedMap) {
        // Calculer l'orientation pour aligner la carte
        if (heading !== null && routeCoords.length > 0) {
          // Garder la position centrée et orienter la carte selon la direction
          map.setView(latlng, Math.max(map.getZoom(), 17));
          
          // Optionnel : faire tourner la carte selon la direction (décommenter si souhaité)
          // map.setBearing ? map.setBearing(heading) : null;
        } else {
          map.setView(latlng, Math.max(map.getZoom(), 16));
        }
      }
    }

    myPath.push(latlng);

    // Gestion des radars
    if (routeCoords.length) {
      handleRouteProgress(L.latLng(pos.lat, pos.lon));
    }

    lastHighAccuracyTime = Date.now();
  }

  function handleError(error) {
    console.error('Erreur géolocalisation:', error);
    const errorMessages = {
      1: 'Permission de géolocalisation refusée.',
      2: 'Position indisponible. Vérifie que le GPS est activé.',
      3: 'Timeout géolocalisation.'
    };

    if (error.code <= 3) {
      say(errorMessages[error.code] || 'Erreur de géolocalisation');
    }
  }

  // Géolocalisation principale haute précision
  highAccuracyWatcher = navigator.geolocation.watchPosition(
    handleUltraPrecisePosition,
    handleError,
    ultraHighAccuracyOptions
  );

  say("GPS ultra-précision activé.");
}

function stopGeolocation() {
  isFollowing = false;
  if (highAccuracyWatcher) {
    navigator.geolocation.clearWatch(highAccuracyWatcher);
    highAccuracyWatcher = null;
  }
  stopGyroscopeTracking();
  hideRecenterButton();
}

document.getElementById('follow').onclick = () => {
  if (isFollowing) {
    stopGeolocation();
    say("Suivi GPS arrêté.");
    document.getElementById('follow').innerHTML = '📍 Suivre';
  } else {
    startUltraHighAccuracyGeolocation();
    document.getElementById('follow').innerHTML = '⏹️ Stop';
  }
};

// Bouton gyroscope
document.getElementById('gyro').onclick = async () => {
  const gyroBtn = document.getElementById('gyro');

  if (!useGyroscope) {
    useGyroscope = true;
    await initializeGyroscope();
    gyroBtn.style.color = 'var(--neon)';
    gyroBtn.style.background = 'linear-gradient(135deg, #003311, #006644)';
    say("Gyroscope activé.");
  } else {
    useGyroscope = false;
    stopGyroscopeTracking();
    gyroBtn.style.color = 'var(--muted)';
    gyroBtn.style.background = 'linear-gradient(135deg, #331100, #664400)';
    say("Gyroscope désactivé.");
  }
};

// ---- Charger radars
const CSV_URL = "https://www.data.gouv.fr/api/1/datasets/r/8a22b5a8-4b65-41be-891a-7c0aead4ba51";
let csvText = "";

async function loadRadars() {
  try {
    const response = await fetch(CSV_URL);
    if (response.ok) {
      csvText = await response.text();
      processRadars();
    }
  } catch (e) {
    console.error("Erreur chargement radars:", e);
  }
}

function processRadars() {
  const parsed = Papa.parse(csvText, { header:true, skipEmptyLines:true }).data;
  radarsAll = parsed.map(r => ({
    id: (r.id || r.ID || '').toString(),
    lat: parseFloat(r.latitude || r.lat || r.Latitude || r.y),
    lon: parseFloat(r.longitude || r.lon || r.Longitude || r.x),
    type: (r.type || r.Type || r.equipement || '').trim(),
    route:(r.route || r.Route || '').trim(),
    ville:(r.commune || r.localisation || '').trim(),
    dep:(r.departement || r.departement_code || '').toString().trim(),
    v_vl: parseInt(r.vitesse_vehicules_legers_kmh || r.Vitesse || r.vitesse) || null,
    v_pl: parseInt(r.vitesse_poids_lourds_kmh || r.Vitesse_PL || r.vitesse_pl) || null
  })).filter(r => Number.isFinite(r.lat) && Number.isFinite(r.lon));

  radarsAll.forEach(e=>{
    const m = L.circleMarker([e.lat, e.lon], {
      radius:5, color:'#00e1ff', fill:true, fillOpacity:0.85,
      pane:'markerPane'
    }).bindPopup(popupHtml(e));
    m._radar = e;
    radarMarkers.addLayer(m);
  });
}

// Charger les radars au démarrage
loadRadars();



// ---- Autocomplete
const destInput = document.getElementById('dest');
const suggestionsDiv = document.getElementById('suggestions');
let suggestionTimeout = null;

destInput.addEventListener('input', function() {
  const query = this.value.trim();

  if (suggestionTimeout) {
    clearTimeout(suggestionTimeout);
  }

  if (query.length < 3) {
    hideSuggestions();
    return;
  }

  suggestionTimeout = setTimeout(async () => {
    try {
      const suggestions = await geocodeFrench(query);
      showSuggestions(suggestions.slice(0, 5));
    } catch (error) {
      console.error("Erreur autocomplete:", error);
      hideSuggestions();
    }
  }, 300);
});

function showSuggestions(suggestions) {
  if (!suggestions.length) {
    hideSuggestions();
    return;
  }

  suggestionsDiv.innerHTML = '';
  suggestions.forEach(suggestion => {
    const item = document.createElement('div');
    item.className = 'suggestion-item';

    const icon = suggestion.type === 'poi' ? '🏪' : '📍';
    const truncatedName = suggestion.name.length > 70 ? 
      suggestion.name.substring(0, 70) + '...' : suggestion.name;

    item.innerHTML = `${icon} ${truncatedName}`;
    item.addEventListener('click', () => {
      destInput.value = suggestion.name;
      hideSuggestions();
      document.getElementById('go').click();
    });
    suggestionsDiv.appendChild(item);
  });

  suggestionsDiv.style.display = 'block';
}

function hideSuggestions() {
  suggestionsDiv.style.display = 'none';
}

document.addEventListener('click', function(e) {
  if (!destInput.contains(e.target) && !suggestionsDiv.contains(e.target)) {
    hideSuggestions();
  }
});

destInput.addEventListener('keydown', function(e) {
  const items = suggestionsDiv.querySelectorAll('.suggestion-item');
  let selected = suggestionsDiv.querySelector('.suggestion-item.selected');

  if (e.key === 'ArrowDown') {
    e.preventDefault();
    if (!selected) {
      items[0]?.classList.add('selected');
    } else {
      selected.classList.remove('selected');
      const next = selected.nextElementSibling || items[0];
      next.classList.add('selected');
    }
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    if (!selected) {
      items[items.length - 1]?.classList.add('selected');
    } else {
      selected.classList.remove('selected');
      const prev = selected.previousElementSibling || items[items.length - 1];
      prev.classList.add('selected');
    }
  } else if (e.key === 'Enter') {
    e.preventDefault();
    if (selected) {
      selected.click();
    } else {
      document.getElementById('go').click();
    }
  } else if (e.key === 'Escape') {
    hideSuggestions();
  }
});

// ---- Calcul d'itinéraire
document.getElementById('go').onclick = async ()=>{
  const q = destInput.value.trim();
  if(!q){ 
    say("Entre une destination.");
    return; 
  }

  say("Recherche en cours...");

  try {
    const results = await geocodeFrench(q);

    if(!results || !results.length){ 
      say("Destination introuvable.");
      return; 
    }

    const best = results[0];
    const destLatLng = best.center;

    let origin = (myMarker && myMarker.getLatLng()) || L.latLng(48.86, 2.35);

    const url = `https://router.project-osrm.org/route/v1/driving/${origin.lng},${origin.lat};${destLatLng.lng},${destLatLng.lat}?overview=full&geometries=geojson&steps=true`;

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Erreur HTTP: ${response.status}`);
    }

    const js = await response.json();

    if(!js.routes?.length){ 
      say("Impossible de calculer un itinéraire.");
      return; 
    }
    const r = js.routes[0];
    routeCoords = r.geometry.coordinates.map(c=>L.latLng(c[1], c[0]));
    routeDistance = r.distance;
    const routeDuration = r.duration;

    if(routeLine){ map.removeLayer(routeLine); }
    routeLine = L.polyline(routeCoords, { weight:5, opacity:.9, color:'#00ffd5'}).addTo(map);
    map.fitBounds(routeLine.getBounds().pad(0.1));

    updateTravelTime(routeDuration);
    document.getElementById('travelTime').style.display = 'block';

    say("Itinéraire calculé.");

    radarsOnRoute = filterRadarsAlongRoute(radarsAll, routeCoords, 0.12);
    radarMarkers.clearLayers();
    radarsOnRoute.forEach(e=>{
      const m = L.circleMarker([e.lat, e.lon], {
        radius:6, color:'#00ffa6', fill:true, fillOpacity:0.95
      }).bindPopup(popupHtml(e));
      m._radar = e;
      radarMarkers.addLayer(m);
    });

    updateNextRadar(origin);

    say(`${radarsOnRoute.length} radars détectés sur le trajet.`);

  } catch (error) {
    console.error("Erreur:", error);
    say("Erreur lors du calcul.");
  }
};

// ---- Gestion des radars et alertes
function handleRouteProgress(myLatLng){
  if(!routeCoords.length) return;
  updateNextRadar(myLatLng);

  const ahead = radarsOnRoute
    .map(r=>({ r, d: L.latLng(r.lat,r.lon).distanceTo(myLatLng) }))
    .filter(o=>o.d<=500)
    .sort((a,b)=>a.d-b.d);

  if(ahead.length){
    const { r, d } = ahead[0];
    if(!alertedIds.has(r.id)){
      const kmh = lastSpeed? `${Math.round(lastSpeed)} km/h` : '—';
      const lim = r.v_vl ? `${r.v_vl} km/h` : 'vitesse non précisée';
      showAlert(`⚠️ Radar ${r.type || ''} à ${Math.round(d)} m — Limite ${lim}. Vitesse ${kmh}.`);
      say(`Attention. Radar dans ${Math.round(d)} mètres. Limite ${r.v_vl|| 'non précisée'}.`);
      alertedIds.add(r.id || (r.lat+','+r.lon));
    }
  }
}

function showAlert(msg){
  alertEl.textContent = msg;
  alertEl.style.display='block';
  setTimeout(()=>{ alertEl.style.display='none'; }, 6000);
}

function updateNextRadar(fromLatLng){
  if(!radarsOnRoute.length){ document.getElementById('nextRadar').textContent='—'; return; }
  const me = fromLatLng || (myMarker && myMarker.getLatLng());
  if(!me){ document.getElementById('nextRadar').textContent='—'; return; }
  const list = radarsOnRoute.map(r=>({ r, d: L.latLng(r.lat,r.lon).distanceTo(me) }))
    .sort((a,b)=>a.d-b.d);
  const info = list[0];
  if(info){
    const t = info.r.type || 'Radar';
    const lim = info.r.v_vl ? info.r.v_vl+' km/h' : '—';
    document.getElementById('nextRadar').textContent = `${t}, ${Math.round(info.d)} m, ${lim}`;
  }
}

// ---- Reconnaissance vocale
const talkBtn = document.getElementById('talk');
let rec=null;
talkBtn.onclick = ()=>{
  try{
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if(!SR){ alert('Reconnaissance vocale non supportée.'); return; }
    rec = new SR(); rec.lang='fr-FR'; rec.interimResults=false; rec.maxAlternatives=1;
    rec.onresult = e=>{
      const text = e.results[0][0].transcript.toLowerCase();
      handleVoice(text);
    };
    rec.onerror = e => {
      console.error("Erreur reconnaissance vocale:", e.error);
      say("Erreur d'écoute.");
    };
    rec.start(); say("J'écoute.");
  }catch(e){ console.error(e); say("Impossible de démarrer l'écoute."); }
};

function handleVoice(text){
  if(text.includes('vitesse')){ 
    say(lastSpeed? `Tu roules à ${Math.round(lastSpeed)} kilomètres heure.` : "Vitesse inconnue."); 
    return; 
  }
  if(text.includes('orientation') || text.includes('direction')){ 
    say(lastHeading? `Direction ${Math.round(lastHeading)} degrés.` : "Direction inconnue."); 
    return; 
  }
  if(text.includes('prochain radar')){ 
    const t = document.getElementById('nextRadar').textContent || 'aucun';
    say(`Prochain radar: ${t}.`); 
    return; 
  }
  if(text.includes('centre') || text.includes('recentrer')){
    document.getElementById('recenterBtn').click();
    return;
  }
  say("Commande non comprise. Dis: vitesse, direction, prochain radar, ou recentrer.");
}

// Calculer l'orientation basée sur le déplacement
function calculateBearing(lat1, lon1, lat2, lon2) {
  const toRad = x => x * Math.PI / 180;
  const toDeg = x => x * 180 / Math.PI;

  const dLon = toRad(lon2 - lon1);
  const lat1Rad = toRad(lat1);
  const lat2Rad = toRad(lat2);

  const y = Math.sin(dLon) * Math.cos(lat2Rad);
  const x = Math.cos(lat1Rad) * Math.sin(lat2Rad) - Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLon);

  let bearing = toDeg(Math.atan2(y, x));
  return (bearing + 360) % 360;
}

// ---- Outils géo
function popupHtml(e){
  const lim = e.v_vl ? `${e.v_vl} km/h` : (e.v_pl? e.v_pl+' km/h (PL)' : '—');
  return `<b>${e.type || 'Radar'}</b><br>${[e.route, e.ville, e.dep && '('+e.dep+')'].filter(Boolean).join(' · ')}
          <br>Limite: <b>${lim}</b>`;
}

function haversine(lat1, lon1, lat2, lon2){
  const R=6371000, toRad=x=>x*Math.PI/180;
  const dLat=toRad(lat2-lat1), dLon=toRad(lon2-lon1);
  const a=Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLon/2)**2;
  return 2*R*Math.asin(Math.sqrt(a));
}

function pointToSegmentDistanceKm(p, a, b){
  const toRad=x=>x*Math.PI/180, R=6371;
  const ax=a.lng, ay=a.lat, bx=b.lng, by=b.lat, px=p.lng, py=p.lat;
  const A=[ax,ay], B=[bx,by], P=[px,py];
  const AB=[B[0]-A[0], B[1]-A[1]], AP=[P[0]-A[0], P[1]-A[1]];
  const ab2=AB[0]*AB[0]+AB[1]*AB[1];
  let t=ab2? (AP[0]*AB[0]+AP[1]*AB[1])/ab2 : 0;
  t=Math.max(0,Math.min(1,t));
  const C=[A[0]+t*AB[0], A[1]+t*AB[1]];
  const d = (function(lat1,lon1,lat2,lon2){
    const dLat=toRad(lat2-lat1), dLon=toRad(lon2-lon1);
    const a=Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLon/2)**2;
    return 2*R*Math.asin(Math.sqrt(a));
  })(py,px,C[1],C[0]);
  return d;
}

function filterRadarsAlongRoute(radars, coords, bufferKm){
  const out=[];
  for(const r of radars){
    const p=L.latLng(r.lat,r.lon);
    const b = L.latLngBounds(coords);
    if(!b.pad(0.02).contains(p)) continue;
    let near=false;
    for(let i=1;i<coords.length;i++){
      const a=coords[i-1], c=coords[i];
      const dk = pointToSegmentDistanceKm(p, a, c);
      if(dk<=bufferKm){ near=true; break; }
    }
    if(near) out.push(r);
  }
  return out;
}

setTimeout(()=>say("GPS ultra-précision prêt. Clique sur Suivre pour commencer. Bouton Gyro pour activer l'orientation avancée."), 1500);

