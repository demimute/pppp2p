import { useState, useCallback } from 'react';

const API_BASE = window.electronAPI
  ? 'http://127.0.0.1:18765'
  : (import.meta.env.VITE_API_BASE_URL || '');

export function useApi() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const request = useCallback(async (method, endpoint, body = null) => {
    setLoading(true);
    setError(null);

    try {
      const options = {
        method,
        headers: {
          'Content-Type': 'application/json',
        },
      };

      if (body) {
        options.body = JSON.stringify(body);
      }

      // Try through electron API first (for production)
      if (window.electronAPI?.apiCall) {
        const result = await window.electronAPI.apiCall(method, endpoint, body);
        if (result.success) {
          return result.data;
        } else {
          throw new Error(result.error || 'API request failed');
        }
      }

      // Fallback to direct fetch (for development)
      const response = await fetch(`${API_BASE}${endpoint}`, options);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      return data;
    } catch (err) {
      console.error(`API Error [${method} ${endpoint}]:`, err);
      setError(err.message);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const get = useCallback((endpoint) => request('GET', endpoint), [request]);
  
  const post = useCallback((endpoint, body) => request('POST', endpoint, body), [request]);
  
  const put = useCallback((endpoint, body) => request('PUT', endpoint, body), [request]);
  
  const del = useCallback((endpoint) => request('DELETE', endpoint), [request]);

  return {
    get,
    post,
    put,
    delete: del,
    request,
    loading,
    error,
  };
}

// Specific API functions
export async function scanFolder(folder) {
  if (window.electronAPI?.apiCall) {
    const result = await window.electronAPI.apiCall('POST', '/api/scan', { folder });
    return result.success ? result.data : null;
  }
  
  const response = await fetch(`${API_BASE}/api/scan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ folder }),
  });
  return response.json();
}

export async function getGroups(params) {
  if (window.electronAPI?.apiCall) {
    const result = await window.electronAPI.apiCall('POST', '/api/groups', params);
    return result.success ? result.data : null;
  }
  
  const response = await fetch(`${API_BASE}/api/groups`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  return response.json();
}

export async function moveFiles(folder, moves) {
  if (window.electronAPI?.apiCall) {
    const result = await window.electronAPI.apiCall('POST', '/api/move', { folder, moves });
    return result.success ? result.data : null;
  }
  
  const response = await fetch(`${API_BASE}/api/move`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ folder, moves }),
  });
  return response.json();
}

export async function undo(folder) {
  if (window.electronAPI?.apiCall) {
    const result = await window.electronAPI.apiCall('POST', '/api/undo', { folder });
    return result.success ? result.data : null;
  }
  
  const response = await fetch(`${API_BASE}/api/undo`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ folder }),
  });
  return response.json();
}

export async function getHistory() {
  if (window.electronAPI?.apiCall) {
    const result = await window.electronAPI.apiCall('GET', '/api/history', null);
    return result.success ? result.data : null;
  }
  
  const response = await fetch(`${API_BASE}/api/history`);
  return response.json();
}
