// ai_worker.js - 優先探索・読み切りログ対応版

const directions = [];
for (let dx = -1; dx <= 1; dx++)
  for (let dy = -1; dy <= 1; dy++)
    for (let dz = -1; dz <= 1; dz++)
      if (dx !== 0 || dy !== 0 || dz !== 0)
        directions.push([dx, dy, dz]);

const CORNERS_LIST = [
  [0,0,0],[3,0,0],[0,3,0],[0,0,3],
  [3,3,0],[3,0,3],[0,3,3],[3,3,3]
];

// ========================================
// 位置分類
// ========================================
function isCornerPosition(x, y, z) {
  return (x===0||x===3)&&(y===0||y===3)&&(z===0||z===3);
}
function isEdgePosition(x, y, z) {
  let c=0; if(x===0||x===3)c++; if(y===0||y===3)c++; if(z===0||z===3)c++; return c===2;
}
function isFacePosition(x, y, z) {
  let c=0; if(x===0||x===3)c++; if(y===0||y===3)c++; if(z===0||z===3)c++; return c===1;
}

// ========================================
// 盤面操作
// ========================================
function copyBoard(b) { return b.map(l => l.map(r => r.slice())); }

function isLegalMove(b, x, y, z, color) {
  if (b[x][y][z] !== null) return false;
  const opp = color==='black'?'white':'black';
  for (const [dx,dy,dz] of directions) {
    let nx=x+dx, ny=y+dy, nz=z+dz, cnt=0;
    while (nx>=0&&nx<4&&ny>=0&&ny<4&&nz>=0&&nz<4&&b[nx][ny][nz]===opp) {
      nx+=dx; ny+=dy; nz+=dz; cnt++;
    }
    if (cnt>0&&nx>=0&&nx<4&&ny>=0&&ny<4&&nz>=0&&nz<4&&b[nx][ny][nz]===color) return true;
  }
  return false;
}

function simulateMove(b, x, y, z, color) {
  const opp = color==='black'?'white':'black';
  b[x][y][z] = color;
  for (const [dx,dy,dz] of directions) {
    const flip=[];
    let nx=x+dx, ny=y+dy, nz=z+dz;
    while (nx>=0&&nx<4&&ny>=0&&ny<4&&nz>=0&&nz<4&&b[nx][ny][nz]===opp) {
      flip.push([nx,ny,nz]); nx+=dx; ny+=dy; nz+=dz;
    }
    if (flip.length>0&&nx>=0&&nx<4&&ny>=0&&ny<4&&nz>=0&&nz<4&&b[nx][ny][nz]===color)
      for (const [fx,fy,fz] of flip) b[fx][fy][fz]=color;
  }
}

function generateLegalMovesOn(b, color) {
  const moves=[];
  for (let x=0;x<4;x++) for(let y=0;y<4;y++) for(let z=0;z<4;z++)
    if (b[x][y][z]===null && isLegalMove(b,x,y,z,color)) moves.push([x,y,z]);
  return moves;
}

// ========================================
// Zobristハッシュ
// ========================================
const ZOBRIST_TABLE = (() => {
  let s=[123456789,362436069,521288629,88675123];
  function next() {
    let t=s[3]; t^=t<<11; t^=t>>>8;
    s[3]=s[2]; s[2]=s[1]; s[1]=s[0]; t^=s[0]; t^=s[0]>>>19; s[0]=t; return t>>>0;
  }
  const tbl=[];
  for(let x=0;x<4;x++){tbl[x]=[];for(let y=0;y<4;y++){tbl[x][y]=[];for(let z=0;z<4;z++)tbl[x][y][z]=[next(),next()];}}
  return tbl;
})();

function computeHash(b) {
  let h=0;
  for(let x=0;x<4;x++) for(let y=0;y<4;y++) for(let z=0;z<4;z++) {
    if(b[x][y][z]==='black') h^=ZOBRIST_TABLE[x][y][z][0];
    if(b[x][y][z]==='white') h^=ZOBRIST_TABLE[x][y][z][1];
  }
  return h>>>0;
}

// ========================================
// 置換表
// ========================================
const TT = new Map();
const TT_MAX = 300000;

function ttGet(h) { return TT.get(h)??null; }
function ttSet(h, depth, score, flag, move) {
  if (TT.size>=TT_MAX) {
    const keys=TT.keys();
    for(let i=0;i<5000;i++){ const k=keys.next().value; if(k===undefined)break; TT.delete(k); }
  }
  const ex=TT.get(h);
  if (ex && ex.depth>=depth) return;
  TT.set(h,{depth,score,flag,move});
}

// ========================================
// 評価関数
// ========================================
const PW = (() => {
  const w=[];
  for(let x=0;x<4;x++){w[x]=[];for(let y=0;y<4;y++){w[x][y]=[];for(let z=0;z<4;z++){
    if(isCornerPosition(x,y,z))    w[x][y][z]=100;
    else if(isEdgePosition(x,y,z)) w[x][y][z]=10;
    else if(isFacePosition(x,y,z)) w[x][y][z]=3;
    else                            w[x][y][z]=1;
  }}}
  return w;
})();

