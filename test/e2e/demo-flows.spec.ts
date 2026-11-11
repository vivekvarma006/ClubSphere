import { expect, test, type Page } from "@playwright/test";

const browserErrors = new WeakMap<Page, string[]>();
test.beforeEach(({ page }) => {
  const errors: string[] = [];
  browserErrors.set(page, errors);
  page.on("pageerror", (error) => errors.push(error.message));
});
test.afterEach(({ page }) => {
  expect(browserErrors.get(page) ?? [], "uncaught browser errors").toEqual([]);
});

async function signIn(page: Page, name: string) {
  await page.goto("/login");
  await page.getByRole("button", { name: new RegExp(name) }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}
async function signOut(page: Page) {
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL(/\/login/);
}

test("demo accounts start with personal activity, waitlists and a promoted QR", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Try the new workflows", exact: true })).toBeVisible();
  await signIn(page, "Ananya Rao");
  await expect(page.getByRole("link", { name: "Prepare the security lab", exact: true })).toBeVisible();
  const certificates = page.locator("section").filter({ has: page.getByRole("heading", { name: "Recent certificates", exact: true }) });
  await expect(certificates.getByRole("link", { name: "Web Exploitation Workshop", exact: true })).toBeVisible();
  const waits = page.locator("section").filter({ has: page.getByRole("heading", { name: "My waitlists", exact: true }) });
  await waits.getByRole("link", { name: "Security Lab: Waitlist Demo", exact: true }).click();
  await expect(page.getByText("Waitlist position #1", { exact: true })).toBeVisible();
  await expect(page.getByRole("img", { name: "Your check-in QR code" })).toHaveCount(0);
  await signOut(page);
  await signIn(page, "Rohan Gupta");
  await expect(page.getByRole("link", { name: "Test the line follower sensors", exact: true })).toBeVisible();
  await page.getByRole("link", { name: /^Security Lab: Promoted Place/ }).click();
  await expect(page.getByText("Your waitlist place became a registration", { exact: true })).toBeVisible();
  await expect(page.getByRole("img", { name: "Your check-in QR code" })).toBeVisible();
});

test("platform admin creates a club and controls availability; owners and members cannot administer the platform", async ({ page }) => {
  await page.goto("/login");
  const ownerId = await page.locator("form").filter({ has: page.getByRole("button", { name: /Arjun Mehta/ }) })
    .locator('input[name="userId"]').inputValue();
  await signIn(page, "Priya Raman");
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "Platform administration" })).toBeVisible();
  await page.getByLabel("Club slug").fill("e2e-admin-club");
  await page.getByLabel("Club name", { exact: true }).fill("E2E Admin Club");
  await page.getByLabel("Verified initial owner’s profile ID").fill(ownerId);
  await page.getByRole("button", { name: "Create club", exact: true }).click();
  const club = page.getByRole("row").filter({ hasText: "E2E Admin Club" });
  await expect(club).toBeVisible();
  await club.getByLabel("New status").selectOption("suspended");
  await club.getByRole("button", { name: "Update", exact: true }).click();
  await expect(club.getByRole("cell", { name: "suspended", exact: true })).toBeVisible();
  await club.getByLabel("New status").selectOption("active");
  await club.getByRole("button", { name: "Update", exact: true }).click();
  await expect(club.getByRole("cell", { name: "active", exact: true })).toBeVisible();
  await signOut(page);
  await signIn(page, "Arjun Mehta");
  expect((await page.goto("/admin"))?.status()).toBe(404);
  await page.goto("/o/e2e-admin-club/settings");
  await expect(page.getByLabel("Club name")).toHaveValue("E2E Admin Club");
  await signOut(page);
  await signIn(page, "Vikram Singh");
  expect((await page.goto("/admin"))?.status()).toBe(404);
});

