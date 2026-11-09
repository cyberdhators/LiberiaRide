import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/admin/table";
import { LiveMap, type LiveMapData } from "@/components/admin/live-map";

export const metadata = { title: "Live map" };
export const dynamic = "force-dynamic";

export default async function LiveMapPage() {
  const supabase = await createClient();
  const { data } = await supabase.rpc("admin_live_map");
  return (
    <>
      <PageHeader title="Live map" />
      <LiveMap initial={(data ?? { drivers: [], bookings: [] }) as LiveMapData} />
    </>
  );
}
