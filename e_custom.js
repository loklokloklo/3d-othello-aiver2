// e_custom.js - カスタムAI(反復深化・思考時間可変版)
import * as THREE from './libs/three.module.js';
import { OrbitControls } from './libs/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from './libs/CSS2DRenderer.js';
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.10.0/firebase-app.js";
import { getDatabase, ref, push, set } from "https://www.gstatic.com/firebasejs/10.10.0/firebase-database.js";

window.init = init;

let scene, camera, renderer, labelRenderer, controls;
let boardGroup;
let currentTurn = null;
let gameStarted = false;
let board = [];
const stoneRadius = 0.3;
let lastPlacedStone = null;
let lastPlacedColor = null;

const stoneMap = new Map();
const moveHistory = [];
let firstPlayer = 'black';
let aiColor;
let waitingPassConfirm = false;
let isPassPopupVisible = false;

// AI応答時間計測
let aiResponseTimes = [];
let aiTurnStartTime = null;

// このAI固有: 思考時間(ms)。index.html のAI選択画面で入力された値。
// window.CUSTOM_AI_THINK_MS が未設定の場合は8秒をデフォルトにする。
const AI_THINK_MS = window.CUSTOM_AI_THINK_MS || 8000;

const firebaseConfig = {
  apiKey: "AIzaSyDXmNcJm-NMieg5ANasgDyKSmYVeNQD1MU",
  authDomain: "kihumohou.firebaseapp.com",
  databaseURL: "https://kihumohou-default-rtdb.firebaseio.com",
  projectId: "kihumohou",
  storageBucket: "kihumohou.firebasestorage.app",
  messagingSenderId: "780352767162",
  appId: "1:780352767162:web:69194592a43ac60c59ee83",
};

const app = initializeApp(firebaseConfig);
const database = getDatabase(app);

const spacing = 1.2;
const size = 4;
const placedStones = new Set();

const directions = [];
for (let dx=-1;dx<=1;dx++) for(let dy=-1;dy<=1;dy++) for(let dz=-1;dz<=1;dz++)
  if(dx!==0||dy!==0||dz!==0) directions.push([dx,dy,dz]);

// ========================================
// 思考用Worker(このAIはPondering非対応。1手ごとに時間制限つきで探索する)
// ========================================
let thinkWorker = null;

function initThinkWorker() {
  thinkWorker = new Worker('./custom_ai_worker.js');
  thinkWorker.onmessage = (e) => {
    const msg = e.data;
    if (msg.type === 'depthProgress') {
      console.log(`🔍 [カスタムAI] 深さ${msg.depth}手読了（経過${msg.elapsed}ms, ${msg.nodes}ノード）`);
      updateAILoadingText(`AI思考中…（${msg.depth}手先まで読了、${(msg.elapsed/1000).toFixed(1)}秒経過）`);
      return;
    }
    if (msg.type === 'result') {
      hideAILoadingIndicator();
      applyAIMove(msg.move);
    }
  };
  thinkWorker.onerror = (err) => {
    console.error('ThinkWorker error:', err);
    hideAILoadingIndicator();
  };
}

/**
 * AIターン処理(このAIはPondering非対応。常に通常思考のみ)
 */
function handleAITurn() {
  if (currentTurn !== aiColor) return;

  if (!hasAnyLegalMove(aiColor)) {
    const other = aiColor === 'black' ? 'white' : 'black';
    if (!hasAnyLegalMove(other)) { checkGameEnd(); return; }
    if (lastPlacedStone && lastPlacedColor)
      revertPreviousRedStone(lastPlacedColor==='black'?0x000000:0xffffff);
    moveHistory.push({player:aiColor,pass:true});
    showAIPassPopup('AIはパスしました');
    currentTurn = other;
    showAllLegalMoves();
    return;
  }

  showAILoadingIndicator(`AI思考中…（最大${(AI_THINK_MS/1000).toFixed(0)}秒）`);
  thinkWorker.postMessage({type:'think', board:board, player:aiColor, timeLimitMs: AI_THINK_MS});
}

/**
 * AIの手を盤面に反映する
 */
