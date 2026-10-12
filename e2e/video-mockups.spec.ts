import { expect, test } from "@playwright/test";

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
  await expect(page.getByRole("status")).toContainText("Video ready", { timeout: 30_000 });

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("link", { name: "Download e2e-team-mockup.webm" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("e2e-team-mockup.webm");
});
