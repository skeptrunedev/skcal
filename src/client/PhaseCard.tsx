import { useState } from "react";
import type { Phase } from "../shared/types";
import { api, todayLocal } from "./api";
import { dayLabel } from "./dates";

// The open goal phase (bulk / cut / maintain): planned vs actual weekly rate,
// and starting or ending one. Calories default to maintenance estimated from
// the user's own logs plus the rate's surplus or deficit.
const KINDS: Phase["kind"][] = ["bulk", "cut", "maintain"];
const DEFAULT_RATE: Record<Phase["kind"], string> = { bulk: "0.25", cut: "-0.5", maintain: "0" };
const STATUS: Record<Phase["progress"]["status"], [string, string]> = {
  on_track: ["good", "ON TRACK"],
  too_fast: ["attention", "TOO FAST"],
  too_slow: ["attention", "TOO SLOW"],
  not_enough_data: ["info", "TRACKING"],
};
const signed = (n: number, digits = 2) => `${n > 0 ? "+" : ""}${n.toFixed(digits)}`;

export function PhaseCard({ phase, onChange }: { phase: Phase | null; onChange: () => void }) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);

  async function end() {
    if (!phase) return;
    setBusy(true);
    try {
      await api.endPhase(phase.id, todayLocal());
      onChange();
    } finally {
      setBusy(false);
    }
  }

  const p = phase?.progress;
  const status = p ? STATUS[p.status] : null;
  return (
    <section className="card">
      <div className="card-head">
        <p className="label">Phase{phase ? ` / ${phase.kind}` : ""}</p>
        {status && <span className={`status ${status[0]}`}>{status[1]}</span>}
      </div>
      {!phase || !p ? (
        <p className="empty">no goal phase set, start a bulk, cut, or maintenance block</p>
      ) : (
        <>
          <p className="insight">
            Week {Math.floor(p.weeksElapsed) + 1}
            {p.weeksPlanned ? ` of ${Math.ceil(p.weeksPlanned)}` : ""}
            {p.changeLb != null ? `, ${signed(p.changeLb, 1)} lb since ${dayLabel(phase.startDate)}` : ""}
          </p>
          <div className="rows">
            <div className="crow">
              <div className="crow-top">
                <span className="crow-label">Planned</span>
                <span className="crow-val">
                  {p.plannedLbPerWeek != null ? signed(p.plannedLbPerWeek) : "—"}
                  <span className="unit"> lb/wk · {phase.ratePctPerWeek != null ? signed(phase.ratePctPerWeek) : "—"}%</span>
                </span>
              </div>
            </div>
            <div className="crow">
              <div className="crow-top">
                <span className="crow-label">Actual</span>
                <span className="crow-val">
                  {p.actualLbPerWeek != null ? signed(p.actualLbPerWeek) : "—"}
                  <span className="unit"> lb/wk{p.actualPctPerWeek != null ? ` · ${signed(p.actualPctPerWeek)}%` : ""}</span>
                </span>
              </div>
            </div>
          </div>
          <p className="meta">
            {phase.dailyKcalTarget != null ? `${phase.dailyKcalTarget} kcal` : "calories unchanged"}
            {phase.proteinTargetG != null ? ` · ${phase.proteinTargetG} g protein` : ""}
            {phase.goalWeightLb != null ? ` · goal ${phase.goalWeightLb} lb` : ""}
            {phase.plannedEndDate ? ` · until ${phase.plannedEndDate}` : ""}
          </p>
        </>
      )}
      <div className="sheet-actions">
        {phase && (
          <button className="btn ghost" onClick={end} disabled={busy}>
            End {phase.kind}
          </button>
        )}
        <button className="btn ghost" onClick={() => setEditing(true)}>
          {phase ? "New phase" : "Start a phase"}
        </button>
      </div>
      {editing && <PhaseSheet current={phase} onClose={() => setEditing(false)} onSaved={onChange} />}
    </section>
  );
}

function PhaseSheet({ current, onClose, onSaved }: { current: Phase | null; onClose: () => void; onSaved: () => void }) {
  const [kind, setKind] = useState<Phase["kind"]>(current?.kind === "bulk" ? "cut" : "bulk");
  const [rate, setRate] = useState(DEFAULT_RATE[kind]);
  const [end, setEnd] = useState("");
  const [kcal, setKcal] = useState("");
  const [protein, setProtein] = useState(current?.proteinTargetG != null ? String(current.proteinTargetG) : "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  async function save() {
    setErr(null);
    setBusy(true);
    try {
      const r = await api.startPhase(todayLocal(), {
        kind,
        ratePctPerWeek: rate.trim() ? Number(rate) : null,
        plannedEndDate: end || null,
        dailyKcal: kcal.trim() ? Number(kcal) : null,
        proteinG: protein.trim() ? Number(protein) : null,
      });
      onSaved();
      if (r.kcalSource === "unchanged") {
        // Not enough logs to estimate maintenance: say so instead of guessing.
        setNote("Started. Calories stayed as they were, there isn't enough logged intake yet to estimate maintenance. Ask the agent to set them, or enter them here.");
      } else onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="tabs">
          {KINDS.map((k) => (
            <button
              key={k}
              className={`tab ${kind === k ? "active" : ""}`}
              onClick={() => {
                setKind(k);
                setRate(DEFAULT_RATE[k]);
              }}
            >
              {k}
            </button>
          ))}
        </div>
        <div className="form">
          <label className="field">
            <span>Rate, % bodyweight / week</span>
            <input inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} />
          </label>
          <label className="field">
            <span>Planned end (optional)</span>
            <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
          </label>
          <label className="field">
            <span>Daily calories (blank = from your logs)</span>
            <input inputMode="numeric" value={kcal} onChange={(e) => setKcal(e.target.value)} placeholder="auto" />
          </label>
          <label className="field">
            <span>Daily protein g</span>
            <input inputMode="numeric" value={protein} onChange={(e) => setProtein(e.target.value)} />
          </label>
        </div>
        {err && <p className="form-err">{err}</p>}
        {note && <p className="form-warn">{note}</p>}
        <div className="sheet-actions">
          <button className="btn ghost" onClick={onClose}>
            {note ? "Done" : "Cancel"}
          </button>
          {!note && (
            <button className="btn" onClick={save} disabled={busy}>
              Start {kind}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
