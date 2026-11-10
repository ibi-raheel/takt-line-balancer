import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/archivo/wdth.css';
import '@fontsource/dm-mono/400.css';
import '@fontsource/dm-mono/500.css';
import './styles.css';
import { App } from './App';
import { loadData, type Line, type Summary } from './data';

function Root() {
  const [data, setData] = useState<{ lines: Line[]; summary: Summary } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    loadData().then(setData, (e: Error) => setErr(e.message));
  }, []);
  if (err)
    return (
      <p className="boot">
        Could not load the precomputed results ({err}). Run <code>python -I pipeline/run_all.py --stage export</code> and reload.
      </p>
    );
  if (!data) return <p className="boot">Loading the precomputed results…</p>;
  return <App lines={data.lines} summary={data.summary} />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
