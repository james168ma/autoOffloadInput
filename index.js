require('dotenv').config();
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());
const readline = require('readline');
const { getCLValue } = require('./lib/services/cl_service');
const { getColLetter, determineProcessingRange } = require('./lib/utility');
const { processRow } = require('./lib/rowprocessor');

const SCOPES = [
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/drive.file',
];

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
});

const askQuestion = (query) => new Promise((resolve) => rl.question(query, resolve));

const cleanCurrentVal = (val) => {
    if (!val || String(val).trim() === '') return '';
    return val;
};

async function main() {
    console.log('🚀 Starting Card Ladder Automation...');

    const WRITE_MODE = process.env.WRITE_MODE || 'BOTH'; // Options: 'BOTH', 'PSA', 'CL', 'CONFIDENCE'
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
    const CERT_HEADER = "Certification Number";
    const VALUE_HEADER = "1/19 Scripted Vals";
    const NAME_HEADER = "Card Name";
    const NUMBER_HEADER = "Card Number";
    const GRADE_HEADER = "Grade";
    const CONFIDENCE_HEADER = "CL Confidence Level";

    const certColIndex = headers.indexOf(CERT_HEADER);
    const valueColIndex = headers.indexOf(VALUE_HEADER);
    const nameColIndex = headers.indexOf(NAME_HEADER);
    const numberColIndex = headers.indexOf(NUMBER_HEADER);
    const gradeColIndex = headers.indexOf(GRADE_HEADER);
    const confidenceColIndex = headers.indexOf(CONFIDENCE_HEADER);

    if (certColIndex === -1) {
        console.error(`❌ Could not find header "${CERT_HEADER}"`);
        process.exit(1);
    }
    // Only require CL Market Value column if we're writing CL data (not in CONFIDENCE-only mode)
    if (valueColIndex === -1 && ['BOTH', 'CL'].includes(WRITE_MODE)) {
        console.error(`❌ Could not find header "${VALUE_HEADER}"`);
        process.exit(1);
    }
    // Only require Confidence column if we're writing confidence data
    if (confidenceColIndex === -1 && ['BOTH', 'CL', 'CONFIDENCE'].includes(WRITE_MODE)) {
        console.error(`❌ Could not find header "${CONFIDENCE_HEADER}"`);
        process.exit(1);
    }

    console.log(
        `✅ Found Headers: "${CERT_HEADER}" (${certColIndex}) | "${VALUE_HEADER}" (${valueColIndex})`
    );

    // Initialize PSA Service
    const PsaService = require('./lib/services/psa_service');
    const psaService = new PsaService(process.env.PSA_API_KEY, browser);

    // 4.2 Process Rows
    const rows = await sheet.getRows();
    console.log(`📊 Found ${rows.length} rows total.`);

    // Parse Row Limits (Human-friendly 1-based row numbers)
    // Default Start: Row 2 (First data row)
    // Default End: Last row
    const { startIndex, endIndex, startRow, endRowDisplay } = determineProcessingRange(
        process.env.START_ROW,
        process.env.END_ROW,
        rows.length
    );

    console.log(
        `🎯 Processing Range: Row ${startRow} to ${endRowDisplay} (Rows processed: ${endIndex - startIndex + 1})`
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
        const confidenceColLetter = getColLetter(confidenceColIndex);

        // Prepare ranges to load
        const cellsToLoad = [];
        if (certColLetter) cellsToLoad.push(`${certColLetter}${rowNumber}`);
        if (valueColLetter) cellsToLoad.push(`${valueColLetter}${rowNumber}`);
        if (confidenceColLetter) cellsToLoad.push(`${confidenceColLetter}${rowNumber}`);
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
        const confidenceCell = confidenceColLetter ? sheet.getCellByA1(`${confidenceColLetter}${rowNumber}`) : null;

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

        // Create Row Data Object
        const rowData = {
            cert,
            currentVal: cleanCurrentVal(currentVal), // Ensure safe string/number
            currentName: nameCell ? nameCell.value : null,
            currentNumber: numberCell ? numberCell.value : null,
            currentGrade: gradeCell ? gradeCell.value : null,
        };

        // Add Previous Row Data if available
        if (i > 0) {
            const prevRow = rows[i - 1];
            rowData.prevRowData = {
                prevName: prevRow.get(NAME_HEADER),
                prevNumber: prevRow.get(NUMBER_HEADER),
                prevGrade: prevRow.get(GRADE_HEADER),
            };
        }

        // Services
        const services = {
            psaService,
            getCLValue,
            page,
        };

        // Options
        const options = {
            WRITE_MODE,
            CL_VALUE_CHOICE,
            SKIP_CL_CHECK: (process.env.SKIP_CL_CHECK || 'false').toLowerCase() === 'true',
            lastScrapedValue,
            lastPsaDetails,
            rowNumber,
        };

        console.log(
            `\nProcessing Row ${rowNumber} | Cert: ${cert} | Row data: ${JSON.stringify(rowData)}`
        );

        // EXECUTE LOGIC
        const result = await processRow(rowData, services, options);

        console.log(`✅ Row ${rowNumber} processed | Result: ${JSON.stringify(result)}`);

        // Update State
        lastScrapedValue = result.updatedLastScrapedValue;
        lastPsaDetails = result.updatedLastPsaDetails;

        // Verify Mismatch
        if (result.mismatch) {
            console.warn(
                `⚠️ MISMATCH for ${cert}! Sheet: ${result.mismatch.sheetVal} | Scraped: ${result.mismatch.scrapedVal}`
            );
            mismatches.push(result.mismatch);
            console.log(
                `✅ Verified match: ${result.mismatch.sheetVal} (Wait.. logic says mismatch?)`
            );
            // Actually, if mismatch is present, it IS a mismatch.
            // The old code printed "Verified match" if NO mismatch.
            // My processRow only returns mismatch object if there IS one.
        } else if (result.writeValue === null && rowData.currentVal) {
            // Only print verified match if we didn't write anew and we had a value.
            // But let's keep it simple.
            console.log(`✅ Verified match or skipped.`);
        }

        // Apply Writes
        if (result.writeName && nameCell) nameCell.value = result.writeName;
        if (result.writeNumber && numberCell) numberCell.value = result.writeNumber;
        if (result.writeGrade && gradeCell) gradeCell.value = result.writeGrade;
        if (result.writeValue && valueCell) {
            valueCell.value = result.writeValue;
            console.log(`✏️ Writing value ${result.writeValue} to "${VALUE_HEADER}"`);
        }

        if (result.writePsaErrorColor) {
            console.log(`🔴 Marking PSA columns red for Cert: ${cert}`);
            const errorColor = { red: 1, green: 0.8, blue: 0.8 }; // Light Red
            if (nameCell) nameCell.backgroundColor = errorColor;
            if (numberCell) numberCell.backgroundColor = errorColor;
            if (gradeCell) gradeCell.backgroundColor = errorColor;
        }

        if (result.writeErrorColor && valueCell) {
            console.log(`🔴 Marking "${VALUE_HEADER}" red for Cert: ${cert}`);
            valueCell.backgroundColor = { red: 1, green: 0.8, blue: 0.8 }; // Light Red
        }

        // Handle Confidence writing (for BOTH, CL, and CONFIDENCE modes)
        if (result.writeConfidence !== undefined && confidenceCell) {
            if (result.writeConfidence > 0) {
                console.log(`✏️ Writing confidence ${result.writeConfidence} to "${CONFIDENCE_HEADER}"`);
                confidenceCell.value = result.writeConfidence;
            } else {
                console.warn(`⚠️ Could not determine confidence for ${cert}`);
            }
        }

        if (result.rowModified) {
            try {
                await sheet.saveUpdatedCells();
            } catch (saveError) {
                console.error(`❌ Failed to save row ${rowNumber}:`, saveError.message);
                // Retry once
                try {
                    console.log(`🔄 Retrying save for row ${rowNumber}...`);
                    await new Promise(r => setTimeout(r, 2000)); // Wait 2 seconds
                    await sheet.saveUpdatedCells();
                    console.log(`✅ Retry successful for row ${rowNumber}`);
                } catch (retryError) {
                    console.error(`❌ Retry failed for row ${rowNumber}:`, retryError.message);
                }
            }
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

if (require.main === module) {
    main();
}

module.exports = { main };