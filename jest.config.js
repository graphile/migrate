module.exports = {
  transform: {
    "^.+\\.tsx?$": "ts-jest",
  },
  testRegex: "__tests__/.*\\.test\\.[tj]s$",
  moduleFileExtensions: ["ts", "tsx", "js", "jsx", "json", "node"],

  // Jest doesn't currently support prettier v3; see https://github.com/jestjs/jest/issues/14305
  prettierPath: require.resolve("@localrepo/prettier2-for-jest"),
};
