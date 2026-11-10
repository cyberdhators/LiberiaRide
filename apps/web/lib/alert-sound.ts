"use client";
// Ride-request alert played inside the page (no audio file to download).
// Browsers only allow sound after a user gesture, so call unlockAlertSound()
// from a tap (e.g. "Go online") and alerts can play later without one.
let ctx: AudioContext | null = null;

export function unlockAlertSound() {
  try {
    ctx ??= new AudioContext();
    void ctx.resume();
  } catch { /* no Web Audio */ }
}

export function playRideAlert(repeats = 3) {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();
    const t0 = ctx.currentTime + 0.05;
    for (let i = 0; i < repeats; i++) {
      for (const [freq, dt] of [[880, 0], [1320, 0.18]] as const) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = freq;
        osc.connect(gain).connect(ctx.destination);
        const s = t0 + i * 0.6 + dt;
        gain.gain.setValueAtTime(0.0001, s);
        gain.gain.exponentialRampToValueAtTime(0.5, s + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, s + 0.16);
        osc.start(s);
        osc.stop(s + 0.17);
      }
    }
  } catch { /* no Web Audio */ }
  if ("vibrate" in navigator) navigator.vibrate?.([400, 150, 400, 150, 400]);
}
