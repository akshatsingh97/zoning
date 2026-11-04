import type { JSX } from 'react';
import type { ChecksResponse, ContractResponse } from '../api';

export function ContractPanel({
  contract,
  checks,
}: {
  contract: ContractResponse;
  checks: ChecksResponse;
}): JSX.Element {
  const active = contract.active;
  const latest =
    active === null
      ? undefined
      : (checks.checks.find((c) => c.slug === active.slug) ?? checks.checks[0]);
  return (
    <section aria-label="Contract">
      <h2>Contract</h2>
      {active === null && <p className="empty">No active contract.</p>}
      {active !== null && (
        <div>
          <p className="task">{active.contract.task}</p>
          <h3>In scope</h3>
          <ul className="mono-list">
            {active.contract.in_scope.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
          {active.contract.must_change.length > 0 && (
            <>
              <h3>Must change</h3>
              <ul className="rules do">
                {active.contract.must_change.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </>
          )}
          {active.contract.must_not_change.length > 0 && (
            <>
              <h3>Must not change</h3>
              <ul className="rules dont">
                {active.contract.must_not_change.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </>
          )}
          {contract.gapQuestions.length > 0 && (
            <>
              <h3>Gap questions</h3>
              <ol className="gaps">
                {contract.gapQuestions.map((q) => (
                  <li key={q}>{q}</li>
                ))}
              </ol>
            </>
          )}
          <h3>Latest check</h3>
          {latest === undefined && <p className="empty">No checks yet.</p>}
          {latest !== undefined && (
            <div>
              <p>
                <span className={`verdict ${latest.result.verdict}`}>{latest.result.verdict}</span>{' '}
                <span className="event-time">{latest.slug}</span>
              </p>
              {latest.result.violations.map((v, i) => (
                <p key={`${v.file}-${v.line}-${i}`} className="violation">
                  {v.file}:{v.line} breaks “{v.rule}” — {v.explanation}
                </p>
              ))}
              {latest.result.out_of_scope.length > 0 && (
                <p>Out of scope: {latest.result.out_of_scope.join(', ')}</p>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
