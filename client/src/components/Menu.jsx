import React from 'react';

/**
 * Menu - Main menu screen for selecting game mode
 */
export default function Menu({ connected, onStartPvai, onStartAivai }) {
  return (
    <div className="app">
      <header className="app-header">
        <h1>♟ Checkers AI</h1>
      </header>
      <div className="menu">
        <h2>Wybierz tryb gry</h2>
        <div className="menu-buttons">
          <button className="btn-primary" onClick={onStartPvai} style={{ fontSize: '1.2rem', padding: '1rem 2rem' }}>
            🎮 Gracz vs AI
          </button>
          <button className="btn-secondary" onClick={onStartAivai} style={{ fontSize: '1.2rem', padding: '1rem 2rem' }}>
            🤖 AI vs AI
          </button>
        </div>
        <p style={{ color: 'var(--text-dim)', marginTop: '1rem' }}>
          {connected ? '🟢 Połączono z serwerem' : '🔴 Brak połączenia'}
        </p>
      </div>
    </div>
  );
}
