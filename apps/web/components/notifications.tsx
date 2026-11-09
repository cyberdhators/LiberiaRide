"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Bell } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useRealtime } from "@/hooks/use-realtime";
import { formatDateTime } from "@/lib/utils";
import { EmptyState } from "@/components/ui";

export interface NotificationRow {
  id: string; kind: string; title: string; body: string | null; data: Record<string, unknown>; read_at: string | null; created_at: string;
}

/** Where tapping a notification goes. Server-defined kinds; unknown kinds have no link. */
export function notificationHref(n: Pick<NotificationRow, "kind" | "data">): string | null {
  const bookingId = typeof n.data?.booking_id === "string" ? n.data.booking_id : null;
  if (n.kind === "booking.assigned" || n.kind.startsWith("driver.")) return "/driver";
  if (bookingId) return `/passenger/trip/${bookingId}`;
  return null;
}

async function unreadCount(): Promise<number> {
  const { count } = await createClient().from("notifications").select("id", { count: "exact", head: true }).is("read_at", null);
  return count ?? 0;
}

/** Bottom-nav item with a live unread badge (private Realtime topic user:<uid>). */
export function NotificationsNavItem({ userId, initialUnread, className }: { userId: string; initialUnread: number; className?: string }) {
  const [unread, setUnread] = useState(initialUnread);
  useRealtime(`user:${userId}`, { notification: () => setUnread((n) => n + 1) }, () => void unreadCount().then(setUnread));
  // The list page marks everything read; it fires this so the badge clears without a reload.
  useEffect(() => {
    const clear = () => setUnread(0);
    window.addEventListener("notifications:read", clear);
    return () => window.removeEventListener("notifications:read", clear);
  }, []);

  return (
    <Link href="/notifications" className={className}>
      <span className="relative">
        <Bell className="h-5 w-5" aria-hidden />
        {unread > 0 && (
          <span className="absolute -right-2 -top-1.5 min-w-4 rounded-full bg-signal-600 px-1 text-center text-[10px] font-bold leading-4 text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </span>
      Alerts<span className="sr-only">{unread > 0 ? `, ${unread} unread` : ""}</span>
    </Link>
  );
}

export function NotificationList({ userId, initial }: { userId: string; initial: NotificationRow[] }) {
  const [items, setItems] = useState(initial);
  // Rows that were unread when the page opened stay highlighted for this visit.
  const [fresh] = useState(() => new Set(initial.filter((n) => !n.read_at).map((n) => n.id)));

  const markAllRead = useCallback(async () => {
    await createClient().from("notifications").update({ read_at: new Date().toISOString() }).is("read_at", null);
    window.dispatchEvent(new Event("notifications:read"));
  }, []);

  const reload = useCallback(async () => {
    const { data } = await createClient().from("notifications")
      .select("id, kind, title, body, data, read_at, created_at").order("created_at", { ascending: false }).limit(50);
    if (data) setItems(data as NotificationRow[]);
  }, []);

  useEffect(() => { void markAllRead(); }, [markAllRead]);
  useRealtime(`user:${userId}`, {
    notification: (p) => {
      const n = p as unknown as NotificationRow;
      fresh.add(n.id);
      setItems((cur) => (cur.some((c) => c.id === n.id) ? cur : [{ ...n, read_at: null }, ...cur]));
      void markAllRead();
    },
  }, reload);

  if (items.length === 0) return <EmptyState title="No notifications yet">Trip updates and account news will appear here.</EmptyState>;
  return (
    <>
      <ul className="surface divide-y divide-[var(--line)] rounded-xl border border-line">
        {items.map((n) => {
          const href = notificationHref(n);
          const inner = (
            <>
              <span className="flex items-baseline justify-between gap-2">
                <span className="font-semibold">{n.title}</span>
                <span className="text-muted shrink-0 text-xs">{formatDateTime(n.created_at)}</span>
              </span>
              {n.body && <span className="text-muted mt-0.5 block text-sm">{n.body}</span>}
            </>
          );
          return (
            <li key={n.id} className={fresh.has(n.id) ? "bg-brand-50/60" : undefined}>
              {href
                ? <Link href={href} className="block p-3 hover:bg-[var(--surface-muted)]">{inner}</Link>
                : <div className="p-3">{inner}</div>}
            </li>
          );
        })}
      </ul>
      {items.length >= 50 && <p className="text-muted mt-2 text-center text-xs">Showing the latest 50.</p>}
    </>
  );
}
