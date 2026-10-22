/**
 * Runs once when the dashboard server starts. In production it refuses to
 * start with missing or weak secrets, development defaults, or the
 * private-address switch that only local development may use.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NODE_ENV !== "production") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return; // a build is not a server
  const problems: string[] = [];
  const need = (name: string, minLength: number) => {
    const value = process.env[name];
    if (!value) problems.push(`${name} is not set`);
    else if (value.length < minLength) problems.push(`${name} must be at least ${minLength} characters`);
  };
  need("SESSION_SECRET", 32);
  need("APPROVAL_LINK_SECRET", 32);
  need("CREDENTIALS_ENCRYPTION_KEY", 44);
  need("AGENT_INTERNAL_TOKEN", 32);
  need("APP_DATABASE_URL", 1);
  need("APP_URL", 1);

  if (process.env.APP_DATABASE_URL?.includes(":storeops_app@")) problems.push("APP_DATABASE_URL uses the local development password");
  if (process.env.ALLOW_PRIVATE_STORE_HOSTS === "1") problems.push("ALLOW_PRIVATE_STORE_HOSTS must not be set in production");
  const appUrl = process.env.APP_URL ?? "";
  if (appUrl && !appUrl.startsWith("https://") && !/^http:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(appUrl)) {
    problems.push("APP_URL must be an https:// address");
  }
  if (!process.env.RESEND_API_KEY) console.warn("RESEND_API_KEY is not set: password resets and approval emails will not be sent.");

  if (problems.length) throw new Error(`Refusing to start in production:\n- ${problems.join("\n- ")}`);
}
