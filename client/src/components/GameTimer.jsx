import React, { useState, useEffect, useRef } from 'react';

export default function GameTimer({ gameOver, running = true }) {
  const [seconds, setSeconds] = useState(0);
  const intervalRef = useRef(null);

  useEffect(() => {
    setSeconds(0);
  }, [running, gameOver]);

  useEffect(() => {
    if (gameOver || !running) {
      if (intervalRef.current) clearInterval(intervalRef.current);
      return;
    }
    intervalRef.current = setInterval(() => {
      setSeconds((s) => s + 1);
    }, 1000);
    return () => clearInterval(intervalRef.current);
  }, [gameOver, running]);

  const min = Math.floor(seconds / 60);
  const sec = seconds % 60;

  return (
    <div className="game-timer">
      ⏱ {min}:{sec.toString().padStart(2, '0')}
    </div>
  );
}
