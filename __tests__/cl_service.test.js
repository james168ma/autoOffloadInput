const { getCLValue } = require('../cl_service');

describe('cl_service', () => {
    let mockPage;
    let mockElement;

    beforeEach(() => {
        jest.setTimeout(30000);
        jest.clearAllMocks();

        // Basic mock element with necessary methods
        mockElement = {
            click: jest.fn(),
            type: jest.fn(),
            evaluate: jest.fn(),
        };

        // Mock Page object
        mockPage = {
            waitForSelector: jest.fn().mockResolvedValue(true),
            $: jest.fn().mockResolvedValue(mockElement),
            evaluate: jest.fn(),
        };
    });

    test('should return null if certNumber is missing', async () => {
        const result = await getCLValue(mockPage, null);
        expect(result).toBeNull();
    });

    test('should return null if search icon is not found', async () => {
        mockPage.$.mockResolvedValueOnce(null); // Search icon missing
        const result = await getCLValue(mockPage, '123456');
        expect(result).toBeNull();
    });

    test('should return null if input field is not found', async () => {
        mockPage.$.mockReturnValueOnce(mockElement); // Search icon found
        mockPage.$.mockReturnValueOnce(null); // Input missing
        const result = await getCLValue(mockPage, '123456');
        expect(result).toBeNull();
    });

    test('should return null if results do not load (timeout)', async () => {
        // Setup successful clicks and type
        mockPage.$.mockResolvedValue(mockElement);

        // Mock results container check finding nothing
        // using mockImplementation to debug calls if needed, otherwise chain is fine
        mockPage.$.mockResolvedValueOnce(mockElement) // search icon
            .mockResolvedValueOnce(mockElement) // input
            .mockResolvedValueOnce(mockElement) // submit
            .mockResolvedValue(null); // container search (and subsequent calls)

        const result = await getCLValue(mockPage, '123456');
        expect(result).toBeNull();
    });

    test('should successfully scrape values when found', async () => {
        // 1. Search Icon
        mockPage.$.mockResolvedValueOnce(mockElement);
        // 2. Input
        mockPage.$.mockResolvedValueOnce(mockElement);
        // 3. Submit
        mockPage.$.mockResolvedValueOnce(mockElement);

        // 4. Results container check (loop)
        const mockContainer = {
            evaluate: jest.fn().mockResolvedValue(3),
        };
        mockPage.$.mockResolvedValueOnce(mockContainer);

        // 5. Card Ladder Value and Prices
        mockPage.evaluate
            .mockResolvedValueOnce(150.5) // Card Ladder Value found immediately
            .mockResolvedValueOnce([100, 150, 200]); // Prices found

        const result = await getCLValue(mockPage, '123456');

        expect(result).toEqual({
            raw: 150.5,
            higher: 151,
        });
    });

    test('should perform stale check and wait if values match', async () => {
        mockPage.$.mockResolvedValue(mockElement);
        // Container
        const mockContainer = { evaluate: jest.fn().mockResolvedValue(3) };
        mockPage.$.mockResolvedValueOnce(mockElement) // search
            .mockResolvedValueOnce(mockElement) // input
            .mockResolvedValueOnce(mockElement) // submit
            .mockResolvedValueOnce(mockContainer); // container

        // Value Scrape sequence
        mockPage.evaluate
            .mockResolvedValueOnce(100) // Call 1: Matches previous
            .mockResolvedValueOnce(100) // Call 2: Matches previous
            .mockResolvedValueOnce(120) // Call 3: New value!
            .mockResolvedValueOnce([120, 120, 120]); // Prices

        const prevValue = 100;
        const result = await getCLValue(mockPage, '123456', prevValue);

        expect(result.raw).toBe(120);
    });

    test('should skip stale check if skipStaleCheck is true', async () => {
        mockPage.$.mockResolvedValue(mockElement);
        // Container
        const mockContainer = { evaluate: jest.fn().mockResolvedValue(3) };
        mockPage.$.mockResolvedValueOnce(mockElement) // search
            .mockResolvedValueOnce(mockElement) // input
            .mockResolvedValueOnce(mockElement) // submit
            .mockResolvedValueOnce(mockContainer); // container

        mockPage.evaluate
            .mockResolvedValueOnce(100) // Value matches prev
            .mockResolvedValueOnce([100]); // Prices

        const prevValue = 100;
        // Pass skipStaleCheck = true
        const result = await getCLValue(mockPage, '123456', prevValue, true);

        expect(result.raw).toBe(100);
    });
});