function adjCorners(x,y,z) {
  return CORNERS_LIST.filter(([cx,cy,cz])=>Math.abs(cx-x)+Math.abs(cy-y)+Math.abs(cz-z)===1);
}
function cornerPriority(b,x,y,z,player) {
  const opp=player==='black'?'white':'black';
  let hasOpp=false,hasSelf=false;
  for(const [cx,cy,cz] of adjCorners(x,y,z)){
    if(b[cx][cy][cz]===opp)  hasOpp=true;
    if(b[cx][cy][cz]===player) hasSelf=true;
  }
  return hasOpp?'adj-opponent':hasSelf?'adj-self':'other';
}
function stableCount(b,color) {
  const st=new Set();
  for(const [cx,cy,cz] of CORNERS_LIST){
    if(b[cx][cy][cz]!==color) continue;
    const stack=[[cx,cy,cz]];
    while(stack.length>0){
      const [x,y,z]=stack.pop(); const k=`${x},${y},${z}`;
      if(st.has(k)||b[x][y][z]!==color) continue;
      st.add(k);
      for(const [dx,dy,dz] of [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]]){
        const nx=x+dx,ny=y+dy,nz=z+dz;
        if(nx>=0&&nx<4&&ny>=0&&ny<4&&nz>=0&&nz<4&&!st.has(`${nx},${ny},${nz}`)&&b[nx][ny][nz]===color)
          stack.push([nx,ny,nz]);
      }
    }
  }
  return st.size;
}
function opensCorner(b,x,y,z,player) {
  const opp=player==='black'?'white':'black';
  const nb=copyBoard(b); simulateMove(nb,x,y,z,player);
  let cnt=0;
  for(const [cx,cy,cz] of CORNERS_LIST) if(nb[cx][cy][cz]===null&&isLegalMove(nb,cx,cy,cz,opp)) cnt++;
  return cnt;
}
function evaluate(b,player) {
  const opp=player==='black'?'white':'black';
  let ms=0,os=0,mw=0,ow=0;
  for(let x=0;x<4;x++) for(let y=0;y<4;y++) for(let z=0;z<4;z++){
    const c=b[x][y][z],w=PW[x][y][z];
    if(c===player){ms++;mw+=w;} if(c===opp){os++;ow+=w;}
  }
  const total=ms+os;
  let score=(mw-ow)+(ms-os)*(total>40?1.5:0.3);
  score+=(generateLegalMovesOn(b,player).length-generateLegalMovesOn(b,opp).length)*5;
  score+=(stableCount(b,player)-stableCount(b,opp))*30;
  for(const [cx,cy,cz] of CORNERS_LIST){
    if(b[cx][cy][cz]===player) score+=200;
    if(b[cx][cy][cz]===opp)   score-=200;
  }
  for(let x=0;x<4;x++) for(let y=0;y<4;y++) for(let z=0;z<4;z++){
    if(!isEdgePosition(x,y,z)) continue;
    const c=b[x][y][z]; if(c===null) continue;
    for(const [cx,cy,cz] of adjCorners(x,y,z)){
      const corner=b[cx][cy][cz];
      if(c===player&&corner===opp)    score-=15;
      if(c===player&&corner===null)   score-=5;
      if(c===player&&corner===player) score+=8;
    }
  }
  for(let fi=0;fi<6;fi++){
    const ax=Math.floor(fi/2),fv=(fi%2===0)?0:3;
    let mf=0,of2=0;
    for(let i=1;i<=2;i++) for(let j=1;j<=2;j++){
      let px,py,pz;
      if(ax===0){px=fv;py=i;pz=j;}else if(ax===1){px=i;py=fv;pz=j;}else{px=i;py=j;pz=fv;}
      if(b[px][py][pz]===player)mf++;if(b[px][py][pz]===opp)of2++;
    }
    if(mf===3)score-=20;if(of2===3)score+=20;if(mf===4)score+=15;if(of2===4)score-=15;
  }
  return score;
}

// ========================================
// ムーブオーダリング
// ========================================
function moveScore(b,m,player) {
  const [x,y,z]=m;
  if(isCornerPosition(x,y,z)){
    const p=cornerPriority(b,x,y,z,player);
    return p==='adj-opponent'?10000:p==='adj-self'?9000:8000;
  }
  if(isEdgePosition(x,y,z)&&opensCorner(b,x,y,z,player)===0) return 500;
  if(isFacePosition(x,y,z)) return 100;
  return 50;
}
function sortMoves(b,moves,player) {
  return moves.slice().sort((a,b2)=>moveScore(b,b2,player)-moveScore(b,a,player));
}

// ========================================
// αβ探索（中断フラグ付き）
// ========================================
const AB_DEPTH = 6;
let shouldStop = false;