function applyAIMove(move) {
  if (aiTurnStartTime !== null) {
    aiResponseTimes.push(Date.now() - aiTurnStartTime);
    aiTurnStartTime = null;
  }
  if (!move) {
    currentTurn = aiColor==='black'?'white':'black';
    showAllLegalMoves();
    return;
  }
  const [x,y,z] = move;
  createStone(x,y,z,aiColor==='black'?0x000000:0xffffff,true);
  board[x][y][z] = aiColor;
  placedStones.add(`${x},${y},${z}`);
  lastPlacedStone = [x,y,z];
  lastPlacedColor = aiColor;
  moveHistory.push({player:aiColor,move:[x,y,z]});
  flipStones(x,y,z,aiColor);
  updateStoneCountDisplay();
  currentTurn = aiColor==='black'?'white':'black';
  showAllLegalMoves();

  if (!hasAnyLegalMove(currentTurn)) {
    const other = currentTurn==='black'?'white':'black';
    if (!hasAnyLegalMove(other)) { checkGameEnd(); return; }
    waitingPassConfirm = true; showPassPopup(); return;
  }
  checkGameEnd();
}

// ========================================
// 1手戻す機能
// ========================================
function buildInitialBoard() {
  const b=[];
  for(let x=0;x<size;x++){b[x]=[];for(let y=0;y<size;y++)b[x][y]=new Array(size).fill(null);}
  b[1][1][1]='black';b[2][2][1]='black';b[2][1][2]='black';b[1][2][2]='black';
  b[1][2][1]='white';b[2][2][2]='white';b[1][1][2]='white';b[2][1][1]='white';
  return b;
}
function removeAllStones() {
  const r=[];
  scene.traverse(o=>{if(o instanceof THREE.Mesh&&o.geometry.type==="SphereGeometry")r.push(o);});
  r.forEach(o=>scene.remove(o)); stoneMap.clear();
}
function redrawAllStones() {
  removeAllStones();
  for(let x=0;x<size;x++) for(let y=0;y<size;y++) for(let z=0;z<size;z++){
    const c=board[x][y][z]; if(c!==null) createStone(x,y,z,c==='black'?0x000000:0xffffff,false);
  }
}
function undoLastHumanMove() {
  if(!gameStarted||currentTurn===aiColor||isPassPopupVisible) return;
  undoCore();
}
function undoCore() {
  const human=aiColor==='black'?'white':'black';
  let steps=0; const tmp=[...moveHistory];
  if(tmp.length>0&&tmp[tmp.length-1].player===aiColor){steps++;tmp.pop();}
  if(tmp.length>0&&tmp[tmp.length-1].player===human){steps++;tmp.pop();}
  if(steps===0){console.log('⚠️ 戻せる手がありません');return;}
  moveHistory.splice(moveHistory.length-steps,steps);
  const rb=buildInitialBoard();
  for(const e of moveHistory){if(e.pass)continue;simulateMoveOnBoard(rb,e.move[0],e.move[1],e.move[2],e.player);}
  for(let x=0;x<size;x++) for(let y=0;y<size;y++) for(let z=0;z<size;z++) board[x][y][z]=rb[x][y][z];
  placedStones.clear();
  for(const e of moveHistory){if(e.pass)continue;placedStones.add(`${e.move[0]},${e.move[1]},${e.move[2]}`);}
  const lm=moveHistory.filter(e=>!e.pass).slice(-1)[0];
  lastPlacedStone=lm?lm.move:null; lastPlacedColor=lm?lm.player:null;
  currentTurn=human; waitingPassConfirm=false;
  redrawAllStones(); updateStoneCountDisplay(); showAllLegalMoves();
  console.log(`✅ 1手戻しました。棋譜残り: ${moveHistory.length}手`);
}
function simulateMoveOnBoard(b,x,y,z,color) {
  const opp=color==='black'?'white':'black'; b[x][y][z]=color;
  for(const [dx,dy,dz] of directions){
    const flip=[];let nx=x+dx,ny=y+dy,nz=z+dz;
    while(nx>=0&&nx<4&&ny>=0&&ny<4&&nz>=0&&nz<4&&b[nx][ny][nz]===opp){flip.push([nx,ny,nz]);nx+=dx;ny+=dy;nz+=dz;}
    if(flip.length>0&&nx>=0&&nx<4&&ny>=0&&ny<4&&nz>=0&&nz<4&&b[nx][ny][nz]===color)
      for(const [fx,fy,fz] of flip) b[fx][fy][fz]=color;
  }
}

