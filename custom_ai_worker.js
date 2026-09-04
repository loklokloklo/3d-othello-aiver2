// custom_ai_worker.js (高速化版)
// 変更点:
//  - 盤面表現をネスト配列([x][y][z])からフラット配列(Int8Array 64要素)に変更(copyBoardのコストを削減)
//  - Zobristハッシュ + 置換表(TT)を追加(同一局面の再探索を回避)
// 評価関数・探索方式(反復深化+αβ法)そのものは変更していません。
// メインスレッド(e_custom.js)とのメッセージ仕様(think/result/depthProgress/stop)も変更なし。

const SZ = 4, TOTAL = 64;
function ci(x,y,z){ return x + y*SZ + z*SZ*SZ; }
function coordOf(i){ return [i % SZ, Math.floor(i/SZ) % SZ, Math.floor(i/(SZ*SZ))]; }

// ========================================
// 26方向のライン事前計算
// ========================================
const DIRS = [];
for (let dx=-1; dx<=1; dx++) for (let dy=-1; dy<=1; dy++) for (let dz=-1; dz<=1; dz++)
  if (dx!==0||dy!==0||dz!==0) DIRS.push([dx,dy,dz]);

const LINES = [];
for (let p=0; p<TOTAL; p++) {
  const [x0,y0,z0] = coordOf(p);
  const dl = [];
  for (const [dx,dy,dz] of DIRS) {
    const line = [];
    let x=x0+dx, y=y0+dy, z=z0+dz;
    while (x>=0&&x<SZ&&y>=0&&y<SZ&&z>=0&&z<SZ) { line.push(ci(x,y,z)); x+=dx; y+=dy; z+=dz; }
    dl.push(line);
  }
  LINES.push(dl);
}

// ========================================
// 位置価値(評価関数はこれまでと同じ)
// ========================================
function isCornerPosition(x,y,z){ return (x===0||x===3)&&(y===0||y===3)&&(z===0||z===3); }
function isEdgePosition(x,y,z){ let c=0; if(x===0||x===3)c++; if(y===0||y===3)c++; if(z===0||z===3)c++; return c===2; }
function isFacePosition(x,y,z){ let c=0; if(x===0||x===3)c++; if(y===0||y===3)c++; if(z===0||z===3)c++; return c===1; }
const POS_WEIGHT = new Int8Array(TOTAL);
for (let i=0;i<TOTAL;i++){
  const [x,y,z]=coordOf(i);
  POS_WEIGHT[i] = isCornerPosition(x,y,z)?24 : isEdgePosition(x,y,z)?6 : isFacePosition(x,y,z)?-4 : -1;
}

// ========================================
// 盤面操作(フラット配列版。1=black, 2=white, 0=empty)
// ========================================
function getMoves(board, player) {
  const opp = player===1?2:1;
  const mv=[];
  for (let p=0;p<TOTAL;p++) {
    if (board[p]!==0) continue;
    let ok=false;
    for (const line of LINES[p]) {
      let k=0;
      while (k<line.length && board[line[k]]===opp) k++;
      if (k>0 && k<line.length && board[line[k]]===player) { ok=true; break; }
    }
    if (ok) mv.push(p);
  }
  return mv;
}
function countStones(board, player) {
  let c=0; for (let i=0;i<TOTAL;i++) if (board[i]===player) c++; return c;
}
function isTerminal(board) {
  for (let i=0;i<TOTAL;i++) if (board[i]===0) {
    // 空きマスがある場合のみ、双方パスかどうかを確認すればよい
    if (getMoves(board,1).length===0 && getMoves(board,2).length===0) return true;
    return false;
  }
  return true; // 全マス埋まっている
}
function evaluate(board, player) {
  const opp = player===1?2:1;
  let score=0, mc=0, oc=0;
  for (let i=0;i<TOTAL;i++) {
    const c=board[i];
    if (c===player) { score+=POS_WEIGHT[i]; mc++; }
    else if (c===opp) { score-=POS_WEIGHT[i]; oc++; }
  }
  const mm=getMoves(board,player).length, om=getMoves(board,opp).length;
  score += (mm-om)*8;
  const empties = TOTAL-mc-oc;
  const matW = empties<12?4:0.3;
  score += (mc-oc)*matW;
  return score;
}

