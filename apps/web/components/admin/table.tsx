import { cn } from "@/lib/utils";

export function Table({ head, children, className }: { head: string[]; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("surface overflow-x-auto rounded-xl border border-line", className)}>
      <table className="w-full text-left text-sm">
        <thead className="text-muted border-b border-line text-xs uppercase tracking-wide">
          <tr>{head.map((h) => <th key={h} scope="col" className="whitespace-nowrap px-3 py-2 font-semibold">{h}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-[var(--line)]">{children}</tbody>
      </table>
    </div>
  );
}

export function Td({ children, className }: { children?: React.ReactNode; className?: string }) {
  return <td className={cn("whitespace-nowrap px-3 py-2 align-top", className)}>{children}</td>;
}

export function PageHeader({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
      <h1 className="text-xl font-bold">{title}</h1>
      {children}
    </div>
  );
}
