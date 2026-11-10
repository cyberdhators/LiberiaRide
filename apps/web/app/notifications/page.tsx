import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { NotificationList, type NotificationRow } from "@/components/notifications";
import { PushToggle } from "@/components/push-toggle";

export const metadata = { title: "Notifications" };
export const dynamic = "force-dynamic";

export default async function NotificationsPage() {
  const user = await requireUser("/notifications");
  const supabase = await createClient();
  const { data } = await supabase.from("notifications")
    .select("id, kind, title, body, data, read_at, created_at")
    .order("created_at", { ascending: false })
    .limit(50);
  const back = user.roles.includes("driver") ? "/driver" : "/passenger";

  return (
    <main className="mx-auto max-w-lg p-4">
      <div className="mb-4 flex items-center gap-2">
        <Link href={back} className="grid h-10 w-10 place-items-center rounded-lg hover:bg-[var(--surface-muted)]" aria-label="Back">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <h1 className="text-xl font-bold">Notifications</h1>
      </div>
      <PushToggle className="mb-4" title="Phone alerts" description="Get ride and trip alerts on this device even when LiberiaRide is closed." />
      <NotificationList userId={user.id} initial={(data ?? []) as NotificationRow[]} />
    </main>
  );
}
