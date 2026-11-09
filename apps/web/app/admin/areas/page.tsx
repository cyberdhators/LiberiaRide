import { createClient } from "@/lib/supabase/server";
import { getSessionUser, hasAnyRole } from "@/lib/auth";
import { Alert, Badge } from "@/components/ui";
import { PageHeader, Table, Td } from "@/components/admin/table";
import { AreasPanel, CategoryEditor, type AreaRow, type CategoryRow } from "@/components/admin/area-forms";

export const metadata = { title: "Ride types & areas" };
export const dynamic = "force-dynamic";

export default async function AreasPage() {
  const me = (await getSessionUser())!;
  const canEdit = hasAnyRole(me, ["admin", "super_admin"]);
  const supabase = await createClient();
  const [{ data: cats, error: catError }, { data: rules }, { data: areas, error: areaError }] = await Promise.all([
    supabase.from("vehicle_categories").select("code, name, description, seats, sort_order, is_active, id").order("sort_order"),
    supabase.from("fare_rules").select("category_id, currency").eq("is_active", true),
    supabase.rpc("admin_geofences"),
  ]);
  const pricedIn = (id: string) => [...new Set((rules ?? []).filter((r) => r.category_id === id).map((r) => r.currency))];
  const categories: (CategoryRow & { currencies: string[] })[] = (cats ?? []).map((c) => ({ ...c, priced: pricedIn(c.id).length > 0, currencies: pricedIn(c.id) }));

  return (
    <>
      <PageHeader title="Ride types & areas" />
      {(catError || areaError) && <Alert tone="danger" className="mb-4">{(catError ?? areaError)!.message}</Alert>}

      <h2 className="mb-2 font-semibold">Ride types</h2>
      <Table head={["Order", "Ride type", "Seats", "Priced in", "Status", ""]}>
        {categories.map((c) => (
          <tr key={c.code}>
            <Td className="text-muted">{c.sort_order}</Td>
            <Td>{c.name} <code className="text-muted text-xs">{c.code}</code><span className="text-muted block text-xs">{c.description}</span></Td>
            <Td>{c.seats}</Td>
            <Td>{c.currencies.length ? c.currencies.join(", ") : <Badge tone="warn">no fare rule</Badge>}</Td>
            <Td>{c.is_active ? <Badge tone="ok">offered</Badge> : <Badge>off</Badge>}</Td>
            <Td>{canEdit && <CategoryEditor category={c} />}</Td>
          </tr>
        ))}
      </Table>
      {canEdit && <div className="mt-2"><CategoryEditor category={null} /></div>}
      <p className="text-muted mt-2 text-xs">
        A ride type can be offered only once it has an active fare rule (Fares &amp; config). Switching one off hides it from new
        bookings; rides already in progress are not affected.
      </p>

      <h2 className="mb-2 mt-8 font-semibold">Service areas &amp; zones</h2>
      {canEdit
        ? <AreasPanel areas={(areas ?? []) as AreaRow[]} />
        : <Alert tone="info">Only administrators can change areas.</Alert>}
    </>
  );
}