function alphaBeta(b, cur, root, depth, alpha, beta, hash) {
  if (shouldStop) return {score:0,move:null,aborted:true};
  const origAlpha=alpha;
  const opp=cur==='black'?'white':'black';

  const tte=ttGet(hash);
  if(tte&&tte.depth>=depth){
    if(tte.flag==='EXACT') return {score:tte.score,move:tte.move};
    if(tte.flag==='LOWER') alpha=Math.max(alpha,tte.score);
    if(tte.flag==='UPPER') beta=Math.min(beta,tte.score);
    if(alpha>=beta) return {score:tte.score,move:tte.move};
  }

  const myMoves=generateLegalMovesOn(b,cur);
  const opMoves=generateLegalMovesOn(b,opp);
  let full=true;
  outer:for(let x=0;x<4;x++) for(let y=0;y<4;y++) for(let z=0;z<4;z++) if(b[x][y][z]===null){full=false;break outer;}

  if(full||(myMoves.length===0&&opMoves.length===0)){
    let bc=0,wc=0;
    for(let x=0;x<4;x++) for(let y=0;y<4;y++) for(let z=0;z<4;z++){
      if(b[x][y][z]==='black')bc++;if(b[x][y][z]==='white')wc++;
    }
    const mf=cur==='black'?bc:wc,of2=cur==='black'?wc:bc;
    return {score:mf>of2?100000:mf<of2?-100000:0,move:null};
  }
  if(myMoves.length===0){
    const r=alphaBeta(b,opp,root,depth,-beta,-alpha,hash);
    return {score:-r.score,move:null,aborted:r.aborted};
  }
  if(depth===0){
    return {score:(cur===root?1:-1)*evaluate(b,root),move:null};
  }

  const sorted=sortMoves(b,myMoves,cur);
  let best=sorted[0],bestScore=-Infinity;

  for(const m of sorted){
    if(shouldStop) return {score:bestScore,move:best,aborted:true};
    const [mx,my,mz]=m;
    let nh=hash^ZOBRIST_TABLE[mx][my][mz][cur==='black'?0:1];
    const nb=copyBoard(b); simulateMove(nb,mx,my,mz,cur);
    for(let x=0;x<4;x++) for(let y=0;y<4;y++) for(let z=0;z<4;z++){
      const bef=b[x][y][z],aft=nb[x][y][z];
      if(bef!==aft&&!(x===mx&&y===my&&z===mz)){
        nh^=ZOBRIST_TABLE[x][y][z][bef==='black'?0:1];
        nh^=ZOBRIST_TABLE[x][y][z][aft==='black'?0:1];
      }
    }
    nh=nh>>>0;
    const r=alphaBeta(nb,opp,root,depth-1,-beta,-alpha,nh);
    if(r.aborted) return {score:bestScore,move:best,aborted:true};
    const s=-r.score;
    if(s>bestScore){bestScore=s;best=m;}
    alpha=Math.max(alpha,bestScore);
    if(alpha>=beta) break;
  }
  const flag=bestScore<=origAlpha?'UPPER':bestScore>=beta?'LOWER':'EXACT';
  ttSet(hash,depth,bestScore,flag,best);
  return {score:bestScore,move:best};
}

function selectMove(b, player, depth=AB_DEPTH) {
  const legal=generateLegalMovesOn(b,player);
  if(legal.length===0) return {move:null,endgame:false};
  let empty=0;
  for(let x=0;x<4;x++) for(let y=0;y<4;y++) for(let z=0;z<4;z++) if(b[x][y][z]===null) empty++;

  const isEndgame = empty<=12;
  const searchDepth = isEndgame ? 50 : depth;

  if(isEndgame){
    // ★ 読み切り開始をWorkerからメインスレッドに通知
    self.postMessage({type:'endgameStart', empty});
  }

  const result=alphaBeta(b,player,player,searchDepth,-Infinity,Infinity,computeHash(b));
  if(result.aborted) return {move:null,endgame:isEndgame,aborted:true};

  if(isEndgame && result.move!==null){
    // ★ 読み切り結果を通知
    const outcome = result.score>0?'勝ち':result.score<0?'負け':'引き分け';
    self.postMessage({type:'endgameResult', score:result.score, outcome});
  }

  return {move:result.move??legal[0], endgame:isEndgame};
}

// ========================================
// メッセージハンドラ
// ========================================
/*
  受信:
    { type:'think', board, player }
      → 通常思考。{ type:'result', move } を返す

    { type:'ponder', board, opponentMove, aiPlayer, ponderIndex }
      → Pondering。{ type:'ponderResult', ponderIndex, opponentMove, aiMove } を返す

    { type:'stop' }
      → 中断
*/
self.onmessage = function(e) {
  const msg=e.data;
  switch(msg.type){

    case 'think': {
      shouldStop=false;
      TT.clear();
      const {move}=selectMove(msg.board, msg.player);
      self.postMessage({type:'result', move});
      break;
    }

    case 'ponder': {
      shouldStop=false;
      const {board,opponentMove,aiPlayer,ponderIndex}=msg;
      const oppColor=aiPlayer==='black'?'white':'black';
      const pb=copyBoard(board);
      simulateMove(pb,opponentMove[0],opponentMove[1],opponentMove[2],oppColor);
      const {move:aiMove}=selectMove(pb,aiPlayer);
      if(!shouldStop){
        self.postMessage({type:'ponderResult',ponderIndex,opponentMove,aiMove});
      }
      break;
    }

    case 'stop': {
      shouldStop=true;
      break;
    }
  }
};
