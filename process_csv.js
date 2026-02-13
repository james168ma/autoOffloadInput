require('dotenv').config();
const fs = require('fs');
const readline = require('readline');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const AuthService = require('./lib/services/auth_service');
const PsaService = require('./lib/services/psa_service');
const { getCLValue } = require('./lib/services/cl_service');
const { processRow } = require('./lib/rowprocessor');

puppeteer.use(StealthPlugin());

/**
 * Parses a CSV line into an array of values, handling quotes.
 * @param {string} text
 * @returns {string[]}
 */
function parseCsvLine(text) {
    const result = [];
    let cell = '';
    let quote = false;
    for (let i = 0; i < text.length; i++) {
        const char = text[i];
        if (char === '"') {
            quote = !quote;
        } else if (char === ',' && !quote) {
            result.push(cell);
            cell = '';
        } else {
            cell += char;
        }
    }
    result.push(cell);
    return result;
}

/**
 * Escapes a value for CSV output.
 * @param {string|number|null|undefined} value
 * @returns {string}
 */
function escapeCsvValue(value) {
    if (value === null || value === undefined) return '';
    const stringValue = String(value);
    if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) {
        return `"${stringValue.replace(/"/g, '""')}"`;
    }
    return stringValue;
}

async function main() {
    const inputFilename = process.argv[2];
    if (!inputFilename) {
        console.error('❌ Usage: node process_csv.js <input_file.csv>');
        process.exit(1);
    }

    if (!fs.existsSync(inputFilename)) {
        console.error(`❌ Input file not found: ${inputFilename}`);
        process.exit(1);
    }

    const outputFilename = inputFilename.replace('.csv', '_filled.csv');
    console.log(`🚀 Starting CSV Processing...`);
    console.log(`📂 Input: ${inputFilename}`);
    console.log(`📂 Output: ${outputFilename}`);

    // --- 1. Launch Browser & Login ---
    console.log('🌍 Launching Browser...');
    const browser = await puppeteer.launch({
        headless: false,
        defaultViewport: null,
        userDataDir: './user_data',
        args: ['--start-maximized'],
    });

    const page = await browser.newPage();
    const authService = new AuthService(process.env.CL_USER, process.env.CL_PASS);
    const loggedIn = await authService.login(page);

    if (!loggedIn) {
        console.error('❌ Failed to login or no credentials provided. Exiting.');
        await browser.close();
        process.exit(1);
    }

    // --- 2. Setup Services ---
    const psaService = new PsaService(process.env.PSA_API_KEY, browser);

    // Config -- ONLY TOUCH IF YOU KNOW WHAT YOU ARE DOING
    const WRITE_MODE = 'BOTH';
    const CL_VALUE_CHOICE = 'RAW';
    const SKIP_CL_CHECK = false;
    const FORCE_CL_OVERWRITE = false;
    const FORCE_CONFIDENCE_OVERWRITE = false;
    const FORCE_GRADE_OVERWRITE = false;

    // --- 3. Read & Process CSV ---
    // Read input file line by line
    const fileStream = fs.createReadStream(inputFilename);
    const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity,
    });

    let headers = [];
    let headerMap = {};
    let headersFound = false;
    let processedCount = 0;

    const outputFileExists = fs.existsSync(outputFilename);
    const outputStream = fs.createWriteStream(outputFilename, { flags: 'a' });

    let lastScrapedValue = null;
    let lastPsaDetails = null;
    let prevRowData = {}; // Store previous row for "Same Card" logic

    for await (const line of rl) {
        // Parse line immediately to check content
        const values = parseCsvLine(line);

        if (!headersFound) {
            // Check if this line is the header
            if (values.includes('Certification Number')) {
                headers = values;
                headers.forEach((h, i) => {
                    headerMap[h.trim()] = i;
                });
                headersFound = true;
                console.log('✅ Headers found:', headers);

                // Write headers if new file
                if (!outputFileExists) {
                    outputStream.write(headers.map(escapeCsvValue).join(',') + '\n');
                }
            } else {
                // Not a header row, and we haven't found headers yet.
                // If it's a pre-header row (like the empty one), just preserve it?
                // Or if we are appending to an existing file, we might assume the file structure matches.
                // If output file exists, we probably don't need to write pre-header garbage if it's already there?
                // EXCEPT: If we are creating a NEW file, we must replicate the structure.
                if (!outputFileExists) {
                    outputStream.write(values.map(escapeCsvValue).join(',') + '\n');
                }
            }
            continue;
        }

        // --- Data Row Processing ---
        // Pad values if short
        while (values.length < headers.length) {
            values.push('');
        }

        // Helper to get/set value by header name
        const getVal = (header) => {
            const idx = headerMap[header];
            if (idx === undefined || idx < 0) return null;
            return values[idx];
        };

        const setVal = (header, val) => {
            const idx = headerMap[header];
            if (idx !== undefined && idx >= 0) {
                values[idx] = val;
            }
        };

        const cert = getVal('Certification Number');
        if (!cert) {
            // Empty row or no cert, just write it as is
            outputStream.write(values.map(escapeCsvValue).join(',') + '\n');
            continue;
        }

        const rowNumber = processedCount + 2; // Approximate row number

        console.log(`\nProcessing Row ${rowNumber} | Cert: ${cert}`);

        const rowData = {
            cert,
            currentVal: getVal('CL Market Value'),
            currentName: getVal('Card Name'),
            currentNumber: getVal('Card Number'),
            currentGrade: getVal('Grade'),
            prevRowData, // Pass previous row details
        };

        // Services wrapper
        const services = {
            psaService,
            getCLValue,
            page,
        };

        // Options
        const options = {
            WRITE_MODE,
            CL_VALUE_CHOICE,
            SKIP_CL_CHECK,
            CL_API_KEY: process.env.CL_API_KEY,
            FORCE_CL_OVERWRITE,
            FORCE_CONFIDENCE_OVERWRITE,
            FORCE_GRADE_OVERWRITE,
            lastScrapedValue,
            lastPsaDetails,
            rowNumber,
        };

        try {
            const result = await processRow(rowData, services, options);

            // Apply updates to `values` array
            if (result.writeName) setVal('Card Name', result.writeName);
            if (result.writeNumber) setVal('Card Number', result.writeNumber);
            if (result.writeGrade) setVal('Grade', result.writeGrade);
            if (result.writeValue) setVal('CL Market Value', result.writeValue);
            if (result.writeConfidence) setVal('CL Confidence Level', result.writeConfidence);

            // State updates
            lastScrapedValue = result.updatedLastScrapedValue;
            lastPsaDetails = result.updatedLastPsaDetails;

            // Update prevRowData for next iteration
            prevRowData = {
                prevName: getVal('Card Name'),
                prevNumber: getVal('Card Number'),
                prevGrade: getVal('Grade'),
            };

            // Write row to output
            outputStream.write(values.map(escapeCsvValue).join(',') + '\n');

            processedCount++;

        } catch (err) {
            console.error(`❌ Error processing row ${rowNumber}:`, err);
            // Write original row on error to preserve data? Or partial?
            // Let's write what we have (values) which might be partially updated or original
            outputStream.write(values.map(escapeCsvValue).join(',') + '\n');
        }
    }

    console.log(`\n✅ Processing complete. ${processedCount} rows processed.`);
    outputStream.end();
    await browser.close();
}

if (require.main === module) {
    main();
}

module.exports = { main, parseCsvLine, escapeCsvValue };
