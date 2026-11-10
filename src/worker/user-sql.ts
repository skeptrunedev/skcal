// Per-user SQL for the coach's query_user_data (read) and execute_user_sql
// (write) tools. Pure (no Worker imports) so the scoping rules are
// unit-tested directly.
//
// D1 has no row-level security, so scoping is done by shadowing: the model's
// SELECT runs as a subquery under a WITH clause that defines a CTE for EVERY
// table in the database. Exposed tables become this user's rows (a curated
// column list, bound to ?1 = their email); every other table, including ones
// added later, becomes an empty CTE. Unqualified table names resolve to the
// CTEs, and anything that could reach the real tables (schema-qualified names,
// sqlite_ internals) is rejected. Because the model's text is a subquery, a
// write statement is a syntax error rather than a write.
//
// Writes can't use the subquery trick, so buildUserWrite rewrites the one
// INSERT / UPDATE / DELETE instead: the target is qualified to the real table,
// UPDATE/DELETE get an ownership predicate ANDed onto the model's WHERE, and
// INSERT gets user_email appended from the bound email. Any read inside the
// statement still resolves to the shadow CTEs. The model can never name
// user_email, so it can't write, move or steal another user's rows.

/** Exposed tables: CTE body selecting this user's rows (?1 = email). */
const EXPOSED: Record<string, { columns: string; from: string }> = {
  meals: { columns: "id, date, note, photo_keys, created_at", from: "main.meals WHERE user_email = ?1" },
  nutrition_items: {
    columns: "id, meal_id, date, name, kcal, protein_g, source, created_at",
    from: "main.nutrition_items WHERE user_email = ?1",
  },
  nutrition_days: { columns: "date, kcal, protein_g, hit_protein, adherence", from: "main.nutrition_days WHERE user_email = ?1" },
  weight_readings: { columns: "id, ts, weight_kg, body_fat_pct, source, note", from: "main.weight_readings WHERE user_email = ?1" },
  measurements: { columns: "id, ts, site, value_cm, source", from: "main.measurements WHERE user_email = ?1" },
  workouts: {
    columns:
      "id, source, activity_type, summary, description, started_at, duration_s, moving_duration_s, distance_m, elevation_gain_m, energy_kcal, avg_hr, max_hr, avg_power_w, avg_cadence, details, created_at",
    from: "main.workouts WHERE user_email = ?1",
  },
  photos: { columns: "id, ts, pose, notes", from: "main.photos WHERE user_email = ?1" },
  targets: {
    columns: "id, goal_weight_kg, target_date, start_weight_kg, start_date, daily_kcal_target, protein_target_g, height_cm, sex",
    from: "main.targets WHERE user_email = ?1",
  },
  reminders: {
    columns: "id, instruction, hour, minute, days, once_date, tz, enabled, next_fire_at, last_sent_at, created_at",
    from: "main.reminders WHERE user_email = ?1",
  },
  phases: {
    columns: "id, kind, start_date, planned_end_date, ended_date, start_weight_kg, goal_weight_kg, rate_pct_per_week, daily_kcal_target, protein_target_g, note, created_at",
    from: "main.phases WHERE user_email = ?1",
  },
  mesocycles: {
    columns: "id, name, weeks, days_per_week, start_date, status, ended_date, notes, created_at",
    from: "main.mesocycles WHERE user_email = ?1",
  },
  meso_days: { columns: "id, meso_id, position, label", from: "main.meso_days WHERE user_email = ?1" },
  meso_slots: {
    columns: "id, meso_id, day_id, position, muscle, exercise_id, exercise_name, equipment",
    from: "main.meso_slots WHERE user_email = ?1",
  },
  meso_sets: {
    columns: "id, meso_id, day_id, slot_id, week, position, muscle, exercise_name, target_reps, target_weight_lb, target_rir, weight_lb, reps, logged_at",
    from: "main.meso_sets WHERE user_email = ?1",
  },
  meso_feedback: {
    columns: "meso_id, day_id, week, muscle, soreness, pump, joint_pain, workload",
    from: "main.meso_feedback WHERE user_email = ?1",
  },
  meso_sessions: { columns: "meso_id, day_id, week, completed_at, workout_id", from: "main.meso_sessions WHERE user_email = ?1" },
  exercises: { columns: "id, name, muscle, equipment, video_url, created_at", from: "main.exercises WHERE user_email = ?1" },
  agent_memories: { columns: "id, content, created_at", from: "main.agent_memories WHERE user_email = ?1" },
  coach_conversations: { columns: "id, title, created_at, updated_at", from: "main.coach_conversations WHERE user_email = ?1" },
  coach_messages: {
    columns: "m.id AS id, m.conversation_id AS conversation_id, m.role AS role, m.content AS content, m.created_at AS created_at",
    from: "main.coach_messages m JOIN main.coach_conversations cc ON cc.id = m.conversation_id WHERE cc.user_email = ?1",
  },
};

