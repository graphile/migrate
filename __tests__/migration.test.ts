import { ParsedSettings } from "../src/settings";
import { Context } from "../src/pg";
import { generatePlaceholderReplacement } from "../src/migration";
const parsedSettings: ParsedSettings = {
  connectionString: "[connectionString]",
  rootConnectionString: "[rootConnectionString]",
  databaseOwner: "[databaseOwner]",
  migrationsFolder: "[migrationsFolder]",
  databaseName: "[databaseName]",
  shadowDatabaseName: "[shadowDatabaseName]",

  placeholders: {
    ":DATABASE_AUTHENTICATOR": "[DATABASE_AUTHENTICATOR]",
    ":DATABASE_AUTHENTICATOR_PASSWORD": "[DATABASE_AUTHENTICATOR_PASSWORD]",
  },
};

it("doesn't mind about placeholder order", () => {
  const context: Context = {
    database: "foo",
  };
  const placeholderReplacement = generatePlaceholderReplacement(
    parsedSettings,
    context
  );
  const body = placeholderReplacement(
    `CREATE ROLE :DATABASE_AUTHENTICATOR WITH LOGIN PASSWORD ':DATABASE_AUTHENTICATOR_PASSWORD';`
  );

  expect(body).toEqual(
    `CREATE ROLE [DATABASE_AUTHENTICATOR] WITH LOGIN PASSWORD '[DATABASE_AUTHENTICATOR_PASSWORD]';`
  );
});