// ========================================
// 初期化・描画
// ========================================
function init() {
  scene=new THREE.Scene(); scene.background=new THREE.Color('#ccffd0');
  camera=new THREE.PerspectiveCamera(45,window.innerWidth/window.innerHeight,0.1,1000);
  camera.position.set(10,10,10); camera.lookAt(0,0,0);
  renderer=new THREE.WebGLRenderer({antialias:true});
  renderer.setSize(window.innerWidth,window.innerHeight);
  document.body.appendChild(renderer.domElement);
  labelRenderer=new CSS2DRenderer();
  labelRenderer.setSize(window.innerWidth,window.innerHeight);
  labelRenderer.domElement.style.cssText='position:absolute;top:0;pointer-events:none;';
  document.body.appendChild(labelRenderer.domElement);
  controls=new OrbitControls(camera,renderer.domElement);
  controls.target.set(3,3,3); controls.update();
  scene.add(new THREE.AmbientLight(0xffffff,5));
  const dl=new THREE.DirectionalLight(0xffffff,0.8); dl.position.set(10,10,10); scene.add(dl);
  scene.add(new THREE.AxesHelper(10));

  for(let x=0;x<size;x++){board[x]=[];for(let y=0;y<size;y++){board[x][y]=[];for(let z=0;z<size;z++)board[x][y][z]=null;}}

  boardGroup=new THREE.Group();
  const geo=new THREE.BoxGeometry(1,1,1);
  const tMat=new THREE.MeshBasicMaterial({color:0x000000,transparent:true,opacity:0});
  const wMat=new THREE.MeshBasicMaterial({color:0xaaaaaa,wireframe:true});
  for(let x=0;x<size;x++) for(let y=0;y<size;y++) for(let z=0;z<size;z++){
    const g=new THREE.Group();
    g.add(new THREE.Mesh(geo,tMat)); g.add(new THREE.Mesh(geo,wMat));
    g.position.set((x+1)*spacing,(y+1)*spacing,(z+1)*spacing); boardGroup.add(g);
  }
  scene.add(boardGroup);

  createStone(1,1,1,0x000000);board[1][1][1]='black';
  createStone(2,2,1,0x000000);board[2][2][1]='black';
  createStone(2,1,2,0x000000);board[2][1][2]='black';
  createStone(1,2,2,0x000000);board[1][2][2]='black';
  createStone(1,2,1,0xffffff);board[1][2][1]='white';
  createStone(2,2,2,0xffffff);board[2][2][2]='white';
  createStone(1,1,2,0xffffff);board[1][1][2]='white';
  createStone(2,1,1,0xffffff);board[2][1][1]='white';

  const al=5;
  [[al,0,0,0xff0000],[0,al,0,0x00ff00],[0,0,al,0x0000ff]].forEach(([ax,ay,az,c])=>{
    scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0,0,0),new THREE.Vector3(ax,ay,az)]),new THREE.LineBasicMaterial({color:c})));
  });
  createAxisLabel('X',4.5*spacing,0,0);
  createAxisLabel('Y',0,4.5*spacing,0);
  createAxisLabel('Z',0,0,4.5*spacing);

  initThinkWorker();
  updateStoneCountDisplay();
  animate();
}

function createAxisLabel(text,x,y,z) {
  const canvas=document.createElement('canvas'); canvas.width=canvas.height=128;
  const ctx=canvas.getContext('2d'); ctx.clearRect(0,0,128,128);
  ctx.fillStyle='black'; ctx.font='bold 40px sans-serif'; ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.fillText(text,64,64);
  const tex=new THREE.CanvasTexture(canvas); tex.needsUpdate=true;
  const sp=new THREE.Sprite(new THREE.SpriteMaterial({map:tex,transparent:true,depthTest:false}));
  sp.position.set(x,y,z); sp.scale.set(1.2,1.2,1.2); scene.add(sp);
}

function animate() {
  requestAnimationFrame(animate); controls.update();
  renderer.render(scene,camera); labelRenderer.render(scene,camera);
}

// ========================================
// UI・イベント
// ========================================
document.addEventListener('DOMContentLoaded',()=>{
  const turnUI=document.getElementById('turn-selection');
  const bb=document.getElementById('black-button');
  const wb=document.getElementById('white-button');
  if(bb&&wb&&turnUI){
    bb.addEventListener('click',()=>{
      aiColor='white';firstPlayer='black';currentTurn='black';
      turnUI.style.display='none';gameStarted=true;showAllLegalMoves();
      setTimeout(setupPointerListener,100);
      if(currentTurn===aiColor) handleAITurn();
    });
    wb.addEventListener('click',()=>{
      aiColor='black';firstPlayer='white';currentTurn='black';
      turnUI.style.display='none';gameStarted=true;showAllLegalMoves();
      setTimeout(setupPointerListener,100);
      if(currentTurn===aiColor) handleAITurn();
    });
  }
  const undoBtn=document.getElementById('undo-button');
  if(undoBtn){
    undoBtn.addEventListener('click',()=>{
      if(!gameStarted||currentTurn===aiColor) return;
      const human=aiColor==='black'?'white':'black';
      if(!moveHistory.some(e=>e.player===human&&!e.pass)) return;
      undoLastHumanMove();
    });
  }
});

