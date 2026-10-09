// `npm run test:live`: only the *.live.test.ts tests, which call real (billed) external APIs.
// Runs in plain Node rather than the jest-expo preset: that preset stubs out `fetch`, so the
// live tests would never reach the real API.
const { preset, setupFilesAfterEnv, ...base } = require('./jest.config');

module.exports = {
  ...base,
  testEnvironment: 'node',
  testMatch: ['**/*.live.test.ts'],
  testPathIgnorePatterns: ['/node_modules/'],
};
