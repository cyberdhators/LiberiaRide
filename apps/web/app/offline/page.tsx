import { WifiOff } from "lucide-react";

export const metadata = { title: "Offline" };
export const dynamic = "force-static";

/** Shown by the service worker when a page can't load because there is no network. */
export default function OfflinePage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col items-center justify-center gap-3 p-6 text-center">
      <WifiOff className="h-10 w-10 text-brand-600" aria-hidden />
      <h1 className="text-xl font-bold">No internet connection</h1>
      <p className="text-muted text-sm">
        Check your data or Wi-Fi. If you are on a ride, it continues — your driver and the trip are not affected.
        In an emergency call 911.
      </p>
      <a href="/" className="mt-2 rounded-xl bg-brand-600 px-5 py-3 font-semibold text-white">Try again</a>
    </main>
  );
}
