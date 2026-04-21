import { useCallback, useEffect, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';

const isElectron = !!window.electronAPI?.isElectron;

export default function FindBar() {
  const [visible, setVisible] = useState(false);
  const [query, setQuery] = useState('');
  const [matchInfo, setMatchInfo] = useState(null); // { activeMatchOrdinal, matches }
  const inputRef = useRef();

  // Show when triggered from the main process context menu
  useEffect(() => {
    if (!isElectron) return;
    window.electronAPI.onShowFindBar(() => {
      setVisible(true);
      setQuery('');
      setMatchInfo(null);
      // Focus after React has painted the input
      setTimeout(() => inputRef.current?.focus(), 0);
    });
  }, []);

  // Receive find-in-page results from main process
  useEffect(() => {
    if (!isElectron) return;
    window.electronAPI.onFoundInPage((result) => {
      if (result.finalUpdate) {
        setMatchInfo({ active: result.activeMatchOrdinal, total: result.matches });
      }
    });
  }, []);

  // Run find whenever the query changes while visible
  useEffect(() => {
    if (!isElectron || !visible) return;
    if (query) {
      window.electronAPI.findInPage(query);
    } else {
      window.electronAPI.stopFind();
      setMatchInfo(null);
    }
  }, [query, visible]);

  const close = useCallback(() => {
    setVisible(false);
    setQuery('');
    setMatchInfo(null);
    if (isElectron) window.electronAPI.stopFind();
  }, []);

  // Escape closes the bar
  useEffect(() => {
    if (!visible) return;
    const handler = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [visible, close]);

  if (!visible) return null;

  const noResults = matchInfo && query && matchInfo.total === 0;

  return (
    <div className="fixed top-3 right-4 z-50 flex items-center gap-2 bg-white border border-gray-300 rounded-lg shadow-lg px-3 py-2">
      <Search size={14} className="text-gray-400 flex-shrink-0" />
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Find on page..."
        className={`text-sm outline-none w-48 ${noResults ? 'text-red-500' : ''}`}
      />
      {matchInfo && query && (
        <span className="text-xs text-gray-400 whitespace-nowrap">
          {matchInfo.total === 0
            ? 'No results'
            : `${matchInfo.active} of ${matchInfo.total}`}
        </span>
      )}
      <button
        onClick={close}
        className="text-gray-400 hover:text-gray-600 ml-1 flex-shrink-0"
        title="Close (Esc)"
      >
        <X size={14} />
      </button>
    </div>
  );
}