test("a new account requests membership, withdraws, reapplies and receives owner approval", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Name", { exact: true }).fill("E2E New Student");
  await page.getByRole("textbox", { name: /^Email/ }).fill("e2e-new-student@example.test");
  await page.getByRole("button", { name: "Create and sign in" }).click();
  await expect(page).toHaveURL(/\/join$/);
  async function apply() {
    await page.goto("/join/cyber-sec");
    await page.getByLabel("Year of study").selectOption("2nd year");
    await page.getByLabel("Security experience").selectOption("Beginner");
    await page.getByRole("button", { name: "Send request" }).click();
    await expect(page).toHaveURL(/\/dashboard\?requested=1/);
    await expect(page.getByText("pending", { exact: true })).toBeVisible();
  }
  await apply();
  await page.getByRole("button", { name: "Withdraw", exact: true }).click();
  await expect(page.getByText("withdrawn", { exact: true })).toBeVisible();
  await apply();
  await signOut(page);
  await signIn(page, "Arjun Mehta");
  await page.goto("/o/cyber-sec/review");
  const request = page.locator("section").filter({ has: page.getByText("E2E New Student", { exact: true }) });
  await request.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(request).toHaveCount(0);
  await signOut(page);
  await signIn(page, "E2E New Student");
  await page.goto("/o/cyber-sec/events");
  await expect(page.getByRole("heading", { name: "Events", exact: true })).toBeVisible();
  expect((await page.goto("/o/cyber-sec/settings"))?.status()).toBe(404);
});

test("officer publishes an event; member cancels and re-registers; volunteer checks the private QR exactly once", async ({ page }) => {
  await signIn(page, "Sneha Iyer");
  await page.goto("/o/cyber-sec/events/new");
  await page.getByLabel("Title", { exact: true }).fill("E2E QR Workshop");
  await page.getByLabel("Description", { exact: true }).fill("Registration and QR workflow");
  const start = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 16);
  const end = new Date(Date.now() + 2 * 86400000 + 3600000).toISOString().slice(0, 16);
  await page.getByLabel("Starts", { exact: true }).fill(start);
  await page.getByLabel("Ends", { exact: true }).fill(end);
  await page.getByLabel("Capacity").fill("1");
  await page.getByRole("button", { name: "Create event", exact: true }).click();
  await expect(page).toHaveURL(/\/events\/[0-9a-f-]+$/);
  const eventUrl = page.url();
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await expect(page.getByText("published", { exact: true })).toBeVisible();
  await signOut(page);
  await signIn(page, "Vikram Singh");
  await page.goto(eventUrl);
  await page.getByRole("button", { name: "Register", exact: true }).click();
  await expect(page.getByRole("img", { name: "Your check-in QR code" })).toBeVisible();
  await page.getByRole("button", { name: "Cancel registration", exact: true }).click();
  await expect(page.getByRole("button", { name: "Register", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Register", exact: true }).click();
  await page.getByText("Code as text", { exact: true }).click();
  const token = (await page.locator("details code").textContent())!;
  expect(token).toMatch(/^[0-9a-f]{64}$/);
  await signOut(page);
  await signIn(page, "Ananya Rao");
  await page.goto(eventUrl);
  await expect(page.getByText("This event is full.", { exact: true })).toBeVisible();
  await expect(page.locator("details code")).toHaveCount(0);
  await signOut(page);
  await signIn(page, "Kiran Das");
  const eventId = eventUrl.split("/").pop();
  await page.goto(`/o/cyber-sec/scan?event=${eventId}`);
  await page.getByLabel("QR code text").fill(token);
  await page.getByRole("button", { name: "Check in", exact: true }).click();
  await expect(page.getByText("Checked in", { exact: true })).toBeVisible();
  await page.getByLabel("QR code text").fill(token);
  await page.getByRole("button", { name: "Check in", exact: true }).click();
  await expect(page.getByText("Already checked in earlier: not counted twice", { exact: true })).toBeVisible();
  expect((await page.goto("/o/cyber-sec/settings"))?.status()).toBe(404);
  expect((await page.goto("/o/cyber-sec/events/new"))?.status()).toBe(404);
});

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
    page.getByRole("heading", { name: "Contribution report" }),
  ).toBeVisible();
  await expect(page.getByText("Participation", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Members to engage" })).toBeVisible();
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
  for (const path of ["leaderboard", "reports", "members", "settings", "inventory", "scan"]) {
    await page.goto(`/o/cyber-sec/${path}`);
    expect(await page.evaluate(() => document.documentElement.scrollWidth), path).toBeLessThanOrEqual(390);
    if (path === "leaderboard") {
      await page.screenshot({ path: "test-results/mobile-contributions.png", fullPage: true });
    }
  }
});

for (const persona of [
  { name: "Arjun Mehta", allowed: ["members", "review", "settings", "audit", "reports", "leaderboard", "inventory", "scan", "events/new"] },
  { name: "Sneha Iyer", allowed: ["members", "review", "reports", "leaderboard", "inventory", "scan", "events/new"] },
  { name: "Kiran Das", allowed: ["inventory", "scan"] },
  { name: "Ananya Rao", allowed: [] },
]) {
  test(`${persona.name}: every club page respects the role access matrix`, async ({ page }) => {
    await signIn(page, persona.name);
    for (const path of ["events", "tasks", "ctf", "certificates", "feedback", "search"]) {
      expect((await page.goto(`/o/cyber-sec/${path}`))?.status(), path).toBe(200);
    }
    for (const path of ["members", "review", "settings", "audit", "reports", "leaderboard", "inventory", "scan", "events/new"]) {
      expect((await page.goto(`/o/cyber-sec/${path}`))?.status(), path)
        .toBe(persona.allowed.includes(path) ? 200 : 404);
    }
    expect((await page.goto("/admin"))?.status()).toBe(404);
  });
}

test("an officer's powers do not extend to another club", async ({ page }) => {
  await signIn(page, "Sneha Iyer");
  for (const path of ["events", "members", "inventory", "scan", "reports", "leaderboard", "settings"]) {
    const response = await page.goto(`/o/robotics/${path}`);
    // The shared layout may show a public invitation instead of rendering
    // its protected child. Both it and a 404 must withhold club data/actions.
    expect([200, 404], path).toContain(response?.status());
    if (response?.status() === 200) {
      await expect(page.getByText("This club's pages are for members.", { exact: true })).toBeVisible();
      await expect(page.getByRole("link", { name: "Request to join", exact: true })).toBeVisible();
      await expect(page.getByRole("table")).toHaveCount(0);
      await expect(page.locator("main form, section form")).toHaveCount(0);
      await expect(page.getByText("Farhan Ali", { exact: true })).toHaveCount(0);
    }
  }
});

test("signed-out and forged-session visitors cannot access protected pages", async ({ page, context }) => {
  for (const path of ["/dashboard", "/admin", "/o/cyber-sec/members", "/o/cyber-sec/leaderboard"]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/login/);
  }
  await context.addCookies([{ name: "cs_demo_session", value: "00000000-0000-4000-8000-000000000000.forged", url: new URL(page.url()).origin }]);
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/login/);
  await context.clearCookies();
  await signIn(page, "Vikram Singh");
  await signOut(page);
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login/);
});

