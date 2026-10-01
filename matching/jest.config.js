module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/test/**/*.test.ts'],
  // *.live.test.ts calls real paid APIs - run those with `npm run test:live`.
  testPathIgnorePatterns: ['/node_modules/', '\.live\.test\.ts$'],
};
