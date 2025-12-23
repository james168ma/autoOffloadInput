require('dotenv').config();
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());
const readline = require('readline');
const { getCLValue } = require('./cl_service');

const SCOPES = [
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/drive.file',
];

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
});

const askQuestion = (query) => new Promise((resolve) => rl.question(query, resolve));

// Helper to convert 0-based column index to letter (A, B, C...)
const getColLetter = (n) => {
    if (n < 0) return null;
    let letter = '';
    while (n >= 0) {
        letter = String.fromCharCode((n % 26) + 65) + letter;
        n = Math.floor(n / 26) - 1;
    }
    return letter;
};

async function main() {
    console.log('🚀 Starting Card Ladder Automation...');

    const WRITE_MODE = process.env.WRITE_MODE || 'BOTH'; // Options: 'BOTH', 'PSA', 'CL'
    console.log(`📝 Write Mode: ${WRITE_MODE}`);

    // 1. Setup Google Sheets
    if (
        !process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ||
        !process.env.GOOGLE_PRIVATE_KEY ||
        !process.env.SHEET_ID
    ) {
        console.error('❌ Missing environment variables. Please check .env file.');
        process.exit(1);
    }

    // Initialize Auth
    const jwt = new JWT({
        email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
        key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
        scopes: SCOPES,
    });

    const doc = new GoogleSpreadsheet(process.env.SHEET_ID, jwt);

    try {
        await doc.loadInfo();
        console.log(`✅ Loaded Google Sheet: "${doc.title}"`);
    } catch (e) {
        console.error('❌ Failed to load Google Sheet. Check ID and Permissions.');
        console.error(e);
        process.exit(1);
    }

    const sheet = doc.sheetsByIndex[0]; // Assuming first sheet
    console.log(`📄 Using sheet: "${sheet.title}"`);

    // 2. Launch Browser
    console.log('🌍 Launching Browser...');
    const browser = await puppeteer.launch({
        headless: false, // Must be false for manual login
        defaultViewport: null,
        userDataDir: './user_data', // SAVE SESSION DATA
        args: ['--start-maximized'],
    });

    const page = await browser.newPage();

    // 3. Login Check with Persistence
    const targetUrl = 'https://app.cardladder.com/sales-history?direction=desc&sort=date';
    console.log('➡️ Checking session...');
    await page.goto(targetUrl, { waitUntil: 'networkidle2' });

    // List of reliable selectors that indicate we are logged in (e.g. user menu, dashboard)
    // or logged out (login form).

    // Give SPA a moment to settle/redirect
    await new Promise((r) => setTimeout(r, 2000));

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

        if (process.env.CL_USER && process.env.CL_PASS) {
            try {
                // Force navigation to login page to be safe
                console.log('➡️ Going to Login Page...');
                await page.goto('https://app.cardladder.com/login', { waitUntil: 'networkidle2' });

                await page.waitForSelector('input[type="email"]', { timeout: 10000 });

                // Type and trigger events to ensure framework picks it up
                await page.type('input[type="email"]', process.env.CL_USER);
                await page.evaluate(() => {
                    const el = document.querySelector('input[type="email"]');
                    el.dispatchEvent(new Event('input', { bubbles: true }));
                    el.dispatchEvent(new Event('change', { bubbles: true }));
                });

                await page.type('input[type="password"]', process.env.CL_PASS);
                await page.evaluate(() => {
                    const el = document.querySelector('input[type="password"]');
                    el.dispatchEvent(new Event('input', { bubbles: true }));
                    el.dispatchEvent(new Event('change', { bubbles: true }));
                });

                // Allow a brief moment for validation
                await new Promise((r) => setTimeout(r, 1000));

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
                await page.goto(targetUrl, { waitUntil: 'networkidle2' });
            } catch (err) {
                console.error('❌ Login failed:', err);
                process.exit(1);
            }
        } else {
            console.log('\n⚠️  NO CREDENTIALS FOUND (CL_USER/CL_PASS) ⚠️');
            console.log('Please log in to Card Ladder in the opened browser window.');
            console.log(
                'Once you are logged in and ready, press ENTER in this terminal to continue...'
            );
            await askQuestion('');
        }
    } else {
        console.log('✅ Session active! Skipping login.');
    }
    console.log('👍 Continuing with scraping...');

    // 4. Process Rows
    // 4.1 FIND COLUMNS DYNAMICALLY
    await sheet.loadHeaderRow(); // Ensure headers are loaded
    console.log('Headers found:', sheet.headerValues);
    const headers = sheet.headerValues;

    // Configurable headers
    const CERT_HEADER = 'Certification Number';
    const VALUE_HEADER = 'CL Market Value';
    const NAME_HEADER = 'Card Name';
    const NUMBER_HEADER = 'Card Number';
    const GRADE_HEADER = 'Grade';

    const certColIndex = headers.indexOf(CERT_HEADER);
    const valueColIndex = headers.indexOf(VALUE_HEADER);
    const nameColIndex = headers.indexOf(NAME_HEADER);
    const numberColIndex = headers.indexOf(NUMBER_HEADER);
    const gradeColIndex = headers.indexOf(GRADE_HEADER);

    if (certColIndex === -1) {
        console.error(`❌ Could not find header "${CERT_HEADER}"`);
        process.exit(1);
    }
    if (valueColIndex === -1) {
        console.error(`❌ Could not find header "${VALUE_HEADER}"`);
        process.exit(1);
    }

    console.log(
        `✅ Found Headers: "${CERT_HEADER}" (${certColIndex}) | "${VALUE_HEADER}" (${valueColIndex})`
    );

    // Initialize PSA Service
    const PsaService = require('./psa_service');
    const psaService = new PsaService(process.env.PSA_API_KEY, browser);

    // 4.2 Process Rows
    const rows = await sheet.getRows();
    console.log(`📊 Found ${rows.length} rows total.`);

    // Parse Row Limits (Human-friendly 1-based row numbers)
    // Default Start: Row 2 (First data row)
    // Default End: Last row
    const startRowEnv = parseInt(process.env.START_ROW);
    const endRowEnv = parseInt(process.env.END_ROW);

    const startRow = !isNaN(startRowEnv) && startRowEnv >= 2 ? startRowEnv : 2;
    // Calculate start index (Row 2 -> Index 0)
    const startIndex = startRow - 2;

    // Calculate end index
    // If END_ROW is set, use it (converted to index). Otherwise use last index.
    let endIndex = rows.length - 1;
    if (!isNaN(endRowEnv) && endRowEnv >= startRow) {
        endIndex = Math.min(endRowEnv - 2, rows.length - 1);
    }

    console.log(
        `🎯 Processing Range: Row ${startRow} to ${!isNaN(endRowEnv) ? 'Row ' + endRowEnv : 'End'} (Rows processed: ${endIndex - startIndex + 1})`
    );

    const mismatches = [];

    let lastScrapedValue = null; // Store RAW unrounded value for stale checks
    let lastPsaDetails = null; // Store { name, number, grade } to detect identical cards

    // Options: 'RAW' (default) or 'HIGHER'
    const CL_VALUE_CHOICE = process.env.CL_VALUE_CHOICE || 'RAW';
    console.log(`⚖️  Value Choice: ${CL_VALUE_CHOICE}`);

    for (let i = startIndex; i <= endIndex; i++) {
        const row = rows[i];
        if (!row) break;

        const rowNumber = i + 2; // Manual calculation for row number

        console.log(`\nProcessing Row ${rowNumber} | Cert: ${row.get(CERT_HEADER) || 'N/A'}`);

        // Load just the cells we need for this row to avoid range errors
        // Convert to A1 notation? Or just use grid range.
        // We need to load a range that covers both columns.
        const certColLetter = getColLetter(certColIndex);
        const valueColLetter = getColLetter(valueColIndex);

        // Prepare ranges to load
        const cellsToLoad = [];
        if (certColLetter) cellsToLoad.push(`${certColLetter}${rowNumber}`);
        if (valueColLetter) cellsToLoad.push(`${valueColLetter}${rowNumber}`);
        if (nameColIndex !== -1) cellsToLoad.push(`${getColLetter(nameColIndex)}${rowNumber}`);
        if (numberColIndex !== -1) cellsToLoad.push(`${getColLetter(numberColIndex)}${rowNumber}`);
        if (gradeColIndex !== -1) cellsToLoad.push(`${getColLetter(gradeColIndex)}${rowNumber}`);

        if (cellsToLoad.length > 0) {
            await sheet.loadCells(cellsToLoad);
        }

        const certCell = certColLetter ? sheet.getCellByA1(`${certColLetter}${rowNumber}`) : null;
        const valueCell = valueColLetter
            ? sheet.getCellByA1(`${valueColLetter}${rowNumber}`)
            : null;

        const nameCell =
            nameColIndex !== -1
                ? sheet.getCellByA1(`${getColLetter(nameColIndex)}${rowNumber}`)
                : null;
        const numberCell =
            numberColIndex !== -1
                ? sheet.getCellByA1(`${getColLetter(numberColIndex)}${rowNumber}`)
                : null;
        const gradeCell =
            gradeColIndex !== -1
                ? sheet.getCellByA1(`${getColLetter(gradeColIndex)}${rowNumber}`)
                : null;

        const cert = certCell ? certCell.value : null;
        const currentVal = valueCell ? valueCell.value : null;

        if (!cert) {
            console.log(`Skipping Row ${rowNumber}: No Cert found`);
            continue;
        }

        console.log(`\nProcessing Row ${rowNumber} | Cert: ${cert}`);
        let rowModified = false;

        // Current PSA Details (starts with cell values)
        let currentPsaDetails = {
            name: nameCell ? nameCell.value : null,
            number: numberCell ? numberCell.value : null,
            grade: gradeCell ? gradeCell.value : null,
        };

        // --- PSA INTEGRATION ---
        const needsName = nameCell && (!nameCell.value || nameCell.value.toString().trim() === '');
        const needsNumber =
            numberCell && (!numberCell.value || numberCell.value.toString().trim() === '');
        const needsGrade =
            gradeCell && (!gradeCell.value || gradeCell.value.toString().trim() === '');

        if (needsName || needsNumber || needsGrade) {
            // ONLY fetch/write if mode is BOTH or PSA
            if (['BOTH', 'PSA'].includes(WRITE_MODE)) {
                console.log(`🔎 Missing metadata. Fetching from PSA...`);
                const psaData = await psaService.getDetails(cert);

                if (psaData) {
                    if (needsName && nameCell) {
                        nameCell.value = psaData.name;
                        rowModified = true;
                    }
                    if (needsNumber && numberCell) {
                        numberCell.value = psaData.number;
                        rowModified = true;
                    }
                    if (needsGrade && gradeCell) {
                        gradeCell.value = psaData.grade;
                        rowModified = true;
                    }

                    // Update our current details object with fetched data
                    if (psaData.name) currentPsaDetails.name = psaData.name;
                    if (psaData.number) currentPsaDetails.number = psaData.number;
                    if (psaData.grade) currentPsaDetails.grade = psaData.grade;
                }
            } else {
                console.log(`⏭️  Skipping PSA fetch (Write Mode: ${WRITE_MODE})`);
            }
        }

        // Check if SAME card as previous
        let isSameCard = false;

        // Helper for safe comparison
        const isMatch = (str1, str2) => String(str1 || '').trim() === String(str2 || '').trim();

        // Check 1: In-memory last details
        if (lastPsaDetails) {
            if (
                isMatch(currentPsaDetails.name, lastPsaDetails.name) &&
                isMatch(currentPsaDetails.number, lastPsaDetails.number) &&
                isMatch(currentPsaDetails.grade, lastPsaDetails.grade)
            ) {
                isSameCard = true;
            }
        }

        // Check 2: Fallback to previous row in Sheet (iff not already confirmed and we have a previous row)
        if (!isSameCard && i > 0) {
            const prevRow = rows[i - 1];
            // We must read the raw values from the previous row object
            const prevName = prevRow.get(NAME_HEADER);
            const prevNumber = prevRow.get(NUMBER_HEADER);
            const prevGrade = prevRow.get(GRADE_HEADER);

            if (
                isMatch(currentPsaDetails.name, prevName) &&
                isMatch(currentPsaDetails.number, prevNumber) &&
                isMatch(currentPsaDetails.grade, prevGrade)
            ) {
                console.log(`ℹ️  Fallback Match: Current row matches previous row in Sheet.`);
                isSameCard = true;
            }
        }

        // Scrape
        if (['BOTH', 'CL'].includes(WRITE_MODE)) {
            const SKIP_CL_CHECK = (process.env.SKIP_CL_CHECK || 'false').toLowerCase() === 'true';

            // Check if we should skip because value exists
            if (SKIP_CL_CHECK && currentVal && currentVal.toString().trim() !== '') {
                console.log(
                    `⏭️  Skipping CL Value Check (SKIP_CL_CHECK=true & value exists: ${currentVal})`
                );
            } else {
                const result = await getCLValue(page, cert, lastScrapedValue, isSameCard);

                if (result === null) {
                    console.warn(`Failed to scrape value for ${cert}`);
                    continue;
                }

                const { raw, higher } = result;

                // Update Caches
                lastScrapedValue = raw;
                lastPsaDetails = currentPsaDetails;

                // Determine which value to write based on CL_VALUE_CHOICE
                let newValToWrite;
                if (CL_VALUE_CHOICE === 'HIGHER') {
                    newValToWrite = higher;
                    console.log(`👉 Using HIGHER value: ${newValToWrite}`);
                } else {
                    // Default to RAW (Card Ladder Value) - Round UP
                    newValToWrite = Math.ceil(raw);
                    console.log(`👉 Using RAW value: ${newValToWrite}`);
                }

                if (!currentVal || currentVal.toString().trim() === '') {
                    // Case: Empty Column -> Write
                    console.log(`✏️ Writing value ${newValToWrite} to "${VALUE_HEADER}"`);
                    if (valueCell) {
                        valueCell.value = newValToWrite;
                        rowModified = true;
                    }
                } else {
                    // Case: Filled -> Compare
                    // Clean currentVal (remove $ or , or %)
                    const cleanCurrent = parseFloat(currentVal.toString().replace(/[^0-9.]/g, ''));

                    if (cleanCurrent !== newValToWrite) {
                        console.warn(
                            `⚠️ MISMATCH for ${cert}! Sheet: ${cleanCurrent} | Scraped: ${newValToWrite}`
                        );
                        mismatches.push({
                            row: rowNumber,
                            cert: cert,
                            sheetVal: cleanCurrent,
                            scrapedVal: newValToWrite,
                        });
                    } else {
                        console.log(`✅ Verified match: ${cleanCurrent}`);
                    }
                }
            }
        } else {
            console.log(`⏭️  Skipping CL Value (Write Mode: ${WRITE_MODE})`);
        }
        if (rowModified) {
            await sheet.saveUpdatedCells();
        }
    }

    // 5. Summary
    console.log('\n\n🏁 Processing Complete!');
    if (mismatches.length > 0) {
        console.warn('\n⚠️ Found Mismatches:');
        console.table(mismatches);
    } else {
        console.log('No mismatches found.');
    }

    await browser.close();
    process.exit(0);
}

main();
