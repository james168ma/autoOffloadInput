const { isMatch } = require('./utility');

/**
 * Core business logic for processing a single row.
 * Decides whether to fetch PSA data, CL data, and what to write.
 *
 * @param {Object} rowData - The current state of the row in the sheet
 * @param {string} rowData.cert
 * @param {string|number|null} rowData.currentVal
 * @param {string|null} rowData.currentName
 * @param {string|null} rowData.currentNumber
 * @param {string|null} rowData.currentGrade
 * @param {Object} prevRowData - Data from the previous row (for simple fallback check)
 * @param {string} prevRowData.name
 * @param {string} prevRowData.number
 * @param {string} prevRowData.grade
 * @param {Object} services - External services
 * @param {Object} services.psaService - Instance of PsaService
 * @param {Function} services.getCLValue - Function(cert, lastVal, isSameCard) -> Promise<{raw, higher}>
 * @param {Object} options - Configuration and State
 * @param {string} options.WRITE_MODE - 'BOTH', 'PSA', 'CL'
 * @param {string} options.CL_VALUE_CHOICE - 'RAW' or 'HIGHER'
 * @param {boolean} options.SKIP_CL_CHECK
 * @param {number|null} options.lastScrapedValue
 * @param {Object|null} options.lastPsaDetails
 * @param {number} options.rowNumber - For logging
 *
 * @returns {Promise<Object>} Result instructions and state updates
 */
async function processRow(rowData, services, options) {
    const { cert, currentVal, currentName, currentNumber, currentGrade } = rowData;

    const prevRowData = rowData.prevRowData || {};
    const { prevName, prevNumber, prevGrade } = prevRowData;

    const { psaService, getCLValue, page } = services;
    const {
        WRITE_MODE,
        CL_VALUE_CHOICE = 'RAW',
        SKIP_CL_CHECK = false,
        lastScrapedValue,
        lastPsaDetails,
        rowNumber,
    } = options;

    const instructions = {
        writeName: null,
        writeNumber: null,
        writeGrade: null,
        writeValue: null,
        rowModified: false,
        mismatch: null,
        updatedLastScrapedValue: lastScrapedValue,
        updatedLastPsaDetails: lastPsaDetails, // Default to carrying over
    };

    // 1. PSA Processing
    // Check if we start with blank fields
    const needsName = !currentName || String(currentName).trim() === '';
    const needsNumber = !currentNumber || String(currentNumber).trim() === '';
    const needsGrade = !currentGrade || String(currentGrade).trim() === '';

    console.log(`current row data ${JSON.stringify(rowData)}`);

    // The working copy of PSA details for this row
    let activePsaDetails = {
        name: currentName,
        number: currentNumber,
        grade: currentGrade,
    };

    if (needsName || needsNumber || needsGrade) {
        if (['BOTH', 'PSA'].includes(WRITE_MODE)) {
            console.log(`🔎 Missing metadata. Fetching from PSA...`);
            const psaData = await psaService.getDetails(cert);

            if (psaData) {
                if (needsName) {
                    instructions.writeName = psaData.name;
                    activePsaDetails.name = psaData.name;
                    instructions.rowModified = true;
                }
                if (needsNumber) {
                    instructions.writeNumber = psaData.number;
                    activePsaDetails.number = psaData.number;
                    instructions.rowModified = true;
                }
                if (needsGrade) {
                    instructions.writeGrade = psaData.grade;
                    activePsaDetails.grade = psaData.grade;
                    instructions.rowModified = true;
                }
            }
        } else {
            console.log(`🔎 Skipping PSA fetch because WRITE_MODE is ${WRITE_MODE}`);
        }
    } else {
        console.log(`🔎 Found metadata. Skipping PSA fetch...`);
    }

    // Update potential State for next row
    // If we fetched new data, or if we had existing data, this is now "current"
    instructions.updatedLastPsaDetails = activePsaDetails;

    // 2. Identify if this is the "Same Card" as previous
    // This optimization helps skip long waits in CL Service
    let isSameCard = false;

    // Check 1: Against last processed PSA details (Memory)
    if (lastPsaDetails) {
        if (
            isMatch(activePsaDetails.name, lastPsaDetails.name) &&
            isMatch(activePsaDetails.number, lastPsaDetails.number) &&
            isMatch(activePsaDetails.grade, lastPsaDetails.grade)
        ) {
            isSameCard = true;
        }
    }

    // Check 2: Fallback to Sheet Previous Row (if loaded)
    if (!isSameCard && prevName) {
        if (
            isMatch(activePsaDetails.name, prevName) &&
            isMatch(activePsaDetails.number, prevNumber) &&
            isMatch(activePsaDetails.grade, prevGrade)
        ) {
            isSameCard = true;
        }
    }

    // 3. CL Value Processing
    if (['BOTH', 'CL'].includes(WRITE_MODE)) {
        let shouldScrape = true;

        if (SKIP_CL_CHECK && currentVal && String(currentVal).trim() !== '') {
            shouldScrape = false;
        }

        if (shouldScrape) {
            console.log(`🔎 Checking CL Value...`);
            const result = await getCLValue(page, cert, lastScrapedValue, isSameCard);
            console.log(`CL Value Result: ${JSON.stringify(result)}`);

            if (result !== null) {
                const { raw, higher } = result;

                // Update State
                instructions.updatedLastScrapedValue = raw;

                // Determine Value to Write
                let newValToWrite;
                if (CL_VALUE_CHOICE === 'HIGHER') {
                    newValToWrite = higher;
                } else {
                    // Default RAW (Ceil)
                    newValToWrite = Math.ceil(raw);
                }

                // Check vs Current
                const hasCurrentVal = currentVal && String(currentVal).trim() !== '';

                if (!hasCurrentVal) {
                    // Write it
                    instructions.writeValue = newValToWrite;
                    instructions.rowModified = true;
                } else {
                    // Compare
                    const cleanCurrent = parseFloat(String(currentVal).replace(/[^0-9.]/g, ''));
                    if (cleanCurrent !== newValToWrite) {
                        instructions.mismatch = {
                            row: rowNumber,
                            cert: cert,
                            sheetVal: cleanCurrent,
                            scrapedVal: newValToWrite,
                        };
                    }
                }
            }
        } else {
            console.log(`Skipping CL check for ${cert} because of SKIP_CL_CHECK`);
        }
    } else {
        console.log(`Skipping CL check for ${cert} because of WRITE_MODE`);
    }

    return instructions;
}

module.exports = { processRow };
