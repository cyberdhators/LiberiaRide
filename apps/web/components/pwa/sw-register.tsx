"use client";
import { useEffect } from "react";

/**
 * Registers the service worker (offline page + push) and forwards "push arrived
 * while the app is open" messages as a window event that live screens listen to.
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    const onMessage = (e: MessageEvent) => {
      if (e.data?.type === "lr:push") window.dispatchEvent(new Event("lr:push"));
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => navigator.serviceWorker.removeEventListener("message", onMessage);
  }, []);
  return null;
}
