import { mkdir, writeFile, readFile } from "node:fs/promises";
import { chromium } from "playwright";

const BASE_URL =
  process.env.LINKEDIN_URL ||
  "https://www.linkedin.com/search/results/people/?keywords=software%20engineering%20manager&origin=FACETED_SEARCH&network=%5B%22O%22%5D&geoUrn=%5B%22103644278%22%5D&currentCompany=%5B%221441%22%2C%2216140%22%5D";
const CDP_URL = process.env.BRAVE_CDP_URL || "http://127.0.0.1:9222";
const MAX_PROFILES_TO_OPEN = Number(process.env.MAX_PROFILES_TO_OPEN || 10);
const START_PAGE = Number(process.env.START_PAGE || 1);
const END_PAGE = Number(process.env.END_PAGE || 3);
const CONCURRENCY = Number(process.env.CONCURRENCY || 5);
const OUTPUT_FILE = process.env.OUTPUT_FILE || "output/profiles.json";
const CACHE_FILE = process.env.CACHE_FILE || "output/visited-cache.json";

async function loadCache() {
  try {
    const raw = await readFile(CACHE_FILE, "utf8");
    return new Set(JSON.parse(raw));
  } catch {
    return new Set();
  }
}

async function saveCache(cache) {
  await mkdir("output", { recursive: true });
  await writeFile(CACHE_FILE, `${JSON.stringify([...cache], null, 2)}\n`, "utf8");
}

function getTopCard(page) {
  return page.locator("main section").first();
}

function getFirstName(fullName) {
  const tokens = fullName
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean)
    .map((token) => token.replace(/^[^A-Za-z]+|[^A-Za-z.]+$/g, ""));

  for (const token of tokens) {
    if (!token) {
      continue;
    }

    // Skip initials like "J." and prefer the next real name token.
    if (/^[A-Za-z]\.$/.test(token)) {
      continue;
    }

    if (/^[A-Za-z][A-Za-z'-]*$/.test(token)) {
      return token;
    }
  }

  return "there";
}

function buildInvitationMessage(fullName) {
  const firstName = getFirstName(fullName);
  return `Hi ${firstName}, I am in Google SDE Intern Summer team matching and would love to connect to learn more about your team and projects.`;
}

async function collectProfileLinks(page) {
  await page.waitForTimeout(3000);

  return page.evaluate((maxProfiles) => {
    const anchors = Array.from(document.querySelectorAll('a[href*="/in/"]'));
    const links = [];
    const seen = new Set();

    for (const anchor of anchors) {
      const href = anchor.getAttribute("href");
      if (!href) {
        continue;
      }

      const absoluteUrl = new URL(href, window.location.origin).toString();
      const normalizedUrl = absoluteUrl.split("?")[0].replace(/\/$/, "");

      if (!normalizedUrl.includes("/in/")) {
        continue;
      }

      if (seen.has(normalizedUrl)) {
        continue;
      }

      seen.add(normalizedUrl);
      links.push(normalizedUrl);

      if (links.length >= maxProfiles) {
        break;
      }
    }

    return links;
  }, MAX_PROFILES_TO_OPEN);
}

async function collectProfileData(page, fallbackUrl) {
  await page.waitForTimeout(2500);

  return page.evaluate((url) => {
    const getText = (selectorList) => {
      for (const selector of selectorList) {
        const element = document.querySelector(selector);
        const text = element?.textContent?.trim();
        if (text) {
          return text;
        }
      }
      return "";
    };

    const name = getText([
      "h1",
      ".text-heading-xlarge",
      ".inline.t-24.v-align-middle.break-words",
    ]);

    return {
      profileUrl: window.location.href.split("?")[0].replace(/\/$/, "") || url,
      name: name || null,
      connectVisible: "no",
    };
  }, fallbackUrl);
}

async function clickConnectIfPresent(page, profileName) {
  const clickedFromTopCard = await getTopCard(page).evaluate(
    (card, expectedName) => {
      const isVisible = (element) => {
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return (
          style.visibility !== "hidden" &&
          style.display !== "none" &&
          rect.width > 0 &&
          rect.height > 0
        );
      };

      const candidates = Array.from(
        card.querySelectorAll("button, a[role='button'], div[role='button']"),
      );
      const normalizedExpectedName = expectedName?.trim().toLowerCase() || "";
      const getLabel = (element) =>
        [
          element.textContent?.trim(),
          element.getAttribute("aria-label"),
          element.getAttribute("title"),
        ]
          .filter(Boolean)
          .join(" ")
          .replace(/\s+/g, " ")
          .trim()
          .toLowerCase();

      const exactCandidate = candidates.find((element) => {
        const label = getLabel(element);
        return (
          isVisible(element) &&
          normalizedExpectedName &&
          label.includes(`invite ${normalizedExpectedName} to connect`)
        );
      });

      const textCandidate = candidates.find((element) => {
        const label = getLabel(element);
        return isVisible(element) && /^connect$/i.test(label);
      });

      const fallbackCandidate = candidates.find((element) => {
        const label = getLabel(element);
        return isVisible(element) && /\bconnect\b/.test(label);
      });

      const target = exactCandidate || textCandidate || fallbackCandidate;
      if (!target) {
        return false;
      }

      target.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      target.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
      target.click();
      return true;
    },
    profileName,
  );

  if (!clickedFromTopCard) {
    return "no";
  }

  await page.waitForTimeout(1000);
  return "yes";
}

