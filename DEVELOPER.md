# Developer Guide

## Setup

To get started, install the dependencies:

```bash
npm install
```

This will also automatically initialize **Husky** git hooks.

## Testing

This project uses [Jest](https://jestjs.io/) for unit testing.

To run tests manually:
```bash
npm test
```

## Git Hooks

We use [Husky](https://typicode.github.io/husky/) to manage git hooks.

### Pre-commit Hook
A `pre-commit` hook is configured to run `npm test` automatically before every commit.

-   If the tests pass, the commit proceeds.
-   If any test fails, the commit is aborted.

This ensures that no broken code is committed to the repository.

### Bypassing Hooks
If you absolutely must bypass the hook (e.g., for a WIP commit being saved locally), you can use the `--no-verify` flag:

```bash
git commit -m "wip" --no-verify
```
*Use this with caution.*
