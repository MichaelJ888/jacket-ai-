import { expect, test } from "@playwright/test";

test("published payment QR, apparel reference gallery, and live design preview work", async ({ page }) => {
  test.setTimeout(60_000);
  const testQr = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 128 128'%3E%3Crect width='128' height='128' fill='white'/%3E%3Cpath d='M8 8h40v40H8zm72 0h40v40H80zM8 80h40v40H8zM64 64h16v16H64zm32 32h24v24H96z' fill='black'/%3E%3C/svg%3E";
  await page.route("**/api/site/overlay", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ overlay: { paymentQR: { gcash: testQr } }, seo: null, publicKeys: ["paymentQR"] }),
    }),
  );

  await page.goto("/");
  const checkout = page.locator("#quote");

  await checkout.getByRole("button", { name: "View full-size QR" }).click();
  const paymentDialog = page.getByRole("dialog", { name: "GCash payment QR" });
  await expect(paymentDialog).toBeVisible();
  await paymentDialog.getByRole("button", { name: "Close" }).click();

  const productCard = page.locator("#catalog .group").filter({ hasText: "Classic Letterman Varsity Jacket" }).first();
  await productCard.getByRole("button", { name: "View Gallery & Details" }).click();
  await expect(page.getByText("Additional photos are category references; they are not verified alternate angles of this exact item.")).toBeVisible();
  await expect(page.locator('button[aria-label^="Show reference photo"]')).toHaveCount(5);
  await page.locator("body").press("Escape");

  const mockup = page.locator("#mockup");
  await mockup.locator("select").first().selectOption({ label: "Classic Letterman Varsity Jacket" });
  await expect(mockup.getByText("Price per piece")).toBeVisible();
  await expect(mockup.getByText("Total", { exact: true })).toBeVisible();
  await page.locator('#fabrics button[title="Black"]').first().click();
  await expect(page.getByText("Microfiber — Black selected.")).toBeVisible();
});
