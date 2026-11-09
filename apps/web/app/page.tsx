import Link from "next/link";
import { Car, LayoutDashboard, MapPin, ShieldCheck, Smartphone, Users } from "lucide-react";
import { getSessionUser, hasAnyRole, STAFF_ROLES } from "@/lib/auth";
import { buttonVariants } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";

export default async function Home() {
  const user = await getSessionUser();
  const supabase = await createClient();
  const { data: categories } = await supabase
    .from("vehicle_categories")
    .select("code, name, description, seats")
    .eq("is_active", true)
    .order("sort_order");

  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col px-5 pb-safe pt-10">
      <div className="flex items-center gap-2">
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-brand-600 text-white">
          <MapPin className="h-5 w-5" aria-hidden />
        </span>
        <span className="text-lg font-bold tracking-tight">LiberiaRide</span>
      </div>

      <h1 className="mt-10 text-3xl font-bold leading-tight tracking-tight">
        Rides across Monrovia, <span className="text-brand-600">priced before you go.</span>
      </h1>
      <p className="text-muted mt-3">
        Keke, car or comfort. Pick up from a landmark, a QLS address or a pin on the map, and track your driver live.
      </p>

      <div className="mt-8 grid gap-3">
        <Link href="/passenger" className={buttonVariants({ size: "lg" })}>
          <Smartphone className="h-5 w-5" aria-hidden /> Book a ride
        </Link>
        <Link href="/driver" className={buttonVariants({ size: "lg", variant: "secondary" })}>
          <Car className="h-5 w-5" aria-hidden /> Drive with LiberiaRide
        </Link>
        {user && hasAnyRole(user, ["fleet_operator"]) && (
          <Link href="/fleet" className={buttonVariants({ size: "lg", variant: "ghost" })}>
            <Users className="h-5 w-5" aria-hidden /> Fleet console
          </Link>
        )}
        {user && hasAnyRole(user, STAFF_ROLES) && (
          <Link href="/admin" className={buttonVariants({ size: "lg", variant: "ghost" })}>
            <LayoutDashboard className="h-5 w-5" aria-hidden /> Operations dashboard
          </Link>
        )}
      </div>

      {categories && categories.length > 0 && (
        <section className="mt-10" aria-labelledby="cats">
          <h2 id="cats" className="text-muted text-xs font-semibold uppercase tracking-wide">Ride options</h2>
          <ul className="mt-3 grid grid-cols-2 gap-3">
            {categories.map((c) => (
              <li key={c.code} className="surface rounded-xl border border-line p-3">
                <p className="font-semibold">{c.name}</p>
                <p className="text-muted text-xs">{c.description}</p>
                <p className="text-muted mt-1 text-xs">Up to {c.seats} riders</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="text-muted mt-auto flex items-center gap-2 pt-10 text-xs">
        <ShieldCheck className="h-4 w-4" aria-hidden /> Verified drivers · SOS on every trip · Share your trip live
      </p>
    </main>
  );
}
