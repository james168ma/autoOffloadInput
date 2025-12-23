/**
 * Converts a 0-based column index to a spreadsheet column letter (A, B, C...).
 * @param {number} n - 0-based index
 * @returns {string|null} - Column letter or null if invalid
 */
const getColLetter = (n) => {
    if (n < 0) return null;
    let letter = '';
    while (n >= 0) {
        letter = String.fromCharCode((n % 26) + 65) + letter;
        n = Math.floor(n / 26) - 1;
    }
    return letter;
};

/**
 * Compares two strings safely, trimming whitespace and handling null/undefined.
 * @param {string|null} str1
 * @param {string|null} str2
 * @returns {boolean}
 */
const isMatch = (str1, str2) => {
    return String(str1 || '').trim() === String(str2 || '').trim();
};

/**
 * Determines the start and end indices for processing rows based on environment variables.
 * @param {string|undefined} startRowEnv - process.env.START_ROW
 * @param {string|undefined} endRowEnv - process.env.END_ROW
 * @param {number} totalRows - Total number of rows in the sheet
 * @returns {{startIndex: number, endIndex: number, startRow: number, endRowDisplay: string}}
 */
const determineProcessingRange = (startRowEnv, endRowEnv, totalRows) => {
    const startRowParsed = parseInt(startRowEnv);
    const endRowParsed = parseInt(endRowEnv);

    // Default Start: Row 2 (First data row)
    const startRow = !isNaN(startRowParsed) && startRowParsed >= 2 ? startRowParsed : 2;
    // Calculate start index (Row 2 -> Index 0)
    const startIndex = startRow - 2;

    // Calculate end index
    let endIndex = totalRows - 1;
    let endRowDisplay = 'End';

    if (!isNaN(endRowParsed) && endRowParsed >= startRow) {
        // User provided an explicit end row
        // But we must cap it at totalRows
        const calculatedEndIndex = endRowParsed - 2;
        if (calculatedEndIndex < endIndex) {
            endIndex = calculatedEndIndex;
            endRowDisplay = 'Row ' + endRowParsed;
        }
    }

    return {
        startIndex,
        endIndex,
        startRow,
        endRowDisplay,
    };
};

module.exports = {
    getColLetter,
    isMatch,
    determineProcessingRange,
};