function createStone(x,y,z,color,isLast=false) {
  let c=color; if(isLast) c=(color===0x000000)?0x4B0000:0xAA6666;
  const s=new THREE.Mesh(new THREE.SphereGeometry(stoneRadius,32,32),new THREE.MeshStandardMaterial({color:c}));
  s.position.set((x+1)*spacing,(y+1)*spacing,(z+1)*spacing);
  scene.add(s); stoneMap.set(`${x},${y},${z}`,s);
}
function revertPreviousRedStone(color) {
  if(!lastPlacedStone) return;
  const m=stoneMap.get(`${lastPlacedStone[0]},${lastPlacedStone[1]},${lastPlacedStone[2]}`);
  if(m) m.material.color.set(color);
}
function setupPointerListener() { window.addEventListener('pointerdown',handlePointerDownOnce); }

function handlePointerDownOnce(event) {
  if(!gameStarted||!firstPlayer||currentTurn===aiColor) return;
  const mouse=new THREE.Vector2((event.clientX/window.innerWidth)*2-1,-(event.clientY/window.innerHeight)*2+1);
  const ray=new THREE.Raycaster(); ray.setFromCamera(mouse,camera);
  const hits=ray.intersectObjects(boardGroup.children,true); if(!hits.length) return;
  const pt=hits[0].object.parent.position;
  const x=Math.round(pt.x/spacing)-1,y=Math.round(pt.y/spacing)-1,z=Math.round(pt.z/spacing)-1;
  const key=`${x},${y},${z}`;
  if(placedStones.has(key)||!isLegalMove(board,x,y,z,currentTurn)) return;
  if(lastPlacedStone) revertPreviousRedStone(lastPlacedColor==='black'?0x000000:0xffffff);
  createStone(x,y,z,currentTurn==='black'?0x000000:0xffffff,false);
  board[x][y][z]=currentTurn; placedStones.add(key);
  moveHistory.push({player:currentTurn,move:[x,y,z]});
  lastPlacedStone=[x,y,z]; lastPlacedColor=currentTurn;
  flipStones(x,y,z,currentTurn);
  currentTurn=currentTurn==='black'?'white':'black';
  updateStoneCountDisplay(); showAllLegalMoves();
  if(currentTurn!==aiColor){
    if(!hasAnyLegalMove(currentTurn)){
      if(!hasAnyLegalMove(currentTurn==='black'?'white':'black')) checkGameEnd();
      else showPassPopup();
      return;
    }
  }
  if(currentTurn===aiColor) {
    aiTurnStartTime = Date.now();
    handleAITurn();
  }
}

