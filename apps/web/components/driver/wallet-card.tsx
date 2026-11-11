import Link from "next/link";
import { formatDateTime, money } from "@/lib/utils";
import { Alert, Badge, Card } from "@/components/ui";

export interface DriverWallet {
  blocked: boolean;
  balances: { currency: string; balance_minor: number; limit_minor: number | null }[];
  entries: { id: string; kind: string; currency: string; amount_minor: number; method: string | null; note: string | null; created_at: string }[];
}

const ENTRY_LABEL: Record<string, string> = { topup: "Top-up", cancellation_fee: "Cancellation fee", adjustment: "Adjustment" };

/** What the driver owes LiberiaRide (cash-trip commission) or is owed (mobile-money trips, fees), per currency. */
export function WalletCard({ wallet }: { wallet: DriverWallet }) {
  return (
    <Card className="space-y-3 p-3">
      <p className="font-semibold">Balance with LiberiaRide</p>
      {wallet.blocked && (
        <Alert tone="danger" title="You owe more than the limit">
          You can&apos;t go online or get new rides until you pay. Pay at the LiberiaRide office or by mobile money, then give
          operations your receipt number so they can record it.
        </Alert>
      )}
      <ul className="space-y-2">
        {wallet.balances.map((b) => {
          const owes = b.balance_minor < 0;
          const over = owes && b.limit_minor !== null && -b.balance_minor > b.limit_minor;
          return (
            <li key={b.currency} className="flex items-center justify-between text-sm">
              <span>
                {b.balance_minor === 0 ? <span className="text-muted">Nothing owed</span>
                  : owes ? <>You owe <strong>{money(-b.balance_minor, b.currency)}</strong></>
                  : <>LiberiaRide owes you <strong>{money(b.balance_minor, b.currency)}</strong></>}
                {b.limit_minor !== null && <span className="text-muted block text-xs">Limit {money(b.limit_minor, b.currency)} owed</span>}
              </span>
              <Badge tone={over ? "danger" : owes ? "warn" : "ok"}>{b.currency}</Badge>
            </li>
          );
        })}
      </ul>
      <p className="text-muted text-xs">
        Cash trips: you keep the fare and owe the commission. Mobile-money trips: LiberiaRide receives the fare and owes you your
        share. Cancellation fees you earned and your payments to LiberiaRide appear below.
      </p>
      {wallet.entries.length > 0 && (
        <ul className="divide-y divide-[var(--line)] text-sm">
          {wallet.entries.map((e) => (
            <li key={e.id} className="flex justify-between py-1.5">
              <span>{ENTRY_LABEL[e.kind] ?? e.kind}<span className="text-muted block text-xs">{formatDateTime(e.created_at)}{e.note ? ` · ${e.note}` : ""}</span></span>
              <span className={e.amount_minor > 0 ? "text-ok-500 tabular-nums" : "tabular-nums"}>{e.amount_minor > 0 ? "+" : "−"}{money(Math.abs(e.amount_minor), e.currency)}</span>
            </li>
          ))}
        </ul>
      )}
      <Link href="/notifications" className="text-xs text-brand-600 underline">Payment confirmations arrive in Notifications</Link>
    </Card>
  );
}
