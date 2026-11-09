"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Upload } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { userMessage } from "@/lib/errors";
import { Alert, Badge, Button, Card, CardTitle, Field, Input, Select } from "@/components/ui";

interface DriverRow { status: string; licence_number: string; licence_expiry: string | null; date_of_birth: string | null; address_text: string | null }
interface VehicleRow { id: string; make: string; model: string; year: number | null; color: string; plate_number: string; status: string; category: string }
interface DocRow { id: string; doc_type: string; status: string; review_note: string | null }

const DOCS: { type: string; label: string; required: boolean; vehicle?: boolean }[] = [
  { type: "driver_licence", label: "Driver licence (front)", required: true },
  { type: "vehicle_registration", label: "Vehicle registration", required: true, vehicle: true },
  { type: "insurance", label: "Insurance certificate", required: false, vehicle: true },
  { type: "national_id", label: "National ID", required: false },
  { type: "profile_photo", label: "Profile photo (your face)", required: false },
  { type: "vehicle_photo", label: "Vehicle photo (plate visible)", required: false, vehicle: true },
];
const MAX_BYTES = 10 * 1024 * 1024;
const MIME = ["image/jpeg", "image/png", "image/webp", "application/pdf"];

export function DriverRegistration({ userId, driver, fullName, categories, vehicles, documents }: {
  userId: string; driver: DriverRow | null; fullName: string; categories: { code: string; name: string }[];
  vehicles: VehicleRow[]; documents: DocRow[];
}) {
  const router = useRouter();
  const supabase = createClient();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // Step 1
  const [name, setName] = useState(fullName);
  const [licence, setLicence] = useState(driver?.licence_number ?? "");
  const [expiry, setExpiry] = useState(driver?.licence_expiry ?? "");
  const [dob, setDob] = useState(driver?.date_of_birth ?? "");
  const [address, setAddress] = useState(driver?.address_text ?? "");
  // Step 2
  const [cat, setCat] = useState(categories[0]?.code ?? "car");
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [year, setYear] = useState("");
  const [color, setColor] = useState("");
  const [plate, setPlate] = useState("");

  const vehicle = vehicles[0] ?? null;

  async function saveDetails(e: React.FormEvent) {
    e.preventDefault();
    setBusy("details");
    setError(null);
    const { error } = await supabase.rpc("register_driver", {
      p_full_name: name, p_licence_number: licence, p_licence_expiry: expiry || null, p_date_of_birth: dob || null, p_address_text: address || null,
    });
    setBusy(null);
    if (error) return setError(userMessage(error, error.code === "23505" ? "That licence number is already registered." : undefined));
    router.refresh();
  }

  async function saveVehicle(e: React.FormEvent) {
    e.preventDefault();
    setBusy("vehicle");
    setError(null);
    const { error } = await supabase.rpc("register_vehicle", {
      p_category_code: cat, p_make: make, p_model: model, p_year: year ? Number(year) : null, p_color: color, p_plate_number: plate, p_registration_number: null,
    });
    setBusy(null);
    if (error) return setError(error.code === "23505" ? "That plate number is already registered." : userMessage(error));
    router.refresh();
  }

  async function upload(docType: string, file: File, forVehicle: boolean) {
    setError(null);
    if (!MIME.includes(file.type)) return setError("Upload a JPG, PNG, WebP or PDF.");
    if (file.size > MAX_BYTES) return setError("File is larger than 10 MB.");
    setBusy(docType);
    const ext = file.type === "application/pdf" ? "pdf" : file.type.split("/")[1];
    const path = `${userId}/${docType}-${crypto.randomUUID()}.${ext}`;
    const up = await supabase.storage.from("driver-documents").upload(path, file, { contentType: file.type, upsert: false });
    if (up.error) {
      setBusy(null);
      return setError("Upload failed. Check your connection and try again.");
    }
    const { error } = await supabase.rpc("submit_driver_document", {
      p_doc_type: docType, p_storage_path: path, p_mime_type: file.type,
      p_vehicle_id: forVehicle ? vehicle?.id ?? null : null, p_document_number: null, p_expires_at: null,
    });
    setBusy(null);
    if (error) return setError(userMessage(error));
    router.refresh();
  }

  const latest = (t: string) => documents.find((d) => d.doc_type === t);

  return (
    <div className="space-y-4">
      {error && <Alert tone="danger">{error}</Alert>}

      <Card>
        <CardTitle className="flex items-center gap-2">1. Your details {driver && <CheckCircle2 className="h-4 w-4 text-ok-500" />}</CardTitle>
        <form onSubmit={saveDetails} className="mt-3 space-y-3">
          <Field label="Full name (as on licence)" htmlFor="n"><Input id="n" value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} /></Field>
          <Field label="Driver licence number" htmlFor="l"><Input id="l" value={licence} onChange={(e) => setLicence(e.target.value.toUpperCase())} required minLength={3} maxLength={40} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Licence expiry" htmlFor="x"><Input id="x" type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} required /></Field>
            <Field label="Date of birth" htmlFor="d"><Input id="d" type="date" value={dob} onChange={(e) => setDob(e.target.value)} required /></Field>
          </div>
          <Field label="Home area" htmlFor="a" hint="e.g. Sinkor, Paynesville, Congo Town"><Input id="a" value={address} onChange={(e) => setAddress(e.target.value)} maxLength={300} /></Field>
          <Button type="submit" loading={busy === "details"}>{driver ? "Update details" : "Save and continue"}</Button>
        </form>
      </Card>

      <Card className={!driver ? "opacity-50" : ""} aria-disabled={!driver}>
        <CardTitle className="flex items-center gap-2">2. Your vehicle {vehicle && <CheckCircle2 className="h-4 w-4 text-ok-500" />}</CardTitle>
        {vehicle ? (
          <p className="mt-2 text-sm">
            {vehicle.color} {vehicle.make} {vehicle.model} {vehicle.year ?? ""} · <span className="font-mono">{vehicle.plate_number}</span>{" "}
            <Badge tone={vehicle.status === "approved" ? "ok" : vehicle.status === "rejected" ? "danger" : "warn"}>{vehicle.status}</Badge>
          </p>
        ) : driver ? (
          <form onSubmit={saveVehicle} className="mt-3 space-y-3">
            <Field label="Type" htmlFor="c">
              <Select id="c" value={cat} onChange={(e) => setCat(e.target.value)}>
                {categories.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
              </Select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Make" htmlFor="mk"><Input id="mk" value={make} onChange={(e) => setMake(e.target.value)} placeholder="Toyota" required /></Field>
              <Field label="Model" htmlFor="md"><Input id="md" value={model} onChange={(e) => setModel(e.target.value)} placeholder="Corolla" required /></Field>
              <Field label="Year" htmlFor="y"><Input id="y" inputMode="numeric" value={year} onChange={(e) => setYear(e.target.value.replace(/\D/g, "").slice(0, 4))} /></Field>
              <Field label="Colour" htmlFor="co"><Input id="co" value={color} onChange={(e) => setColor(e.target.value)} required /></Field>
            </div>
            <Field label="Plate number" htmlFor="p"><Input id="p" value={plate} onChange={(e) => setPlate(e.target.value.toUpperCase())} required maxLength={20} /></Field>
            <Button type="submit" loading={busy === "vehicle"}>Save vehicle</Button>
          </form>
        ) : <p className="text-muted mt-2 text-sm">Complete step 1 first.</p>}
      </Card>

      <Card className={!vehicle ? "opacity-50" : ""} aria-disabled={!vehicle}>
        <CardTitle>3. Documents</CardTitle>
        <p className="text-muted mt-1 text-xs">Clear photos in good light. Files are private — only you and LiberiaRide reviewers can see them.</p>
        <ul className="mt-3 space-y-2">
          {DOCS.map((d) => {
            const doc = latest(d.type);
            return (
              <li key={d.type} className="flex items-center gap-2 rounded-xl border border-line p-2">
                <div className="flex-1 text-sm">
                  <p className="font-medium">{d.label} {d.required && <span className="text-signal-600">*</span>}</p>
                  {doc && <Badge tone={doc.status === "approved" ? "ok" : doc.status === "rejected" ? "danger" : "warn"}>{doc.status}</Badge>}
                  {doc?.status === "rejected" && doc.review_note && <p className="mt-1 text-xs text-signal-600">{doc.review_note}</p>}
                </div>
                <label className={`flex cursor-pointer items-center gap-1 rounded-lg border border-line px-3 py-2 text-xs font-semibold ${!vehicle ? "pointer-events-none" : ""}`}>
                  <Upload className="h-4 w-4" /> {busy === d.type ? "Uploading…" : doc ? "Replace" : "Upload"}
                  <input type="file" accept={MIME.join(",")} capture="environment" className="sr-only" disabled={!vehicle || busy !== null}
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(d.type, f, Boolean(d.vehicle)); e.target.value = ""; }} />
                </label>
              </li>
            );
          })}
        </ul>
      </Card>

      {driver && vehicle && latest("driver_licence") && latest("vehicle_registration") && (
        <Alert tone="ok" title="Application submitted">We&apos;ll notify you when your account is approved.</Alert>
      )}
    </div>
  );
}
