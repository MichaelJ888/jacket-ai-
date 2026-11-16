import { expect, test } from "@playwright/test";

test("editor previews and publishes hero text, image, and CTA destination", async ({ page }) => {
  test.setTimeout(90_000);
  let published = { theme: { primary: "#0B1E3D", secondary: "#B8912F", background: "#FFFFFF", bgImage: "", bgOpacity: 15 }, texts: {}, images: {}, links: {}, catalogOrder: [], sectionOrder: [], positions: {}, styles: {}, updatedAt: null };
  await page.route("**/api/admin/editor", async (route) => {
    if (route.request().method() === "POST") {
      published = route.request().postDataJSON();
      await route.fulfill({ json: { ok: true } });
    } else {
      await route.fulfill({ json: { doc: published } });
    }
  });
  await page.route("**/api/site", (route) => route.fulfill({ json: published }));
  await page.route("**/image-library.json", (route) => route.fulfill({ json: { items: [{ src: "/branding/mjic-official-logo-source.jpg", label: "Test banner" }] } }));
  await page.goto("/admin/editor");
  await page.getByRole("button", { name: "Edit links" }).click();
  const preview = page.frameLocator('iframe[title="Live page editor"]');
  const cta = preview.getByRole("link", { name: "Browse Catalog", exact: true }).first();
  await expect(cta).toBeVisible({ timeout: 45_000 });
  page.once("dialog", (dialog) => dialog.accept("/quote"));
  await cta.click();
  await expect(cta).toHaveAttribute("href", "/quote");
  await page.getByRole("button", { name: "Done editing links" }).click();
  const heroTitle = preview.locator('[x-text="siteSettings.heroTitle"]');
  await expect(heroTitle).toHaveAttribute("contenteditable", "true");
  await heroTitle.fill("Updated hero title");
  const heroImage = preview.locator('img[alt="Custom jacket sample"]').last();
  await heroImage.click();
  await preview.locator('[data-cms-picker] button[title="Test banner"]').click({ timeout: 10_000 });
  await expect(heroImage).toHaveAttribute("src", "/branding/mjic-official-logo-source.jpg");
  await page.getByRole("button", { name: "Publish Changes" }).click();
  await expect(page.getByText("Published. Live visitors see the update within about 20 seconds.")).toBeVisible();
  expect(Object.values(published.links)).toContain("/quote");
  expect(Object.values(published.texts)).toContain("Updated hero title");
  expect(Object.values(published.images)).toContain("/branding/mjic-official-logo-source.jpg");
  await page.goto("/index.html");
  await expect(page.getByRole("link", { name: "Browse Catalog", exact: true }).first()).toHaveAttribute("href", "/quote");
  await expect(page.locator('[x-text="siteSettings.heroTitle"]')).toHaveText("Updated hero title");
  await expect(page.locator('img[alt="Custom jacket sample"]').last()).toHaveAttribute("src", "/branding/mjic-official-logo-source.jpg");
});
