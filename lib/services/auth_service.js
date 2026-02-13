const wait = (ms) => new Promise((r) => setTimeout(r, ms));

class AuthService {
    /**
     * @param {string} username
     * @param {string} password
     */
    constructor(username, password) {
        this.username = username;
        this.password = password;
        this.targetUrl = 'https://app.cardladder.com/sales-history?direction=desc&sort=date';
    }

    /**
     * Logs into Card Ladder using the provided page.
     * @param {import('puppeteer').Page} page
     * @returns {Promise<boolean>} True if logged in successfully
     */
    async login(page) {
        console.log('➡️ Checking session...');
        await page.goto(this.targetUrl, { waitUntil: 'networkidle2' });

        // Give SPA a moment to settle/redirect
        await wait(2000);

        // Check if we are logged out (URL includes 'login' OR 'Log In' button exists)
        const currentUrl = page.url();
        let loginBtnExists = false;
        try {
            loginBtnExists = await page.evaluate(() => {
                const xpath = "//*[contains(text(), 'Login')]";
                const result = document.evaluate(
                    xpath,
                    document,
                    null,
                    XPathResult.FIRST_ORDERED_NODE_TYPE,
                    null
                );
                return !!result.singleNodeValue;
            });
        } catch {
            console.warn(
                '⚠️ Could not check for login button (context changed?), proceeding with URL check...'
            );
        }

        if (currentUrl.includes('login') || loginBtnExists) {
            console.log('🔒 Not logged in (detected Login button/URL). Attempting automation...');

            if (this.username && this.password) {
                try {
                    // Force navigation to login page to be safe
                    console.log('➡️ Going to Login Page...');
                    await page.goto('https://app.cardladder.com/login', { waitUntil: 'networkidle2' });

                    await page.waitForSelector('input[type="email"]', { timeout: 10000 });

                    // Type and trigger events to ensure framework picks it up
                    await page.type('input[type="email"]', this.username);
                    await page.evaluate(() => {
                        const el = document.querySelector('input[type="email"]');
                        el.dispatchEvent(new Event('input', { bubbles: true }));
                        el.dispatchEvent(new Event('change', { bubbles: true }));
                    });

                    await page.type('input[type="password"]', this.password);
                    await page.evaluate(() => {
                        const el = document.querySelector('input[type="password"]');
                        el.dispatchEvent(new Event('input', { bubbles: true }));
                        el.dispatchEvent(new Event('change', { bubbles: true }));
                    });

                    // Allow a brief moment for validation
                    await wait(1000);

                    console.log('⌨️ Pressing Enter to submit...');
                    await page.keyboard.press('Enter');

                    try {
                        await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 });
                    } catch (navErr) {
                        console.warn('⚠️ Navigation wait ended (possibly success):', navErr.message);
                    }
                    console.log('✅ Login flow completed');

                    // Navigate back to Sales History
                    console.log('➡️ Navigating to Sales History...');
                    await page.goto(this.targetUrl, { waitUntil: 'networkidle2' });
                    return true;
                } catch (err) {
                    console.error('❌ Login failed:', err);
                    throw err;
                }
            } else {
                console.log('\n⚠️  NO CREDENTIALS FOUND (CL_USER/CL_PASS) ⚠️');
                return false;
            }
        } else {
            console.log('✅ Session active! Skipping login.');
            return true;
        }
    }
}

module.exports = AuthService;
