import { requireUser } from "@/lib/auth";
import { SupportForm } from "@/components/support-form";

export const metadata = { title: "Get help" };

export default async function SupportPage({ searchParams }: { searchParams: Promise<{ booking?: string }> }) {
  await requireUser("/passenger/support");
  const { booking } = await searchParams;
  return (
    <main className="mx-auto max-w-lg space-y-4 p-4">
      <h1 className="text-xl font-bold">Get help</h1>
      <SupportForm bookingId={booking && /^[0-9a-f-]{36}$/.test(booking) ? booking : null} />
    </main>
  );
}
