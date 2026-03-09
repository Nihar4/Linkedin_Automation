# LinkedIn Automation

A powerful automation tool to interact with LinkedIn search results and automatically connect with profiles. It is built to run through your existing Brave Browser session to avoid detection as a bot and retain user login sessions.

## 🚀 Getting Started

We provide an easy to use batch script to run everything!

1. Open the project folder `C:\Users\019158958\Desktop\linkedinautomation` or wherever you cloned the repo.
2. Ensure you have **Node.js** installed on your system.
3. Simply double-click on `start.bat`.

The automation will:
- Open Brave Browser locally with remote debugging enabled.
- Automatically install dependencies (npm install).
- Run the automation script.
- Scrape profiles starting from search results based on the provided URL targeting specific headings.
- Send connection requests with custom notes!

## ⚙️ How It Works
- Uses `Playwright` to connect to your existing local Brave browser instance (bypassing LinkedIn restrictions compared to generic headless browsers).
- Iterates through search results pages.
- Finds targeted search profiles with the specific `search-result-lockup-title` attribute.
- Initiates the connection dialog on profiles, adding a customized introductory note.

## 📝 Configuration
To alter the search term or how many people the automation reaches out to, you can update variables like `BASE_URL`, `MAX_PROFILES_TO_OPEN`, `START_PAGE`, and `END_PAGE` directly in `src/open-linkedin.js`.
