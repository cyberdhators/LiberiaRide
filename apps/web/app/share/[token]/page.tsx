import { createClient } from "@/lib/supabase/server";
import { STATUS_LABELS, type BookingStatus } from "@liberia-ride/shared";
import { timeAgo } from "@/lib/utils";
import { Alert, Card } from "@/components/ui";
import { SharedTripMap } from "./shared-trip-map";

export const metadata = { title: "Shared trip", robots: { index: false } };
export const dynamic = "force-dynamic";

/** Public trip-sharing page (anonymous). Shows only what a trusted contact needs. */
export default async function SharedTrip({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const supabase = await createClient();
  const { data } = await supabase.rpc("get_shared_trip", { p_share_token: decodeURIComponent(token) });
  const trip = data as null | {
    code: string; status: BookingStatus; pickup_address: string; dropoff_address: string;
    driver: { name: string; vehicle: string; plate: string } | null;
    driver_location: { lat: number; lng: number; received_at: string } | null;
  };

  if (!trip) {
    return (
      <main className="mx-auto max-w-sm p-6">
        <Alert tone="info" title="This trip link is no longer active">Shared trips stop updating an hour after the ride ends.</Alert>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col">
      <div className="h-[55dvh]">
        <SharedTripMap location={trip.driver_location} />
      </div>
      <div className="space-y-3 p-4">
        <h1 className="text-lg font-bold">{STATUS_LABELS[trip.status]}</h1>
        <Card className="space-y-1 text-sm">
          {trip.driver && <p><strong>{trip.driver.name}</strong> · {trip.driver.vehicle} · <span className="font-mono">{trip.driver.plate}</span></p>}
          <p className="text-muted">From {trip.pickup_address}</p>
          <p className="text-muted">To {trip.dropoff_address}</p>
          {trip.driver_location && <p className="text-muted text-xs">Location updated {timeAgo(trip.driver_location.received_at)}</p>}
        </Card>
        <p className="text-muted text-xs">Trip {trip.code}. Refresh to update. In an emergency call 911.</p>
      </div>
    </main>
  );
}
