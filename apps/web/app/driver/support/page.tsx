import { requireUser } from "@/lib/auth";
import { SupportForm } from "@/components/support-form";
import { Card } from "@/components/ui";

export const metadata = { title: "Driver help" };

export default async function DriverSupport() {
  await requireUser("/driver/support");
  return (
    <main className="mx-auto max-w-lg space-y-4 p-4">
      <h1 className="text-xl font-bold">Help</h1>
      <Card className="space-y-2 text-sm">
        <p className="font-semibold">Why did I stop getting rides?</p>
        <p className="text-muted">
          LiberiaRide runs in your web browser. Browsers pause GPS when the screen locks, when you switch to another app, or when the tab is closed.
          After {45} seconds without a location update you are treated as unavailable, and after 10 minutes you are taken offline.
          Keep the screen on and this page open while you are on duty. A phone mount and charger help.
        </p>
      </Card>
      <SupportForm bookingId={null} />
      <form action="/auth/signout" method="post">
        <button className="text-muted w-full py-3 text-sm underline" type="submit">Sign out</button>
      </form>
    </main>
  );
}
