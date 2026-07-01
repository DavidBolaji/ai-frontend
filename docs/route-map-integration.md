# Transport Route Map — Frontend Integration

How the backend returns journey-planning results and how the Next.js client renders
the interactive map next to the written directions.

---

## 1. Where the data lives

A normal `ask-response` already carries a `content_blocks` array. When the user asks
for directions and the OpenTripPlanner route succeeds, the backend appends **one extra
block** of `type: "route_map"`. Nothing else about the response changes:

- `content` — the prose the model wrote (the "Option 1 / Option 2 …" text).
- `content_blocks` — structured blocks; now may include a `route_map`.

The map block and the prose are derived from the **same** route plan, so they never
disagree.

> The `route_map` block only appears when OTP returns geometry. On the NS-train
> fallback (and for non-transport answers) there is **no** `route_map` block — render
> prose only.

### Full response shape (WebSocket `ask-response` / HTTP `/route`)

```jsonc
{
  "jsonapi": { "version": "1.0" },
  "data": {
    "type": "ask-response",
    "id": "9b1f…",                      // conversation id
    "attributes": {
      "conversation_id": "9b1f…",
      "question": "How do I get from Amsterdam to Rijswijk?",
      "content": "To get from Amsterdam to Rijswijk you can take a metro + train…",
      "content_blocks": [
        { "type": "route_map", "...": "see §2" }
      ],
      "model_name": "…",
      "created_at": "2026-06-30T09:12:00Z"
      // …other ask-response fields unchanged
    }
  }
}
```

Over the WebSocket the client receives, in order: `ws-open` → `ws-status`* →
`ws-delta` (the prose) → the `ask-response` payload above (this is where
`content_blocks` lives) → `ws-done`. Read `content_blocks` off the `ask-response`
frame, **not** off `ws-delta`.

---

## 2. The `route_map` block contract

```ts
// types/routeMap.ts
export interface LatLon {
  name: string;
  lat: number | null;
  lon: number | null;
}

export interface RouteMapLeg {
  mode: string;            // "WALK" | "RAIL" | "BUS" | "TRAM" | "SUBWAY" | "FERRY" | "BICYCLE" | "CAR"
  label: string;          // e.g. "Metro 52", "Train IC", "Walk"
  route_name: string;     // "52", "IC", …  (may be "")
  agency: string;         // "GVB", "NS", …  (may be "")
  color: string;          // hex, pre-chosen per mode, e.g. "#E4002B"
  from: LatLon;
  to: LatLon;
  departure: string;      // "HH:MM" (may be "")
  arrival: string;        // "HH:MM" (may be "")
  duration_minutes: number;
  geometry: string;       // Google-encoded polyline of THIS leg (may be "")
}

export interface RouteMapItinerary {
  index: number;          // 1-based, matches "Option N" in the prose
  summary: string;        // "Metro + Train"
  duration_minutes: number;
  transfers: number;
  start_time: string;     // "HH:MM"
  end_time: string;       // "HH:MM"
  legs: RouteMapLeg[];
}

export interface RouteMapBlock {
  type: "route_map";
  origin: LatLon;
  destination: LatLon;
  bounds: { minLat: number; minLon: number; maxLat: number; maxLon: number };
  itineraries: RouteMapItinerary[];
}
```

### Example block (Amsterdam → Rijswijk, abridged)

```jsonc
{
  "type": "route_map",
  "origin":      { "name": "Amsterdam", "lat": 52.379, "lon": 4.900 },
  "destination": { "name": "Rijswijk",  "lat": 52.036, "lon": 4.325 },
  "bounds": { "minLat": 52.036, "minLon": 4.322, "maxLat": 52.379, "maxLon": 4.900 },
  "itineraries": [
    {
      "index": 1,
      "summary": "Metro + Train",
      "duration_minutes": 82,
      "transfers": 1,
      "start_time": "09:05",
      "end_time": "10:27",
      "legs": [
        {
          "mode": "SUBWAY", "label": "Metro 52", "route_name": "52", "agency": "GVB",
          "color": "#E4002B",
          "from": { "name": "Amsterdam Centraal", "lat": 52.379, "lon": 4.900 },
          "to":   { "name": "Amsterdam Zuid",     "lat": 52.339, "lon": 4.873 },
          "departure": "09:05", "arrival": "09:14", "duration_minutes": 9,
          "geometry": "mmu~Hci`@…"     // encoded polyline
        },
        {
          "mode": "RAIL", "label": "Train IC", "route_name": "IC", "agency": "NS",
          "color": "#1D4ED8",
          "from": { "name": "Amsterdam Zuid", "lat": 52.339, "lon": 4.873 },
          "to":   { "name": "Rijswijk",       "lat": 52.036, "lon": 4.325 },
          "departure": "09:20", "arrival": "09:59", "duration_minutes": 39,
          "geometry": "ka{~Hgh_@…"
        }
      ]
    }
    // …Option 2, Option 3
  ]
}
```

Notes for the implementer:
- `color` is already decided server-side per mode — just use it; don't re-map.
- `geometry` is a **per-leg** Google-encoded polyline. Decode each leg separately so
  you can colour them independently. If a leg's `geometry` is `""`, fall back to a
  straight line between `from`/`to`.
- A leg may have `lat/lon === null` in rare cases; skip those points when building the
  line / markers.

---

## 3. Install

```bash
npm i maplibre-gl @mapbox/polyline @types/mapbox__polyline
```

- `maplibre-gl` — map renderer; uses free OpenStreetMap raster tiles, **no API key**.
- `@mapbox/polyline` — decodes the encoded `geometry` strings.

Import MapLibre's CSS once in `pages/_app.tsx`:

```ts
import "maplibre-gl/dist/maplibre-gl.css";
import "@/styles/route-map.css";
```

---

## 4. Files added / changed

| File | Change |
|---|---|
| `lib/types.ts` | Added `LatLon`, `RouteMapLeg`, `RouteMapItinerary`, `RouteMapBlock`; extended `ContentBlock.type` union |
| `components/RouteMap.tsx` | New — MapLibre map component (client-only via `ssr:false`) |
| `styles/route-map.css` | New — marker and toggle styles |
| `pages/_app.tsx` | Import MapLibre CSS + route-map CSS |
| `components/ContentBlockRenderer.tsx` | Added `route_map` case using `dynamic(() => import('./RouteMap'))` |
| `docs/route-map-integration.md` | This file |

---

## 5. Behaviour checklist

- [x] `route_map` present → map renders under the prose with an option toggle.
- [x] Switching options redraws the coloured legs + markers and refits the view.
- [x] No `route_map` block (NS fallback / non-transport answer) → prose only, no map.
- [x] A leg with empty `geometry` falls back to a straight `from→to` line.
- [x] OSM attribution stays visible (license requirement).
- [x] Map only initialises on the client (`ssr: false` / `'use client'`).
