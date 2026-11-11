export const metadata = { title: "Offline" };
export const dynamic = "force-static";

// Shown by the service worker when a page can't load because there is no network.
// Styles are inline: the cached HTML is served without the app's CSS bundle.
const s = {
  main: { minHeight: "100dvh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12,
    padding: 24, maxWidth: 380, margin: "0 auto", textAlign: "center", fontFamily: "system-ui, sans-serif", color: "#0f172a" },
  h1: { fontSize: 20, fontWeight: 700, margin: 0 },
  p: { fontSize: 14, color: "#475569", margin: 0, lineHeight: 1.5 },
  a: { marginTop: 8, background: "#143f85", color: "#fff", padding: "12px 20px", borderRadius: 12, fontWeight: 600, textDecoration: "none" },
} as const;

export default function OfflinePage() {
  return (
    <main style={s.main}>
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#143f85" strokeWidth="2" strokeLinecap="round" aria-hidden>
        <path d="M2 2l20 20M8.5 16.5a5 5 0 0 1 7 0M2 8.82a15 15 0 0 1 4.17-2.65M10.66 5c4.01-.36 8.14.9 11.34 3.76M16.85 11.25a10 10 0 0 1 2.22 1.68M5 13a10 10 0 0 1 5.24-2.76M12 20h.01" />
      </svg>
      <h1 style={s.h1}>No internet connection</h1>
      <p style={s.p}>
        Check your data or Wi-Fi. If you are on a ride, it continues — your driver and the trip are not affected.
        In an emergency call 911.
      </p>
      <a href="/" style={s.a}>Try again</a>
    </main>
  );
}
