import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth-shell";
import { readMfaChallenge } from "@/lib/session";
import { VerifyForm } from "./verify-form";

export const metadata = { title: "Two-factor sign-in" };

export default async function VerifyPage() {
  if (!(await readMfaChallenge())) redirect("/login");
  return (
    <AuthShell title="Enter your code" lead="Open your authenticator app and type the 6-digit code for Store Ops Agent.">
      <VerifyForm />
    </AuthShell>
  );
}
