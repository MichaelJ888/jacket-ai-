import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

test("admin can render and download a local jacket video mockup", async ({ page }) => {
  test.setTimeout(60_000);
  await page.route("**/api/admin/prices", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "{}" }),
  );

  await page.goto("/admin/video-mockups");
  await expect(page.getByRole("heading", { name: "Local jacket video mockups" })).toBeVisible();
  await page.getByLabel("Admin password").fill("playwright-ci-token");
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page.getByRole("heading", { name: "Jacket video mockups" })).toBeVisible();
  await page.getByLabel("Client or team name").fill("E2E Team");
  await page.getByLabel("Product label", { exact: true }).fill("Corporate jackets");
  await page.getByLabel("Call to action", { exact: true }).fill("Message MJIC today");
  const artworkBytes = await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 32;
    canvas.height = 32;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Could not create test artwork.");
    context.fillStyle = "#234";
    context.fillRect(0, 0, canvas.width, canvas.height);
    const image = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Could not encode test artwork."))), "image/png");
    });
    return Array.from(new Uint8Array(await image.arrayBuffer()));
  });
  await page.getByLabel("Finished jacket mockup (required)").setInputFiles({
    name: "mockup.png",
    mimeType: "image/png",
    buffer: Buffer.from(artworkBytes),
  });

  const renderButton = page.getByRole("button", { name: "Render local WebM" });
  await expect(renderButton).toBeEnabled();
  await renderButton.click();
  await expect(page.getByLabel("Product label", { exact: true })).toBeDisabled();
  await expect(page.getByLabel("Client or team name")).toBeDisabled();
  await expect(page.getByRole("status")).toContainText("Video ready", { timeout: 30_000 });

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("link", { name: "Download e2e-team-mockup.webm" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("e2e-team-mockup.webm");
  const path = await download.path();
  if (!path) throw new Error("Video download did not produce a file.");
  const bytes = await readFile(path);
  expect(bytes.byteLength).toBeGreaterThan(1000);
  expect([...bytes.subarray(0, 4)]).toEqual([0x1a, 0x45, 0xdf, 0xa3]);

  await page.getByLabel("Call to action", { exact: true }).fill("Request a proposal");
  await expect(page.getByRole("link", { name: "Download e2e-team-mockup.webm" })).toHaveCount(0);
});

test("campaign draft exports multiple account notes without generation or posting requests", async ({ page }) => {
  const apiRequests: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/")) apiRequests.push(new URL(request.url()).pathname);
  });
  await page.route("**/api/admin/prices", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "{}" }),
  );
  await page.goto("/admin/video-mockups");
  await page.getByLabel("Admin password").fill("playwright-ci-token");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Video ad campaign planner" })).toBeVisible();
  await page.getByLabel("Client or team name").fill("MJIC Sales");
  await page.getByLabel("Product label", { exact: true }).fill("Team uniforms");
  await page.getByLabel("Facebook Pages account labels", { exact: true }).fill("MJIC Main\nMJIC Sales\nMJIC Main");
  await page.getByLabel("Other social networks", { exact: true }).check();
  await page.getByLabel("Other social networks account labels", { exact: true }).fill("Pinterest @mjic\nX @mjic");
  await expect(page.getByTestId("campaign-caption")).toContainText("Team uniforms para sa MJIC Sales");

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download campaign draft JSON" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("mjic-sales-campaign-draft.json");
  const path = await download.path();
  if (!path) throw new Error("Campaign download did not produce a file.");
  const plan = JSON.parse(await readFile(path, "utf8"));
  expect(plan).toMatchObject({
    status: "DRAFT",
    approvalStatus: "NOT_SUBMITTED",
    publishingPolicy: "APPROVED_CAMPAIGNS_ONLY",
    autoPublishEligible: false,
    queuedForPublishing: false,
    rendering: { engine: "browser", durationSeconds: 8, audioIncluded: false },
  });
  expect(plan.targets.filter((target: { platform: string }) => target.platform === "facebook")).toHaveLength(2);
  expect(plan.targets.filter((target: { platform: string }) => target.platform === "other")).toEqual([
    expect.objectContaining({ accountLabel: "Pinterest @mjic", integration: "manual-export", accountVerified: false }),
    expect.objectContaining({ accountLabel: "X @mjic", integration: "manual-export", accountVerified: false }),
  ]);
  expect(apiRequests).toEqual(["/api/admin/prices"]);

  for (const label of ["Facebook Pages", "Instagram Business / Reels", "YouTube Shorts", "TikTok", "Other social networks"]) {
    await page.getByLabel(label, { exact: true }).uncheck();
  }
  await expect(page.getByRole("button", { name: "Download campaign draft JSON" })).toBeDisabled();
});
