import { DatabaseSync } from "node:sqlite";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildUserQuery, buildUserWrite } from "../src/worker/user-sql";

// A miniature copy of the real schema with two users' rows, so the scoping is
// checked by actually running the built SQL, not by string inspection.
const A = "a@example.com";
const B = "b@example.com";
let db: DatabaseSync;
let tables: string[];

beforeAll(() => {
  db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE user (id TEXT, email TEXT, phone_number TEXT);
    CREATE TABLE session (id TEXT, token TEXT, user_id TEXT);
    CREATE TABLE api_keys (id TEXT, user_email TEXT, token_hash TEXT);
    CREATE TABLE weight_readings (id INTEGER, ts INTEGER, weight_kg REAL, body_fat_pct REAL, source TEXT, raw_payload TEXT, user_email TEXT, note TEXT);
    CREATE TABLE meals (id TEXT, user_email TEXT, date TEXT, note TEXT, photo_keys TEXT, created_at INTEGER);
    CREATE TABLE coach_conversations (id TEXT, user_email TEXT, title TEXT, created_at INTEGER, updated_at INTEGER);
    CREATE TABLE coach_messages (id TEXT, conversation_id TEXT, role TEXT, content TEXT, created_at INTEGER);
    INSERT INTO user VALUES ('ua', '${A}', '+1555'), ('ub', '${B}', '+1666');
    INSERT INTO session VALUES ('s1', 'secret-token', 'ua');
    INSERT INTO api_keys VALUES ('k1', '${A}', 'hash');
    INSERT INTO weight_readings VALUES (1, 1000, 80, NULL, 'manual', 'raw', '${A}', 'a1'), (2, 2000, 79, NULL, 'manual', 'raw', '${A}', 'a2'), (3, 1500, 60, NULL, 'manual', 'raw', '${B}', 'b1');
    INSERT INTO meals VALUES ('m1', '${A}', '2026-09-01', 'eggs', NULL, 1), ('m2', '${B}', '2026-09-01', 'b meal', NULL, 1);
    INSERT INTO coach_conversations VALUES ('ca', '${A}', 'a chat', 1, 1), ('cb', '${B}', 'b chat', 1, 1);
    INSERT INTO coach_messages VALUES ('x1', 'ca', 'user', 'hello from a', 1), ('x2', 'cb', 'user', 'hello from b', 1);
  `);
  tables = (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map((r) => r.name);
});

function run(sql: string, email = A) {
  const built = buildUserQuery(sql, tables);
  if ("error" in built) return built;
  return { rows: db.prepare(built.sql).all(email) as Record<string, unknown>[] };
}

describe("query_user_data scoping", () => {
  it("sees only the caller's rows", () => {
    const r = run("SELECT note FROM weight_readings ORDER BY ts");
    expect(r).toEqual({ rows: [{ note: "a1" }, { note: "a2" }] });
    expect(run("SELECT COUNT(*) n FROM weight_readings", B)).toEqual({ rows: [{ n: 1 }] });
  });

  it("scopes joins and tables without a user column", () => {
    expect(run("SELECT content FROM coach_messages")).toEqual({ rows: [{ content: "hello from a" }] });
    const joined = run("SELECT m.note, w.weight_kg FROM meals m JOIN weight_readings w ON w.id = 1");
    expect(joined).toEqual({ rows: [{ note: "eggs", weight_kg: 80 }] });
  });

  it("allows the model's own WITH and aggregates", () => {
    const r = run("WITH w AS (SELECT weight_kg FROM weight_readings) SELECT MIN(weight_kg) lo, MAX(weight_kg) hi FROM w");
    expect(r).toEqual({ rows: [{ lo: 79, hi: 80 }] });
  });

  it("hides columns that are not exposed", () => {
    expect(() => run("SELECT raw_payload FROM weight_readings")).toThrow(/no such column/);
    expect(() => run("SELECT user_email FROM meals")).toThrow(/no such column/);
  });

  it("returns nothing from tables that are not exposed", () => {
    for (const t of ["user", "session", "api_keys", '"user"', "[session]"]) {
      expect(run(`SELECT * FROM ${t}`), t).toEqual({ rows: [] });
    }
  });

  it("rejects ways around the shadowing", () => {
    for (const sql of [
      "SELECT * FROM main.session",
      'SELECT * FROM "main"."session"',
      "SELECT * FROM [main].[user]",
      "SELECT * FROM temp.session",
      "SELECT sql FROM sqlite_master",
      "SELECT * FROM sqlite_schema",
      "SELECT * FROM weight_readings; DELETE FROM weight_readings",
      "SELECT 1 -- ",
      "SELECT /* x */ 1",
    ]) {
      expect(run(sql), sql).toHaveProperty("error");
    }
  });

  it("cannot write", () => {
    for (const sql of ["DELETE FROM weight_readings", "UPDATE meals SET note = 'x'", "INSERT INTO meals VALUES (1)", "DROP TABLE meals"]) {
      expect(run(sql), sql).toHaveProperty("error");
    }
    // A WITH wrapping a write is not a valid subquery: SQLite refuses it.
    expect(() => run("WITH x AS (SELECT 1) DELETE FROM weight_readings")).toThrow();
    expect((db.prepare("SELECT COUNT(*) n FROM weight_readings").get() as { n: number }).n).toBe(3);
  });
});

describe("execute_user_sql write scoping", () => {
  let wdb: DatabaseSync;
  let wtables: string[];

  beforeEach(() => {
    wdb = new DatabaseSync(":memory:");
    wdb.exec(`
      CREATE TABLE user (id TEXT, email TEXT);
      CREATE TABLE session (id TEXT, token TEXT, user_id TEXT);
      CREATE TABLE meals (id TEXT PRIMARY KEY, user_email TEXT NOT NULL, date TEXT, note TEXT, photo_keys TEXT, created_at INTEGER);
      CREATE TABLE weight_readings (id INTEGER PRIMARY KEY, ts INTEGER, weight_kg REAL, body_fat_pct REAL, source TEXT, raw_payload TEXT, user_email TEXT, note TEXT);
      CREATE TABLE coach_conversations (id TEXT, user_email TEXT, title TEXT, created_at INTEGER, updated_at INTEGER);
      CREATE TABLE coach_messages (id TEXT, conversation_id TEXT, role TEXT, content TEXT, created_at INTEGER);
      INSERT INTO user VALUES ('ua', '${A}'), ('ub', '${B}');
      INSERT INTO session VALUES ('s1', 'secret-token', 'ua');
      INSERT INTO meals VALUES ('m1', '${A}', '2026-09-01', 'eggs', NULL, 1), ('m2', '${B}', '2026-09-01', 'b meal', NULL, 1), ('m3', '${A}', '2026-09-02', 'rice', NULL, 1);
      INSERT INTO weight_readings VALUES (1, 1000, 80, NULL, 'manual', 'raw', '${A}', 'a1'), (2, 1500, 60, NULL, 'manual', 'raw', '${B}', 'b1');
      INSERT INTO coach_conversations VALUES ('ca', '${A}', 'a chat', 1, 1);
      INSERT INTO coach_messages VALUES ('x1', 'ca', 'user', 'hi', 1);
    `);
    wtables = (wdb.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map((r) => r.name);
  });

  function write(sql: string, email = A) {
    const built = buildUserWrite(sql, wtables);
    if ("error" in built) return built;
    const stmt = wdb.prepare(built.sql);
    return /\breturning\b/i.test(sql) ? { rows: stmt.all(email) as Record<string, unknown>[] } : { changes: Number(stmt.run(email).changes) };
  }
  const notes = (email: string) => (wdb.prepare("SELECT id, note FROM meals WHERE user_email = ? ORDER BY id").all(email) as { id: string; note: string }[]).map((r) => `${r.id}:${r.note}`);

  it("updates only the caller's rows, even without a WHERE or with an OR", () => {
    expect(write("UPDATE meals SET note = 'x' WHERE id = 'm1'")).toEqual({ changes: 1 });
    expect(write("UPDATE meals SET note = 'y'")).toEqual({ changes: 2 });
    expect(write("UPDATE meals SET note = 'z' WHERE id = 'nope' OR 1 = 1")).toEqual({ changes: 2 });
    expect(notes(B)).toEqual(["m2:b meal"]);
    expect(write("UPDATE meals SET note = 'hack' WHERE id = 'm2'")).toEqual({ changes: 0 });
    expect(notes(B)).toEqual(["m2:b meal"]);
  });

  it("deletes only the caller's rows", () => {
    expect(write("DELETE FROM meals WHERE id = 'm2'")).toEqual({ changes: 0 });
    expect(write("DELETE FROM meals WHERE date = '2026-09-01'")).toEqual({ changes: 1 });
    expect(write("DELETE FROM meals")).toEqual({ changes: 1 });
    expect(notes(A)).toEqual([]);
    expect(notes(B)).toEqual(["m2:b meal"]);
  });

  it("stamps inserts with the caller's email, from VALUES or a SELECT", () => {
    expect(write("INSERT INTO meals (id, date, note) VALUES ('n1', '2026-09-03', 'one'), ('n2', '2026-09-03', 'two')")).toEqual({ changes: 2 });
    expect(write("INSERT INTO meals (id, date, note) SELECT id || 'copy', date, note FROM meals WHERE id = 'm1'")).toEqual({ changes: 1 });
    expect(notes(A)).toEqual(["m1:eggs", "m1copy:eggs", "m3:rice", "n1:one", "n2:two"]);
    expect(notes(B)).toEqual(["m2:b meal"]);
  });

  it("returns rows with RETURNING and keeps strings containing keywords intact", () => {
    expect(write("INSERT INTO meals (id, note) VALUES ('r1', 'where; -x') RETURNING id, note")).toEqual({ rows: [{ id: "r1", note: "where; -x" }] });
    expect(write("UPDATE meals SET note = 'a where b' WHERE id = 'm3' RETURNING id")).toEqual({ rows: [{ id: "m3" }] });
    expect(write("DELETE FROM meals WHERE id = 'm3' RETURNING id")).toEqual({ rows: [{ id: "m3" }] });
  });

  it("reads inside a write still see only the caller's data", () => {
    expect(write("UPDATE meals SET note = (SELECT COUNT(*) FROM session) WHERE id = 'm1'")).toEqual({ changes: 1 });
    expect(notes(A)[0]).toBe("m1:0");
    expect(write("INSERT INTO meals (id, note) SELECT 'z' || id, note FROM meals")).toEqual({ changes: 2 });
    expect(notes(A).filter((n) => n.startsWith("z"))).toHaveLength(2);
    expect(write("UPDATE meals SET note = 'c' WHERE id IN (SELECT id FROM meals WHERE id = 'm2')")).toEqual({ changes: 0 });
  });

  it("handles aliases and quoted table names", () => {
    expect(write(`UPDATE "meals" AS m SET note = 'q' WHERE m.id = 'm1'`)).toEqual({ changes: 1 });
    expect(write("DELETE FROM `meals` WHERE id = 'm2'")).toEqual({ changes: 0 });
  });

  it("refuses everything that could escape the caller's rows", () => {
    const refused = [
      "UPDATE meals SET user_email = 'b@example.com' WHERE id = 'm1'",
      "UPDATE meals SET \"user_email\" = 'b@example.com'",
      "INSERT INTO meals (id, user_email) VALUES ('h', 'b@example.com')",
      "INSERT OR REPLACE INTO meals (id, note) VALUES ('m2', 'taken')",
      "INSERT INTO meals (id, note) VALUES ('m2', 'taken') ON CONFLICT (id) DO UPDATE SET note = 'x'",
      "UPDATE meals SET note = 'x' FROM weight_readings",
      "UPDATE main.meals SET note = 'x'",
      "DELETE FROM main.meals",
      "UPDATE session SET token = 'x'",
      "DELETE FROM user",
      "INSERT INTO user (id, email) VALUES ('h', 'h@example.com')",
      "UPDATE coach_messages SET content = 'x'",
      "DELETE FROM coach_messages",
      "DELETE FROM meals; DELETE FROM user",
      "DROP TABLE meals",
      "CREATE TABLE evil (x)",
      "SELECT * FROM meals",
      "WITH x AS (SELECT 1) DELETE FROM meals",
      "UPDATE meals SET note = 'x' -- WHERE",
      "DELETE FROM sqlite_master",
      "INSERT INTO meals VALUES ('h', 'a', 'b', 'c', NULL, 1)",
      "DELETE FROM meals WHERE note = 'oops",
    ];
    for (const sql of refused) expect(write(sql), sql).toHaveProperty("error");
    expect(wdb.prepare("SELECT COUNT(*) n FROM user").get()).toEqual({ n: 2 });
    expect(wdb.prepare("SELECT token FROM session").get()).toEqual({ token: "secret-token" });
    expect(notes(B)).toEqual(["m2:b meal"]);
    expect(notes(A)).toEqual(["m1:eggs", "m3:rice"]);
  });
});
