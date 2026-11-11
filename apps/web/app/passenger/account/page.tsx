import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AccountForms } from "@/components/passenger/account-forms";
import type { SavedPlace } from "@/components/passenger/booking-flow";
import { ReferralCard, type Referral } from "@/components/passenger/referral-card";
import { publicEnv } from "@/lib/env";

export const metadata = { title: "Account" };

export default async function AccountPage() {
  const user = await requireUser("/passenger/account");
  const supabase = await createClient();
  const [{ data: profile }, { data: passenger }, { data: contacts }, { data: places }, { data: referral }] = await Promise.all([
    supabase.from("profiles").select("full_name, phone, email, preferred_currency").eq("id", user.id).single(),
    supabase.from("passengers").select("default_payment_method, rating_avg, completed_trips").eq("id", user.id).maybeSingle(),
    supabase.from("emergency_contacts").select("id, name, phone, relationship").eq("user_id", user.id).order("created_at"),
    supabase.rpc("my_saved_locations"),
    supabase.rpc("my_referral"),
  ]);

  return (
    <main className="mx-auto max-w-lg space-y-4 p-4">
      <h1 className="text-xl font-bold">Account</h1>
      {referral && <ReferralCard referral={referral as Referral} siteUrl={publicEnv.NEXT_PUBLIC_SITE_URL} />}
      <AccountForms
        profile={{
          full_name: profile?.full_name ?? "",
          phone: profile?.phone ?? null,
          email: profile?.email ?? null,
          preferred_currency: (profile?.preferred_currency as "USD" | "LRD") ?? "USD",
          default_payment_method: (passenger?.default_payment_method as string) ?? "cash",
          rating: passenger?.rating_avg ?? null,
          trips: passenger?.completed_trips ?? 0,
        }}
        contacts={contacts ?? []}
        places={(places ?? []) as SavedPlace[]}
        isDriver={user.roles.includes("driver")}
      />
      <form action="/auth/signout" method="post">
        <button className="text-muted w-full py-3 text-sm underline" type="submit">Sign out</button>
      </form>
    </main>
  );
}
