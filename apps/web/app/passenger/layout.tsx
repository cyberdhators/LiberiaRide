import Link from "next/link";
import { Clock, MapPin, UserRound } from "lucide-react";
import { requireUser } from "@/lib/auth";

export default async function PassengerLayout({ children }: { children: React.ReactNode }) {
  await requireUser("/passenger");
  return (
    <div className="flex min-h-dvh flex-col">
      <div className="flex-1">{children}</div>
      <nav aria-label="Passenger" className="surface sticky bottom-0 z-30 border-t border-line pb-safe">
        <ul className="mx-auto grid max-w-lg grid-cols-3 text-xs font-medium">
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
        </ul>
      </nav>
    </div>
  );
}
