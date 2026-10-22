import { expect, test } from "@playwright/test";
import { E2E_COUPON } from "../scripted-model";

/**
 * The launch path, as a new owner sees it: land, sign up, connect a store,
 * read the first digest, ask the agent for a change, approve it, and find it
 * in the activity log.
 */
test("a new owner goes from sign-up to a first digest and an approved change", async ({ page }) => {
  const email = `owner-${Date.now()}@e2e.test`;

  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("within rules you set");
  await page.getByRole("link", { name: "Connect your store" }).click();

  // 1. Account
  await expect(page).toHaveURL(/\/signup$/);
  const signedUpAt = Date.now();
  await page.getByLabel("Name").fill("Asha Owner");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("e2e-owner-pass-2026");
  await page.getByRole("button", { name: "Create account" }).click();

  // 2. Connect: straight into onboarding
  await expect(page).toHaveURL(/\/stores\/new$/);
  await expect(page.getByRole("list", { name: "Getting started" })).toBeVisible();
  await page.getByRole("button", { name: /Supabase/ }).click();
  await page.getByLabel("Store name").fill("E2E Boutique");
  await page.getByLabel("Agent role connection string").fill(process.env.BOUTIQUE_AGENT_URL!);
  await page.getByRole("button", { name: "Test and connect" }).click();

  // 3. The first digest, written by the job worker from the store's own data
  // The dev server compiles the page on its first visit, so allow for that.
  await expect(page).toHaveURL(/\/stores\/[0-9a-f-]+\/welcome/, { timeout: 60_000 });
  await expect(page.getByRole("heading", { name: "E2E Boutique is connected" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Your first morning digest" })).toBeVisible({ timeout: 90_000 });
  await expect(page.getByText(/Yesterday brought \d+ orders worth ₹/)).toBeVisible();
  await expect(page.getByText(/Ready .* after you signed up/)).toBeVisible();
  expect(Date.now() - signedUpAt, "sign-up to first digest").toBeLessThan(5 * 60_000);
  await expect(page.getByText("Change stock levels, after you approve")).toBeVisible();

  // Ask for a change: it waits for the owner
  await page.getByRole("link", { name: "Ask the agent", exact: true }).click();
  await page.getByLabel("Message").fill(`Create a coupon ${E2E_COUPON.code} for 15% off, 50 uses`);
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText(`The coupon ${E2E_COUPON.code} (15% off, up to 50 uses) is waiting for your approval.`)).toBeVisible();
  await expect(page.getByRole("link", { name: /waiting for your approval/ })).toBeVisible();

  // Approve it
  await page.getByRole("navigation", { name: "Store sections" }).getByRole("link", { name: /Approvals/ }).click();
  await expect(page.getByText(`Create coupon ${E2E_COUPON.code}: 15% off, up to 50 uses`)).toBeVisible();
  await page.getByRole("button", { name: "Approve" }).click();
  // The page refreshes: the change leaves "Waiting for you" and is listed as executed.
  await expect(page.getByText("Nothing to approve.")).toBeVisible();
  await expect(page.getByRole("row", { name: new RegExp(`Create coupon ${E2E_COUPON.code}.*executed`) })).toBeVisible();

  // On the record
  await page.getByRole("navigation", { name: "Store sections" }).getByRole("link", { name: "Activity" }).click();
  await expect(page.getByText("Coupon created")).toBeVisible();
  await expect(page.getByText("by you (approved)")).toBeVisible();
  await expect(page.getByText("Store connected")).toBeVisible();
});

test("signed-out visitors see the landing page, and store pages ask them to log in", async ({ page }) => {
  await page.goto("/stores");
  await expect(page).toHaveURL(/\/login$/);
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Get started" }).first()).toBeVisible();
  await expect(page.getByText("Safe by design")).toBeVisible();
});
