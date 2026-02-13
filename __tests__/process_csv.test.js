const { parseCsvLine, escapeCsvValue } = require('../process_csv');

describe('CSV Helpers', () => {
    describe('parseCsvLine', () => {
        test('should parse simple comma-separated values', () => {
            const line = 'a,b,c';
            expect(parseCsvLine(line)).toEqual(['a', 'b', 'c']);
        });

        test('should handle quoted values with commas', () => {
            const line = '"a,b",c';
            expect(parseCsvLine(line)).toEqual(['a,b', 'c']);
        });

        test('should handle empty values', () => {
            const line = 'a,,c';
            expect(parseCsvLine(line)).toEqual(['a', '', 'c']);
        });
    });

    describe('escapeCsvValue', () => {
        test('should escape values with commas', () => {
            expect(escapeCsvValue('a,b')).toBe('"a,b"');
        });

        test('should escape values with quotes', () => {
            expect(escapeCsvValue('a"b')).toBe('"a""b"');
        });

        test('should return string for normal values', () => {
            expect(escapeCsvValue('abc')).toBe('abc');
            expect(escapeCsvValue(123)).toBe('123');
        });

        test('should handle null/undefined', () => {
            expect(escapeCsvValue(null)).toBe('');
            expect(escapeCsvValue(undefined)).toBe('');
        });
    });
});
