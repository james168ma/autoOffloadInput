require('dotenv').config();
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());
const fs = require('fs');
const readline = require('readline');
const { processCert } = require('./scraper');

const SCOPES = [
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/drive.file',
];

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

const askQuestion = (query) => new Promise((resolve) => rl.question(query, resolve));

async function main() {
    console.log("🚀 Starting Card Ladder Automation...");

    // 1. Setup Google Sheets
    if (!process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || !process.env.GOOGLE_PRIVATE_KEY || !process.env.SHEET_ID) {
        console.error("❌ Missing environment variables. Please check .env file.");
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
        console.error("❌ Failed to load Google Sheet. Check ID and Permissions.");
        console.error(e);
        process.exit(1);
    }

    const sheet = doc.sheetsByIndex[0]; // Assuming first sheet
    console.log(`📄 Using sheet: "${sheet.title}"`);

    // 2. Launch Browser
    console.log("🌍 Launching Browser...");
    const browser = await puppeteer.launch({
        headless: false, // Must be false for manual login
        defaultViewport: null,
        args: ['--start-maximized']
    });

    const page = await browser.newPage();
    await page.goto('https://www.cardladder.com', { waitUntil: 'networkidle2' });

    // 3. User Login Check
    console.log("\n⚠️  ACTION REQUIRED ⚠️");
    console.log("Please log in to Card Ladder in the opened browser window.");
    console.log("Once you are logged in and ready, press ENTER in this terminal to continue...");
    await askQuestion("");
    console.log("👍 Continuing with scraping...");

    // 4. Process Rows
    // 4.1 FIND COLUMNS DYNAMICALLY
    await sheet.loadHeaderRow(); // Ensure headers are loaded
    console.log("Headers found:", sheet.headerValues);
    const headers = sheet.headerValues;

    // Configurable headers
    const CERT_HEADER = "Certification Number";
    const VALUE_HEADER = "CL Market Value When Paid";

    const certColIndex = headers.indexOf(CERT_HEADER);
    const valueColIndex = headers.indexOf(VALUE_HEADER);

    if (certColIndex === -1) {
        console.error(`❌ Could not find header "${CERT_HEADER}"`);
        process.exit(1);
    }
    if (valueColIndex === -1) {
        console.error(`❌ Could not find header "${VALUE_HEADER}"`);
        process.exit(1);
    }

    console.log(`✅ Found Headers: "${CERT_HEADER}" (Index ${certColIndex}) | "${VALUE_HEADER}" (Index ${valueColIndex})`);

    // 4.2 Process Rows
    const rows = await sheet.getRows();
    console.log(`📊 Found ${rows.length} rows to process.`);

    const mismatches = [];

    // We iterate generic rows object
    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];

        // Calculate row number manually to be safe (Header is Row 1, so Data starts at Row 2)
        const rowNumber = i + 2;

        // Load just the cells we need for this row to avoid range errors
        // Convert to A1 notation? Or just use grid range. 
        // We need to load a range that covers both columns.
        // Easiest is to load row range from min(col) to max(col).

        // Helper to convert 0-based column index to letter (A, B, C...)
        const getColLetter = (n) => {
            let letter = '';
            while (n >= 0) {
                letter = String.fromCharCode(n % 26 + 65) + letter;
                n = Math.floor(n / 26) - 1;
            }
            return letter;
        };

        const certColLetter = getColLetter(certColIndex);
        const valueColLetter = getColLetter(valueColIndex);

        // Load only the specific cells using A1 notation
        // e.g. D2:D2 and E2:E2, or if adjacent D2:E2.
        // We can pass an array of ranges to loadCells.

        await sheet.loadCells([
            `${certColLetter}${rowNumber}`,
            `${valueColLetter}${rowNumber}`
        ]);

        const certCell = sheet.getCellByA1(`${certColLetter}${rowNumber}`);
        const valueCell = sheet.getCellByA1(`${valueColLetter}${rowNumber}`);

        const cert = certCell.value;
        const currentVal = valueCell.value;

        if (!cert) {
            console.log(`Skipping Row ${rowNumber}: No Cert found`);
            continue;
        }

        console.log(`\nProcessing Row ${rowNumber} | Cert: ${cert}`);

        // Scrape
        const newVal = await processCert(page, cert);

        if (newVal === null) {
            console.warn(`Failed to scrape value for ${cert}`);
            continue;
        }

        if (!currentVal || currentVal.toString().trim() === "") {
            // Case: Empty Column -> Write
            console.log(`✏️ Writing value ${newVal} to "${VALUE_HEADER}"`);
            valueCell.value = newVal;
            await sheet.saveUpdatedCells(); // Only saves cells we loaded and modified
        } else {
            // Case: Filled -> Compare
            // Clean currentVal (remove $ or , or %)
            const cleanCurrent = parseFloat(currentVal.toString().replace(/[^0-9.]/g, ''));

            if (cleanCurrent !== newVal) {
                console.warn(`⚠️ MISMATCH for ${cert}! Sheet: ${cleanCurrent} | Scraped: ${newVal}`);
                mismatches.push({
                    row: rowNumber,
                    cert: cert,
                    sheetVal: cleanCurrent,
                    scrapedVal: newVal
                });
            } else {
                console.log(`✅ Verified match: ${cleanCurrent}`);
            }
        }
    }

    // 5. Summary
    console.log("\n\n🏁 Processing Complete!");
    if (mismatches.length > 0) {
        console.warn("\n⚠️ Found Mismatches:");
        console.table(mismatches);
    } else {
        console.log("No mismatches found.");
    }

    await browser.close();
    process.exit(0);
}

main();
