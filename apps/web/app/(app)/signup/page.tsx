import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth-form";
import { AuthShell } from "@/components/auth-shell";
import { signup } from "@/lib/auth-actions";
import { getSessionUser } from "@/lib/session";

export const metadata = { title: "Create your account" };

export default async function SignupPage() {
  if (await getSessionUser()) redirect("/stores");
  return (
    <AuthShell title="Create your account" lead="About five minutes to your first digest.">
      <AuthForm mode="signup" action={signup} />
    </AuthShell>
  );
}
