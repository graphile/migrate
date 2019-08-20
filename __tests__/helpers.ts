import { Settings } from "../src/settings";
import { exec } from "child_process";

interface ActionSpies {
  getActionCalls: () => string[];
  settings: Pick<
    Settings,
    "afterAllMigrations" | "afterReset" | "afterCurrent"
  >;
}
export function makeActionSpies(shadow = false): ActionSpies {
  const mockedExec = (exec as unknown) as jest.Mock<typeof exec>;
  if (!mockedExec.mock) {
    throw new Error("Must mock child_process");
  }
  mockedExec.mockReset();
  const calls: string[] = [];
  mockedExec.mockImplementation(
    (_cmd, _opts, cb): any => {
      expect(_opts.env.PATH).toBe(process.env.PATH);
      expect(typeof _opts.env.GM_DBURL).toBe("string");
      if (shadow) {
        expect(_opts.env.GM_SHADOW).toBe("1");
      } else {
        expect(typeof _opts.env.GM_SHADOW).toBe("undefined");
      }
      calls.push(_cmd.replace(/^touch /, ""));
      cb(null, {
        error: null,
        stdout: "",
        stderr: "",
      });
    }
  );
  function getActionCalls() {
    return calls;
  }
  return {
    getActionCalls,
    settings: {
      afterAllMigrations: [
        { _: "command", command: "touch afterAllMigrations" },
      ],
      afterReset: [{ _: "command", command: "touch afterReset" }],
      afterCurrent: [{ _: "command", command: "touch afterCurrent" }],
    },
  };
}

function makePgClientMock() {
  return { query: jest.fn(async () => {}) };
}

export const mockPgClient = makePgClientMock();
