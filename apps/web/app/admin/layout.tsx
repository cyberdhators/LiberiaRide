import Link from "next/link";
import { requireStaff } from "@/lib/auth";

const NAV = [
  ["/admin", "Overview"], ["/admin/map", "Live map"], ["/admin/bookings", "Bookings"], ["/admin/drivers", "Drivers"],
  ["/admin/passengers", "Passengers"], ["/admin/safety", "Safety"], ["/admin/finance", "Finance"],
  ["/admin/fares", "Fares & config"], ["/admin/staff", "Staff & roles"], ["/admin/audit", "Audit log"],
] as const;

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requireStaff("/admin");
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[220px_1fr]">
      <aside className="surface border-b border-line lg:min-h-dvh lg:border-b-0 lg:border-r">
        <div className="flex items-center justify-between p-4">
          <Link href="/admin" className="font-bold">LiberiaRide <span className="text-muted font-normal">Ops</span></Link>
          <span className="text-muted text-xs lg:hidden">{user.roles.filter((r) => r !== "passenger").join(", ")}</span>
        </div>
        <nav aria-label="Admin" className="overflow-x-auto">
          <ul className="flex gap-1 px-2 pb-2 text-sm lg:flex-col">
            {NAV.map(([href, label]) => (
              <li key={href}>
                <Link href={href} className="block whitespace-nowrap rounded-lg px-3 py-2 hover:bg-[var(--surface-muted)]">{label}</Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="text-muted hidden p-4 text-xs lg:block">
          Signed in as {user.fullName ?? user.email ?? user.phone}
          <form action="/auth/signout" method="post"><button className="mt-1 underline" type="submit">Sign out</button></form>
        </div>
      </aside>
      <main className="min-w-0 p-4 lg:p-6">{children}</main>
    </div>
  );
}