// ========================================
// 盤面ユーティリティ
// ========================================
function isLegalMove(b,x,y,z,color) {
  if(b[x][y][z]!==null) return false;
  const opp=color==='black'?'white':'black';
  for(const [dx,dy,dz] of directions){
    let nx=x+dx,ny=y+dy,nz=z+dz,cnt=0;
    while(nx>=0&&nx<4&&ny>=0&&ny<4&&nz>=0&&nz<4&&b[nx][ny][nz]===opp){nx+=dx;ny+=dy;nz+=dz;cnt++;}
    if(cnt>0&&nx>=0&&nx<4&&ny>=0&&ny<4&&nz>=0&&nz<4&&b[nx][ny][nz]===color) return true;
  }
  return false;
}
function copyBoard(b) { return b.map(l=>l.map(r=>r.slice())); }
function generateLegalMovesOn(b,color) {
  const m=[];
  for(let x=0;x<4;x++) for(let y=0;y<4;y++) for(let z=0;z<4;z++)
    if(b[x][y][z]===null&&isLegalMove(b,x,y,z,color)) m.push([x,y,z]);
  return m;
}
function isCornerPosition(x,y,z){return(x===0||x===3)&&(y===0||y===3)&&(z===0||z===3);}
function isEdgePosition(x,y,z){let c=0;if(x===0||x===3)c++;if(y===0||y===3)c++;if(z===0||z===3)c++;return c===2;}
function isFacePosition(x,y,z){let c=0;if(x===0||x===3)c++;if(y===0||y===3)c++;if(z===0||z===3)c++;return c===1;}
function hasAnyLegalMove(player){
  for(let x=0;x<size;x++) for(let y=0;y<size;y++) for(let z=0;z<size;z++)
    if(isLegalMove(board,x,y,z,player)) return true;
  return false;
}
function flipStones(x,y,z,color){
  const opp=color==='black'?'white':'black'; let flipped=false;
  for(const [dx,dy,dz] of directions){
    const flip=[]; let nx=x+dx,ny=y+dy,nz=z+dz;
    while(nx>=0&&nx<4&&ny>=0&&ny<4&&nz>=0&&nz<4&&board[nx][ny][nz]===opp){flip.push([nx,ny,nz]);nx+=dx;ny+=dy;nz+=dz;}
    if(flip.length>0&&nx>=0&&nx<4&&ny>=0&&ny<4&&nz>=0&&nz<4&&board[nx][ny][nz]===color){
      for(const [fx,fy,fz] of flip){
        board[fx][fy][fz]=color; removeStoneAt(fx,fy,fz);
        createStone(fx,fy,fz,color==='black'?0x000000:0xffffff); flipped=true;
      }
    }
  }
  if(flipped) updateStoneCountDisplay();
}
function removeStoneAt(x,y,z){
  const t=new THREE.Vector3((x+1)*spacing,(y+1)*spacing,(z+1)*spacing);
  const o=scene.children.find(o=>o instanceof THREE.Mesh&&o.geometry.type==="SphereGeometry"&&o.position.distanceTo(t)<0.01);
  if(o) scene.remove(o);
}
function countStones(){
  let b=0,w=0;
  for(let x=0;x<size;x++) for(let y=0;y<size;y++) for(let z=0;z<size;z++){
    if(board[x][y][z]==='black')b++;if(board[x][y][z]==='white')w++;
  }
  return{black:b,white:w};
}

// ========================================
// UI表示
// ========================================
function clearLegalMoveMarkers(){
  const r=[]; scene.traverse(o=>{if(o.userData?.isLegalMoveMarker)r.push(o);}); r.forEach(o=>scene.remove(o));
}
function showAllLegalMoves(){
  clearLegalMoveMarkers(); if(currentTurn===aiColor) return;
  for(let x=0;x<4;x++) for(let y=0;y<4;y++) for(let z=0;z<4;z++){
    if(!isLegalMove(board,x,y,z,currentTurn)) continue;
    const s=new THREE.Mesh(new THREE.SphereGeometry(stoneRadius*0.6,16,16),new THREE.MeshBasicMaterial({color:0xffff00}));
    s.userData.isLegalMoveMarker=true; s.position.set((x+1)*spacing,(y+1)*spacing,(z+1)*spacing); scene.add(s);
  }
}
function updateStoneCountDisplay(){
  const c=countStones(); const d=document.getElementById('stone-count-display');
  if(d) d.textContent=`黒: ${c.black} ／ 白: ${c.white}`;
}
function showGameResultUI(result){
  const div=document.createElement('div');
  div.style.cssText='position:absolute;top:30%;left:50%;transform:translate(-50%,-50%);background:white;padding:20px;border-radius:10px;text-align:center;box-shadow:0 0 10px rgba(0,0,0,0.3);z-index:100;';
  if(result.endReasonMessage){const p=document.createElement('p');p.textContent=result.endReasonMessage;p.style.marginBottom='10px';div.appendChild(p);}
  const t=document.createElement('p'); t.textContent=`勝者: ${result.result}（黒: ${result.score.black} - 白: ${result.score.white}）`; div.appendChild(t);
  const btn=document.createElement('button'); btn.textContent='棋譜を送信'; btn.style.margin='10px';
  btn.addEventListener('click',()=>{
    set(push(ref(database,'kifu')),result).then(()=>{alert('棋譜を送信しました！');div.remove();showNewGameButton();}).catch(e=>{console.error(e);alert('送信失敗');});
  });
  div.appendChild(btn); document.body.appendChild(div);
}
function showNewGameButton(){
  const div=document.createElement('div');
  div.style.cssText='position:absolute;top:30%;left:50%;transform:translate(-50%,-50%);background:white;padding:20px;border-radius:10px;text-align:center;box-shadow:0 0 10px rgba(0,0,0,0.3);z-index:100;';
  const btn=document.createElement('button'); btn.textContent='新しいゲーム'; btn.addEventListener('click',()=>location.reload()); div.appendChild(btn); document.body.appendChild(div);
}
function checkGameEnd(){
  if(!gameStarted) return;
  const total=size*size*size; const full=placedStones.size>=total-8;
  if(full||(!hasAnyLegalMove('black')&&!hasAnyLegalMove('white'))){
    const result=countStones();
    const winner=result.black>result.white?'black':result.white>result.black?'white':'draw';
    const moves=moveHistory.map((e,i)=>e.pass?{turn:i+1,player:e.player,pass:true}:{turn:i+1,player:e.player,x:e.move[0]+1,y:e.move[1]+1,z:e.move[2]+1});
    const msg=full?'全てのマスが埋まったためゲーム終了です。\n':`${total-8-placedStones.size}マス空いていますが、双方置けないためゲーム終了です。\n`;
    const data={first:firstPlayer,result:winner,score:result,moves,endReasonMessage:msg,aiType:'custom',thinkMs:AI_THINK_MS};
    if (aiResponseTimes.length > 0) {
      const avg = Math.round(aiResponseTimes.reduce((a,b)=>a+b,0)/aiResponseTimes.length);
      console.log(`⏱️ AI平均応答時間: ${(avg/1000).toFixed(2)}秒 (${aiResponseTimes.length}ターン)`);
    }
    console.log('🎯 ゲーム終了:',data); gameStarted=false; showGameResultUI(data);
  }
}
function showPassPopup(){
  const p=document.getElementById('pass-popup'),t=document.getElementById('turn-selection');
  if(!gameStarted||!firstPlayer||t&&t.style.display!=='none') return;
  isPassPopupVisible=true; p.style.display='flex';
  const b=document.getElementById('undo-button'); if(b) b.disabled=true;
}
function hidePassPopup(){
  document.getElementById('pass-popup').style.display='none'; isPassPopupVisible=false;
  const b=document.getElementById('undo-button'); if(b) b.disabled=false;
}
document.getElementById('pass-ok-button').addEventListener('click',()=>{
  hidePassPopup(); moveHistory.push({player:currentTurn,pass:true});
  if(lastPlacedStone&&lastPlacedColor) revertPreviousRedStone(lastPlacedColor==='black'?0x000000:0xffffff);
  currentTurn=currentTurn==='black'?'white':'black';
  if(waitingPassConfirm&&currentTurn===aiColor){waitingPassConfirm=false;handleAITurn();}
  if(!hasAnyLegalMove(currentTurn)) checkGameEnd();
});
document.getElementById('pass-undo-button').addEventListener('click',()=>{ hidePassPopup(); undoCore(); });

