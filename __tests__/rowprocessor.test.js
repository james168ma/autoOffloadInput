const { processRow } = require('../lib/rowprocessor');

// Mocks
const mockPsaService = {
    getDetails: jest.fn(),
};
const mockGetCLValue = jest.fn().mockResolvedValue(null);

const mockPage = { name: 'MockPage' };

const services = {
    psaService: mockPsaService,
    getCLValue: mockGetCLValue,
    page: mockPage,
};

describe('processRow Logic', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('should fetch PSA details if missing and WRITE_MODE is BOTH', async () => {
        const rowData = {
            cert: '123',
            currentName: '', // Missing
            currentNumber: '1',
            currentGrade: '10',
        };
        const options = { WRITE_MODE: 'BOTH', rowNumber: 2 };

        mockPsaService.getDetails.mockResolvedValue({
            name: 'Pikachu',
            number: '1',
            grade: '10',
        });

        const result = await processRow(rowData, services, options);

        expect(mockPsaService.getDetails).toHaveBeenCalledWith('123');
        expect(result.writeName).toBe('Pikachu');
        expect(result.rowModified).toBe(true);
    });

    test('should NOT fetch PSA if WRITE_MODE is CL', async () => {
        const rowData = { cert: '123', currentName: '', currentVal: '100' };
        const options = { WRITE_MODE: 'CL', rowNumber: 2 };

        mockGetCLValue.mockResolvedValue(null); // Ensure CL doesn't write either

        const result = await processRow(rowData, services, options);

        expect(mockPsaService.getDetails).not.toHaveBeenCalled();
        expect(result.rowModified).toBe(false); // No change
    });

    test('should scrape CL value and write if empty', async () => {
        const rowData = { cert: '123', currentVal: '' };
        const options = { WRITE_MODE: 'BOTH', CL_VALUE_CHOICE: 'RAW', rowNumber: 2 };

        mockGetCLValue.mockResolvedValue({ raw: 50.2, higher: 55 });

        const result = await processRow(rowData, services, options);

        expect(mockGetCLValue).toHaveBeenCalled();
        expect(result.writeValue).toBe(51); // Ceil(50.2)
        expect(result.rowModified).toBe(true);
    });

    test('should report mismatch if CL value differs', async () => {
        const rowData = { cert: '123', currentVal: '100' };
        const options = { WRITE_MODE: 'BOTH', CL_VALUE_CHOICE: 'HIGHER', rowNumber: 2 };

        mockGetCLValue.mockResolvedValue({ raw: 50, higher: 200 });

        const result = await processRow(rowData, services, options);

        expect(result.writeValue).toBeNull(); // Don't overwrite existing
        expect(result.mismatch).toEqual({
            row: 2,
            cert: '123',
            sheetVal: 100,
            scrapedVal: 200,
        });
    });

    test('should overwrite CL value when FORCE_CL_OVERWRITE is true', async () => {
        const rowData = { cert: '123', currentVal: '100' };
        const options = {
            WRITE_MODE: 'BOTH',
            CL_VALUE_CHOICE: 'HIGHER',
            FORCE_CL_OVERWRITE: true,
            rowNumber: 2,
        };

        mockGetCLValue.mockResolvedValue({ raw: 50, higher: 200 });

        const result = await processRow(rowData, services, options);

        expect(result.writeValue).toBe(200);
        expect(result.rowModified).toBe(true);
        expect(result.mismatch).toBeNull();
    });

    test('should overwrite confidence when FORCE_CONFIDENCE_OVERWRITE is true', async () => {
        const rowData = { cert: '123', currentVal: '' };
        const options = {
            WRITE_MODE: 'CL',
            FORCE_CONFIDENCE_OVERWRITE: true,
            rowNumber: 2,
        };

        mockGetCLValue.mockResolvedValue({ raw: 50, higher: 55, confidence: 2 });

        const result = await processRow(rowData, services, options);

        expect(result.writeConfidence).toBe(2);
    });

    test('should overwrite grade when FORCE_GRADE_OVERWRITE is true', async () => {
        const rowData = { cert: '123', currentVal: '', currentGrade: '9' };
        const options = {
            WRITE_MODE: 'CL',
            FORCE_GRADE_OVERWRITE: true,
            rowNumber: 2,
        };

        mockGetCLValue.mockResolvedValue({ raw: 50, higher: 55, grade: 10 });

        const result = await processRow(rowData, services, options);

        expect(result.writeGrade).toBe(10);
        expect(result.rowModified).toBe(true);
    });

    test('should detect same card from previous row data', async () => {
        const rowData = {
            cert: '123',
            currentName: 'Charizard',
            currentNumber: '4',
            currentGrade: '10',
            prevRowData: {
                prevName: 'Charizard',
                prevNumber: '4',
                prevGrade: '10',
            },
        };
        const options = { WRITE_MODE: 'CL', rowNumber: 3 };

        mockGetCLValue.mockResolvedValue({ raw: 100, higher: 100 });

        await processRow(rowData, services, options);

        // Check if getCLValue came with 'isSameCard = true' -> 3rd arg
        expect(mockGetCLValue).toHaveBeenCalledWith(mockPage, '123', undefined, true, undefined);
    });

    test('should signal error color if CL value fails to load and cell is empty', async () => {
        const rowData = { cert: '123', currentVal: '' };
        const options = { WRITE_MODE: 'BOTH', rowNumber: 4 };

        mockGetCLValue.mockResolvedValue(null); // Simulate failure

        const result = await processRow(rowData, services, options);

        expect(result.writeValue).toBe('No comps');
        expect(result.writeErrorColor).toBe(true);
        expect(result.rowModified).toBe(true);
    });

    test('should signal PSA error color if PSA fetch fails and data is missing', async () => {
        const rowData = {
            cert: '123',
            currentName: '', // Missing
            currentNumber: '', // Missing
            currentGrade: '', // Missing
        };
        const options = { WRITE_MODE: 'BOTH', rowNumber: 5 };

        mockPsaService.getDetails.mockResolvedValue(null); // Simulate failure

        const result = await processRow(rowData, services, options);

        expect(result.writePsaErrorColor).toBe(true);
        expect(result.rowModified).toBe(true);
    });
});
