'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import polyline from '@mapbox/polyline';
import type { RouteMapBlock, RouteMapItinerary } from '@/lib/types';

const OSM_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution: '© OpenStreetMap contributors',
    },
  },
  layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
};

function itineraryToGeoJSON(itin: RouteMapItinerary): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = itin.legs.map((leg) => {
    const coords: number[][] = leg.geometry
      ? polyline.decode(leg.geometry).map(([lat, lon]: [number, number]) => [lon, lat])
      : (
          [
            [leg.from.lon, leg.from.lat],
            [leg.to.lon, leg.to.lat],
          ] as Array<[number | null, number | null]>
        )
          .filter(([lon, lat]) => lon != null && lat != null)
          .map(([lon, lat]) => [lon as number, lat as number]);

    return {
      type: 'Feature',
      properties: { color: leg.color, mode: leg.mode, label: leg.label },
      geometry: { type: 'LineString', coordinates: coords },
    };
  });
  return { type: 'FeatureCollection', features };
}

function markerPoints(block: RouteMapBlock, itin: RouteMapItinerary) {
  const pts: { lon: number; lat: number; label: string; kind: string }[] = [];
  if (block.origin.lat != null && block.origin.lon != null) {
    pts.push({ lon: block.origin.lon, lat: block.origin.lat, label: block.origin.name, kind: 'origin' });
  }
  itin.legs.slice(0, -1).forEach((leg) => {
    if (leg.to.lat != null && leg.to.lon != null) {
      pts.push({ lon: leg.to.lon, lat: leg.to.lat, label: leg.to.name, kind: 'transfer' });
    }
  });
  if (block.destination.lat != null && block.destination.lon != null) {
    pts.push({ lon: block.destination.lon, lat: block.destination.lat, label: block.destination.name, kind: 'destination' });
  }
  return pts;
}

export default function RouteMap({ block }: { block: RouteMapBlock }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const [selected, setSelected] = useState<number>(block.itineraries[0]?.index ?? 1);

  const activeItin = useMemo(
    () => block.itineraries.find((i) => i.index === selected) ?? block.itineraries[0],
    [block, selected]
  );

  // Create the map once.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: OSM_STYLE,
      bounds: [
        [block.bounds.minLon, block.bounds.minLat],
        [block.bounds.maxLon, block.bounds.maxLat],
      ],
      fitBoundsOptions: { padding: 48 },
    });
    map.addControl(new maplibregl.NavigationControl(), 'top-right');
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Redraw the selected itinerary whenever it changes.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !activeItin) return;

    const draw = () => {
      const data = itineraryToGeoJSON(activeItin);
      const src = map.getSource('route') as maplibregl.GeoJSONSource | undefined;
      if (src) {
        src.setData(data);
      } else {
        map.addSource('route', { type: 'geojson', data });
        map.addLayer({
          id: 'route-line',
          type: 'line',
          source: 'route',
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: {
            'line-color': ['get', 'color'],
            'line-width': 5,
            'line-opacity': 0.9,
          },
        });
      }

      markersRef.current.forEach((m) => m.remove());
      markersRef.current = markerPoints(block, activeItin).map((p) => {
        const el = document.createElement('div');
        el.className = `route-marker route-marker--${p.kind}`;
        return new maplibregl.Marker({ element: el })
          .setLngLat([p.lon, p.lat])
          .setPopup(new maplibregl.Popup({ offset: 12 }).setText(p.label))
          .addTo(map);
      });

      map.fitBounds(
        [
          [block.bounds.minLon, block.bounds.minLat],
          [block.bounds.maxLon, block.bounds.maxLat],
        ],
        { padding: 48, duration: 400 }
      );
    };

    if (map.isStyleLoaded()) draw();
    else map.once('load', draw);
  }, [activeItin, block]);

  return (
    <div className="route-map">
      {block.itineraries.length > 1 && (
        <div className="route-map__options" role="tablist">
          {block.itineraries.map((itin) => (
            <button
              key={itin.index}
              role="tab"
              aria-selected={itin.index === selected}
              className={itin.index === selected ? 'is-active' : ''}
              onClick={() => setSelected(itin.index)}
            >
              Option {itin.index} · {itin.summary}
            </button>
          ))}
        </div>
      )}

      <div ref={containerRef} className="route-map__canvas" style={{ height: 360 }} />

      <ol className="route-map__legend">
        {activeItin?.legs.map((leg, i) => (
          <li key={i}>
            <span className="route-map__swatch" style={{ background: leg.color }} />
            {leg.description ||
              `${leg.label} ${leg.from.name} → ${leg.to.name}${
                leg.departure && leg.arrival ? ` (${leg.departure}–${leg.arrival})` : ''
              }`}
          </li>
        ))}
      </ol>
    </div>
  );
}
