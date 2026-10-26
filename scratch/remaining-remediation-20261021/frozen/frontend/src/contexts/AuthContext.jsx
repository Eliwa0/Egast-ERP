import React, { createContext, useContext, useEffect, useState } from 'react';
import API from '../services/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    try {
      const stored = localStorage.getItem('auth_user');
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  });

  const loginUser = (userData) => {
    setUser(userData);
    localStorage.setItem('auth_user', JSON.stringify(userData));
  };

  const logoutUser = () => {
    setUser(null);
    localStorage.removeItem('auth_user');
  };

  useEffect(() => {
    let mounted = true;
    const storedAtSyncStart = localStorage.getItem('auth_user');
    console.log('[RULE-TRACE][AUTH] /me start', {
      at: performance.now().toFixed(1),
      storedUser: storedAtSyncStart,
    });
    API.get('/me/')
      .then((res) => {
        if (!mounted) return;
        const serverUser = res.data?.data;
        console.log('[RULE-TRACE][AUTH] /me success', {
          at: performance.now().toFixed(1),
          serverUser,
        });
        if (serverUser) {
          setUser(serverUser);
          localStorage.setItem('auth_user', JSON.stringify(serverUser));
        }
      })
      .catch((err) => {
        if (!mounted) return;
        console.log('[RULE-TRACE][AUTH] /me error', {
          at: performance.now().toFixed(1),
          status: err?.response?.status,
          error: err?.response?.data?.error || err.message,
        });
        if (err?.response?.status === 401) {
          if (localStorage.getItem('auth_user') === storedAtSyncStart) {
            setUser(null);
            localStorage.removeItem('auth_user');
          }
        }
      });
    return () => { mounted = false; };
  }, []);

  return (
    <AuthContext.Provider value={{ user, loginUser, logoutUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
