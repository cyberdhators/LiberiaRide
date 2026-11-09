import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Alert, Badge, buttonVariants, Card } from "@/components/ui";
import { DriverConsole, type DriverDashboard } from "@/components/driver/driver-console";

export const metadata = { title: "Driver" };

const DOC_LABEL: Record<string, string> = {
  driver_licence: "Driver licence", vehicle_registration: "Vehicle registration", insurance: "Insurance",
  national_id: "National ID", profile_photo: "Profile photo", vehicle_photo: "Vehicle photo", other: "Other",
};

export default async function DriverHome() {
  const user = await requireUser("/driver");
  const supabase = await createClient();
  const { data } = await supabase.rpc("driver_dashboard");
  const dash = data as DriverDashboard | null;
  if (!dash) redirect("/driver/register");

  if (dash.status !== "approved") {
    return (
      <main className="mx-auto max-w-lg space-y-4 p-4">
        <h1 className="text-xl font-bold">Driver account</h1>
        {dash.status === "pending" && (
          <Alert tone="info" title="Your application is under review">
            We check your licence, vehicle registration and vehicle before you can go online. This usually takes 1–2 working days.
          </Alert>
        )}
        {dash.status === "rejected" && (
          <Alert tone="warn" title="Your application needs changes">{dash.review_note ?? "Please update your details and documents."}</Alert>
        )}
        {dash.status === "suspended" && (
          <Alert tone="danger" title="Your driver account is suspended">{dash.review_note ?? "Contact LiberiaRide operations."}</Alert>
        )}
        <Card>
          <p className="font-semibold">Checklist</p>
          <ul className="mt-2 space-y-1 text-sm">
            <li className="flex justify-between">Vehicle {dash.vehicle ? <Badge tone={dash.vehicle.status === "approved" ? "ok" : dash.vehicle.status === "rejected" ? "danger" : "warn"}>{dash.vehicle.status}</Badge> : <Badge tone="danger">missing</Badge>}</li>
            {["driver_licence", "vehicle_registration"].map((t) => {
              const d = dash.documents.find((x) => x.doc_type === t);
              return (
                <li key={t} className="flex justify-between">{DOC_LABEL[t]}
                  {d ? <Badge tone={d.status === "approved" ? "ok" : d.status === "rejected" ? "danger" : "warn"}>{d.status}</Badge> : <Badge tone="danger">missing</Badge>}
                </li>
              );
            })}
          </ul>
          {dash.documents.filter((d) => d.status === "rejected" && d.review_note).map((d) => (
            <p key={d.id} className="mt-2 text-xs text-signal-600">{DOC_LABEL[d.doc_type]}: {d.review_note}</p>
          ))}
        </Card>
        {dash.status !== "suspended" && (
          <Link href="/driver/register" className={buttonVariants({ variant: "secondary", className: "w-full" })}>Update details & documents</Link>
        )}
      </main>
    );
  }

  return <DriverConsole initial={dash} userId={user.id} />;
}
