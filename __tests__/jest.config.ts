/** @jest-config-loader ts-node */

import { defineConfig } from "jest";

export default defineConfig({
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
        '/node_modules/(?!(@react-native|react-native|expo|expo-.*)/)', // only these 4 modules will be untransformed
    ],
    verbose: true,
});