import { ImageResponse } from "next/og";

/** App icon (same mark as app/icon.svg). `maskable` keeps the mark inside the 80% safe zone. */
export function pwaIcon(size: number, maskable = false) {
  const mark = Math.round(size * (maskable ? 0.5 : 0.62));
  return new ImageResponse(
    (
      <div style={{ width: size, height: size, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        background: "#143f85", borderRadius: maskable ? 0 : size * 0.22 }}>
        <svg width={mark} height={mark} viewBox="12 10 40 46">
          <path d="M32 12l5.3 10.8 11.9 1.7-8.6 8.4 2 11.8L32 39.1l-10.6 5.6 2-11.8-8.6-8.4 11.9-1.7z" fill="#fff" />
          <rect x="12" y="50" width="40" height="4" rx="2" fill="#c8102e" />
        </svg>
      </div>
    ),
    { width: size, height: size, headers: { "Cache-Control": "public, max-age=86400, immutable" } },
  );
}
