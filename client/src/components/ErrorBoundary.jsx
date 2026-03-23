import React from 'react';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('ErrorBoundary caught:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          minHeight: '100vh', background: '#1a1a2e', color: '#e0e0e0', fontFamily: 'Segoe UI, sans-serif',
          textAlign: 'center', padding: '2rem',
        }}>
          <h1 style={{ fontSize: '3rem', marginBottom: '1rem' }}>💥 Ups!</h1>
          <p style={{ fontSize: '1.2rem', marginBottom: '0.5rem' }}>Coś poszło nie tak.</p>
          <p style={{ color: '#e94560', fontFamily: 'monospace', marginBottom: '1.5rem', maxWidth: '600px', wordBreak: 'break-word' }}>
            Wystąpił nieoczekiwany błąd. Spróbuj odświeżyć stronę.
          </p>
          <button
            onClick={() => { this.setState({ hasError: false, error: null }); window.location.reload(); }}
            style={{
              padding: '0.75rem 2rem', background: '#e94560', color: '#fff', border: 'none',
              borderRadius: '8px', fontSize: '1rem', cursor: 'pointer', fontWeight: 600,
            }}
          >
            🔄 Odśwież stronę
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
