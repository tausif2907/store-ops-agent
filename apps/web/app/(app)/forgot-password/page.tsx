import { AuthShell } from "@/components/auth-shell";
import { ForgotForm } from "./forgot-form";

export const metadata = { title: "Reset your password" };

export default function ForgotPasswordPage() {
  return (
    <AuthShell title="Reset your password" lead="Enter your account's email and we'll send you a link to choose a new password.">
      <ForgotForm />
    </AuthShell>
  );
}
