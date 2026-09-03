import type { Config } from "jest";

export const config: Config = {
    preset: 'jest-expo', // Expo-specific Jest preset
    collectCoverageFrom: [
        '**/*.{ts,tsx}', // only catches typescript files
        '!**/node_modules/**',  // |
        '!**/.expo/**',         // |
        '!**/.github/**',       // - folders to ignore
        '!**/.vscode/**',       // |
        '!**/.meteor/**',       // |
    ],
    coverageDirectory: './tests/reports',
    // coverageThreshold: { global: { branches: 80, functions: 80, lines: 80, statements: -10, }, },
    setupFilesAfterEnv: ['./jest.setup.js'],
    testEnvironment: 'node',
    transformIgnorePatterns: [
        '/node_modules/(?!(jest-)?(@)?react-native(-community)?)/', // transforms/translates specified modules, rest are ignored for efficiency
    ],
    verbose: true,
};