const { getColLetter, isMatch, determineProcessingRange } = require('../utility');

describe('Utility Functions', () => {
    describe('getColLetter', () => {
        test('should return correct letters for indices', () => {
            expect(getColLetter(0)).toBe('A');
            expect(getColLetter(1)).toBe('B');
            expect(getColLetter(25)).toBe('Z');
            expect(getColLetter(26)).toBe('AA');
            expect(getColLetter(27)).toBe('AB');
        });

        test('should return null for negative indices', () => {
            expect(getColLetter(-1)).toBeNull();
        });
    });

    describe('isMatch', () => {
        test('should return true for identical strings', () => {
            expect(isMatch('foo', 'foo')).toBe(true);
        });

        test('should return true for strings matching with whitespace', () => {
            expect(isMatch(' foo ', 'foo')).toBe(true);
        });

        test('should handle null/undefined as empty strings', () => {
            expect(isMatch(null, '')).toBe(true);
            expect(isMatch(undefined, '')).toBe(true);
            expect(isMatch(null, undefined)).toBe(true);
        });

        test('should return false for different strings', () => {
            expect(isMatch('foo', 'bar')).toBe(false);
        });
    });

    describe('determineProcessingRange', () => {
        test('should use defaults when env vars are missing', () => {
            // totalRows = 10 (which means indices 0..9)
            // Default start row is 2 (index 0)
            const result = determineProcessingRange(undefined, undefined, 10);
            expect(result.startRow).toBe(2);
            expect(result.startIndex).toBe(0);
            expect(result.endIndex).toBe(9);
            expect(result.endRowDisplay).toBe('End');
        });

        test('should respect START_ROW', () => {
            // START_ROW=3 (index 1)
            const result = determineProcessingRange('3', undefined, 10);
            expect(result.startRow).toBe(3);
            expect(result.startIndex).toBe(1);
            expect(result.endIndex).toBe(9);
        });

        test('should respect END_ROW', () => {
            // END_ROW=5 (index 3)
            const result = determineProcessingRange(undefined, '5', 10);
            expect(result.startRow).toBe(2);
            expect(result.startIndex).toBe(0);
            expect(result.endIndex).toBe(3); // Row 5 is index 3
            expect(result.endRowDisplay).toBe('Row 5');
        });

        test('should cap END_ROW if it exceeds total rows', () => {
            // END_ROW=100, totalRows=10
            // Should just go to end
            const result = determineProcessingRange(undefined, '100', 10);
            expect(result.startRow).toBe(2);
            expect(result.startIndex).toBe(0);
            expect(result.endIndex).toBe(9); // totalRows - 1
            // Note: My implementation keeps "End" as display if it hits the cap?
            // Actually my implementation checks: if (calculatedEndIndex < endIndex)
            // calculatedEndIndex would be 98. endIndex is 9.
            // 98 !< 9, so it stays as endIndex (totalRows-1) and display "End".
            // Wait, let's check the logic in utility.js again.
            // let endIndex = totalRows - 1; let endRowDisplay = 'End';
            // if (calculated < endIndex) { ... }
            // So if calculated is BIGGER, we use default endIndex and default display. Correct.
            expect(result.endIndex).toBe(9);
            expect(result.endRowDisplay).toBe('End');
        });
    });
});
