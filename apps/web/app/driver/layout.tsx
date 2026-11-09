import Link from "next/link";
import { CircleDollarSign, LifeBuoy, Navigation } from "lucide-react";
import { requireUser } from "@/lib/auth";

export default async function DriverLayout({ children }: { children: React.ReactNode }) {
  await requireUser("/driver");
  return (
    <div className="flex min-h-dvh flex-col">
      <div className="flex-1">{children}</div>
      <nav aria-label="Driver" className="surface sticky bottom-0 z-30 border-t border-line pb-safe">
        <ul className="mx-auto grid max-w-lg grid-cols-3 text-xs font-medium">
          {[
            { href: "/driver", label: "Drive", Icon: Navigation },
            { href: "/driver/earnings", label: "Earnings", Icon: CircleDollarSign },
            { href: "/driver/support", label: "Help", Icon: LifeBuoy },
          ].map(({ href, label, Icon }) => (
            <li key={href}>
              <Link href={href} className="text-muted flex flex-col items-center gap-0.5 py-2.5 hover:text-brand-600">
                <Icon className="h-5 w-5" aria-hidden />{label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