async function clickMoreThenConnect(page, profileName) {
  const moreButton = getTopCard(page)
    .getByRole("button", { name: /More actions|More/i })
    .first();

  if (!(await moreButton.isVisible().catch(() => false))) {
    return "no";
  }

  await moreButton.click();
  await page.waitForTimeout(750);

  const visibleMenu = page
    .locator(".artdeco-dropdown__content-inner, div[role='menu'], ul[role='menu']")
    .filter({ has: page.getByText(/Connect/i) })
    .last();

  if (!(await visibleMenu.isVisible().catch(() => false))) {
    await page.keyboard.press("Escape").catch(() => { });
    return "no";
  }

  const clickedFromMenu = await visibleMenu.evaluate((menu, expectedName) => {
    const isVisible = (element) => {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return (
        style.visibility !== "hidden" &&
        style.display !== "none" &&
        rect.width > 0 &&
        rect.height > 0
      );
    };

    const normalizedExpectedName = expectedName?.trim().toLowerCase() || "";
    const candidates = Array.from(
      menu.querySelectorAll(
        "button, a, div[role='button'], li[role='menuitem'], div[role='menuitem']",
      ),
    );

    const getLabel = (element) =>
      [
        element.textContent?.trim(),
        element.getAttribute("aria-label"),
        element.getAttribute("title"),
      ]
        .filter(Boolean)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();

    const exactCandidate = candidates.find((element) => {
      const label = getLabel(element).toLowerCase();
      return (
        isVisible(element) &&
        normalizedExpectedName &&
        label.includes(`invite ${normalizedExpectedName} to connect`)
      );
    });

    const textCandidate = candidates.find((element) => {
      const label = getLabel(element).toLowerCase();
      return isVisible(element) && /^connect$/i.test(label);
    });

    const fallbackCandidate = candidates.find((element) => {
      const label = getLabel(element).toLowerCase();
      return isVisible(element) && /\bconnect\b/.test(label);
    });

    const target = exactCandidate || textCandidate || fallbackCandidate;
    if (!target) {
      return false;
    }

    target.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    target.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    target.click();
    return true;
  }, profileName);

  if (clickedFromMenu) {
    await page.waitForTimeout(1000);
    return "yes";
  }

  await page.keyboard.press("Escape").catch(() => { });
  return "no";
}

async function isEmailVerificationDialog(page) {
  const dialog = page.locator("[role='dialog']").last();
  const dialogVisible = await dialog.isVisible().catch(() => false);

  if (!dialogVisible) {
    return false;
  }

  const text = await dialog.textContent().catch(() => "");
  return /please enter their email to connect/i.test(text);
}

async function closeDialog(page) {
  const dialog = page.locator("[role='dialog']").last();

  // Try clicking a Dismiss/Cancel/Close button first
  const closeButton = dialog
    .locator("button")
    .filter({ hasText: /dismiss|cancel|close|got it/i })
    .first();

  if (await closeButton.isVisible().catch(() => false)) {
    await closeButton.click().catch(() => { });
  } else {
    await page.keyboard.press("Escape").catch(() => { });
  }

  await page.waitForTimeout(500);
}

async function clickAddNoteIfPresent(page) {
  const dialog = page.locator("[role='dialog']").last();
  const dialogVisible = await dialog.isVisible().catch(() => false);

  if (!dialogVisible) {
    return "no";
  }

  const addNoteButton = dialog
    .getByRole("button", { name: /Add a note/i })
    .first();

  if (!(await addNoteButton.isVisible().catch(() => false))) {
    return "no";
  }

  await addNoteButton.click();
  await page.waitForTimeout(1000);
  return "yes";
}

async function fillNoteMessage(page, fullName) {
  const dialog = page.locator("[role='dialog']").last();
  const dialogVisible = await dialog.isVisible().catch(() => false);

  if (!dialogVisible) {
    return "no";
  }

  const noteField = dialog
    .locator("textarea, div[contenteditable='true']")
    .first();

  if (!(await noteField.isVisible().catch(() => false))) {
    return "no";
  }

  const message = buildInvitationMessage(fullName);

  if (await noteField.evaluate((el) => el.tagName.toLowerCase() === "textarea")) {
    await noteField.fill(message);
  } else {
    await noteField.click();
    await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
    await page.keyboard.type(message);
  }

  await page.waitForTimeout(500);
  return "yes";
}

