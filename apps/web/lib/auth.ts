import "server-only";
import { redirect } from "next/navigation";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

export type AppRole = "passenger" | "driver" | "fleet_operator" | "support_agent" | "admin" | "super_admin";

export interface SessionUser {
  id: string;
  phone: string | null;
  email: string | null;
  fullName: string | null;
  roles: AppRole[];
  isSuspended: boolean;
}

/** Verified user for this request (JWT validated with Supabase Auth), or null. Cached per request. */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  const [{ data: roles }, { data: profile }] = await Promise.all([
    supabase.from("user_roles").select("role").eq("user_id", data.user.id),
    supabase.from("profiles").select("full_name, phone, email, is_suspended").eq("id", data.user.id).maybeSingle(),
  ]);
  return {
    id: data.user.id,
    phone: profile?.phone ?? data.user.phone ?? null,
    email: profile?.email ?? data.user.email ?? null,
    fullName: profile?.full_name ?? null,
    roles: (roles ?? []).map((r) => r.role as AppRole),
    isSuspended: Boolean(profile?.is_suspended),
  };
});

export async function requireUser(next: string): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(next)}`);
  if (user.isSuspended) redirect("/suspended");
  return user;
}

export const STAFF_ROLES: AppRole[] = ["support_agent", "admin", "super_admin"];

export function hasAnyRole(user: SessionUser, roles: AppRole[]): boolean {
  return user.roles.some((r) => roles.includes(r));
}

export async function requireStaff(next: string): Promise<SessionUser> {
  const user = await requireUser(next);
  if (!hasAnyRole(user, STAFF_ROLES)) redirect("/forbidden");
  return user;
}
