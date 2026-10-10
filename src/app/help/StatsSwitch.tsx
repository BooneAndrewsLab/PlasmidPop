import { useState } from 'react';

import { type Analytics, analytics as defaultAnalytics } from '../analytics';

interface Props {
  /** Injectable for tests; the app's tracker otherwise. */
  readonly tracker?: Analytics;
}

/**
 * The opt-out for usage statistics (#205), in the guide's footer. Hidden in
 * a build with no tracker configured, where there is nothing to switch. A
 * browser Do-Not-Track or Global Privacy Control signal turns statistics off
 * and is not overridden here.
 */
export function StatsSwitch({ tracker = defaultAnalytics }: Props) {
  const [optedOut, setOptedOut] = useState(tracker.isOptedOut);
  if (!tracker.available) return null;
  const blocked = tracker.blockedByBrowser;
  const on = !blocked && !optedOut;
  return (
    <footer className="help__footer">
      <label className="help__stats">
        <input
          type="checkbox"
          checked={on}
          disabled={blocked}
          onChange={(e) => {
            const next = !e.target.checked;
            tracker.setOptedOut(next);
            setOptedOut(next);
          }}
        />
        Send anonymous usage statistics
      </label>
      <span className="help__stats-note">
        {blocked
          ? 'Off: your browser sends a Do-Not-Track or Global Privacy Control signal.'
          : 'No sequences or file names are ever sent. Takes effect at once.'}
      </span>
    </footer>
  );
}
