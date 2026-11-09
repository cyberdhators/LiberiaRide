"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { userMessage } from "@/lib/errors";
import { Button, type ButtonProps } from "@/components/ui";

/**
 * Calls a permission-checked, audited RPC as the signed-in operator, then refreshes
 * the server-rendered page. All authorisation happens in the database.
 */
export function RpcAction({ fn, args, label, confirm, prompt, promptArg, variant, size, onDone }: {
  fn: string;
  args: Record<string, unknown>;
  label: string;
  confirm?: string;
  /** Ask the operator for a reason; inserted into args[promptArg]. */
  prompt?: string;
  promptArg?: string;
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
  onDone?: () => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    if (confirm && !window.confirm(confirm)) return;
    let finalArgs = args;
    if (prompt && promptArg) {
      const reason = window.prompt(prompt);
      if (reason === null) return;
      finalArgs = { ...args, [promptArg]: reason };
    }
    setBusy(true);
    setError(null);
    const { error } = await createClient().rpc(fn, finalArgs);
    setBusy(false);
    if (error) return setError(userMessage(error));
    onDone?.();
    router.refresh();
  }

  return (
    <span className="inline-flex flex-col">
      <Button size={size ?? "sm"} variant={variant ?? "secondary"} loading={busy} onClick={run}>{label}</Button>
      {error && <span className="mt-1 max-w-56 text-xs text-signal-600">{error}</span>}
    </span>
  );
}
