"use client";
import { useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";

export type ChannelState = "connecting" | "live" | "offline";

/**
 * Subscribe to a PRIVATE broadcast topic (authorised by RLS on realtime.messages).
 * Realtime is a notification transport only: on every (re)connect `onResync` is
 * called so the component reloads authoritative state from the database.
 */
export function useRealtime(
  topic: string | null,
  handlers: Record<string, (payload: Record<string, unknown>) => void>,
  onResync?: () => void,
): ChannelState {
  const [state, setState] = useState<ChannelState>("connecting");
  const handlersRef = useRef(handlers);
  const resyncRef = useRef(onResync);
  handlersRef.current = handlers;
  resyncRef.current = onResync;

  useEffect(() => {
    if (!topic) return;
    const supabase = createClient();
    let channel: RealtimeChannel | null = null;
    let cancelled = false;

    (async () => {
      // Private channels authorise with the user's JWT.
      const { data } = await supabase.auth.getSession();
      if (data.session) await supabase.realtime.setAuth(data.session.access_token);
      if (cancelled) return;
      channel = supabase.channel(topic, { config: { private: true } });
      channel.on("broadcast", { event: "*" }, (msg) => {
        const fn = handlersRef.current[msg.event] ?? handlersRef.current["*"];
        fn?.((msg.payload ?? {}) as Record<string, unknown>);
      });
      channel.subscribe((status) => {
        if (status === "SUBSCRIBED") {
          setState("live");
          resyncRef.current?.();
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          setState("offline");
        }
      });
    })();

    return () => {
      cancelled = true;
      if (channel) void supabase.removeChannel(channel);
    };
  }, [topic]);

  return state;
}
