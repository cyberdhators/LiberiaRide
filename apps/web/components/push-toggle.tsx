"use client";
import { useEffect, useState } from "react";
import { Bell, BellOff } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { userMessage } from "@/lib/errors";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui";

type State = "loading" | "unsupported" | "ios-install" | "denied" | "off" | "on";

function keyBytes(b64url: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64url.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((b64url.length + 3) % 4));
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function registration(): Promise<ServiceWorkerRegistration | null> {
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise<null>((r) => setTimeout(() => r(null), 5000)),
  ]);
}

async function save(sub: PushSubscription) {
  const j = sub.toJSON();
  return createClient().rpc("push_subscribe", {
    p_endpoint: sub.endpoint, p_p256dh: j.keys?.p256dh, p_auth: j.keys?.auth, p_user_agent: navigator.userAgent.slice(0, 300),
  });
}

/** Turn phone alerts (Web Push) on/off for this device. */
export function PushToggle({ title, description, className }: { title: string; description: string; className?: string }) {
  const [state, setState] = useState<State>("loading");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
      const standalone = window.matchMedia("(display-mode: standalone)").matches;
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
        return setState(ios && !standalone ? "ios-install" : "unsupported");
      }
      const reg = await registration();
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        void save(sub); // keep this device linked to whoever is signed in now
        return setState("on");
      }
      setState(Notification.permission === "denied" ? "denied" : "off");
    })().catch(() => setState("unsupported"));
  }, []);

  async function enable() {
    setBusy(true);
    setError(null);
    try {
      if ((await Notification.requestPermission()) !== "granted") return setState("denied");
      const { data: key } = await createClient().rpc("push_public_key");
      if (!key) throw new Error("Alerts are not set up on the server yet. Please try again later.");
      const reg = await registration();
      if (!reg) throw new Error("This browser could not start background alerts.");
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key as string) });
      const { error } = await save(sub);
      if (error) {
        await sub.unsubscribe();
        throw new Error(userMessage(error));
      }
      setState("on");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    const sub = await (await registration())?.pushManager.getSubscription();
    if (sub) {
      await createClient().rpc("push_unsubscribe", { p_endpoint: sub.endpoint });
      await sub.unsubscribe();
    }
    setBusy(false);
    setState("off");
  }

  if (state === "loading" || state === "unsupported") return null;
  return (
    <div className={cn("flex items-start gap-3 rounded-xl border border-line p-3 text-sm", className)}>
      {state === "on" ? <Bell className="mt-0.5 h-5 w-5 shrink-0 text-ok-500" aria-hidden /> : <BellOff className="text-muted mt-0.5 h-5 w-5 shrink-0" aria-hidden />}
      <div className="min-w-0 flex-1">
        <p className="font-semibold">{title}{state === "on" && <span className="text-ok-500 font-normal"> · on</span>}</p>
        <p className="text-muted text-xs">
          {state === "ios-install" ? "On iPhone, tap Share → Add to Home Screen, then open LiberiaRide from your home screen to turn alerts on."
            : state === "denied" ? "Notifications are blocked for this site. Allow them in your browser's site settings."
            : description}
        </p>
        {error && <p className="mt-1 text-xs text-signal-600">{error}</p>}
      </div>
      {state === "off" && <Button size="sm" loading={busy} onClick={enable}>Turn on</Button>}
      {state === "on" && <Button size="sm" variant="ghost" loading={busy} onClick={disable}>Turn off</Button>}
    </div>
  );
}
