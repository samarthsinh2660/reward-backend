/** @type {import('jest').Config} */
const config = {
    preset: 'ts-jest/presets/default-esm',
    testEnvironment: 'node',
    // Run test files serially — repository tests each spin up a MySQL container
    // via testcontainers; running them in parallel starves Docker Desktop on Windows
    maxWorkers: 1,
    extensionsToTreatAsEsm: ['.ts'],
    moduleNameMapper: {
        '^(\\.{1,2}/.*)\\.ts$': '$1',
        '^@controller/(.*)$': '<rootDir>/src/controller/$1',
        '^@utils/(.*)$': '<rootDir>/src/utils/$1',
        '^@models/(.*)$': '<rootDir>/src/models/$1',
        '^@middleware/(.*)$': '<rootDir>/src/middleware/$1',
        '^@repositories/(.*)$': '<rootDir>/src/repositories/$1',
        '^@services/(.*)$': '<rootDir>/src/services/$1',
        '^@types/(.*)$': '<rootDir>/src/types/$1',
    },
    transform: {
        '^.+\\.ts$': ['ts-jest', {
            useESM: true,
            tsconfig: './tsconfig.json',
            diagnostics: false,
        }],
    },
    testMatch: ['**/*.test.ts'],
    collectCoverageFrom: [
        'src/controller/**/*.ts',
        '!src/**/*.test.ts',
    ],
};

export default config;
