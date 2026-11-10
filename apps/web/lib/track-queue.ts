// GPS fixes buffered on the phone while the network is down (per trip), uploaded
// with driver_upload_track when it returns, so the fare sees the real route.
export interface TrackPoint { lat: number; lng: number; accuracy_m: number; speed_mps: number | null; recorded_at: string }

const key = (bookingId: string) => `lr.track.${bookingId}`;
const MAX_POINTS = 2000;

export function readTrack(bookingId: string): TrackPoint[] {
  try {
    return JSON.parse(localStorage.getItem(key(bookingId)) ?? "[]") as TrackPoint[];
  } catch {
    return [];
  }
}

export function queueTrackPoint(bookingId: string, p: TrackPoint) {
  try {
    const q = readTrack(bookingId);
    if (q.at(-1)?.recorded_at === p.recorded_at) return;
    q.push(p);
    localStorage.setItem(key(bookingId), JSON.stringify(q.slice(-MAX_POINTS)));
  } catch { /* storage full or blocked: live updates still work */ }
}

export function dropTrackPoints(bookingId: string, count: number) {
  try {
    const rest = readTrack(bookingId).slice(count);
    if (rest.length) localStorage.setItem(key(bookingId), JSON.stringify(rest));
    else localStorage.removeItem(key(bookingId));
  } catch { /* ignore */ }
}
