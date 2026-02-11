// We use global fetch (Node 18+)

class PsaService {
    /**
     * @param {string} apiKey - PSA API Key
     * @param {import('puppeteer').Browser} browser - Puppeteer browser instance
     */
    constructor(apiKey, browser) {
        this.apiKey = apiKey;
        this.browser = browser;
    }

    /**
     * Fetch card details by Cert Number
     * @param {string} cert
     * @returns {Promise<{name: string, number: string, grade: string}|null>}
     */
    async getDetails(cert) {
        // 1. Try API
        if (this.apiKey) {
            try {
                // Official PSA Public API endpoint
                const response = await fetch(
                    `https://api.psacard.com/publicapi/cert/GetByCertNumber/${cert}`,
                    {
                        method: 'GET',
                        headers: {
                            Authorization: `Bearer ${this.apiKey}`,
                            'Content-Type': 'application/json',
                        },
                    }
                );

                if (response.ok) {
                    const data = await response.json();
                    if (data && data.PSACert) {
                        const certData = data.PSACert;
                        // Map API fields to our needs
                        // Usually: Subject, CardNumber, CardGrade
                        console.log(`✅ [PSA API] Found: ${certData.Subject}`);

                        let grade = certData.CardGrade || '';
                        // User wants just the number (e.g. "GEM MT 10" -> "10")
                        const gradeMatch = grade.match(/(\d+(?:\.\d+)?)$/);
                        if (gradeMatch) {
                            grade = parseFloat(gradeMatch[1]); // Convert to Number to avoid '10 in Sheets
                        }

                        return {
                            name: certData.Subject || certData.CardName || '', // Fallback field names just in case
                            number: certData.CardNumber || '',
                            grade: grade,
                        };
                    }
                } else {
                    console.warn(
                        `⚠️ [PSA API] Failed for ${cert}: ${response.status} ${response.statusText}`
                    );
                }
            } catch (err) {
                console.error(`❌ [PSA API] Error: ${err.message}`);
            }
        } else {
            console.log('ℹ️ [PSA] No API Key provided, skipping API.');
        }

        // 2. Fallback to Scraper
        return await this.scrapeDetails(cert);
    }

    /**
     * Scrape details using Puppeteer (Fallback)
     * @param {string} cert
     */
    async scrapeDetails(cert) {
        console.log(`To [PSA Scraper] Fetching ${cert}...`);
        const url = `https://www.psacard.com/cert/${cert}`;

        let page = null;
        try {
            if (!this.browser) {
                console.error('❌ [PSA Scraper] No browser available for scraping.');
                return null;
            }

            // OPEN NEW TAB
            page = await this.browser.newPage();

            // Retry logic for "Something's not right" errors
            const MAX_RETRIES = 5;
            let attempt = 0;
            let contentLoaded = false;

            while (attempt < MAX_RETRIES && !contentLoaded) {
                attempt++;
                
                if (attempt > 1) {
                    console.log(`🔄 [PSA Scraper] Retry attempt ${attempt}/${MAX_RETRIES} for ${cert}...`);
                }

                await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

                // Wait for potential Cloudflare check
                await new Promise(r => setTimeout(r, 3000));

                // specific cloudflare check from example
                try {
                    const cfCheckbox = await page.$('input[type="checkbox"]');
                    if (cfCheckbox) {
                        console.log('☁️ [PSA Scraper] Cloudflare detected...');
                        await cfCheckbox.click();
                        await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 });
                    }
                } catch {
                    /* ignore */
                }
                
                // Check if content loaded successfully OR if there's an error
                const pageStatus = await page.evaluate(() => {
                    const bodyText = document.body.textContent.toLowerCase();
                    const hasError = bodyText.includes("something's not right") || 
                                   bodyText.includes('something is not right');
                    const hasDt = document.querySelector('dt') !== null;
                    
                    return { hasError, hasDt };
                });

                if (pageStatus.hasError) {
                    console.log(`⚠️ [PSA Scraper] "Something's not right" detected, refreshing...`);
                    await new Promise(r => setTimeout(r, 2000));
                    continue;
                }

                if (!pageStatus.hasDt) {
                    if (attempt === MAX_RETRIES) {
                        console.warn('⚠️ [PSA Scraper] No content found after all retries.');
                        return null;
                    }
                    console.log(`⚠️ [PSA Scraper] No content on attempt ${attempt}, will retry...`);
                    await new Promise(r => setTimeout(r, 2000));
                    continue;
                }

                // Content successfully loaded
                contentLoaded = true;
            }

            if (!contentLoaded) {
                console.warn('⚠️ [PSA Scraper] Failed to load content after all retries.');
                return null;
            }

            const data = await page.evaluate(() => {
                function getValueByLabel(labelText) {
                    // Find all DTs
                    const dts = Array.from(document.querySelectorAll('dt'));
                    const targetDt = dts.find((el) => el.textContent.trim() === labelText);
                    if (targetDt && targetDt.nextElementSibling) {
                        return targetDt.nextElementSibling.textContent.trim();
                    }
                    return '';
                }

                // User requested: "right div within the div that contains the word Subject"
                // In DOM reality, it's dt -> dd
                let name = getValueByLabel('Subject');
                let number = getValueByLabel('Card Number');

                // For Grade, staying with previous logic or try label if acts same way
                // Usually PSA has "Grade" label too? Let's try label first, fallback to selector
                let grade = getValueByLabel('Grade');

                if (!grade) {
                    // Fallback to old selector if "Grade" label not found
                    const gradeEl = document.querySelector(
                        'div.grid.grid-cols-2.gap-2 > div:nth-child(1) > p.mt-1.text-center.text-body1.font-semibold.uppercase.text-primary'
                    );
                    if (gradeEl) {
                        grade = gradeEl.textContent.trim();
                    }
                }

                // Clean grade (numeric part)
                const gradeNumberMatch = grade.match(/(\d+(?:\.\d+)?)/);
                if (gradeNumberMatch) {
                    grade = parseFloat(gradeNumberMatch[1]);
                }

                return { name, number, grade };
            });

            console.log(`✅ [PSA Scraper] Found: ${data.name} | Grade: ${data.grade}`);
            
            // Add delay between requests to avoid bot detection
            await new Promise(r => setTimeout(r, 2000));
            
            return data;
        } catch (error) {
            console.error(`❌ [PSA Scraper] Error: ${error.message}`);
            return null;
        } finally {
            if (page) {
                await page.close();
            }
        }
    }
}

module.exports = PsaService;
