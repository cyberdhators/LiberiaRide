export const metadata = { title: "Account suspended" };

export default function Suspended() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-4 px-5">
      <h1 className="text-2xl font-bold">Your account is suspended</h1>
      <p className="text-muted text-sm">
        You can&apos;t book or drive while your account is under review. Please contact LiberiaRide support to resolve this.
      </p>
      <form action="/auth/signout" method="post">
        <button className="text-sm underline" type="submit">Sign out</button>
      </form>
    </main>
  );
}
