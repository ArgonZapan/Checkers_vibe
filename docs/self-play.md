# Self-play training

## Cykl

1. Node.js → C++: start gry
2. Pętla: predykcja → ruch → zapis do bufora → powtórz
3. Po grze: szkolenie na danych z bufora
4. Aktualizacja wag
5. Zapis modelu na dysk
6. Kolejna gra (automatycznie)

## Przepływ jednej gry

```
Node.js:
  1. POST /api/game/start → C++ (nowa plansza)
  2. GET /api/legal-moves → C++
  3. TensorFlow.js.predict(board, legalMoves) → ruch
  4. POST /api/move → C++ (wykonaj)
  5. Zapisz {board, move, turn} do bufora
  6. Sprawdź gameOver
  7. Jeśli nie → goto 2
  8. Określ wynik: +1 (biały wygrał) / -1 (czarny wygrał) / 0 (remis)
  9. Oznacz wszystkie ruchy w buforze wynikiem gry
```

## Epsilon (eksploracja)

- Osobny epsilon dla białych i czarnych (`epsilonWhite`, `epsilonBlack`)
- Każdy gracz może mieć inną wartość
- Decay: -0.01 po każdej grze (min 0.01, z pliku `config.js`)
- Użytkownik może zmienić ręcznie z UI

## Kolejkowanie ruchów (Promise Queue)

Każdy ruch przez WebSocket jest serializowany przez `_moveQueue`:
```js
socket._moveQueue = (socket._moveQueue || Promise.resolve())
  .then(() => handleMove(socket, data))
```
To zapewnia, że ruchy są przetwarzane w kolejności, nawet przy opóźnionых odpowiedziach C++.

## Sterowanie prędkością

- `setSpeed(ms)` — ustawia opóźnienie między ruchami AI (0-10000ms, max 60000 z walidacją)
- `setSpeedMode('fast'|'normal')` — tryb szybki/normalny, zapisany w `CONFIG.server.speedMode`

## Replay buffer

- FIFO, max 10k wpisów
- Wpis: `{board: 8x8x4, legalMoves: [...], chosenMove: int, result: float, turn: string}`
- Auto-zapis na dysk co 10 minut (binarny: `data/buffer.bin`)
- Przy starcie: wczytaj z dysku jeśli istnieje

## Szkolenie

- Po każdej grze: 1 runda szkolenia
- Mini-batch: 256 losowych próbek z bufora
- 5 epok na batch
- Loss:
  - Policy: cross-entropy (predicted vs actual move)
  - Value: MSE (predicted vs game result)
- Optimizer: Adam (lr=0.001)

## Dashboard (AI vs AI)

Użytkownik widzi:
- Planszę w czasie rzeczywistym
- Aktualną turę i numer gry
- Wykres loss (ostatnie 100 rund)
- Statystyki: gry, wygrane białe, wygrane czarne, remisy
- Historia ostatnich 10 gier (wynik, liczba ruchów)

Użytkownik może:
- Start/stop self-play
- Zmienić epsilon (dla białych/czarnych osobno)
- Zmienić rozmiar sieci (dla białych/czarnych osobno)
- Restartować model (biały/czarny/oba)

## Pliki

- `models/white.json` — wagi białych
- `models/black.json` — wagi czarnych
- `models/meta.json` — metadata
- `data/buffer.bin` — replay buffer (binarny)
- `.gitignore` — wyklucz `models/` i `data/`
