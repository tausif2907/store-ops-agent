import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth-form";
import { login } from "@/lib/auth-actions";
import { getSessionUser } from "@/lib/session";

export default async function LoginPage() {
  if (await getSessionUser()) redirect("/stores");
  return <AuthForm mode="login" action={login} />;
}
