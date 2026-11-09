import {
  InstrumentationError,
  runQueryWithErrorInstrumentation,
} from "../src/instrumentation";
import { Client } from "../src/pg";

const folderSql = `\
--! split: 100-first.sql
select 1;

--! split: 200-second.sql
-- line 1 of second
-- line 2 of second
select 1/0;
`;

function makePgClientThatErrorsAt(body: string, substring: string): Client {
  const position = body.indexOf(substring) + 1;
  return {
    query: jest.fn().mockRejectedValue(
      Object.assign(new Error("division by zero"), {
        position: String(position),
        code: "22012",
      }),
    ),
  } as unknown as Client;
}

it("reports SQL errors against the file in current/ rather than concatenated current.sql", async () => {
  const pgClient = makePgClientThatErrorsAt(folderSql, "1/0");
  let err: InstrumentationError | undefined;
  try {
    await runQueryWithErrorInstrumentation(pgClient, folderSql, "current.sql", {
      splitBasePath: "migrations/current",
    });
  } catch (e) {
    err = e as InstrumentationError;
  }

  expect(err).toBeTruthy();
  expect(err!._gmMessageOverride).toMatch(
    /migrations\/current\/200-second\.sql/,
  );
  expect(err!._gmMessageOverride).toMatch(/line 3,/);
  expect(err!._gmMessageOverride).not.toMatch(/of "current\.sql"/);
});
