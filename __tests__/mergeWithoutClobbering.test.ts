import { mergeWithoutClobbering } from "../src/lib";
process.env.NODE_ENV = "test";

test("merges", () => {
  const result = mergeWithoutClobbering(
    process.env,
    { FOO: "bar" },
    "don't set this envvar.",
  );
  expect(result).toMatchObject({
    ...process.env,
    FOO: "bar",
  });
});

test("doesn't mutate source", () => {
  expect(process.env.FOO).toBe(undefined);
  const result = mergeWithoutClobbering(
    process.env,
    { FOO: "bar" },
    "don't set this envvar.",
  );
  expect(result).toMatchObject({
    ...process.env,
    FOO: "bar",
  });
  expect(process.env.FOO).toBe(undefined);
});

test("throws if property already set", () => {
  expect(process.env.FOO).toBe(undefined);
  expect(() => {
    mergeWithoutClobbering(
      process.env,
      { NODE_ENV: "bar" },
      "don't set this envvar.",
    );
  }).toThrowErrorMatchingInlineSnapshot(
    `"Refusing to clobber 'NODE_ENV' (from 'test' to 'bar'): don't set this envvar."`,
  );
});

test("doesn't throw if property already set to same value", () => {
  expect(process.env.FOO).toBe(undefined);
  const result = mergeWithoutClobbering(
    process.env,
    { NODE_ENV: "test" },
    "don't set this envvar.",
  );
  expect(result).toMatchObject(process.env);
});
