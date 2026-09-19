"use client";
import { useMemo } from "react";
import { Section, CopyButton } from "./ui";
import { normalizeSetup } from "./normalize";

export default function SetupSection({ step, onRetry }) {
  const setup = useMemo(() => (step.data ? normalizeSetup(step.data) : null), [step.data]);
  const lastCmd = setup?.steps.filter((s) => s.command).slice(-1)[0]?.command;
  const showRun = setup?.runCommand && setup.runCommand !== lastCmd;
  const conf = setup?.confidence;

  return (
    <Section
      id="setup"
      title="Run it on your machine"
      lead="Copy these commands in order. Every npm, yarn or pnpm script is checked against the project's real package.json."
      step={step}
      onRetry={onRetry}
      raw={step.data}
      aside={conf && (
        <div className="gs-conf" title="Calculated by GitScope from the config files it found">
          <span>Confidence</span><b>{conf.label}</b>
          <div className="gs-conf__bar"><i style={{ width: `${conf.pct}%` }} /></div>
        </div>
      )}
    >
      {setup && (
        <div className="gs-setup">
          <div className="gs-term">
            <div className="gs-term__bar"><i /><i /><i /><span>terminal</span></div>
            <ol>
              {setup.steps.map((s, i) => (
                <li key={i} style={{ "--i": i }}>
                  <span className="gs-term__n">{i + 1}</span>
                  <div>
                    {s.title && <p className="gs-term__title">{s.title}</p>}
                    {s.command && (
                      <div className="gs-cmd"><code><span>$</span> {s.command}</code><CopyButton text={s.command} /></div>
                    )}
                    {s.detail && <p className="gs-term__detail">{s.detail}</p>}
                  </div>
                </li>
              ))}
              {showRun && (
                <li className="gs-term__run" style={{ "--i": setup.steps.length }}>
                  <span className="gs-term__n">&#9654;</span>
                  <div>
                    <p className="gs-term__title">Then start it</p>
                    <div className="gs-cmd"><code><span>$</span> {setup.runCommand}</code><CopyButton text={setup.runCommand} /></div>
                  </div>
                </li>
              )}
            </ol>
            {setup.steps.length === 0 && <p className="gs-muted gs-pad">No steps were generated for this repository.</p>}
          </div>

          <div className="gs-setup__side">
            {setup.requirements.length > 0 && (
              <div>
                <h4>You need</h4>
                <ul className="gs-tags">{setup.requirements.map((r, i) => <li key={i}>{r}</li>)}</ul>
              </div>
            )}
            {setup.env.length > 0 && (
              <div>
                <h4>Environment variables</h4>
                <ul className="gs-env">
                  {setup.env.map((e) => (
                    <li key={e.name}>
                      <code>{e.name}</code>{e.required === true && <em>required</em>}
                      {e.description && <p>{e.description}</p>}
                      {e.example && <small>e.g. {e.example}</small>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {conf?.reasons?.length > 0 && (
              <div><h4>Why this confidence</h4><ul className="gs-plain">{conf.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul></div>
            )}
            {setup.warnings.length > 0 && (
              <div className="gs-note gs-note--stack">{setup.warnings.map((w, i) => <span key={i}>{w}</span>)}</div>
            )}
          </div>

          {setup.troubleshooting.length > 0 && (
            <div className="gs-trouble">
              <h4>If something breaks</h4>
              {setup.troubleshooting.map((t, i) => (
                <details key={i}>
                  <summary>{t.problem}</summary>
                  <div>
                    {t.fix && <p>{t.fix}</p>}
                    {t.source && (/^https?:/.test(t.source) ? <a href={t.source} target="_blank" rel="noreferrer">Source in the repository</a> : <small>Source: {t.source}</small>)}
                  </div>
                </details>
              ))}
            </div>
          )}
        </div>
      )}
    </Section>
  );
}
