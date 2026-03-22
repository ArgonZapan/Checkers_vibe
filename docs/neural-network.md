# Sieć neuronowa — Architektura

## Silnik

TensorFlow.js (tfjs-node) — działa w Node.js na backendzie.

## Wejście (input)

Stan planszy z bitboardów jako tensor wejściowy:

- **8×8×4** — 8 rzędów, 8 kolumn, 4 kanały:
  - Kanał 1: pionki białe
  - Kanał 2: damki białe
  - Kanał 3: pionki czarne
  - Kanał 4: damki czarne
- Dodatkowo: 1 bit — czyja tura (0 = białe, 1 = czarne)

Razem: 257 wartości wejściowych.

## Warianty rozmiaru sieci

### Small (szybki, mniej dokładny)
```
Input (257) → Dense(128) + ReLU → Dense(64) + ReLU → Policy + Value
```

### Medium (domyślny)
```
Input (257) → Dense(256) + ReLU → Dense(128) + ReLU → Dense(64) + ReLU → Policy + Value
```

### Large (dokładny, wolniejszy)
```
Input (257) → Dense(512) + ReLU → Dense(256) + ReLU → Dense(128) + ReLU → Dense(64) + ReLU → Policy + Value
```

## Output — dual head

### Policy head
- Dense(N) + Softmax — N = max legalnych ruchów (~48)
- Prawdopodobieństwo każdego ruchu
- Ruchy nielegalne → maska (0)

### Value head
- Dense(1) + Tanh
- -1.0 (przegrana) do +1.0 (wygrana)

## Parametry (konfigurowalne z UI)

- **epsilon** (0.0 - 1.0): prawdopodobieństwo losowego ruchu (eksploracja)
  - 1.0 = pełna losowość
  - 0.0 = zawsze najlepszy ruch
  - Domyślnie: 0.5
  - Decay: -0.001 na grę (min 0.01)
- **networkSize**: "small" | "medium" | "large"
- Oba parametry osobno dla białych i czarnych

## Format zapisu (na dysk)

Katalog `models/`:
- `white.json` — wagi modelu białych
- `black.json` — wagi modelu czarnych
- `meta.json` — metadata (wersja, epsilon, rozmiar, liczba gier)

Auto-zapis co 5 minut.
