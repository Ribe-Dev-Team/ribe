// `npm run test:live`: only the tests that call real external APIs.
const base = require('./jest.config');

module.exports = {
  ...base,
  testMatch: ['**/test/**/*.live.test.ts'],
  testPathIgnorePatterns: ['/node_modules/'],
};
