import Link from "next/link";
import { buttonVariants } from "@/components/ui";

export const metadata = { title: "Not allowed" };

export default function Forbidden() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-4 px-5">
      <h1 className="text-2xl font-bold">You don&apos;t have access to this area</h1>
      <p className="text-muted text-sm">This section is for LiberiaRide operations staff. If you think this is wrong, contact an administrator.</p>
      <Link href="/" className={buttonVariants({ variant: "secondary" })}>Go home</Link>
    </main>
  );
}
