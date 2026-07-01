'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import type { Place, PlacesMapBlock } from '@/lib/types';

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

function Stars({ rating, ratingsTotal }: { rating: number | null; ratingsTotal: number | null }) {
  if (rating == null) return null;

  return (
    <span className="places-map__rating">
      {rating.toFixed(1)} star{ratingsTotal ? ` (${ratingsTotal})` : ''}
    </span>
  );
}

function normalizePhoneHref(phone: string) {
  return `tel:${phone.replace(/[^\d+]/g, '')}`;
}

function hasValidBounds(block: PlacesMapBlock) {
  const { bounds } = block;
  return [bounds.minLat, bounds.minLon, bounds.maxLat, bounds.maxLon].every(Number.isFinite);
}

export default function PlacesMap({ block }: { block: PlacesMapBlock }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const [active, setActive] = useState<number>(0);

  const mappable = useMemo(
    () => block.places.filter((p) => p.lat != null && p.lon != null),
    [block.places]
  );

  useEffect(() => {
    if (!containerRef.current || mapRef.current || mappable.length === 0) return;

    const mapOptions: maplibregl.MapOptions = {
      container: containerRef.current,
      style: OSM_STYLE,
    };

    if (hasValidBounds(block)) {
      mapOptions.bounds = [
        [block.bounds.minLon, block.bounds.minLat],
        [block.bounds.maxLon, block.bounds.maxLat],
      ];
      mapOptions.fitBoundsOptions = { padding: 56, maxZoom: 15 };
    } else {
      mapOptions.center = [block.center.lon, block.center.lat];
      mapOptions.zoom = 13;
    }

    const map = new maplibregl.Map(mapOptions);
    map.addControl(new maplibregl.NavigationControl(), 'top-right');
    mapRef.current = map;

    markersRef.current = mappable.map((place, index) => {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'places-marker';
      el.textContent = String(index + 1);
      el.setAttribute('aria-label', place.name);
      el.onclick = () => setActive(index);

      return new maplibregl.Marker({ element: el })
        .setLngLat([place.lon as number, place.lat as number])
        .setPopup(new maplibregl.Popup({ offset: 14 }).setText(place.name))
        .addTo(map);
    });

    return () => {
      markersRef.current.forEach((marker) => marker.remove());
      markersRef.current = [];
      map.remove();
      mapRef.current = null;
    };
  }, [block, mappable]);

  useEffect(() => {
    markersRef.current.forEach((marker, index) => {
      const element = marker.getElement();
      element.classList.toggle('is-active', index === active);
    });

    const map = mapRef.current;
    const place = mappable[active];
    if (map && place && place.lat != null && place.lon != null) {
      map.easeTo({ center: [place.lon, place.lat], zoom: 15, duration: 400 });
    }
  }, [active, mappable]);

  if (block.places.length === 0) {
    return null;
  }

  return (
    <div className="places-map">
      {mappable.length > 0 && (
        <div ref={containerRef} className="places-map__canvas" style={{ height: 340 }} />
      )}

      <ol className="places-map__cards">
        {block.places.map((place, index) => {
          const isActive = index === active;
          return (
            <li
              key={place.id || `${place.name}-${index}`}
              className={isActive ? 'is-active' : ''}
              onClick={() => setActive(index)}
            >
              {place.photo_url ? (
                <img src={place.photo_url} alt={place.name} loading="lazy" />
              ) : (
                <div className="places-map__noimg" aria-hidden="true" />
              )}

              <div className="places-map__info">
                <strong>
                  {index + 1}. {place.name}
                </strong>

                <div className="places-map__meta">
                  <Stars rating={place.rating} ratingsTotal={place.ratings_total} />
                  {place.price_level ? <span>{place.price_level}</span> : null}
                  {place.category ? <span>{place.category}</span> : null}
                  {place.open_now === true ? <span className="open">Open now</span> : null}
                  {place.open_now === false ? <span className="closed">Closed</span> : null}
                </div>

                {place.summary ? <div className="places-map__summary">{place.summary}</div> : null}
                {place.address ? <div className="places-map__addr">{place.address}</div> : null}

                <PlaceLinks place={place} />
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function PlaceLinks({ place }: { place: Place }) {
  if (!place.website && !place.maps_uri && !place.phone) {
    return null;
  }

  return (
    <div className="places-map__links">
      {place.website ? (
        <a href={place.website} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>
          Website
        </a>
      ) : null}
      {place.maps_uri ? (
        <a href={place.maps_uri} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>
          Google Maps
        </a>
      ) : null}
      {place.phone ? (
        <a href={normalizePhoneHref(place.phone)} onClick={(event) => event.stopPropagation()}>
          {place.phone}
        </a>
      ) : null}
    </div>
  );
}
