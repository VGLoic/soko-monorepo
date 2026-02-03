# Agent Guidelines for Soko Monorepo

This document provides guidelines for AI coding agents working in the Soko monorepo.

## Project Overview

Soko is a warehouse for smart-contract compilation artifacts. It enables teams to version, store, and share smart-contract compilation artifacts, decoupling compilation from deployment.

**Monorepo Structure:**

- `packages/hardhat-soko`: Hardhat plugin for Soko (main package)
- `packages/eslint-config`: Shared ESLint configurations
- `packages/typescript-config`: Shared TypeScript configurations
- `apps/hardhat-v2-external-lib`: Integration example with Hardhat v2

## Build System

**Package Manager:** pnpm 9.0.0 (required)
**Build Tool:** Turborepo
**Node Version:** >=18 (use `nvm use` to ensure correct version)

## Plan Mode

When creating multi-step plans:

- Keep plans extremely concise - sacrifice grammar for brevity
- End each plan with unresolved questions (if any)
- Each step should complete ONE task only (e.g., implementation + its tests)

### Before submitting changes for a step

Ensure all code changes adhere to the standards and guidelines below.

### Before starting a new step

- Verify the previous step is fully complete and accepted
- Commit all changes from the previous step with a concise message

### Common Commands

```bash
# Root level (affects all packages)
pnpm build              # Build all packages
pnpm dev                # Run dev mode for all packages
pnpm test               # Run tests for all packages
pnpm lint               # Lint all packages
pnpm format             # Format all packages
pnpm check-format       # Check formatting
pnpm check-types        # Typecheck all packages

# Package-specific (run from package directory)
cd packages/hardhat-soko
pnpm build              # Build using tsup
pnpm lint               # ESLint with max 0 warnings
pnpm format             # Format TypeScript files
pnpm check-types        # TypeScript type checking

# App-specific (Hardhat example)
cd apps/hardhat-v2-external-lib
pnpm test               # Run Hardhat tests
pnpm compile            # Compile contracts (formats then compiles)
pnpm deploy-contracts   # Deploy contracts
pnpm soko-typings       # Generate Soko typings
```

### Running Tests

Currently, there are no unit test files in the main packages. The test command primarily runs Hardhat contract tests in the example app.

To run a single Hardhat test:

```bash
cd apps/hardhat-v2-external-lib
npx hardhat test test/specific-test.ts
```

### Build Dependencies

Turborepo manages dependencies between tasks. Notable dependencies:

- `lint`, `check-types`, and `test` depend on `build`
- Each package's tasks depend on its dependencies' tasks (via `^task` syntax)

## Code Style Guidelines

### TypeScript Configuration

**Base Config:** All packages extend `@soko/typescript-config/node-base.json`

Key compiler options:

- **Strict mode enabled:** All strict TypeScript checks
- **Module:** NodeNext (ESM + CJS dual output)
- **Target:** ES2022
- **Lib:** ES2022
- **noUncheckedIndexedAccess:** true (array/object access returns `T | undefined`)
- **noUnusedParameters:** true
- **noUnusedLocals:** true
- **isolatedModules:** true

### Import Style

```typescript
// Standard library imports first
import { Dirent } from "fs";
import fs from "fs/promises";
import crypto from "crypto";

// Third-party imports
import { z } from "zod";
import { keccak256 } from "@ethersproject/keccak256";

// Internal imports
import { LOG_COLORS, ScriptError, toAsyncResult } from "./utils";
import { S3BucketProvider } from "./s3-bucket-provider";
```

**Order:** Built-in modules → External packages → Internal modules

### Formatting

**Formatter:** Prettier (default config, empty `.prettierrc.json`)

- Always run `pnpm format` before committing
- For Solidity files: use `prettier-plugin-solidity`

### ESLint Configuration

**Base:** `@soko/eslint-config/base` which includes:

- `@eslint/js` recommended rules
- `typescript-eslint` recommended rules
- `eslint-config-prettier` (disables conflicting rules)
- `eslint-plugin-turbo` (for monorepo-specific rules)
- `eslint-plugin-only-warn` (converts all errors to warnings)

**Max Warnings:** 0 (treat warnings as errors in CI)

**Ignored Paths:** `dist/**`

### Naming Conventions

**Variables/Functions:** camelCase

