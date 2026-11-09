"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Map } from "@/components/map";

/** Anonymous viewers have no Realtime access, so the page refreshes every 15 s. */
export function SharedTripMap({ location }: { location: { lat: number; lng: number } | null }) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => router.refresh(), 15_000);
    return () => clearInterval(t);
  }, [router]);
  return <Map markers={location ? [{ id: "driver", kind: "driver", lat: location.lat, lng: location.lng, label: "Driver" }] : []} />;
}
