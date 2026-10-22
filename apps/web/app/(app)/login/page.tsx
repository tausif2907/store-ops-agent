import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth-form";
import { AuthShell } from "@/components/auth-shell";
import { login } from "@/lib/auth-actions";
import { getSessionUser } from "@/lib/session";

export const metadata = { title: "Log in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ reset?: string }> }) {
  if (await getSessionUser()) redirect("/stores");
  const { reset } = await searchParams;
  return (
    <AuthShell title="Welcome back" lead="Log in to your stores.">
      <AuthForm mode="login" action={login} notice={reset ? "Your password has been changed. Log in with the new one." : undefined} />
    </AuthShell>
  );
}
