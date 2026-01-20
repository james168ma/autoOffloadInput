const js = require('@eslint/js');
const globals = require('globals');
const prettierConfig = require('eslint-config-prettier');

module.exports = [
    js.configs.recommended,
    prettierConfig,
    {
        files: ['**/*.js'],
        languageOptions: {
            sourceType: 'commonjs',
            globals: {
                ...globals.node,
                ...globals.browser,
            },
        },
    },
    {
        files: ['__tests__/**/*.js'],
        languageOptions: {
            globals: {
                ...globals.jest,
            },
        },
    },
];
