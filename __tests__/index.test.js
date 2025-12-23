// MOCKS - Must be defined before requires for hoisting to work effectively with factories preventing import
jest.mock('google-spreadsheet', () => {
    return {
        GoogleSpreadsheet: jest.fn(),
    };
});
jest.mock('google-auth-library', () => {
    return {
        JWT: jest.fn(),
    };
});
jest.mock('puppeteer-extra', () => {
    return {
        use: jest.fn(),
        launch: jest.fn(),
    };
});
jest.mock('puppeteer-extra-plugin-stealth', () => jest.fn());
jest.mock('readline', () => ({
    createInterface: jest.fn().mockReturnValue({
        question: jest.fn(),
        close: jest.fn(),
    }),
}));
jest.mock('../cl_service', () => ({
    getCLValue: jest.fn().mockResolvedValue({ raw: 100, higher: 100 }),
}));
jest.mock('../psa_service');
jest.mock('../rowprocessor', () => ({
    processRow: jest.fn().mockResolvedValue({
        rowModified: false,
        mismatch: null,
        updatedLastScrapedValue: 100,
        updatedLastPsaDetails: {},
    }),
}));

const { main } = require('../index');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const puppeteer = require('puppeteer-extra');

// Mock console to avoid clutter
global.console = {
    log: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    table: jest.fn(),
};

// Mock process.exit
const mockExit = jest.spyOn(process, 'exit').mockImplementation(() => {});

describe('index.js main workflow', () => {
    let mockSheet;
    let mockPage;
    let mockBrowser;

    beforeEach(() => {
        jest.clearAllMocks();

        // Setup Environment Variables
        process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = 'test@example.com';
        process.env.GOOGLE_PRIVATE_KEY = 'private_key';
        process.env.SHEET_ID = 'sheet_id';
        process.env.WRITE_MODE = 'BOTH';
        delete process.env.START_ROW;
        delete process.env.END_ROW;
        delete process.env.CL_VALUE_CHOICE;

        // Mock Google Sheet
        mockSheet = {
            title: 'Test Sheet',
            headerValues: [
                'Certification Number',
                'CL Market Value',
                'Card Name',
                'Card Number',
                'Grade',
            ],
            loadHeaderRow: jest.fn().mockResolvedValue(),
            getRows: jest.fn().mockResolvedValue([]),
            loadCells: jest.fn().mockResolvedValue(),
            getCellByA1: jest.fn(),
            saveUpdatedCells: jest.fn().mockResolvedValue(),
        };

        GoogleSpreadsheet.mockImplementation(() => ({
            loadInfo: jest.fn().mockResolvedValue(),
            title: 'Mock Doc',
            sheetsByIndex: [mockSheet],
        }));

        // Mock Puppeteer
        mockPage = {
            goto: jest.fn(),
            url: jest.fn().mockReturnValue('https://app.cardladder.com/sales-history'),
            evaluate: jest.fn(),
            waitForSelector: jest.fn(),
            type: jest.fn(),
            keyboard: { press: jest.fn() },
            waitForNavigation: jest.fn(),
            close: jest.fn(),
        };
        mockBrowser = {
            newPage: jest.fn().mockResolvedValue(mockPage),
            close: jest.fn().mockResolvedValue(),
        };
        puppeteer.launch.mockResolvedValue(mockBrowser);
    });

    test('should run through main matching process with empty rows', async () => {
        // Setup 0 rows
        mockSheet.getRows.mockResolvedValue([]);

        await main();

        expect(GoogleSpreadsheet).toHaveBeenCalled();
        expect(puppeteer.launch).toHaveBeenCalled();
        expect(mockBrowser.close).toHaveBeenCalled();
        expect(mockExit).toHaveBeenCalledWith(0);
    });

    test('should process a row and calculate values', async () => {
        // Setup 1 row
        const mockRow = {
            get: jest.fn((header) => {
                if (header === 'Certification Number') return '123456';
                if (header === 'CL Market Value') return ''; // Empty value, needs write
                return 'Sample Data';
            }),
        };
        mockSheet.getRows.mockResolvedValue([mockRow]);

        // Mock cell objects for writing
        const mockValueCell = { value: null };
        const mockCertCell = { value: '123456' };

        mockSheet.getCellByA1.mockImplementation((a1) => {
            if (a1.startsWith('A')) return mockCertCell;
            if (a1.startsWith('B')) return mockValueCell;
            return { value: 'some data' };
        });

        // Mock login check to skip login flow (already logged in)
        mockPage.url.mockReturnValue('https://app.cardladder.com/sales-history');
        mockPage.evaluate.mockResolvedValue(false); // No login button

        // Mock processRow to return instruction to write 100
        const { processRow } = require('../rowprocessor');
        processRow.mockResolvedValue({
            writeValue: 100,
            rowModified: true,
            updatedLastScrapedValue: 100,
            updatedLastPsaDetails: {},
        });

        await main();

        // Check if getCLValue was called
        // Check if processRow was called
        // Check if processRow was called
        expect(processRow).toHaveBeenCalled();

        // Check if value was written (mockValueCell.value updated)
        // logic: getCLValue returns 100raw. Logic rounds up to 100. Write 100.
        expect(mockValueCell.value).toBe(100);
        expect(mockSheet.saveUpdatedCells).toHaveBeenCalled();
    });
});
