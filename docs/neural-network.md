# Sieć neuronowa — Architektura

## Silnik

TensorFlow.js — sieć działa w C++ (backend) z bindingiem do JS lub natywnie przez tfjs-node.

## Wejście (input)

Stan planszy z bitboardów jako tensor wejściowy:

- **8×8×4** — 8 rzędów, 8 kolumn, 4 kanały:
  - Kanał 1: pionki białe (z `white_pieces`)
  - Kanał 2: damki białe (z `white_kings`)
  - Kanał 3: pionki czarne (z `black_pieces`)
  - Kanał 4: damki czarne (z `black_kings`)
- Każdy kanał: 1 jeśli pionek/damka jest na polu, 0 jeśli nie
- Dodatkowo: 1 bit — czyja tura (0 = białe, 1 = czarne)

Razem: 8×8×4 + 1 = 257 wartości wejściowych.

## Architektura

```
Input (257)
  ↓
Dense(512) + ReLU
  ↓
Dense(256) + ReLU
  ↓
Dense(128) + ReLU
  ↓
  ┌──────────┐
  │ Policy   │  (głowa polityki — prawdopodobieństwa ruchów)
  │ Dense(N) │  N = max liczba legalnych ruchów (~48)
  │ Softmax  │
  └──────────┘
  ↓
  ┌──────────┐
  │ Value    │  (głowa wartości — ocena pozycji)
  │ Dense(1) │
  │ Tanh     │  (-1 do +1: -1 = przegrana, +1 = wygrana)
  └──────────┘
```

Dual-headed: jedna sieć, dwa wyjścia. Policy mówi CO zagrać, Value mówi JAK DOBRZE stoimy.

## Output policy

Sieć zwraca prawdopodobieństwo dla każdego możliwego ruchu. Ruchy nielegalne → maska (0).

Przykład:
- Ruch A: 0.45
- Ruch B: 0.30
- Ruch C: 0.15
- Ruch D: 0.10
- (maska) Ruch E: 0.0 — nielegalny

## Output value

Jedna wartość: -1.0 (przegrana) do +1.0 (wygrana). 0.0 = remis/niepewność.

## Uczenie

- **Loss policy:** Cross-entropy między predicted policy a winner moves
- **Loss value:** MSE między predicted value a rzeczywistym wynikiem gry
- **Optimizer:** Adam (lr=0.001)
- **Batch size:** 256
- **Epoki na update:** 5

## Format zapisu

Model zapisywany jako plik binarny:
- Wagi każdej warstwy (float32)
- Architektura (metadane: rozmiary warstw)
- Numer wersji formatu

Ładowanie: odczyt wag + odtworzenie architektury.
