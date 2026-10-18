"use server";

import bcrypt from "bcryptjs";
import { redirect } from "next/navigation";
import { z } from "zod";
import { EmailTakenError, createUser, findUserForLogin } from "@store-ops/db";
import { endSession, startSession } from "./session";

export interface FormState {
  error?: string;
}

const SignupInput = z.object({
  name: z.string().trim().min(1, "Enter your name").max(100),
  email: z.email("Enter a valid email").max(200),
  password: z.string().min(10, "Use at least 10 characters").max(200),
});

const LoginInput = z.object({
  email: z.email("Enter a valid email"),
  password: z.string().min(1, "Enter your password"),
});

// Compared against when the email is unknown, so timing does not reveal which emails exist.
let dummyHash: Promise<string> | undefined;
const getDummyHash = () => (dummyHash ??= bcrypt.hash("not-a-real-password", 12));

export async function signup(_prev: FormState, form: FormData): Promise<FormState> {
  const parsed = SignupInput.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0]!.message };
  const { name, email, password } = parsed.data;
  let id: string;
  try {
    id = await createUser(email, name, await bcrypt.hash(password, 12));
  } catch (err) {
    if (err instanceof EmailTakenError) return { error: err.message };
    throw err;
  }
  await startSession({ id, name });
  redirect("/stores");
}

export async function login(_prev: FormState, form: FormData): Promise<FormState> {
  const parsed = LoginInput.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0]!.message };
  const user = await findUserForLogin(parsed.data.email);
  const ok = await bcrypt.compare(parsed.data.password, user?.password_hash ?? (await getDummyHash()));
  if (!user || !ok) return { error: "Wrong email or password" };
  await startSession({ id: user.id, name: user.name });
  redirect("/stores");
}

export async function logout(): Promise<void> {
  await endSession();
  redirect("/login");
}
