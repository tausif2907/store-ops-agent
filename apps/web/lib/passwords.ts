import { z } from "zod";

/** The one password rule: sign-up, reset and change. */
export const PASSWORD_RULE = z.string().min(10, "Use at least 10 characters").max(200);
