import { useState, useCallback, useEffect } from 'react';
import { getHistory, undo } from './useApi.js';

export function useHistory() {
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // fetchHistory intentionally omits setError from its dependency array.
  // setError from useState is stable across renders and does NOT change,
  // so listing it would NOT cause useCallback to recreate fetchHistory.
  // However, for safety and clarity we use an empty deps array here.
  const fetchHistory = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const result = await getHistory();
      if (result) {
        setHistory(result.history || []);
      }
    } catch (err) {
      console.error('History fetch error:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []); // stable: setError identity is fixed for the lifetime of this component

  const handleUndo = useCallback(async (folder) => {
    setLoading(true);
    setError(null);

    try {
      const result = await undo(folder);
      if (result?.success) {
        await fetchHistory();
        return true;
      } else {
        setError(result?.error || 'Undo failed');
        return false;
      }
    } catch (err) {
      console.error('Undo error:', err);
      setError(err.message);
      return false;
    } finally {
      setLoading(false);
    }
  }, [fetchHistory]); // stable: setError is not a dependency

  const addEntry = useCallback((entry) => {
    setHistory(prev => [entry, ...prev]);
  }, []);

  // Fetch history on mount — intentionally run once with empty deps.
  // fetchHistory is useCallback-wrapped so it has a stable identity.
  useEffect(() => {
    fetchHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Intentionally not adding fetchHistory to deps: we want mount-only behavior.
  // Adding it would re-trigger fetch on any future fetchHistory recreation.

  return {
    history,
    loading,
    error,
    fetchHistory,
    handleUndo,
    addEntry,
  };
}