async function clickSendButton(page) {
  const dialog = page.locator("[role='dialog']").last();
  const dialogVisible = await dialog.isVisible().catch(() => false);

  if (!dialogVisible) {
    return "no";
  }

  // Wait for the Send button to appear after note is typed
  await page.waitForTimeout(500);

  const sendButton = dialog
    .locator("button")
    .filter({ hasText: /send/i })
    .last();

  if (!(await sendButton.isVisible().catch(() => false))) {
    return "no";
  }

  await sendButton.click();
  await page.waitForTimeout(1500);
  return "yes";
}

async function goToPage(page, pageNum) {
  const url = `${BASE_URL}&page=${pageNum}`;
  console.log(`Navigating to: ${url}`);
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForLoadState("load", { timeout: 10000 }).catch(() => { });
  await page.waitForTimeout(2000);
}

async function processProfile(context, profileLink, cache) {
  if (cache.has(profileLink)) {
    console.log(`[Cache] Skipping already-visited: ${profileLink}`);
    return null;
  }

  const profilePage = await context.newPage();
  try {
    await profilePage.goto(profileLink, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    const profile = await collectProfileData(profilePage, profileLink);
    profile.connectClicked = "no";
    profile.addNoteClicked = "no";
    profile.noteInserted = "no";
    profile.sendClicked = "no";

    profile.connectClicked = await clickConnectIfPresent(profilePage, profile.name);

    if (profile.connectClicked === "no") {
      profile.connectClicked = await clickMoreThenConnect(profilePage, profile.name);
    }

    if (profile.connectClicked === "yes") {
      if (await isEmailVerificationDialog(profilePage)) {
        console.log(`[Skip] Email verification required for ${profile.name ?? profile.profileUrl}`);
        await closeDialog(profilePage);
        profile.connectClicked = "skipped";
      } else {
        profile.addNoteClicked = await clickAddNoteIfPresent(profilePage);
      }
    }

    if (profile.addNoteClicked === "yes") {
      profile.noteInserted = await fillNoteMessage(profilePage, profile.name);
    }

    if (profile.noteInserted === "yes") {
      profile.sendClicked = await clickSendButton(profilePage);
    }

    if (profile.sendClicked === "yes") {
      cache.add(profileLink);
      await saveCache(cache);
    }

    console.log(
      `Collected profile: ${profile.profileUrl} | ${profile.name ?? "unknown"} | connect=${profile.connectVisible} | clicked=${profile.connectClicked} | addNote=${profile.addNoteClicked} | noteInserted=${profile.noteInserted} | sent=${profile.sendClicked}`,
    );

    return profile;
  } finally {
    // Always cache after visiting, regardless of outcome
    cache.add(profileLink);
    await saveCache(cache).catch(() => { });
    await profilePage.close().catch(() => { });
  }
}

async function saveProfiles(profiles) {
  await mkdir("output", { recursive: true });
  await writeFile(OUTPUT_FILE, `${JSON.stringify(profiles, null, 2)}\n`, "utf8");
}

async function openLinkedIn(browser) {
  const context = browser.contexts()[0] || (await browser.newContext());
  const searchPage = await context.newPage();

  const allProfiles = [];
  const cache = await loadCache();
  console.log(`Cache loaded: ${cache.size} profiles already visited.`);

  for (let pageNum = START_PAGE; pageNum <= END_PAGE; pageNum++) {
    console.log(`\n--- Page ${pageNum} (${pageNum - START_PAGE + 1} of ${END_PAGE - START_PAGE + 1}) ---`);
    await goToPage(searchPage, pageNum);

    const profileLinks = await collectProfileLinks(searchPage);
    console.log(`Found ${profileLinks.length} profile links on page ${pageNum}.`);

    for (let i = 0; i < profileLinks.length; i += CONCURRENCY) {
      const batch = profileLinks.slice(i, i + CONCURRENCY);
      console.log(`  Running batch of ${batch.length} profiles in parallel...`);
      const results = await Promise.all(
        batch.map((link) => processProfile(context, link, cache)),
      );
      allProfiles.push(...results.filter(Boolean));
    }
  }

  await searchPage.close().catch(() => { });

  await saveProfiles(allProfiles);
  console.log(`Saved ${allProfiles.length} profiles to ${OUTPUT_FILE}`);
  console.log("Done.");
}

async function main() {
  console.log(`Connecting to running Brave via CDP: ${CDP_URL}`);

  const browser = await chromium.connectOverCDP(CDP_URL);
  await openLinkedIn(browser);
}

main().catch((error) => {
  console.error("Failed to connect to Brave.");
  console.error(error.message);
  process.exit(1);
});
