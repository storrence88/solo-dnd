import { useEffect, useState } from 'react';
import { Play } from './Play';
import { Sandbox } from './Sandbox';

type Page = 'play' | 'sandbox';

export function App() {
  const [page, setPage] = useState<Page>(() => (location.hash === '#sandbox' ? 'sandbox' : 'play'));
  useEffect(() => {
    const onHash = () => setPage(location.hash === '#sandbox' ? 'sandbox' : 'play');
    addEventListener('hashchange', onHash);
    return () => removeEventListener('hashchange', onHash);
  }, []);

  return (
    <main>
      <nav className="tabs">
        <a href="#play" className={page === 'play' ? 'on' : ''}>Play</a>
        <a href="#sandbox" className={page === 'sandbox' ? 'on' : ''}>Rules sandbox</a>
      </nav>
      {page === 'play' ? <Play /> : <Sandbox />}
    </main>
  );
}
