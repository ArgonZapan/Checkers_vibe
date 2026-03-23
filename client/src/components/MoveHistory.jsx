import React from 'react';

const colLetters = 'abcdefgh';

function posLabel(r, c) {
  return `${colLetters[c]}${8 - r}`;
}

export default function MoveHistory({ moves = [] }) {
  const recent = moves.slice(-20);

  return (
    <div className="move-history">
      <h3>📜 Historia ruchów</h3>
      {recent.length === 0 ? (
        <p style={{ color: 'var(--text-dim)', fontSize: '0.85rem' }}>Brak ruchów</p>
      ) : (
        <ol className="move-list">
          {recent.map((m, i) => (
            <li key={i} className={i === recent.length - 1 ? 'move-last' : ''}>
              <span className={m.color === 'white' ? 'move-white' : 'move-black'}>
                {m.color === 'white' ? '⚪' : '⚫'}
                <span className="sr-only">{m.color === 'white' ? 'biały' : 'czarny'}</span>
              </span>
              {' '}
              <span className="move-notation">
                {posLabel(m.from[0], m.from[1])} → {posLabel(m.to[0], m.to[1])}
                {m.captured && <span className="move-capture"> <span aria-label="zbicie">✕</span></span>}
                {m.becameKing && <span className="move-king"> 👑</span>}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