function showAIPassPopup(msg){
  const ex=document.getElementById('ai-pass-popup'); if(ex) ex.remove();
  const p=document.createElement('div'); p.id='ai-pass-popup'; p.textContent=msg;
  p.style.cssText='position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:rgba(255,80,80,0.9);color:white;padding:20px 40px;border-radius:12px;font-size:20px;font-weight:bold;z-index:9999;opacity:0;transition:opacity 0.3s ease;';
  document.body.appendChild(p); requestAnimationFrame(()=>{p.style.opacity='1';});
  setTimeout(()=>{p.style.opacity='0';setTimeout(()=>p.remove(),300);},1500);
}
function showAILoadingIndicator(text){
  const existing=document.getElementById('ai-loading-indicator');
  if(existing){ updateAILoadingText(text); return; }
  const d=document.createElement('div'); d.id='ai-loading-indicator';
  d.innerHTML=`<div class="spinner"></div><p id="ai-loading-text">${text||'AI思考中...'}</p>`;
  d.style.cssText='position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:rgba(255,255,255,0.95);padding:30px 50px;border-radius:15px;box-shadow:0 4px 20px rgba(0,0,0,0.3);z-index:10000;text-align:center;font-size:18px;font-weight:bold;color:#333;';
  document.body.appendChild(d);
  if(!document.getElementById('spinner-style')){
    const s=document.createElement('style'); s.id='spinner-style';
    s.textContent='.spinner{width:50px;height:50px;border:5px solid #f3f3f3;border-top:5px solid #3498db;border-radius:50%;animation:spin 1s linear infinite;margin:0 auto 15px auto;}@keyframes spin{0%{transform:rotate(0deg);}100%{transform:rotate(360deg);}}';
    document.head.appendChild(s);
  }
}
function updateAILoadingText(text){
  const p=document.getElementById('ai-loading-text');
  if(p&&text) p.textContent=text;
}
function hideAILoadingIndicator(){
  const d=document.getElementById('ai-loading-indicator'); if(d) d.remove();
}
