import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { TripTracker, type BookingView } from "@/components/passenger/trip-tracker";

export const metadata = { title: "Your trip" };

export default async function TripPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser(`/passenger/trip/${id}`);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_booking_view", { p_booking_id: id });
  if (error || !data) notFound();
  const view = data as BookingView;
  if (view.passenger !== null && view.passenger !== undefined) notFound(); // not the passenger of this booking

  const [{ data: bids }, { data: conversation }, { data: rating }] = await Promise.all([
    supabase.from("booking_bids").select("id, party, amount_minor, currency, status, expires_at, driver_id")
      .eq("booking_id", id).eq("party", "driver").eq("status", "open"),
    supabase.from("chat_conversations").select("id, closed_at").eq("booking_id", id).maybeSingle(),
    supabase.from("ratings").select("score").eq("booking_id", id).eq("rater_id", user.id).maybeSingle(),
  ]);

  return (
    <TripTracker
      initial={view}
      userId={user.id}
      initialBids={bids ?? []}
      conversationId={conversation?.id ?? null}
      alreadyRated={Boolean(rating)}
      siteUrl={process.env.NEXT_PUBLIC_SITE_URL ?? ""}
    />
  );
}
