import { expect, test, type Page } from "@playwright/test";

async function signIn(page: Page, name: string) {
  await page.goto("/login");
  await page.getByRole("button", { name: new RegExp(name) }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}
async function signOut(page: Page) {
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL(/\/login/);
}

test("officer can manage inventory and meal slots; member access is denied", async ({
  page,
}) => {
  await signIn(page, "Sneha Iyer");
  await page.goto("/o/cyber-sec/inventory");
  const item = page
    .getByRole("heading", { name: "New item", exact: true })
    .locator("..");
  await item.getByLabel("Name", { exact: true }).fill("E2E meal boxes");
  await item.getByLabel("Initial stock").fill("3");
  await item.getByLabel("Reason").fill("Test delivery");
  await item.getByRole("button", { name: "Add item" }).click();
  await expect(item.getByRole("status")).toHaveText("Saved.");
  await expect(
    page.getByRole("row", { name: "E2E meal boxes 3", exact: true }),
  ).toBeVisible();
  const slot = page
    .getByRole("heading", { name: "Meal slot", exact: true })
    .locator("..");
  await slot
    .getByRole("combobox", { name: "Event", exact: true })
    .selectOption({ label: "CyberQuest CTF 2026" });
  await slot.getByLabel("Stock item").selectOption({ label: "E2E meal boxes" });
  await slot.getByLabel("Meal name").fill("E2E Lunch");
  await slot.getByRole("button", { name: "Create slot" }).click();
  await expect(slot.getByRole("status")).toHaveText("Saved.");
  await page.goto("/o/cyber-sec/scan");
  await page.getByRole("link", { name: /CyberQuest CTF/ }).click();
  await expect(
    page.getByRole("link", { name: "Meal: E2E Lunch", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("link", { name: "Meal: E2E Lunch", exact: true })
    .click();
  await expect(page.getByRole("button", { name: "Claim meal" })).toBeVisible();
  await signOut(page);
  await signIn(page, "Vikram Singh");
  const response = await page.goto("/o/cyber-sec/inventory");
  expect(response?.status()).toBe(404);
});

test("owner assigns a volunteer task; assignee completes it", async ({
  page,
}) => {
  await signIn(page, "Arjun Mehta");
  await page.goto("/o/cyber-sec/tasks");
  const create = page
    .getByRole("heading", { name: "Create task", exact: true })
    .locator("..");
  await create.getByLabel("Title", { exact: true }).fill("E2E arrange chairs");
  await create.getByLabel("Description").fill("Arrange the front row.");
  await create
    .getByRole("button", { name: "Create task", exact: true })
    .click();
  await expect(create.getByRole("status")).toHaveText("Saved.");
  const task = page
    .getByRole("heading", { name: "E2E arrange chairs", exact: true })
    .locator("..");
  await task
    .getByRole("combobox", { name: "Member", exact: true })
    .selectOption({ label: "Vikram Singh" });
  await task.getByRole("button", { name: "Assign", exact: true }).click();
  await expect(task.getByText("Assigned", { exact: true })).toBeVisible();
  await signOut(page);
  await signIn(page, "Vikram Singh");
  await page.goto("/o/cyber-sec/tasks");
  const assigned = page
    .getByRole("heading", { name: "E2E arrange chairs", exact: true })
    .locator("..");
  await assigned.getByRole("button", { name: "Mark complete" }).click();
  await expect(assigned.getByText("Completed", { exact: true })).toBeVisible();
});

test("membership controls and settings render for owner; regular members cannot open them", async ({
  page,
}) => {
  await signIn(page, "Arjun Mehta");
  await page.goto("/o/cyber-sec/members");
  await expect(
    page.getByRole("heading", { name: "Members", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Update role" }).first(),
  ).toBeVisible();
  await page.goto("/o/cyber-sec/settings");
  await expect(page.getByLabel("Club name")).toHaveValue("Cyber Security Club");
  await expect(
    page.getByRole("heading", { name: "New custom role" }),
  ).toBeVisible();
  await page.goto("/o/cyber-sec/audit");
  await expect(
    page.getByRole("heading", { name: "Audit log", exact: true }),
  ).toBeVisible();
  await page.goto("/o/cyber-sec/leaderboard");
  await expect(
    page.getByRole("heading", { name: "Contribution leaderboard" }),
  ).toBeVisible();
  await signOut(page);
  await signIn(page, "Vikram Singh");
  for (const path of ["settings", "members", "audit", "leaderboard"])
    expect((await page.goto(`/o/cyber-sec/${path}`))?.status()).toBe(404);
});

test("demo scanner and member pages hydrate under the nonce CSP", async ({
  page,
}) => {
  const violations: string[] = [];
  page.on("console", (msg) => {
    if (/Content Security Policy|Refused to execute/.test(msg.text()))
      violations.push(msg.text());
  });
  await signIn(page, "Sneha Iyer");
  await page.goto("/o/cyber-sec/scan");
  await page.getByRole("link", { name: /CyberQuest CTF/ }).click();
  await page.getByLabel("QR code text").fill("invalid-code");
  await page.getByRole("button", { name: "Check in", exact: true }).click();
  await expect(
    page.getByText("This is not a ClubSphere QR code.", { exact: true }),
  ).toBeVisible();
  expect(violations).toEqual([]);
  await page.screenshot({ path: "test-results/scanner.png", fullPage: true });
});

test("CTF flags award points once and show a scoreboard", async ({ page }) => {
  await signIn(page, "Sneha Iyer");
  await page.goto("/o/cyber-sec/ctf");
  const create = page
    .getByRole("heading", { name: "New challenge", exact: true })
    .locator("..");
  await create
    .getByLabel("CTF event")
    .selectOption({ label: "CyberQuest CTF 2026" });
  await create
    .getByLabel("Title", { exact: true })
    .fill("E2E decode challenge");
  await create.getByLabel("Description").fill("Decode the message.");
  await create.getByLabel("Points").fill("50");
  await create.getByLabel("Flag", { exact: true }).fill("flag{browser_test}");
  await create.getByRole("button", { name: "Create challenge" }).click();
  await expect(create.getByRole("status")).toHaveText("Saved.");
  await signOut(page);
  await signIn(page, "Vikram Singh");
  await page.goto("/o/cyber-sec/ctf");
  const challenge = page
    .getByRole("heading", { name: /E2E decode challenge/ })
    .locator("..");
  await challenge.getByLabel("Your flag").fill("flag{browser_test}");
  await challenge.getByRole("button", { name: "Submit flag" }).click();
  await expect(challenge.getByText("Solved", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("row", { name: /CyberQuest CTF 2026 1 You 50/ }),
  ).toBeVisible();
});

test("attendee feedback is indexed and issued certificates have a public printable verification page", async ({
  page,
}) => {
  await signIn(page, "Sneha Iyer");
  await page.goto("/o/cyber-sec/feedback");
  await page
    .getByLabel("Completed event")
    .selectOption({ label: "Web Exploitation Workshop" });
  await page
    .getByRole("combobox", { name: "Rating", exact: true })
    .selectOption("5");
  await page
    .getByLabel("Comment (shared with club members)")
    .fill("E2E workshop feedback: the cryptography labs were useful.");
  await page.getByRole("button", { name: "Publish feedback" }).click();
  await expect(page.getByRole("status")).toHaveText(
    "Published to the knowledge base.",
  );
  await page.goto("/o/cyber-sec/search?q=cryptography");
  await expect(
    page
      .getByRole("listitem")
      .filter({ hasText: "Feedback: Web Exploitation Workshop" })
      .first(),
  ).toBeVisible();
  await page.goto("/o/cyber-sec/certificates");
  await page
    .getByLabel("Completed event")
    .selectOption({ label: "Web Exploitation Workshop" });
  await page.getByRole("button", { name: "Issue certificates" }).click();
  await expect(page.getByRole("status")).toContainText("Certificates issued");
  const row = page.getByRole("row").filter({ hasText: "Sneha Iyer" });
  const verifyUrl = await row
    .getByRole("link", { name: "View / print" })
    .getAttribute("href");
  expect(verifyUrl).toMatch(/^\/verify\/[0-9a-f]{64}$/);
  await signOut(page);
  await page.goto(verifyUrl!);
  await expect(
    page.getByRole("heading", { name: "Certificate of participation" }),
  ).toBeVisible();
  await expect(page.getByText("Sneha Iyer", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Print certificate" }),
  ).toBeVisible();
});

test("owner edits questions and roles, then suspends and reinstates a member", async ({
  page,
}) => {
  await signIn(page, "Arjun Mehta");
  await page.goto("/o/cyber-sec/settings");
  await page.getByRole("button", { name: "Add question", exact: true }).click();
  await page
    .getByLabel("Question 4", { exact: true })
    .fill("Preferred activity");
  await page
    .getByRole("button", { name: "Save settings", exact: true })
    .click();
  await expect(page.getByRole("status").first()).toHaveText("Saved.");
  await page.reload();
  await expect(page.getByLabel("Question 4", { exact: true })).toHaveValue(
    "Preferred activity",
  );
  const create = page
    .getByRole("heading", { name: "New custom role", exact: true })
    .locator("..");
  await create.getByLabel("Role key").fill("e2e_helper");
  await create.getByLabel("Name", { exact: true }).fill("E2E helper");
  await create.getByLabel("event.checkin", { exact: true }).check();
  await create.getByRole("button", { name: "Save role" }).click();
  await expect(
    page.getByRole("heading", { name: "Edit E2E helper", exact: true }),
  ).toBeVisible();
  await page.goto("/o/cyber-sec/members");
  const member = page
    .getByRole("heading", { name: /Vikram Singh/ })
    .locator("..");
  await member
    .getByRole("combobox", { name: "Role", exact: true })
    .selectOption({ label: "E2E helper" });
  await member
    .getByRole("button", { name: "Update role", exact: true })
    .click();
  await expect(member.getByText(/Roles:.*E2E helper/)).toBeVisible();
  await member
    .getByLabel("Suspension reason")
    .fill("Temporary E2E test suspension");
  await member
    .getByRole("button", { name: "Suspend member", exact: true })
    .click();
  await expect(member.getByText("suspended", { exact: true })).toBeVisible();
  await member
    .getByRole("button", { name: "Reinstate member", exact: true })
    .click();
  await expect(member.getByText("active", { exact: true })).toBeVisible();
  await page.goto("/o/cyber-sec/settings");
  const role = page
    .getByRole("heading", { name: "Edit E2E helper", exact: true })
    .locator("..");
  await role.getByLabel("Remove this role and all its assignments").check();
  await role
    .getByRole("button", { name: "Delete custom role", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Edit E2E helper", exact: true }),
  ).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/o/cyber-sec/tasks");
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  await page.screenshot({
    path: "test-results/mobile-tasks.png",
    fullPage: true,
  });
});