test("event waitlists promote members and personal activity and reports stay usable on mobile", async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page, "Sneha Iyer");
  await page.goto("/o/cyber-sec/events/new");
  await page.getByLabel("Title", { exact: true }).fill("E2E Waitlist Workshop");
  await page.getByLabel("Starts", { exact: true }).fill(new Date(Date.now()+3*86400000).toISOString().slice(0,16));
  await page.getByLabel("Ends", { exact: true }).fill(new Date(Date.now()+3*86400000+3600000).toISOString().slice(0,16));
  await page.getByLabel("Capacity").fill("1");
  await page.getByRole("button", { name: "Create event", exact: true }).click();
  await expect(page).toHaveURL(/\/events\/[0-9a-f-]+$/);
  const eventUrl=page.url();
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await expect(page.getByText("published", { exact: true })).toBeVisible();
  await signOut(page);
  await signIn(page,"Vikram Singh");
  await page.goto(eventUrl);
  await page.getByRole("button",{name:"Register",exact:true}).click();
  await expect(page.getByRole("img",{name:"Your check-in QR code"})).toBeVisible();
  await signOut(page);
  await signIn(page,"Ananya Rao");
  await page.goto(eventUrl);
  await page.getByRole("button",{name:"Join waitlist",exact:true}).click();
  await expect(page.getByText("Waitlist position #1",{exact:true})).toBeVisible();
  await expect(page.getByRole("img",{name:"Your check-in QR code"})).toHaveCount(0);
  await page.screenshot({path:"test-results/waitlist-desktop.png",fullPage:true});
  await page.goto("/dashboard");
  await expect(page.getByRole("heading",{name:"My Activity",exact:true})).toBeVisible();
  const waits=page.locator("section").filter({has:page.getByRole("heading",{name:"My waitlists",exact:true})});
  await expect(waits.getByText("E2E Waitlist Workshop",{exact:true})).toBeVisible();
  await waits.getByRole("listitem").filter({ has: page.getByRole("link", { name: "E2E Waitlist Workshop", exact: true }) })
    .getByRole("button", { name: "Leave waitlist", exact: true }).click();
  await expect(waits.getByText("E2E Waitlist Workshop",{exact:true})).toHaveCount(0);
  await page.goto(eventUrl);
  await page.getByRole("button",{name:"Join waitlist",exact:true}).click();
  await expect(page.getByText("Waitlist position #1",{exact:true})).toBeVisible();
  await signOut(page);
  await signIn(page,"Vikram Singh");
  await page.goto(eventUrl);
  await page.getByRole("button",{name:"Cancel registration",exact:true}).click();
  await expect(page.getByRole("button",{name:"Join waitlist",exact:true})).toBeVisible();
  await signOut(page);
  await signIn(page,"Ananya Rao");
  await page.goto(eventUrl);
  await expect(page.getByText("Your waitlist place became a registration",{exact:true})).toBeVisible();
  await expect(page.getByRole("img",{name:"Your check-in QR code"})).toBeVisible();
  await page.goto("/dashboard");
  await expect(page.getByRole("heading",{name:"Tasks to complete",exact:true})).toBeVisible();
  await expect(page.getByRole("heading",{name:"Recent certificates",exact:true})).toBeVisible();
  await expect(page.getByRole("heading",{name:"Recent participation",exact:true})).toBeVisible();
  await expect(page.locator("section").filter({has:page.getByRole("heading",{name:"My upcoming events",exact:true})}).getByText("E2E Waitlist Workshop",{exact:true})).toBeVisible();
  await page.screenshot({path:"test-results/activity-desktop.png",fullPage:true});
  await page.setViewportSize({width:390,height:844});
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({path:"test-results/activity-mobile.png",fullPage:true});
  await signOut(page);
  await signIn(page,"Sneha Iyer");
  await page.goto("/o/cyber-sec/reports");
  await expect(page.getByRole("heading",{name:"Application trend",exact:true})).toBeVisible();
  await expect(page.getByRole("heading",{name:"Event registration & attendance",exact:true})).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({path:"test-results/reports-mobile.png",fullPage:true});
  await page.setViewportSize({width:1440,height:1000});
  await page.screenshot({path:"test-results/reports-desktop.png",fullPage:true});
});

