import Link from "next/link";
import { Clock, MapPin, UserRound } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { NotificationsNavItem } from "@/components/notifications";

export default async function PassengerLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser("/passenger");
  const supabase = await createClient();
  const { count: unread } = await supabase.from("notifications").select("id", { count: "exact", head: true }).is("read_at", null);
  return (
    <div className="flex min-h-dvh flex-col">
      <div className="flex-1">{children}</div>
      <nav aria-label="Passenger" className="surface sticky bottom-0 z-30 border-t border-line pb-safe">
        <ul className="mx-auto grid max-w-lg grid-cols-4 text-xs font-medium">
          {[
            { href: "/passenger", label: "Ride", Icon: MapPin },
            { href: "/passenger/trips", label: "Trips", Icon: Clock },
            { href: "/passenger/account", label: "Account", Icon: UserRound },
          ].map(({ href, label, Icon }) => (
            <li key={href}>
              <Link href={href} className="flex flex-col items-center gap-0.5 py-2.5 text-muted hover:text-brand-600">
                <Icon className="h-5 w-5" aria-hidden />
                {label}
              </Link>
            </li>
          ))}
          <li>
            <NotificationsNavItem userId={user.id} initialUnread={unread ?? 0}
              className="text-muted flex flex-col items-center gap-0.5 py-2.5 hover:text-brand-600" />
          </li>
        </ul>
      </nav>
    </div>
  );
}
