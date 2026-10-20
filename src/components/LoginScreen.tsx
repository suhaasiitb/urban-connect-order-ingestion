import React, { useState } from 'react';
import { isSupabaseConfigured } from '../config/supabaseClient';
import { type AdminProfile, signInAdmin } from '../services/authService';

interface LoginScreenProps {
  initialError?: string | null;
  onLoginSuccess: (admin: AdminProfile) => void;
}

export const LoginScreen: React.FC<LoginScreenProps> = ({
  initialError,
  onLoginSuccess,
}) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(
    initialError ?? null
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setSubmitting(true);

    try {
      const result = await signInAdmin(email, password);
      if (result.error || !result.admin) {
        setErrorMessage(result.error ?? 'Authentication failed.');
      } else {
        onLoginSuccess(result.admin);
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="login-layout">
      <div className="login-card">
        <div className="login-header">
          <span className="badge badge-primary">Urban Connect</span>
          <h1>Daily Store Order Ingestion Portal</h1>
          <p className="subtitle">
            Authorized administrator access only. Sign in with your Supabase
            administrator credentials to upload and reconcile store order workbooks.
          </p>
        </div>

        {!isSupabaseConfigured && (
          <div className="alert alert-warning" role="alert">
            <strong>Environment Configuration Required:</strong>{' '}
            <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code>{' '}
            are not set yet. Copy <code>.env.example</code> to{' '}
            <code>.env.local</code> and add your Supabase project URL and anon key.
          </div>
        )}

        {errorMessage && (
          <div className="alert alert-error" role="alert">
            <strong>Sign-In Error:</strong> {errorMessage}
          </div>
        )}

        <form onSubmit={handleSubmit} className="login-form">
          <div className="form-group">
            <label htmlFor="admin-email">Administrator Email</label>
            <input
              id="admin-email"
              type="email"
              required
              autoComplete="email"
              placeholder="admin@urbanconnect.in"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={submitting}
            />
          </div>

          <div className="form-group">
            <label htmlFor="admin-password">Password</label>
            <input
              id="admin-password"
              type="password"
              required
              autoComplete="current-password"
              placeholder="Enter your password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={submitting}
            />
          </div>

          <button
            type="submit"
            className="btn btn-primary btn-block"
            disabled={submitting}
          >
            {submitting ? 'Verifying Administrator Session...' : 'Sign In to Portal'}
          </button>
        </form>
      </div>
    </div>
  );
};