// ========================================
// Zobristハッシュ(盤面のみ。手番は別途XORして区別する)
// ========================================
const ZOBRIST = (() => {
  let s=[123456789,362436069,521288629,88675123];
  function next() {
    let t=s[3]; t^=t<<11; t^=t>>>8;
    s[3]=s[2]; s[2]=s[1]; s[1]=s[0]; t^=s[0]; t^=s[0]>>>19; s[0]=t; return t>>>0;
  }
  const tbl=[];
  for (let i=0;i<TOTAL;i++) tbl.push([0, next(), next()]); // index0未使用、[黒用,白用]
  return tbl;
})();
const TURN_SALT = 0x9e3779b9;

function computeHash(board) {
  let h=0;
  for (let i=0;i<TOTAL;i++) if (board[i]!==0) h ^= ZOBRIST[i][board[i]];
  return h>>>0;
}

/**
 * 手を適用し、盤面と(手番を含まない)ハッシュの両方を差分更新して返す
 */
function applyMoveHashed(board, hash, player, pos) {
  const opp = player===1?2:1;
  const nb = board.slice();
  nb[pos]=player;
  let nh = hash ^ ZOBRIST[pos][player];
  for (const line of LINES[pos]) {
    let k=0;
    while (k<line.length && board[line[k]]===opp) k++;
    if (k>0 && k<line.length && board[line[k]]===player) {
      for (let j=0;j<k;j++) {
        const idx=line[j];
        nh ^= ZOBRIST[idx][opp];    // 反転前の石を除去
        nh ^= ZOBRIST[idx][player]; // 反転後の石を追加
        nb[idx]=player;
      }
    }
  }
  return [nb, nh>>>0];
}

// ========================================
// 置換表(TT)
// ========================================
const TT = new Map();
const TT_MAX = 400000;
function ttGet(key) { return TT.get(key) ?? null; }
function ttSet(key, depth, score, flag, move) {
  if (TT.size >= TT_MAX) {
    const it = TT.keys();
    for (let i=0;i<8000;i++){ const k=it.next().value; if (k===undefined) break; TT.delete(k); }
  }
  const ex = TT.get(key);
  if (ex && ex.depth > depth) return; // より深い探索結果を優先して残す
  TT.set(key, {depth, score, flag, move});
}

// ========================================
// 反復深化 + αβ法(negamax、置換表つき、時間制限つき)
// ========================================
let shouldStop = false;
class TimeUp extends Error {}
let nodeCount = 0, ttHits = 0;
let startTime = 0, timeLimit = 8000;

function negamax(board, hash, player, depth, alpha, beta) {
  nodeCount++;
  if ((nodeCount & 511) === 0) {
    if (shouldStop || (Date.now()-startTime) > timeLimit) throw new TimeUp();
  }
  const opp = player===1?2:1;
  const key = (hash ^ (player===2 ? TURN_SALT : 0)) >>> 0;
  const origAlpha = alpha;

  const tte = ttGet(key);
  if (tte && tte.depth >= depth) {
    if (tte.flag==='EXACT') { ttHits++; return tte.score; }
    if (tte.flag==='LOWER') alpha = Math.max(alpha, tte.score);
    else if (tte.flag==='UPPER') beta = Math.min(beta, tte.score);
    if (alpha >= beta) { ttHits++; return tte.score; }
  }

  if (isTerminal(board)) {
    const diff = countStones(board,1) - countStones(board,2);
    const val = diff*1000;
    return player===1 ? val : -val;
  }
  if (depth===0) return evaluate(board, player);

  let moves = getMoves(board, player);
  if (moves.length===0) {
    // パス(盤面もハッシュも変化しないので、そのまま渡す)
    return -negamax(board, hash, opp, depth-1, -beta, -alpha);
  }

  moves = moves.slice().sort((a,b)=>POS_WEIGHT[b]-POS_WEIGHT[a]);
  if (tte && tte.move!=null) {
    const idx = moves.indexOf(tte.move);
    if (idx>0) { moves.splice(idx,1); moves.unshift(tte.move); }
  }

  let best=-Infinity, bestMove=moves[0];
  for (const mv of moves) {
    const [nb, nh] = applyMoveHashed(board, hash, player, mv);
    const val = -negamax(nb, nh, opp, depth-1, -beta, -alpha);
    if (val>best) { best=val; bestMove=mv; }
    if (best>alpha) alpha=best;
    if (alpha>=beta) break;
  }
  const flag = best<=origAlpha ? 'UPPER' : best>=beta ? 'LOWER' : 'EXACT';
  ttSet(key, depth, best, flag, bestMove);
  return best;
}

