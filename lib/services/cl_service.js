const MAX_RETRIES = 30;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const resultsContainerSelector = "#content > div > section > div > div.results > div.list";
const firstResultLinkSelector = "#content > div > section > div > div.results > div.list > a:nth-child(1)";
const priceSelectors = [
    '#content > div > section > div > div.results > div.list > a:nth-child(1) > div.fields > div:nth-child(3) > div > span',
    '#content > div > section > div > div.results > div.list > a:nth-child(2) > div.fields > div:nth-child(3) > div > span',
    '#content > div > section > div > div.results > div.list > a:nth-child(3) > div.fields > div:nth-child(3) > div > span',
];
const cardLadderSelector = "#content > div > section > div > div.estimate > div > div.value";
const confidenceBarsSelector = "span.confidence-bars";

const searchIconSelector =
    '#content > div > section > div > div.align.collapse-end.flex > div.shared-filters > div.align.small-gap > div.search-area.search-area-filters > div > div.input-wrapper > div > button > i';
const inputSelector =
    '#content > div > section > div > div.modal-backdrop.backdrop.default > div > div > section > div > form > div.text-input > div > div.input-wrapper > input[type=text]';
const submitBtnSelector =
    '#content > div > section > div > div.modal-backdrop.backdrop.default > div > div > section > div > form > button > span';

/**
 * Searches for a cert number and scrapes the value
 * @param {import('puppeteer').Page} page
 * @param {string} certNumber
 * @param {number|null} previousValue - The raw value of the previous card to check for stale data
 * @returns {Promise<{raw: number, higher: number, confidence: number}|null>} Object containing raw, higher values, and confidence (1-5), or null if failed
 */
async function getCLValue(page, certNumber, previousValue = null, skipStaleCheck = false) {
    if (!certNumber) return null;

    try {
        console.log(`\n🔹 Searching cert: ${certNumber}`);

        // Click Search Icon
        await page.waitForSelector(searchIconSelector, { timeout: 5000 }).catch(() => null);
        const searchIcon = await page.$(searchIconSelector);
        if (!searchIcon) {
            console.warn('Search icon not found!');
            return null;
        }
        await searchIcon.click();
        await wait(800);

        // Type Cert Number
        await page.waitForSelector(inputSelector, { timeout: 5000 });
        const input = await page.$(inputSelector);
        if (!input) {
            console.warn('Input field not found');
            return null;
        }
        // Clear existing input if any
        await input.click({ clickCount: 3 });
        await input.type(String(certNumber), { delay: 50 });

        // Click Submit
        const submitBtn = await page.$(submitBtnSelector);
        if (!submitBtn) {
            console.warn('Submit button not found');
            return null;
        }
        await submitBtn.click();

        // Wait for Results
        let attempts = 0;
        let found = false;
        while (attempts < 20) {
            const container = await page.$(resultsContainerSelector);
            if (container) {
                const childCount = await container.evaluate((el) => el.children.length);
                if (childCount >= 3) {
                    // Original script check
                    found = true;
                    break;
                }
            }
            await wait(500);
            attempts++;
        }

        if (!found) {
            console.warn('Results did not load in time for cert:', certNumber);
            return null;
        }
        await wait(500);

        // Scrape Card Ladder Value
        attempts = 0;
        let cardLadderValue = 0;

        // Wait loop for Value
        while (attempts < MAX_RETRIES) {
            const val = await page.evaluate((sel) => {
                const el = document.querySelector(sel);
                if (el && el.textContent.trim() !== '') {
                    return parseFloat(el.textContent.replace(/[^0-9.]/g, ''));
                }
                return null;
            }, cardLadderSelector);

            if (val !== null && !isNaN(val) && val > 0) {
                cardLadderValue = val;

                // STALE CHECK: If value is same as previous, wait longer to be sure
                if (previousValue !== null && val === previousValue) {
                    if (skipStaleCheck) {
                        console.log('ℹ️ Identical card detected. Skipping stale check.');
                        break; // Accept it immediately
                    }

                    if (attempts % 4 === 0) {
                        // Log every ~2 seconds
                        console.log(`⏳ Value (${val}) matches previous. Waiting for update...`);
                    }
                    // Continue waiting...
                } else {
                    // New value confirmed
                    console.log(`✅ Card Ladder value loaded: ${cardLadderValue}`);
                    break;
                }
            }
            await wait(500);
            attempts++;
        }

        if (cardLadderValue === 0) {
            console.warn('⚠️ Card Ladder value did not load in time');
        } else if (previousValue !== null && cardLadderValue === previousValue) {
            console.log(`ℹ️ Value remained ${cardLadderValue} after waiting. Assuming match.`);
        }

        // Scrape Prices
        // We evaluate in the browser context to be efficient/safe
        const prices = await page.evaluate((selectors) => {
            return selectors.map((sel) => {
                const el = document.querySelector(sel);
                if (!el) return 0;
                return parseFloat(el.textContent.replace(/[^0-9.]/g, '')) || 0;
            });
        }, priceSelectors);

        const average = prices.length ? prices.reduce((a, b) => a + b, 0) / prices.length : 0;

        const higherValue = Math.ceil(Math.max(average, cardLadderValue));
        console.log('💵 Prices:', prices);
        console.log('📈 Average:', average.toFixed(2));
        console.log('🏷 Card Ladder Value (Raw):', cardLadderValue);
        console.log('💰 Higher Value (rounded UP):', higherValue);

        // Scrape Confidence Level (1-5)
        let confidence = 0;
        try {
            // Click on first result to get detailed view
            const firstLink = await page.$(firstResultLinkSelector);
            if (firstLink) {
                await firstLink.click();
                await wait(2000); // Wait for detail view to load

                // Extract confidence from class name (e.g., "confidence-5" -> 5)
                confidence = await page.evaluate((sel) => {
                    const el = document.querySelector(sel);
                    if (el) {
                        const classes = el.className;
                        const match = classes.match(/confidence-(\d+)/);
                        if (match) {
                            return parseInt(match[1]);
                        }
                    }
                    return 0;
                }, confidenceBarsSelector);

                console.log("🎯 Confidence Level:", confidence);

                // Navigate back to search results
                await page.goBack();
                await wait(1000);
            } else {
                console.warn("⚠️ Could not find first result link for confidence check");
            }
        } catch (err) {
            console.warn("⚠️ Failed to scrape confidence:", err.message);
        }

        // Return raw value so we can cache it for next time
        return {
            raw: cardLadderValue,
            higher: higherValue,
            confidence: confidence,
        };
    } catch (error) {
        console.error('Error processing cert:', certNumber, error);
        return null;
    }
}

module.exports = { getCLValue };
