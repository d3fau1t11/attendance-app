import React, { useEffect, useRef, useState } from "react";
import L from "leaflet";
import { Compass, Locate, MapPin, Loader2, Sparkles } from "lucide-react";

interface WorkplaceMapPickerProps {
  latitude: number;
  longitude: number;
  radiusM: number;
  onChangeLocation: (lat: number, lng: number, address?: string) => void;
}

const RAPIDAPI_KEY = import.meta.env.VITE_RAPIDAPI_KEY || "4b4352b0e3msh8bb4052d5569861p16fffajsn29304da12b9e";

export function WorkplaceMapPicker({
  latitude,
  longitude,
  radiusM,
  onChangeLocation,
}: WorkplaceMapPickerProps) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const circleRef = useRef<L.Circle | null>(null);

  const [locating, setLocating] = useState(false);
  const [geoAddress, setGeoAddress] = useState<string>("");

  // Fix default marker icon issue in Leaflet with bundlers
  useEffect(() => {
    delete (L.Icon.Default.prototype as any)._getIconUrl;
    L.Icon.Default.mergeOptions({
      iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
      iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
      shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
    });
  }, []);

  // Reverse geocoding helper (tries RapidAPI host or OpenStreetMap Nominatim)
  const fetchAddress = async (lat: number, lng: number) => {
    try {
      // 1. Try Nominatim / OpenStreetMap reverse geocoding
      const response = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`
      );
      if (response.ok) {
        const data = await response.json();
        if (data.display_name) {
          setGeoAddress(data.display_name);
          return data.display_name;
        }
      }
    } catch {
      // Fallback
    }

    try {
      // 2. Try RapidAPI Reverse Geocoding
      const res = await fetch(
        `https://forward-reverse-geocoding.p.rapidapi.com/v1/reverse?lat=${lat}&lon=${lng}&format=json`,
        {
          headers: {
            "x-rapidapi-key": RAPIDAPI_KEY,
            "x-rapidapi-host": "forward-reverse-geocoding.p.rapidapi.com",
          },
        }
      );
      if (res.ok) {
        const data = await res.json();
        if (data.display_name) {
          setGeoAddress(data.display_name);
          return data.display_name;
        }
      }
    } catch {
      // Ignore
    }

    return undefined;
  };

  // Initialize Leaflet Map
  useEffect(() => {
    if (!mapContainerRef.current) return;

    if (!mapInstanceRef.current) {
      const map = L.map(mapContainerRef.current, {
        center: [latitude, longitude],
        zoom: 16,
        zoomControl: false,
      });

      L.control.zoom({ position: "bottomright" }).addTo(map);

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 19,
      }).addTo(map);

      const marker = L.marker([latitude, longitude], { draggable: true }).addTo(map);
      const circle = L.circle([latitude, longitude], {
        radius: radiusM,
        color: "#6366f1",
        fillColor: "#6366f1",
        fillOpacity: 0.2,
        weight: 2,
      }).addTo(map);

      marker.on("dragend", async () => {
        const pos = marker.getLatLng();
        const addr = await fetchAddress(pos.lat, pos.lng);
        onChangeLocation(pos.lat, pos.lng, addr);
      });

      map.on("click", async (e: L.LeafletMouseEvent) => {
        marker.setLatLng(e.latlng);
        circle.setLatLng(e.latlng);
        const addr = await fetchAddress(e.latlng.lat, e.latlng.lng);
        onChangeLocation(e.latlng.lat, e.latlng.lng, addr);
      });

      mapInstanceRef.current = map;
      markerRef.current = marker;
      circleRef.current = circle;
    }

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, []);

  // Update marker position & geofence circle when props change
  useEffect(() => {
    if (mapInstanceRef.current && markerRef.current && circleRef.current) {
      const currentPos = markerRef.current.getLatLng();
      if (currentPos.lat !== latitude || currentPos.lng !== longitude) {
        markerRef.current.setLatLng([latitude, longitude]);
        circleRef.current.setLatLng([latitude, longitude]);
        mapInstanceRef.current.setView([latitude, longitude], mapInstanceRef.current.getZoom());
      }
      circleRef.current.setRadius(radiusM);
    }
  }, [latitude, longitude, radiusM]);

  // Request browser geolocation to set current admin location
  const handleGetCurrentLocation = () => {
    if (!navigator.geolocation) {
      alert("Geolocation is not supported by your browser.");
      return;
    }

    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;

        if (mapInstanceRef.current && markerRef.current && circleRef.current) {
          mapInstanceRef.current.setView([lat, lng], 17);
          markerRef.current.setLatLng([lat, lng]);
          circleRef.current.setLatLng([lat, lng]);
        }

        const addr = await fetchAddress(lat, lng);
        onChangeLocation(lat, lng, addr);
        setLocating(false);
      },
      (error) => {
        setLocating(false);
        alert(`Failed to retrieve location: ${error.message}`);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  };

  return (
    <div className="space-y-3 select-none">
      <div className="flex items-center justify-between">
        <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
          <Compass className="w-4 h-4 text-indigo-400" />
          <span>Interactive Boundary & Location Picker</span>
        </label>

        {/* GPS Location Button */}
        <button
          type="button"
          onClick={handleGetCurrentLocation}
          disabled={locating}
          className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs shadow-md shadow-indigo-600/30 flex items-center gap-1.5 transition-all cursor-pointer disabled:opacity-50"
        >
          {locating ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              <span>Locating GPS…</span>
            </>
          ) : (
            <>
              <Locate className="w-3.5 h-3.5" />
              <span>Set to My Current Location</span>
            </>
          )}
        </button>
      </div>

      {/* Map Element */}
      <div className="relative rounded-2xl overflow-hidden border border-slate-800 shadow-xl h-64 bg-slate-900">
        <div ref={mapContainerRef} className="w-full h-full z-10" />

        {/* Legend Overlay */}
        <div className="absolute top-3 left-3 z-[400] glass-panel px-3 py-1.5 rounded-xl border border-slate-800 text-[11px] text-slate-300 font-medium flex items-center gap-2 pointer-events-none">
          <span className="w-2.5 h-2.5 rounded-full bg-indigo-500 animate-ping"></span>
          <span>Click map or drag marker to set coordinates</span>
        </div>
      </div>

      {/* Reverse Geocoding Result Address */}
      {geoAddress && (
        <div className="p-2.5 rounded-xl bg-indigo-950/40 border border-indigo-800/40 text-indigo-200 text-xs font-medium flex items-center gap-2">
          <MapPin className="w-4 h-4 text-indigo-400 shrink-0" />
          <span className="truncate">{geoAddress}</span>
        </div>
      )}
    </div>
  );
}
