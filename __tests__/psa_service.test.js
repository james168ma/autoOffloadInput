const PsaService = require('../psa_service');

describe('PsaService', () => {
    let mockBrowser;
    let mockPage;
    let psaService;
    const API_KEY = 'test_api_key';

    beforeEach(() => {
        jest.clearAllMocks();

        // Mock global fetch
        global.fetch = jest.fn();

        // Mock Puppeteer
        mockPage = {
            goto: jest.fn().mockResolvedValue(true),
            $: jest.fn().mockResolvedValue(null), // No cloudflare by default
            waitForNavigation: jest.fn(),
            waitForSelector: jest.fn(),
            evaluate: jest.fn(),
            close: jest.fn(),
        };

        mockBrowser = {
            newPage: jest.fn().mockResolvedValue(mockPage),
        };

        psaService = new PsaService(API_KEY, mockBrowser);
    });

    test('should return data from API if successful', async () => {
        const mockCertData = {
            Subject: 'Michael Jordan',
            CardNumber: '23',
            CardGrade: 'GEM MT 10',
        };

        global.fetch.mockResolvedValueOnce({
            ok: true,
            json: jest.fn().mockResolvedValue({ PSACert: mockCertData }),
        });

        const result = await psaService.getDetails('123456');

        expect(global.fetch).toHaveBeenCalledWith(
            expect.stringContaining('123456'),
            expect.objectContaining({
                headers: expect.objectContaining({ Authorization: `Bearer ${API_KEY}` }),
            })
        );

        expect(result).toEqual({
            name: 'Michael Jordan',
            number: '23',
            grade: 10,
        });
    });

    test('should parse numeric grade from API even if not standard format', async () => {
        global.fetch.mockResolvedValueOnce({
            ok: true,
            json: jest.fn().mockResolvedValue({
                PSACert: {
                    Subject: 'Test Card',
                    CardNumber: '1',
                    CardGrade: 'Near Mint 8.5',
                },
            }),
        });

        const result = await psaService.getDetails('123456');
        expect(result.grade).toBe(8.5);
    });

    test('should fallback to scraper if API fails', async () => {
        // Mock API failure
        global.fetch.mockResolvedValueOnce({
            ok: false,
            status: 404,
            statusText: 'Not Found',
        });

        // Mock Scraper success
        mockPage.evaluate.mockReturnValue({
            name: 'Scraped Name',
            number: 'Scraped #1',
            grade: 9,
        });

        const result = await psaService.getDetails('fallback_cert');

        expect(global.fetch).toHaveBeenCalled();
        expect(mockBrowser.newPage).toHaveBeenCalled();
        expect(mockPage.goto).toHaveBeenCalledWith(
            expect.stringContaining('fallback_cert'),
            expect.anything()
        );
        expect(result).toEqual({
            name: 'Scraped Name',
            number: 'Scraped #1',
            grade: 9,
        });
    });

    test('should skip API if no key provided', async () => {
        const serviceNoKey = new PsaService(null, mockBrowser);

        mockPage.evaluate.mockReturnValue({
            name: 'NoKey Name',
            number: 'NoKey',
            grade: 5,
        });

        await serviceNoKey.getDetails('nokey_cert');

        expect(global.fetch).not.toHaveBeenCalled();
        expect(mockBrowser.newPage).toHaveBeenCalled();
    });

    test('should handle Cloudflare checkpoint in scraper', async () => {
        const serviceNoKey = new PsaService(null, mockBrowser);

        // Mock Cloudflare checkbox present
        const mockCheckbox = { click: jest.fn() };
        mockPage.$.mockResolvedValueOnce(mockCheckbox);

        mockPage.evaluate.mockReturnValue({
            name: 'CF Card',
            number: '1',
            grade: 10,
        });

        await serviceNoKey.getDetails('cf_cert');

        expect(mockCheckbox.click).toHaveBeenCalled();
        expect(mockPage.waitForNavigation).toHaveBeenCalled();
    });

    test('should return null from scraper if browser is missing', async () => {
        const serviceNoBrowser = new PsaService(null, null);
        const result = await serviceNoBrowser.getDetails('123');
        expect(result).toBeNull();
    });

    test('should return null from scraper on error or timeout', async () => {
        const serviceNoKey = new PsaService(null, mockBrowser);

        // Simulate error during goto
        mockPage.goto.mockRejectedValue(new Error('Timeout'));

        const result = await serviceNoKey.getDetails('timeout_cert');

        expect(result).toBeNull();
        expect(mockPage.close).toHaveBeenCalled(); // Ensure cleanup
    });
});
