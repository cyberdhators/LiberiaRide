import { createClient } from "@/lib/supabase/server";
import { Alert } from "@/components/ui";
import { PageHeader } from "@/components/admin/table";
import { PhoneBookingForm } from "@/components/admin/phone-booking-form";

export const metadata = { title: "New booking" };
export const dynamic = "force-dynamic";

/** Call-centre booking for callers without a smartphone (permission: bookings.create). */
export default async function NewBookingPage() {
  const supabase = await createClient();
  const [{ data: allowed }, { data: categories }] = await Promise.all([
    supabase.rpc("has_permission", { p_permission: "bookings.create" }),
    supabase.from("vehicle_categories").select("code, name").eq("is_active", true).order("sort_order"),
  ]);
  return (
    <>
      <PageHeader title="New booking (phone)" />
      {allowed !== true ? (
        <Alert tone="info">Only support agents and admins can book for callers.</Alert>
      ) : (
        <>
          <p className="text-muted mb-3 max-w-xl text-sm">
            For callers without a smartphone. Their account is found (or created) by phone number; the driver calls them on arrival.
          </p>
          <PhoneBookingForm categories={categories ?? []} />
        </>
      )}
    </>
  );
}
