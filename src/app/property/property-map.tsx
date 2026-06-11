"use client";

import { useEffect, useRef } from "react";
import type * as L from "leaflet";
import "leaflet/dist/leaflet.css";

export type MapListing = {
  id: string;
  address: string;
  postcode: string;
  askingPrice: number;
  fairValue: number | null;
  dealPct: number | null;
  sizeSqm: number | null;
  sizeSource: string;
  valuationBasis: string;
  lat: number | null;
  lng: number | null;
};

function colour(pct: number | null): string {
  if (pct == null) return "#9ca3af";
  if (pct >= 10) return "#34d399";
  if (pct >= 0) return "#6ee7b7";
  if (pct > -10) return "#fbbf24";
  return "#f87171";
}

const gbp = (n: number | null) =>
  n == null ? "—" : `£${Math.round(n).toLocaleString()}`;

export default function PropertyMap({ listings }: { listings: MapListing[] }) {
  const elRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const leafletRef = useRef<typeof L | null>(null);

  // init once
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const mod = await import("leaflet");
      const leaflet = (mod.default ?? mod) as typeof L;
      if (cancelled || !elRef.current || mapRef.current) return;
      leafletRef.current = leaflet;
      const map = leaflet.map(elRef.current).setView([54.595, -5.93], 12);
      leaflet
        .tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
          attribution: "© OpenStreetMap",
          maxZoom: 19,
        })
        .addTo(map);
      layerRef.current = leaflet.layerGroup().addTo(map);
      mapRef.current = map;
    })();
    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  // redraw markers when listings change
  useEffect(() => {
    const leaflet = leafletRef.current;
    const layer = layerRef.current;
    const map = mapRef.current;
    if (!leaflet || !layer || !map) return;
    layer.clearLayers();
    const pts: L.LatLngExpression[] = [];
    for (const l of listings) {
      if (l.lat == null || l.lng == null) continue;
      pts.push([l.lat, l.lng]);
      leaflet
        .circleMarker([l.lat, l.lng], {
          radius: 9,
          color: colour(l.dealPct),
          fillColor: colour(l.dealPct),
          fillOpacity: 0.8,
          weight: 1,
        })
        .bindPopup(
          `<b>${l.address}</b><br/>${l.postcode}${
            l.sizeSqm
              ? ` · ${l.sizeSqm}m²${l.sizeSource === "lps" ? " (LPS)" : ""}`
              : ""
          }<br/>Asking ${gbp(l.askingPrice)}<br/>Fair ${gbp(l.fairValue)}${
            l.valuationBasis ? ` <i>(${l.valuationBasis})</i>` : ""
          }<br/><b>${l.dealPct == null ? "—" : (l.dealPct > 0 ? "+" : "") + l.dealPct + "%"}</b>`,
        )
        .addTo(layer);
    }
    if (pts.length > 0) {
      map.fitBounds(leaflet.latLngBounds(pts).pad(0.2));
    }
  }, [listings]);

  const mappable = listings.filter((l) => l.lat != null).length;

  return (
    <div>
      <div
        ref={elRef}
        className="h-80 w-full overflow-hidden rounded-lg ring-1 ring-neutral-800"
        style={{ background: "#0a0a0a" }}
      />
      <p className="mt-1 text-xs text-neutral-600">
        {mappable} of {listings.length} listings mapped (need a known postcode);
        green = under fair value, red = over.
      </p>
    </div>
  );
}
