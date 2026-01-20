# Developer Guide

## Setup

To get started, install the dependencies:

```bash
npm install
```

This will also automatically initialize **Husky** git hooks.

## Development Scripts

### Testing

This project uses [Jest](https://jestjs.io/) for unit testing.

```bash
npm test
```

### Linting

We use [ESLint](https://eslint.org/) to enforce code quality.

To run the linter:

```bash
npm run lint
```

To automatically fix fixable errors:

```bash
npm run lint:fix
```

### Formatting

We use [Prettier](https://prettier.io/) for code formatting.

To format all files:

```bash
npm run format
```

## Git Hooks

We use [Husky](https://typicode.github.io/husky/) to manage git hooks.

### Pre-commit Hook

A `pre-commit` hook is configured to automatically run:

1.  **Linting**: `npm run lint`
2.  **Tests**: `npm test`

If either fails, the commit is aborted. This ensures that the codebase remains clean and bug-free.

### Bypassing Hooks

If you absolutely must bypass the hook (e.g., for a WIP commit being saved locally), you can use the `--no-verify` flag:

```bash
git commit -m "wip" --no-verify
```

_Use this with caution._
