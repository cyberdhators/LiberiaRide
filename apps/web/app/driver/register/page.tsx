import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { DriverRegistration } from "@/components/driver/registration";

export const metadata = { title: "Become a driver" };

export default async function RegisterPage() {
  const user = await requireUser("/driver/register");
  const supabase = await createClient();
  const [{ data: driver }, { data: profile }, { data: categories }, { data: vehicles }, { data: docs }] = await Promise.all([
    supabase.from("drivers").select("status, licence_number, licence_expiry, date_of_birth, address_text").eq("id", user.id).maybeSingle(),
    supabase.from("profiles").select("full_name").eq("id", user.id).single(),
    supabase.from("vehicle_categories").select("code, name").eq("is_active", true).order("sort_order"),
    supabase.from("vehicles").select("id, make, model, year, color, plate_number, status, vehicle_categories(code)").eq("driver_id", user.id),
    supabase.from("driver_documents").select("id, doc_type, status, review_note, created_at").eq("driver_id", user.id).order("created_at", { ascending: false }),
  ]);

  return (
    <main className="mx-auto max-w-lg space-y-4 p-4">
      <h1 className="text-xl font-bold">Driver registration</h1>
      <p className="text-muted text-sm">Three steps: your details, your vehicle, then photos of your documents. We review every application before you can go online.</p>
      <DriverRegistration
        userId={user.id}
        driver={driver}
        fullName={profile?.full_name ?? ""}
        categories={categories ?? []}
        vehicles={(vehicles ?? []).map((v) => ({ ...v, category: (v.vehicle_categories as unknown as { code: string } | null)?.code ?? "" }))}
        documents={docs ?? []}
      />
    </main>
  );
}