function bestMoveTimed(flatBoard, player, limitMs) {
  startTime = Date.now();
  timeLimit = limitMs;
  nodeCount = 0; ttHits = 0;
  shouldStop = false;
  TT.clear();

  const opp = player===1?2:1;
  let moves = getMoves(flatBoard, player);
  if (moves.length===0) return null;
  moves = moves.slice().sort((a,b)=>POS_WEIGHT[b]-POS_WEIGHT[a]);

  const empties = TOTAL - countStones(flatBoard,1) - countStones(flatBoard,2);
  const rootHash = computeHash(flatBoard);

  let overallBest = moves[0];
  let lastCompletedDepth = 0;

  for (let depth=1; depth<=empties; depth++) {
    if ((Date.now()-startTime) > timeLimit) break;
    let bestVal=-Infinity, bestMv=moves[0], alpha=-Infinity, beta=Infinity, timedOut=false;
    try {
      for (const mv of moves) {
        const [nb, nh] = applyMoveHashed(flatBoard, rootHash, player, mv);
        const val = -negamax(nb, nh, opp, depth-1, -beta, -alpha);
        if (val>bestVal) { bestVal=val; bestMv=mv; }
        if (val>alpha) alpha=val;
      }
    } catch (e) {
      if (e instanceof TimeUp) timedOut=true; else throw e;
    }
    if (!timedOut) {
      overallBest = bestMv;
      lastCompletedDepth = depth;
      self.postMessage({type:'depthProgress', depth, elapsed: Date.now()-startTime, nodes: nodeCount, ttHits});
      const idx = moves.indexOf(bestMv);
      if (idx>0) { moves.splice(idx,1); moves.unshift(bestMv); }
      if (depth>=empties) break;
    } else {
      break;
    }
  }
  return overallBest;
}

// ========================================
// メインスレッドとの盤面表現の変換
// ([x][y][z]のネスト配列('black'/'white'/null) ⇔ フラット配列(1/2/0))
// ========================================
function nestedToFlat(nested) {
  const flat = new Int8Array(TOTAL);
  for (let x=0;x<SZ;x++) for (let y=0;y<SZ;y++) for (let z=0;z<SZ;z++) {
    const c = nested[x][y][z];
    flat[ci(x,y,z)] = c==='black'?1 : c==='white'?2 : 0;
  }
  return flat;
}

// ========================================
// メッセージハンドラ(仕様はこれまでと同じ)
// ========================================
self.onmessage = function(e) {
  const msg = e.data;
  switch (msg.type) {
    case 'think': {
      shouldStop = false;
      const flatBoard = nestedToFlat(msg.board);
      const player = msg.player==='black' ? 1 : 2;
      const idx = bestMoveTimed(flatBoard, player, msg.timeLimitMs || 8000);
      const move = idx===null ? null : coordOf(idx);
      self.postMessage({type:'result', move});
      break;
    }
    case 'stop': {
      shouldStop = true;
      break;
    }
  }
};