/** Schema text for the tool description. */
export const USER_SQL_SCHEMA = [
  ...Object.entries(EXPOSED).map(([t, d]) => `${t}(${d.columns.replace(/\b\w+\.\w+ AS /g, "")})`),
  "Units: weight_kg in kilograms (x 2.2046 for pounds), value_cm/height_cm in centimeters, distance_m in meters, duration_s in seconds, energy_kcal in kcal. ts, created_at, updated_at, started_at, next_fire_at and last_sent_at are Unix epoch MILLISECONDS (UTC); date, target_date, start_date and once_date are local YYYY-MM-DD text. Use date(ts/1000, 'unixepoch') for a UTC day.",
  "Training: weight_lb / target_weight_lb are POUNDS; logged_at and completed_at are epoch ms (logged_at null = set not done yet; logged_at is when the set was finished, so rest before a set = its logged_at minus the previous logged_at among sets with the same meso_id, day_id, week, and sets sharing a logged_at were logged together with unknown rest). A mesocycle's last week is its deload. meso_days.position and meso_sets.week are 1-based. meso_feedback scales: soreness 0 never sore..3 still sore, pump 0 low..2 amazing, joint_pain 0 none..3 a lot, workload 0 not enough..3 too much. exercises holds only the user's custom exercises; built-in ones appear by name in meso_slots / meso_sets. phases.rate_pct_per_week is % bodyweight per week (positive = gain); ended_date null = the open phase.",
].join("\n");

export const USER_SQL_MAX_ROWS = 200;

const quoteIdent = (name: string) => `"${name.replace(/"/g, '""')}"`;

/** Every table in the database as a CTE: exposed ones are this user's rows (?1), the rest are empty. */
function shadowCtes(allTables: string[]): string {
  const names = new Set([...allTables, ...Object.keys(EXPOSED)]);
  return [...names]
    .filter((t) => !/^sqlite_/i.test(t))
    .map((t) => {
      const d = EXPOSED[t];
      return d ? `${quoteIdent(t)} AS (SELECT ${d.columns} FROM ${d.from})` : `${quoteIdent(t)} AS (SELECT NULL AS unavailable WHERE 0)`;
    })
    .join(",\n");
}

/**
 * Validate the model's query and wrap it in the per-user shadowing WITH.
 * `allTables` is every table name in the database (from sqlite_master), so
 * tables that are not exposed are shadowed as empty.
 */
