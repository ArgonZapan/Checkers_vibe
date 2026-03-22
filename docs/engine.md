# Silnik gry — Warcaby

## Zasady

Plansza 8×8, pionki na ciemnych polach. Każdy gracz zaczyna z 12 pionkami.

### Ruch
- Pionek: do przodu po skosie (1 pole)
- Pionek bije do przodu i do tyłu
- Damka: po skosie w dowolną stronę, dowolną ilość pól

### Bicie
- Bicie obowiązkowe — jeśli masz możliwość bicia, MUSISz bić
- Bicie: przeskakujesz nad pionkiem przeciwnika na wolne pole za nim
- Bicie wielokrotne: jeśli po biciu masz kolejną możliwość — kontynuujesz
- Pionek bije do przodu i do tyłu
- Damka bije po skosie, przeskakuje 1 pionek, ląduje za nim (na dowolnej odległości)

### Promocja
- Pionek dociera do ostatniego rzędu → staje się damką
- Jeśli bicie prowadzi do ostatniego rzędu — promocja natychmiastowa

### Koniec gry
- Gracz nie ma ruchów (zablokowany) → przegrywa
- Gracz stracił wszystkie pionki → przegrywa
- Remis: 20 ruchów bez bicia lub zmiany pozycji

## Reprezentacja planszy

Bitboard (64-bit unsigned integer). Każdy bit = jedno pole planszy.

### Bitboardy:
- `white_pieces` — pionki białe
- `white_kings` — damki białe
- `black_pieces` — pionki czarne
- `black_kings` — damki czarne
- `empty` — puste pola (obliczane: `~(white | black)`)

Operacje: AND, OR, XOR, shift — przetwarzanie 64 pól jednocześnie. Generowanie ruchów: kilka operacji bitowych zamiast pętli for.

## Generowanie ruchów

1. Zbierz wszystkie możliwe bicia (obowiązkowe)
2. Jeśli bicia istnieją — filtruj tylko bicia
3. Jeśli nie — zbierz zwykłe ruchy
4. Dla bicia wielokrotnego: rekurencja — po każdym przeskoku sprawdź kolejne możliwości

## Ocena pozycji (dla AI klasycznego)

- +1 za każdy pionek, +3 za damkę
- -1 za każdy pionek przeciwnika, -3 za damkę
- +0.5 za kontrolę centrum
- +0.3 za pionka blisko promocji
