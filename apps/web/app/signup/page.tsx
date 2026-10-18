import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth-form";
import { signup } from "@/lib/auth-actions";
import { getSessionUser } from "@/lib/session";

export default async function SignupPage() {
  if (await getSessionUser()) redirect("/stores");
  return <AuthForm mode="signup" action={signup} />;
}