export function buildUserQuery(userSql: string, allTables: string[]): { sql: string } | { error: string } {
  const q = userSql.trim().replace(/;+\s*$/, "");
  if (!q) return { error: "sql is required" };
  if (q.length > 4000) return { error: "sql too long (max 4000 characters)" };
  if (!/^(select|with)\b/i.test(q)) return { error: "only a single SELECT (optionally starting with WITH) is allowed" };
  if (q.includes(";")) return { error: "only one statement is allowed" };
  if (/--|\/\*/.test(q)) return { error: "comments are not allowed" };
  if (/sqlite_/i.test(q)) return { error: "sqlite_ internals are not available" };
  if (/["`[]?\b(main|temp)\b["`\]]?\s*\./i.test(q)) return { error: "schema-qualified names (main./temp.) are not allowed; use the plain table names" };

  return { sql: `WITH ${shadowCtes(allTables)}\nSELECT * FROM (\n${q}\n) LIMIT ${USER_SQL_MAX_ROWS + 1}` };
}

// ---- writes ----------------------------------------------------------------

/** Tables the user's own rows can be written to: those owned directly by user_email (coach_messages is read-only). */
export const USER_SQL_WRITABLE: string[] = Object.entries(EXPOSED)
  .filter(([t, d]) => d.from === `main.${t} WHERE user_email = ?1`)
  .map(([t]) => t);

/** Appended to the write tool's description. */
export const USER_SQL_WRITE_RULES = [
  `Writable tables: ${USER_SQL_WRITABLE.join(", ")} (coach_messages is read-only).`,
  "Exactly one INSERT, UPDATE or DELETE. INSERT must list its columns (INSERT INTO t (a, b) VALUES (...) or ... SELECT ...); user_email is filled in for you and can't be named. Text ids have no default, so supply one, e.g. lower(hex(randomblob(16))). ON CONFLICT, OR REPLACE, comments, schema-qualified names and UPDATE ... FROM are not allowed. You may add RETURNING to get rows back.",
  "UPDATE and DELETE only ever touch this user's rows, even without a WHERE; with no WHERE they touch ALL of the user's rows in that table.",
].join("\n");

type Tok = { t: "word" | "str" | "id" | "num" | "p"; v: string; s: number; e: number; depth: number };

/** Split SQL into tokens with their text span and paren depth; null if a quote is unterminated. */
function tokenize(q: string): Tok[] | null {
  const out: Tok[] = [];
  let depth = 0;
  let i = 0;
  const push = (t: Tok["t"], s: number, e: number, v: string, d = depth) => out.push({ t, v, s, e, depth: d });
  while (i < q.length) {
    const ch = q[i];
    if (/\s/.test(ch)) {
      i++;
    } else if (ch === "'" || ch === '"' || ch === "`" || ch === "[") {
      const close = ch === "[" ? "]" : ch;
      let j = i + 1;
      for (;;) {
        if (j >= q.length) return null;
        if (q[j] === close) {
          if (ch !== "[" && q[j + 1] === close) j += 2;
          else break;
        } else j++;
      }
      const body = q.slice(i + 1, j).split(close + close).join(close);
      push(ch === "'" ? "str" : "id", i, j + 1, ch === "'" ? body : body.toLowerCase());
      i = j + 1;
    } else if (/[A-Za-z_]/.test(ch)) {
      let j = i + 1;
      while (j < q.length && /[A-Za-z0-9_$]/.test(q[j])) j++;
      push("word", i, j, q.slice(i, j).toLowerCase());
      i = j;
    } else if (/[0-9]/.test(ch)) {
      let j = i + 1;
      while (j < q.length && /[0-9A-Za-z_.]/.test(q[j])) j++;
      push("num", i, j, q.slice(i, j));
      i = j;
    } else {
      if (ch === ")") depth--;
      push("p", i, i + 1, ch);
      if (ch === "(") depth++;
      i++;
    }
  }
  return depth === 0 ? out : null;
}

/** Ownership predicate for UPDATE/DELETE: the target row must be one of this user's. */
const ownedRows = (table: string) => `rowid IN (SELECT rowid FROM main.${quoteIdent(table)} WHERE user_email = ?1)`;

/**
 * Validate one INSERT / UPDATE / DELETE and rewrite it so it can only write
 * the caller's rows (?1 = their email). See the header for the approach.
 */
export function buildUserWrite(userSql: string, allTables: string[]): { sql: string } | { error: string } {
  const q = userSql.trim().replace(/;+\s*$/, "");
  if (!q) return { error: "sql is required" };
  if (q.length > 8000) return { error: "sql too long (max 8000 characters)" };
  if (/--|\/\*/.test(q)) return { error: "comments are not allowed" };
  const toks = tokenize(q);
  if (!toks) return { error: "could not parse the statement (unbalanced quote or parenthesis)" };
  if (toks.some((t) => t.t === "p" && t.v === ";")) return { error: "only one statement is allowed" };
  if (toks.some((t) => (t.t === "word" || t.t === "id") && (t.v === "user_email" || t.v.startsWith("sqlite_"))))
    return { error: "user_email and sqlite_ internals can't be referenced; rows are scoped to the user automatically" };
  if (toks.some((t, i) => (t.t === "word" || t.t === "id") && (t.v === "main" || t.v === "temp") && toks[i + 1]?.v === "." && toks[i + 1].t === "p"))
    return { error: "schema-qualified names (main./temp.) are not allowed; use the plain table names" };

  const kind = toks[0].t === "word" ? toks[0].v : "";
  if (kind !== "insert" && kind !== "update" && kind !== "delete") return { error: "only a single INSERT, UPDATE or DELETE is allowed here (use query_user_data to read)" };

  // The target table: INSERT INTO t / UPDATE t / DELETE FROM t.
  const at = kind === "update" ? 1 : 2;
  if ((kind === "insert" && toks[1]?.v !== "into") || (kind === "delete" && toks[1]?.v !== "from"))
    return { error: kind === "insert" ? "write INSERT INTO <table> (columns) ..." : "write DELETE FROM <table> ..." };
  const target = toks[at];
  if (!target || (target.t !== "word" && target.t !== "id")) return { error: "missing table name" };
  const table = target.v;
  if (toks[at + 1]?.v === "." && toks[at + 1].t === "p") return { error: "schema-qualified names (main./temp.) are not allowed; use the plain table names" };
  if (!USER_SQL_WRITABLE.includes(table)) {
    return { error: table in EXPOSED ? `${table} is read-only` : `no writable table named ${table}; writable: ${USER_SQL_WRITABLE.join(", ")}` };
  }
  const realTable = `main.${quoteIdent(table)}`;
  const top = toks.filter((t) => t.depth === 0);
  const has = (word: string) => top.some((t) => t.t === "word" && t.v === word);
  const ctes = shadowCtes(allTables);

  if (kind === "insert") {
    const open = toks[at + 1];
    if (!open || open.v !== "(" || open.t !== "p") return { error: "INSERT must list its columns: INSERT INTO <table> (col, ...) VALUES (...)" };
    const close = toks.find((t) => t.t === "p" && t.v === ")" && t.depth === 0 && t.s > open.s)!;
    const cols = toks.filter((t) => t.s > open.s && t.e < close.e && t !== close);
    if (!cols.length || cols.some((t, i) => (i % 2 === 0 ? t.t !== "word" && t.t !== "id" : t.v !== ","))) return { error: "the column list must be plain column names" };
    const rest = top.filter((t) => t.s >= close.e);
    if (!rest.length || !["values", "select", "with"].includes(rest[0].v)) return { error: "INSERT must be followed by VALUES (...) or a SELECT" };
    if (rest.some((t, i) => t.t === "word" && t.v === "on" && rest[i + 1]?.v === "conflict")) return { error: "ON CONFLICT is not allowed; UPDATE the existing row instead" };
    const returning = rest.find((t) => t.t === "word" && t.v === "returning");
    const bodyEnd = returning ? returning.s : q.length;
    const body = q.slice(close.e, bodyEnd).trim();
    const colText = q.slice(open.e, close.s);
    return {
      sql: `WITH ${ctes}\nINSERT INTO ${realTable} (${colText}, "user_email") SELECT *, ?1 FROM (\n${body}\n)${returning ? " " + q.slice(returning.s) : ""}`,
    };
  }

  if (kind === "update") {
    if (!has("set")) return { error: "UPDATE needs SET" };
    if (has("from")) return { error: "UPDATE ... FROM is not allowed; use a subquery in the WHERE or SET instead" };
  }
  if (kind === "delete" && has("from") && top.filter((t) => t.t === "word" && t.v === "from").length > 1) return { error: "unexpected FROM" };

  // Splice the ownership predicate in, working back to front so earlier offsets stay valid.
  const afterTarget = top.filter((t) => t.s >= target.e);
  const tail = afterTarget.find((t) => t.t === "word" && (t.v === "returning" || t.v === "order" || t.v === "limit"));
  const tailAt = tail ? tail.s : q.length;
  const where = afterTarget.find((t) => t.t === "word" && t.v === "where" && t.s < tailAt);
  let out: string;
  if (where) out = `${q.slice(0, where.e)} ${ownedRows(table)} AND (${q.slice(where.e, tailAt)}) ${q.slice(tailAt)}`;
  else out = `${q.slice(0, tailAt)} WHERE ${ownedRows(table)} ${q.slice(tailAt)}`;
  out = out.slice(0, target.s) + realTable + out.slice(target.e);
  return { sql: `WITH ${ctes}\n${out.trim()}` };
}
