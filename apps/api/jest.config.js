module.exports = { preset: 'ts-jest', testEnvironment: 'node', testMatch: ['**/*.spec.ts'], testTimeout: 60000, globalSetup: './test/global-setup.ts', setupFiles: ['./test/env.ts'], maxWorkers: 1 };
