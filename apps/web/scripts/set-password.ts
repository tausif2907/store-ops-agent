/**
 * Sets a new password for an account, for when an owner is locked out
 * (there is no reset-by-email flow yet). The password is typed at a hidden
 * prompt, never passed on the command line or shown.
 *
 *   pnpm user:set-password owner@example.com
 */
import bcrypt from "bcryptjs";
import { basePrisma, setUserPasswordHash } from "@store-ops/db";

const MIN_LENGTH = 10; // the same rule as sign-up

/** Reads a line from the terminal without echoing it. */
function hidden(prompt: string): Promise<string> {
  const { stdin, stdout } = process;
  return new Promise((resolve, reject) => {
    stdout.write(prompt);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    let value = "";
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n") {
          done();
          return resolve(value);
        }
        if (ch === "\u0003") {
          done();
          return reject(new Error("Cancelled"));
        }
        if (ch === "\u007f" || ch === "\b") value = value.slice(0, -1);
        else if (ch >= " ") value += ch;
      }
    };
    const done = () => {
      stdin.off("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
      stdout.write("\n");
    };
    stdin.on("data", onData);
  });
}

const email = process.argv[2]?.trim();
if (!email) {
  console.error("Usage: pnpm user:set-password <email>");
  process.exit(1);
}
if (!process.stdin.isTTY) {
  console.error("Run this in an interactive terminal (PowerShell, Windows Terminal or cmd) so the password can be typed hidden.");
  process.exit(1);
}

try {
  const password = await hidden(`New password for ${email}: `);
  if (password.length < MIN_LENGTH) throw new Error(`Use at least ${MIN_LENGTH} characters.`);
  if ((await hidden("Type it again: ")) !== password) throw new Error("The two passwords did not match. Nothing was changed.");
  if (!(await setUserPasswordHash(email, await bcrypt.hash(password, 12)))) throw new Error(`No account has the email ${email}.`);
  console.log(`Password updated for ${email}. Log in with it now.`);
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
} finally {
  await basePrisma().$disconnect();
}