```typescript
const projectName = "doubtful-counter";
function retrieveFreshCompilationArtifact() {}
```

**Types/Interfaces/Classes:** PascalCase

```typescript
interface StorageProvider {}
class S3BucketProvider implements StorageProvider {}
type CompilerOutputContract = z.infer<typeof ZCompilerOutputContract>;
```

**Zod Schemas:** Prefix with `Z`

```typescript
const ZBuildInfo = z.object({...});
const ZAbi = z.array(...);
```

**Constants:** SCREAMING_SNAKE_CASE for log colors and configuration

```typescript
export const LOG_COLORS = {
  log: "\x1b[0m%s\x1b[0m",
  success: "\x1b[32m%s\x1b[0m",
};
```

### Type Safety

**Use explicit types for public APIs:**

```typescript
export type SokoHardhatUserConfig = {
  project: string;
  pulledArtifactsPath?: string;
  // ...
};
```

**Prefer Zod schemas for runtime validation:**

```typescript
const SokoHardhatConfig = z.object({
  project: z.string().min(1),
  pulledArtifactsPath: z.string().default(".soko"),
});

const result = SokoHardhatConfig.safeParse(userInput);
if (!result.success) {
  // Handle validation error
}
```

**Use discriminated unions for results:**

```typescript
type Result<T> =
  | { status: "success"; value: T }
  | { status: "error"; reason: string };
```

### Error Handling

**Use custom error classes:**

```typescript
export class ScriptError extends Error {
  constructor(message: string) {
    super(message);
  }
}
```

**Use result wrappers for async operations:**

```typescript
export function toAsyncResult<T, TError = Error>(
  promise: Promise<T>,
  opts: { debug?: boolean } = {},
): Promise<{ success: true; value: T } | { success: false; error: TError }> {
  return promise
    .then((value) => ({ success: true as const, value }))
    .catch((error) => {
      if (opts.debug) console.error(error);
      return { success: false as const, error };
    });
}
```

**Error handling pattern:**

```typescript
const result = await toAsyncResult(someOperation(), { debug: opts.debug });
if (!result.success) {
  if (result.error instanceof ScriptError) {
    console.error(LOG_COLORS.error, "❌", result.error.message);
    process.exitCode = 1;
    return;
  }
  console.error(LOG_COLORS.error, "❌ Unexpected error:", result.error);
  process.exitCode = 1;
  return;
}
// Use result.value
```

### Console Output

Use `LOG_COLORS` for all console output:

```typescript
console.error(LOG_COLORS.success, "\nOperation successful");
console.error(LOG_COLORS.error, "❌ Operation failed");
console.error(LOG_COLORS.warn, "⚠️ Warning message");
console.error(LOG_COLORS.log, "Info message");
```

Note: Use `console.error()` for task output (not `console.log()`) to ensure proper streaming in Hardhat tasks.

## File Organization

```
packages/hardhat-soko/
├── src/
│   ├── index.ts              # Main plugin entry, task definitions
│   ├── utils.ts              # Shared utilities and types
│   ├── s3-bucket-provider.ts # Storage provider implementation
│   └── scripts/
│       ├── exports.ts        # Public script exports
│       ├── push.ts           # Push artifact logic
│       ├── pull.ts           # Pull artifact logic
│       ├── generate-typings.ts
│       └── ...
├── dist/                     # Build output (ignored)
├── tsup.config.ts            # Build configuration
├── tsconfig.json
├── eslint.config.mjs
└── package.json
```

## Best Practices

1. **Always validate user input with Zod** before processing
2. **Use async/await** over raw promises
3. **Prefer explicit return types** for public functions
4. **Use `opts` pattern** for function options (better than multiple params)
5. **Handle both ScriptError and unexpected errors** in all task handlers
6. **Use descriptive variable names** - clarity over brevity
7. **Comment complex algorithms** but keep code self-documenting
8. **Use TypeScript's strict null checks** - avoid `!` assertions
9. **Leverage Zod's `safeParse`** instead of `parse` to handle errors gracefully
10. **Use `process.exitCode`** instead of `process.exit()` in tasks

## Git Workflow

- Commit messages should be concise and descriptive
- Always run `pnpm lint` and `pnpm check-types` before committing
- Generated files in `.soko/` and `.soko-typings/` are gitignored
- Build outputs (`dist/`, `.next/`, etc.) are gitignored
