import { mkdir, writeFile, readFile } from "node:fs/promises";
import { chromium } from "playwright";
import { XPATHS } from "./linkedin-xpaths.js";

const BASE_URL =
  process.env.LINKEDIN_URL ||
  "https://www.linkedin.com/search/results/people/?keywords=software%20engineering%20manager&origin=GLOBAL_SEARCH_HEADER&network=%5B%22S%22%2C%22O%22%5D&geoUrn=%5B%22103644278%22%5D&currentCompany=%5B%221441%22%2C%2216140%22%5D";
const CDP_URL = process.env.BRAVE_CDP_URL || "http://127.0.0.1:9222";
const MAX_PROFILES_TO_OPEN = Number(process.env.MAX_PROFILES_TO_OPEN || 100);
const START_PAGE = Number(process.env.START_PAGE || 1);
const END_PAGE = Number(process.env.END_PAGE || 10);
const CONCURRENCY = Number(process.env.CONCURRENCY || 2);
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
  return page.locator(XPATHS.profileTopCard.css).first();
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

  return page.evaluate(({ maxProfiles, xpath }) => {
    const result = document.evaluate(
      xpath,
      document,
      null,
      XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
      null,
    );

    const links = [];
    const seen = new Set();

    for (let i = 0; i < result.snapshotLength; i++) {
      const a = result.snapshotItem(i);
      const href = a.getAttribute("href");
      if (!href) continue;

      const absoluteUrl = new URL(href, window.location.origin).toString();
      const normalizedUrl = absoluteUrl.split("?")[0].replace(/\/$/, "");

      if (seen.has(normalizedUrl)) continue;
      seen.add(normalizedUrl);
      links.push(normalizedUrl);

      if (links.length >= maxProfiles) return links;
    }

    return links;
  }, { maxProfiles: MAX_PROFILES_TO_OPEN, xpath: XPATHS.searchResultProfileAnchor.xpath });
}

async function collectProfileData(page, fallbackUrl) {
  await page.waitForTimeout(2500);

  return page.evaluate(({ url, nameConfig }) => {
    const titleNode = document.evaluate(
      nameConfig.xpath,
      document,
      null,
      XPathResult.FIRST_ORDERED_NODE_TYPE,
      null,
    ).singleNodeValue;
    const title = titleNode?.textContent?.trim() || document.title || "";
    let name = null;
    if (
      title.endsWith(nameConfig.suffix) &&
      !nameConfig.ignoredTitles.includes(title)
    ) {
      name = title.slice(0, -nameConfig.suffix.length).trim() || null;
    }

    return {
      profileUrl: window.location.href.split("?")[0].replace(/\/$/, "") || url,
      name,
      connectVisible: "no",
    };
  }, { url: fallbackUrl, nameConfig: XPATHS.profileName });
}

async function clickConnectIfPresent(page) {
  const clicked = await getTopCard(page).evaluate((card, { xpath }) => {
    const isVisible = (el) => {
      const s = window.getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return s.visibility !== "hidden" && s.display !== "none" && r.width > 0 && r.height > 0;
    };
    const result = document.evaluate(xpath, card, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
    for (let i = 0; i < result.snapshotLength; i++) {
      const el = result.snapshotItem(i);
      if (!isVisible(el)) continue;
      el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
      el.click();
      return true;
    }
    return false;
  }, { xpath: XPATHS.connectButton.xpath });

  if (!clicked) return "no";
  await page.waitForTimeout(1000);
  return "yes";
}

async function clickMoreThenConnect(page) {
  // Click the "More" overflow button in the top card
  const moreClicked = await getTopCard(page).evaluate((card, { xpath }) => {
    const isVisible = (el) => {
      const s = window.getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return s.visibility !== "hidden" && s.display !== "none" && r.width > 0 && r.height > 0;
    };
    const result = document.evaluate(xpath, card, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
    for (let i = 0; i < result.snapshotLength; i++) {
      const el = result.snapshotItem(i);
      if (!isVisible(el)) continue;
      el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
      el.click();
      return true;
    }
    return false;
  }, { xpath: XPATHS.moreButton.xpath });

  if (!moreClicked) return "no";
  await page.waitForTimeout(750);

  // Find the Connect option that appeared in the dropdown (search whole document)
  const connectClicked = await page.evaluate(({ xpath }) => {
    const isVisible = (el) => {
      const s = window.getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return s.visibility !== "hidden" && s.display !== "none" && r.width > 0 && r.height > 0;
    };
    const result = document.evaluate(xpath, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
    for (let i = 0; i < result.snapshotLength; i++) {
      const el = result.snapshotItem(i);
      if (!isVisible(el)) continue;
      el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
      el.click();
      return true;
    }
    return false;
  }, { xpath: XPATHS.connectButton.xpath });

  if (connectClicked) {
    await page.waitForTimeout(1000);
    return "yes";
  }

  await page.keyboard.press("Escape").catch(() => { });
  return "no";
}

async function isEmailVerificationDialog(page) {
  const dialog = page.locator(XPATHS.dialog.css).last();
  const dialogVisible = await dialog.isVisible().catch(() => false);

  if (!dialogVisible) {
    return false;
  }

  const text = await dialog.textContent().catch(() => "");
  return /please enter their email to connect/i.test(text);
}

async function closeDialog(page) {
  const dialog = page.locator(XPATHS.dialog.css).last();
  const closeButton = dialog.locator(XPATHS.dialogDismissButton.css).first();
  if (await closeButton.isVisible().catch(() => false)) {
    await closeButton.click().catch(() => { });
  } else {
    await page.keyboard.press("Escape").catch(() => { });
  }
  await page.waitForTimeout(500);
}

async function clickAddNoteIfPresent(page) {
  const dialog = page.locator(XPATHS.dialog.css).last();
  if (!(await dialog.isVisible().catch(() => false))) return "no";
  const addNoteButton = dialog.locator(XPATHS.addNoteButton.css).first();
  if (!(await addNoteButton.isVisible().catch(() => false))) return "no";
  await addNoteButton.click();
  await page.waitForTimeout(1000);
  return "yes";
}

async function fillNoteMessage(page, fullName) {
  const dialog = page.locator(XPATHS.dialog.css).last();
  const dialogVisible = await dialog.isVisible().catch(() => false);

  if (!dialogVisible) {
    return "no";
  }

  const noteField = dialog
    .locator(XPATHS.noteTextField.css)
    .first();

  if (!(await noteField.isVisible().catch(() => false))) {
    return "no";
  }

  const message = buildInvitationMessage(fullName);
  await noteField.fill(message);
  await page.waitForTimeout(500);
  return "yes";
}

async function clickSendButton(page) {
  const dialog = page.locator(XPATHS.dialog.css).last();
  if (!(await dialog.isVisible().catch(() => false))) return "no";
  await page.waitForTimeout(500);
  const sendButton = dialog.locator(XPATHS.sendButton.css).first();
  if (!(await sendButton.isVisible().catch(() => false))) return "no";
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

    profile.connectClicked = await clickConnectIfPresent(profilePage);

    if (profile.connectClicked === "no") {
      profile.connectClicked = await clickMoreThenConnect(profilePage);
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
