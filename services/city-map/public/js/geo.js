// Shared geography: a local flat projection (metres from the map centre) and
// the same Gaussian-peak elevation model the generator and server use.
export const M_PER_DEG_LAT = 110574;
export const M_PER_DEG_LNG = 108400;

export function makeGeo(config, mountains) {
  const c = config.center;
  const base = config.base_elevation_m;
  const peaks = mountains.map((m) => ({
    x: (m.lng - c.lng) * M_PER_DEG_LNG,
    y: (m.lat - c.lat) * M_PER_DEG_LAT,
    h: m.height_m,
    r2: m.radius_m * m.radius_m,
  }));

  const toXY = (lat, lng) => ({ x: (lng - c.lng) * M_PER_DEG_LNG, y: (lat - c.lat) * M_PER_DEG_LAT });
  const toLatLng = (x, y) => ({ lat: c.lat + y / M_PER_DEG_LAT, lng: c.lng + x / M_PER_DEG_LNG });
  const elevationXY = (x, y) => {
    let h = base;
    for (const p of peaks) {
      const dx = x - p.x, dy = y - p.y;
      h += p.h * Math.exp(-(dx * dx + dy * dy) / p.r2);
    }
    return h;
  };
  const b = config.bounds;
  const sw = toXY(b.south, b.west), ne = toXY(b.north, b.east);

  return {
    center: c,
    base,
    bounds: b,
    extent: { minX: sw.x, minY: sw.y, maxX: ne.x, maxY: ne.y },
    toXY,
    toLatLng,
    elevationXY,
    elevation: (lat, lng) => { const p = toXY(lat, lng); return elevationXY(p.x, p.y); },
    fmt: (lat, lng) => `${Math.abs(lat).toFixed(5)}° ${lat >= 0 ? 'N' : 'S'}  ${Math.abs(lng).toFixed(5)}° ${lng >= 0 ? 'E' : 'W'}`,
  };
}

export const KIND_LABEL = {
  police: 'Police', civic: 'Civic', station: 'Station', bus_stop: 'Bus stop', cave: 'Cave', hill: 'Peak', lake: 'Lake', park: 'Park',
  hospital: 'Hospital', cafe: 'Café', residential: 'Residential', commercial: 'Commercial', office: 'Office', tech: 'Tech',
  industrial: 'Industrial', district: 'District', home: 'Home', family: 'Family', workplace: 'Workplace', poi: 'Point of interest',
  utility: 'Utility', vet: 'Veterinary hospital', auditorium: 'Auditorium', eco: 'Eco-park', school: 'School', church: 'Church', theatre: 'Theatre', stadium: 'Stadium', temple: 'Temple', university: 'University', market: 'Market hall', fire_station: 'Fire station', library: 'Library', pylon: 'Pylon', cell: 'Cell mast', water: 'Water tower', radio: 'Radio relay', substation: 'Substation', you: 'You', sos: 'SOS', tower: 'Tower',
};
