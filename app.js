// Game of Chests - single page app with perfect AI (coin-placer)
// Roles:
// - Presenter offers a basket (1-3) each of 4 turns.
// - Placer (friend) places one remaining coin (1-4) into the offered basket.
// After 4 placements, placer chooses the basket with the largest sum; presenter wins only on draw.

(function(){
  // DOM
  const modeEl = document.getElementById('mode');
  const newGameBtn = document.getElementById('newGame');
  const infoEl = document.getElementById('info');
  const offers = Array.from(document.querySelectorAll('.offer'));
  const coinButtons = Array.from(document.querySelectorAll('.place-coin'));
  const coinSpans = Array.from(document.querySelectorAll('#coins .coin'));
  const basketContents = [
    document.getElementById('basket-0'),
    document.getElementById('basket-1'),
    document.getElementById('basket-2'),
  ];
  const basketSums = [
    document.getElementById('sum-0'),
    document.getElementById('sum-1'),
    document.getElementById('sum-2'),
  ];
  const movesList = document.getElementById('moves');
  const resultEl = document.getElementById('result');
  const resultText = document.getElementById('result-text');
  const newRoundBtn = document.getElementById('newRound');
  const placerPrompt = document.getElementById('placer-prompt');

  // Game state
  let baskets; // arrays of coins
  let sums;
  let remainingCoins;
  let turn; // 0..3
  let awaitingOffer = true;
  let currentOffered = null;

  function newGame(){
    baskets = [[],[],[]];
    sums = [0,0,0];
    remainingCoins = [1,2,3,4];
    turn = 0;
    awaitingOffer = true;
    currentOffered = null;
    movesList.innerHTML = '';
    resultEl.hidden = true;
    updateUI();
    infoEl.textContent = "Presenter's turn: offer a basket (1–3)";
    placerPrompt.textContent = "Waiting for basket offer...";
  }

  // UI updates / helpers
  function updateUI(){
    for(let i=0;i<3;i++){
      basketContents[i].textContent = baskets[i].length ? baskets[i].join(', ') : '(empty)';
      basketSums[i].textContent = `Sum: ${sums[i]}`;
    }
    coinSpans.forEach(s => {
      const v = Number(s.dataset.value);
      if(remainingCoins.includes(v)) s.classList.add('available'), s.classList.remove('used');
      else s.classList.remove('available'), s.classList.add('used');
    });
    // disable/enable offers and place buttons depending on phase
    offers.forEach(b => {
      b.disabled = !awaitingOffer;
    });
    coinButtons.forEach(b => {
      const val = Number(b.dataset.value);
      b.disabled = awaitingOffer || !remainingCoins.includes(val) || currentOffered===null;
    });
  }

  // Game move: presenter offers basket idx
  function offerBasket(idx){
    if(!awaitingOffer) return;
    currentOffered = idx;
    awaitingOffer = false;
    infoEl.textContent = `Basket ${idx+1} offered — placer choose a coin to place.`;
    placerPrompt.textContent = `Basket ${idx+1} offered. Place a coin.`;
    updateUI();

    // If mode is AI and the placer is AI, compute AI move
    if(modeEl.value === 'ai'){
      // compute best coin to place (perfect adversarial search)
      const best = aiChooseCoinForOffer({baskets: cloneArr(baskets), sums: sums.slice(), remaining: remainingCoins.slice(), turn}, idx);
      // small delay to feel natural
      setTimeout(()=> doPlace(Number(best), idx), 400);
    }
  }

  // Execute placing coin v into basket idx
  function doPlace(v, idx){
    if(awaitingOffer) return;
    if(!remainingCoins.includes(v)) return;
    // place
    baskets[idx].push(v);
    sums[idx] += v;
    remainingCoins = remainingCoins.filter(x => x !== v);
    const li = document.createElement('li');
    li.textContent = `Turn ${turn+1}: basket ${idx+1} <- ${v}`;
    movesList.appendChild(li);

    turn++;
    currentOffered = null;
    // check end
    if(turn >= 4){
      endGame();
      return;
    } else {
      awaitingOffer = true;
      infoEl.textContent = "Presenter's turn: offer a basket (1–3)";
      placerPrompt.textContent = "Waiting for basket offer...";
    }
    updateUI();
  }

  function endGame(){
    updateUI();
    // compute sorted sums
    const sorted = sums.slice().sort((a,b)=>b-a);
    const s1 = sorted[0], s2 = sorted[1];
    // placer (friend) wins if s1 > s2, presenter wins only on draw (s1 == s2)
    if(s1 > s2){
      resultText.textContent = `Placer (coin-placer) wins — top ${s1} vs second ${s2}`;
    } else {
      resultText.textContent = `Presenter wins (draw) — top ${s1} vs second ${s2}`;
    }
    resultEl.hidden = false;
    infoEl.textContent = 'Game over';
  }

  // Utility: deep clone arrays of arrays
  function cloneArr(a){ return a.map(x => x.slice()); }

  // --- AI logic: perfect adversarial search for the placer
  // The scenario: presenter (adversary) chooses which basket to offer each turn.
  // The placer wants to choose a coin at each offered basket choice such that,
  // for all future choices of offered baskets by the presenter, the placer can still force a win.
  //
  // We'll implement a recursive adversarial search:
  // function canForceWinGivenOffer(state, offeredBasket):
  //   for each coin c in remaining:
  //     place c into offeredBasket => newState
  //     if turn+1 == 4 => evaluate final result (true if placer wins)
  //     else => for all possible next offered baskets b2 (presenter choices),
  //               canForceWinGivenOffer(newState, b2) must be true
  //     if such a coin c exists, return true
  //   return false
  //
  // To pick a move in real play when presenter offers basket idx, we return any coin c that satisfies the above.
  //
  // We'll memoize states to be fast. The state can be represented by:
  //  - sorted remaining coin bitmask (1..4) or integer mask
  //  - basket sums (s1,s2,s3) and turn
  //  - but since baskets are distinguished by index (presenter offers by index), we keep basket sums in order.
  //

  function stateKey(sumsArr, remainingArr, turnVal, offeredIdx){
    // sums in order, remaining mask, turn, offered
    let mask = 0;
    for(const c of remainingArr) mask |= 1 << (c-1);
    return `${sumsArr[0]},${sumsArr[1]},${sumsArr[2]}|${mask}|${turnVal}|${offeredIdx}`;
  }

  const memo = new Map();

  function canForceWinGivenOffer(state, offeredIdx){
    // state: {baskets: [[],[],[]], sums: [n,n,n], remaining: [coins], turn}
    const key = stateKey(state.sums, state.remaining, state.turn, offeredIdx);
    if(memo.has(key)) return memo.get(key);

    // If invalid: no remaining coins, return evaluation
    if(state.remaining.length === 0){
      const sorted = state.sums.slice().sort((a,b)=>b-a);
      const s1 = sorted[0], s2 = sorted[1];
      const res = s1 > s2;
      memo.set(key, res);
      return res;
    }

    // For each possible coin c we could place on offeredIdx:
    for(const c of state.remaining){
      // apply
      const newSums = state.sums.slice();
      newSums[offeredIdx] += c;
      const newRemaining = state.remaining.filter(x => x !== c);
      const newTurn = state.turn + 1;

      if(newTurn >= 4){
        // evaluation
        const sorted = newSums.slice().sort((a,b)=>b-a);
        const s1 = sorted[0], s2 = sorted[1];
        if(s1 > s2){
          memo.set(key, true);
          return true; // this coin produces final win
        }
        // else try other coins
        continue;
      }

      // Otherwise, presenter will choose next offered basket adversarially.
      // For this coin to be safe, for ALL possible next offered basket indices,
      // the placer must be able to force a win (existence of responses).
      let allNext = true;
      for(let nextOff = 0; nextOff < 3; nextOff++){
        // Note: presenter can offer any basket; even repeatedly the same.
        const nextState = {
          baskets: null,
          sums: newSums,
          remaining: newRemaining,
          turn: newTurn,
        };
        const ok = canForceWinGivenOffer(nextState, nextOff);
        if(!ok){
          allNext = false;
          break;
        }
      }
      if(allNext){
        memo.set(key, true);
        return true;
      }
      // else try next coin
    }

    memo.set(key, false);
    return false;
  }

  // Given the current state and an offered basket idx, pick a coin value.
  // Prefer a coin that guarantees a forced win. If none, pick fallback:
  // greedy: place the largest available coin in the offered basket.
  function aiChooseCoinForOffer(state, offeredIdx){
    // state param includes baskets, sums, remaining, turn
    // Clear memo between full game checks to avoid interference across different root states
    // (but we keep memo global for speed across calls).
    for(const c of state.remaining){
      const newSums = state.sums.slice();
      newSums[offeredIdx] += c;
      const newRemaining = state.remaining.filter(x => x !== c);
      const newState = {sums: newSums, remaining: newRemaining, turn: state.turn + 1};
      if(newState.turn >= 4){
        const sorted = newSums.slice().sort((a,b)=>b-a);
        if(sorted[0] > sorted[1]) return c;
        continue;
      }
      // check for all next offers
      let allOk = true;
      for(let nextOff=0; nextOff<3; nextOff++){
        if(!canForceWinGivenOffer(newState, nextOff)){
          allOk = false;
          break;
        }
      }
      if(allOk) return c;
    }
    // no guaranteed coin found; fallback heuristic: put largest remaining
    return Math.max(...state.remaining);
  }

  // Event wiring
  offers.forEach(b => b.addEventListener('click', e => {
    const idx = Number(e.currentTarget.dataset.index);
    offerBasket(idx);
  }));

  coinButtons.forEach(btn => btn.addEventListener('click', e => {
    const val = Number(e.currentTarget.dataset.value);
    if(currentOffered === null) return;
    doPlace(val, currentOffered);
  }));

  newGameBtn.addEventListener('click', () => {
    // reset memo to keep it small between full games
    memo.clear();
    newGame();
  });
  newRoundBtn.addEventListener('click', () => {
    memo.clear();
    newGame();
  });

  // initialize
  newGame();

  // Expose for debugging from console (optional)
  window.__game = {
    canForceWinGivenOffer,
    aiChooseCoinForOffer,
    memo,
  };

})();