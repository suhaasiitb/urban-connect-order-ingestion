import React, { useState } from 'react';
import { isSupabaseConfigured } from '../config/supabaseClient';
import { type UserProfile, signInUser } from '../services/authService';

interface LoginScreenProps {
  initialError?: string | null;
  onLoginSuccess: (user: UserProfile) => void;
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
      const result = await signInUser(email, password);
      if (result.error || !result.user) {
        setErrorMessage(result.error ?? 'Authentication failed.');
      } else {
        onLoginSuccess(result.user);
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
            Sign in with your administrator or store operator credentials to upload
            and inspect store order workbooks and performance analytics.
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
            <label htmlFor="user-email">Account Email</label>
            <input
              id="user-email"
              type="email"
              required
              autoComplete="email"
              placeholder="admin@urbanconnect.in or store@urbanconnect.in"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={submitting}
            />
          </div>

          <div className="form-group">
            <label htmlFor="user-password">Password</label>
            <input
              id="user-password"
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
            {submitting ? 'Verifying Credentials...' : 'Sign In to Portal'}
          </button>
        </form>
      </div>
    </div>
  );
};
