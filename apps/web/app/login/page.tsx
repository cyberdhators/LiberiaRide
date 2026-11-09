import { Suspense } from "react";
import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-5 py-10">
      <h1 className="text-2xl font-bold tracking-tight">Sign in</h1>
      <p className="text-muted mt-1 text-sm">We&apos;ll send you a one-time code. No password needed.</p>
      <Suspense>
        <LoginForm />
      </Suspense>
    </main>
  );
}
