/**
 * Centralized selector map for all LinkedIn DOM elements used in the automation.
 *
 * HOW TO UPDATE: When LinkedIn changes its DOM, locate the element in DevTools,
 * copy the new CSS / XPath and update the relevant entry here.
 * The rest of the automation code reads from this file – nothing else needs changing.
 */

export const XPATHS = {
    // Single xpath — grabs every profile-link anchor from search results directly.
    // Update this if LinkedIn restructures the search result list.
    searchResultProfileAnchor: {
        xpath: '//*[@role="listitem"]/div[1]//a[contains(@href, "/in/")]',
    },

    // Profile name is taken from the page title node.
    // Example: "Ozias Gonet | LinkedIn"
    profileName: {
        xpath: '//title',
        suffix: ' | LinkedIn',
        ignoredTitles: ['Search | LinkedIn', 'LinkedIn | LinkedIn'],
    },

    // Profile header section — scopes button searches to avoid false positives.
    profileTopCard: {
        css: 'main section:first-of-type',
    },

    // Connect button: a/button whose aria-label contains " to connect",
    // or an <a> with href pointing to the custom-invite endpoint.
    connectButton: {
        xpath: './/a[contains(@aria-label," to connect")] | .//button[contains(@aria-label," to connect")] | .//a[contains(@href,"/preload/custom-invite/")]',
    },

    // More / overflow actions button (aria-label="More").
    moreButton: {
        xpath: './/a[@aria-label="More"] | .//button[@aria-label="More"]',
    },

    // Topmost dialog / modal overlay.
    dialog: {
        css: "[role='dialog']",
    },

    // "Add a note" button in the invite dialog (aria-label="Add a note").
    addNoteButton: {
        css: 'a[aria-label="Add a note"], button[aria-label="Add a note"]',
    },

    // Note textarea inside the invite dialog.
    noteTextField: {
        css: 'textarea[name="message"], textarea#custom-message',
    },

    // Send invitation button (aria-label="Send invitation").
    sendButton: {
        css: 'a[aria-label="Send invitation"], button[aria-label="Send invitation"]',
    },

    // Dismiss button on the dialog (aria-label="Dismiss").
    dialogDismissButton: {
        css: 'a[aria-label="Dismiss"], button[aria-label="Dismiss"]',
    },
};
