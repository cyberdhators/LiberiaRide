"use client";
import { useCallback, useEffect, useRef, useState } from "react";

export interface Fix {
  lat: number;
  lng: number;
  accuracy: number;
  heading: number | null;
  speed: number | null;
  timestamp: number;
}

export type GeoPermission = "unknown" | "prompt" | "granted" | "denied" | "unsupported";

/** One-shot current position (passenger "use my location"). */
export function getCurrentFix(timeoutMs = 10_000): Promise<Fix> {
  return new Promise((resolve, reject) => {
    if (!("geolocation" in navigator)) return reject(new Error("Location is not supported on this device."));
    if (!window.isSecureContext) {
      return reject(new Error("Your phone only shares location with secure (https) sites. Search for your pickup or choose it on the map."));
    }
    navigator.geolocation.getCurrentPosition(
      (p) => resolve(toFix(p)),
      (e) => {
        if (e.code === e.PERMISSION_DENIED) return reject(new Error(geoErrorMessage(e)));
        // GPS slow or unavailable (indoors): accept a quicker network-based position instead.
        navigator.geolocation.getCurrentPosition(
          (p) => resolve(toFix(p)),
          (e2) => reject(new Error(geoErrorMessage(e2))),
          { enableHighAccuracy: false, timeout: timeoutMs, maximumAge: 60_000 },
        );
      },
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 15_000 },
    );
  });
}

function toFix(p: GeolocationPosition): Fix {
  return {
    lat: p.coords.latitude,
    lng: p.coords.longitude,
    accuracy: p.coords.accuracy,
    heading: Number.isFinite(p.coords.heading ?? NaN) ? p.coords.heading : null,
    speed: Number.isFinite(p.coords.speed ?? NaN) ? p.coords.speed : null,
    timestamp: p.timestamp,
  };
}

export function geoErrorMessage(e: GeolocationPositionError): string {
  if (e.code === e.PERMISSION_DENIED) return "Location permission was denied. Allow location for this site in your browser settings.";
  if (e.code === e.POSITION_UNAVAILABLE) return "Your position is unavailable. Move to an open area and try again.";
  return "Getting your location timed out. Please try again.";
}

/**
 * Continuous watch for the driver console. The browser stops delivering fixes when the
 * tab is hidden or the phone sleeps — callers must surface that (see DriverConsole).
 */
export function useGeoWatch(enabled: boolean) {
  const [fix, setFix] = useState<Fix | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [permission, setPermission] = useState<GeoPermission>("unknown");
  const watchId = useRef<number | null>(null);

  useEffect(() => {
    if (!("geolocation" in navigator)) {
      setPermission("unsupported");
      return;
    }
    let status: PermissionStatus | null = null;
    navigator.permissions?.query({ name: "geolocation" as PermissionName }).then((s) => {
      status = s;
      setPermission(s.state as GeoPermission);
      s.onchange = () => setPermission(s.state as GeoPermission);
    }).catch(() => undefined);
    return () => {
      if (status) status.onchange = null;
    };
  }, []);

  const stop = useCallback(() => {
    if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current);
    watchId.current = null;
  }, []);

  useEffect(() => {
    if (!enabled || !("geolocation" in navigator)) {
      stop();
      return;
    }
    watchId.current = navigator.geolocation.watchPosition(
      (p) => {
        setFix(toFix(p));
        setError(null);
        setPermission("granted");
      },
      (e) => {
        setError(geoErrorMessage(e));
        if (e.code === e.PERMISSION_DENIED) setPermission("denied");
      },
      { enableHighAccuracy: true, maximumAge: 2_000, timeout: 20_000 },
    );
    return stop;
  }, [enabled, stop]);

  return { fix, error, permission };
}

/** Tab visibility + network status: both silently stop GPS delivery on the web. */
export function useDeviceStatus() {
  const [visible, setVisible] = useState(true);
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const onVis = () => setVisible(document.visibilityState === "visible");
    const onNet = () => setOnline(navigator.onLine);
    onVis();
    onNet();
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("online", onNet);
    window.addEventListener("offline", onNet);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("online", onNet);
      window.removeEventListener("offline", onNet);
    };
  }, []);
  return { visible, online };
}
