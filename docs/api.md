# Backend API

## Protokół

Backend (C++) nasłuchuje na WebSocket + HTTP REST.

## Endpointy REST

### GET /api/status
Stan serwera i modelu.

Odpowiedź:
- `modelLoaded: bool`
- `modelVersion: int`
- `gamesPlayed: int`
- `bufferSize: int` (liczba ruchów w replay buffer)
- `lastSave: timestamp`

### POST /api/game/start
Rozpocznij nową grę.

Parametry:
- `mode: "pvai" | "aivai"`
- `playerSide: 1 | 2` (tylko w PvAI)

Odpowiedź:
- `gameId: string`
- `board: 8x8 array`
- `currentTurn: 1 | 2`

### POST /api/game/move
Wykonaj ruch (tylko PvAI).

Parametry:
- `gameId: string`
- `move: {from: [r,c], to: [r,c]}`

Odpowiedź:
- `board: 8x8 array`
- `aiMove: {from, to}` (jeśli AI odpowiedziało)
- `gameOver: bool`
- `winner: 1 | 2 | null`

### GET /api/game/state
Pobierz aktualny stan gry.

### GET /api/model/info
Informacje o modelu.

### POST /api/model/save
Wymuś zapis modelu.

## WebSocket

### Kanał: /ws/game
Stream aktualizacji planszy w czasie rzeczywistym.

Eventy:
- `move` — ruch wykonany
- `turn` — zmiana tury
- `gameOver` — koniec gry
- `modelUpdate` — wagi zaktualizowane

### Kanał: /ws/training
Stream postępu szkolenia (tylko AI vs AI).

Eventy:
- `gameStart` — rozpoczęcie gry
- `gameEnd` — wynik gry
- `trainStart` — rozpoczęcie szkolenia
- `trainEnd` — loss, accuracy
- `modelSave` — model zapisany