test("black and green workspace and activity heatmaps work with keyboard, touch and either OS theme", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await signIn(page, "Ananya Rao");
  const personal = page.locator("section").filter({ has: page.getByRole("heading", { name: "Contribution activity", exact: true }) });
  await expect(personal.getByRole("button")).toHaveCount(365);
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe("rgb(9, 11, 10)");
  const populated = personal.locator('button[data-count]:not([data-count="0"])').first();
  await populated.click();
  await expect(personal.getByRole("status")).toContainText(/check-ins.*tasks completed.*CTF solves/);
  await expect(populated).toHaveAttribute("aria-pressed", "true");
  await populated.press("ArrowRight");
  await expect(personal.locator("button:focus")).toHaveCount(1);
  await personal.getByLabel("Activity period").selectOption("13");
  await expect(personal.getByRole("button")).toHaveCount(91);
  await personal.getByLabel("Activity period").selectOption("52");
  await expect(personal.getByRole("button")).toHaveCount(365);
  await page.evaluate(() => window.scrollTo(0,0));
  await page.screenshot({ path: "test-results/redesign-preview.png" });
  await page.screenshot({ path: "test-results/redesign-dashboard-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByText("Workspace menu", { exact: false }).click();
  await expect(page.getByRole("link", { name: "Discover clubs", exact: true })).toBeVisible();
  await page.getByText("Workspace menu", { exact: false }).click();
  await expect.poll(() => personal.getByRole("region").evaluate(element => element.scrollLeft)).toBeGreaterThan(0);
  await personal.getByLabel("Activity period").selectOption("13");
  await personal.locator('button[data-count]:not([data-count="0"])').first().click();
  const selectedDate = await personal.getByLabel("Activity date").inputValue();
  expect(selectedDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  await expect(personal.getByRole("status")).toBeVisible();
  const skip = page.getByRole("link", { name: "Skip to content", exact: true });
  expect(await skip.evaluate(element => getComputedStyle(element).clipPath)).toBe("inset(50%)");
  await page.screenshot({ path: "test-results/redesign-dashboard-mobile.png", fullPage: true });
  await signOut(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await signIn(page, "Sneha Iyer");
  await page.goto("/o/cyber-sec/reports");
  await expect(page.getByRole("heading", { name: "Club activity", exact: true })).toBeVisible();
  await page.emulateMedia({ colorScheme: "dark" });
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe("rgb(9, 11, 10)");
  await page.screenshot({ path: "test-results/redesign-reports-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "test-results/redesign-reports-mobile.png", fullPage: true });
  await signOut(page);
  await page.screenshot({ path: "test-results/redesign-login-mobile.png", fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  await page.screenshot({ path: "test-results/redesign-home.png", fullPage: true });
});
