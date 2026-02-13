const AuthService = require('../lib/services/auth_service');

describe('AuthService', () => {
    let mockPage;
    let authService;

    beforeEach(() => {
        mockPage = {
            goto: jest.fn(),
            url: jest.fn(),
            evaluate: jest.fn(),
            waitForSelector: jest.fn(),
            type: jest.fn(),
            keyboard: {
                press: jest.fn(),
            },
            waitForNavigation: jest.fn(),
        };
        authService = new AuthService('user@example.com', 'password123');
    });

    test('should return true if already logged in', async () => {
        mockPage.url.mockReturnValue('https://app.cardladder.com/sales-history');
        mockPage.evaluate.mockResolvedValue(false); // No login button

        const result = await authService.login(mockPage);

        expect(result).toBe(true);
        expect(mockPage.goto).toHaveBeenCalledWith(
            'https://app.cardladder.com/sales-history?direction=desc&sort=date',
            expect.any(Object)
        );
    });

    test('should perform login flow if login button is present', async () => {
        mockPage.url.mockReturnValue('https://app.cardladder.com/login');
        mockPage.evaluate.mockResolvedValue(true); // Login button exists

        const result = await authService.login(mockPage);

        expect(result).toBe(true);
        expect(mockPage.goto).toHaveBeenCalledWith('https://app.cardladder.com/login', expect.any(Object));
        expect(mockPage.type).toHaveBeenCalledWith('input[type="email"]', 'user@example.com');
        expect(mockPage.type).toHaveBeenCalledWith('input[type="password"]', 'password123');
        expect(mockPage.keyboard.press).toHaveBeenCalledWith('Enter');
    });

    test('should return false if credentials are missing', async () => {
        authService = new AuthService('', '');
        mockPage.url.mockReturnValue('https://app.cardladder.com/login');

        const result = await authService.login(mockPage);

        expect(result).toBe(false);
        expect(mockPage.type).not.toHaveBeenCalled();
    });
});
