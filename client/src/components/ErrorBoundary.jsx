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
        <div className="error-boundary">
          <h1>💥 Ups!</h1>
          <p>Coś poszło nie tak.</p>
          <p className="error-message">
            Wystąpił nieoczekiwany błąd. Spróbuj odświeżyć stronę.
          </p>
          <button
            className="btn-reload"
            onClick={() => { this.setState({ hasError: false, error: null }); window.location.reload(); }}
            aria-label="Odśwież stronę"
          >
            🔄 Odśwież stronę
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
