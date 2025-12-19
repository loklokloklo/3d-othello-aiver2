// main.jsだお
import * as THREE from './libs/three.module.js';
import { OrbitControls } from './libs/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from './libs/CSS2DRenderer.js';
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.10.0/firebase-app.js";
import { getDatabase, ref, push, set } from "https://www.gstatic.com/firebasejs/10.10.0/firebase-database.js";

window.init = init;



let scene, camera, renderer, labelRenderer, controls;
let boardGroup;
let currentTurn = null; // 現在の手番（'black' または 'white'）
// グローバル変数に追加
let gameStarted = false;
// グローバル領域に追加（scene, camera, などと同じ場所）
let board = [];
const stoneRadius = 0.3;
let lastPlacedStone = null;
let lastPlacedColor = null;  // 最後に置かれた石の色（パスがあるため交互ではない可能性あり）

const stoneMap = new Map(); // キー = "x,y,z", 値 = stone Mesh
const moveHistory = []; // 各手の記録 ["2,3,1", "1,1,1", ...]
let firstPlayer = 'black';
let aiColor;
let aicannot = false;
let waitingPassConfirm = false;



const firebaseConfig = {
  apiKey: "AIzaSyDpXdLFl05RGNS7sh0FEbFAtcM8aWgMVvg",
  authDomain: "d-othello.firebaseapp.com",
  projectId: "d-othello",
  storageBucket: "d-othello.firebasestorage.app",
  messagingSenderId: "895908988417",
  appId: "1:895908988417:web:6726542c927ad8d9c36200",
  databaseURL: "https://d-othello-default-rtdb.firebaseio.com/"
};

const app = initializeApp(firebaseConfig);
const database = getDatabase(app);

const spacing = 1.2;
const size = 4;

function init() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color('#ccffd0'); // 薄い水色の背景

  camera = new THREE.PerspectiveCamera(
    45,
    window.innerWidth / window.innerHeight,
    0.1,
    1000
  );
  camera.position.set(10, 10, 10);
  camera.lookAt(0, 0, 0);

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setClearColor('#ccffd0'); // 背景を薄い水色に設定（リロード時含む）
  document.body.appendChild(renderer.domElement);

  labelRenderer = new CSS2DRenderer();
  labelRenderer.setSize(window.innerWidth, window.innerHeight);
  labelRenderer.domElement.style.position = 'absolute';
  labelRenderer.domElement.style.top = '0';
  document.body.appendChild(labelRenderer.domElement);

  controls = new OrbitControls(camera, labelRenderer.domElement);
  controls.enablePan = false;
  controls.enableZoom = false;
  controls.target.set(3, 3, 3);

  // ライト
  const ambientLight = new THREE.AmbientLight(0xffffff, 5);
  scene.add(ambientLight);

  const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
  directionalLight.position.set(10, 10, 10);
  scene.add(directionalLight);

  const axesHelper = new THREE.AxesHelper(10); // 長さ10

scene.add(axesHelper);


for (let x = 0; x < size; x++) {
  board[x] = [];
  for (let y = 0; y < size; y++) {
    board[x][y] = [];
    for (let z = 0; z < size; z++) {
      board[x][y][z] = null; // 'black' or 'white' を後で格納する
    }
  }
}



  // ボード作成
boardGroup = new THREE.Group();
const geometry = new THREE.BoxGeometry(1, 1, 1);

// 透明なマテリアル（石を格納する空間）
const transparentMaterial = new THREE.MeshBasicMaterial({
  color: 0x000000,
  transparent: true,
  opacity: 0 // 完全に透明
});

// ワイヤーフレーム（薄い灰色の枠線）
const wireframeMaterial = new THREE.MeshBasicMaterial({
  color: 0xaaaaaa,
  wireframe: true
});


for (let x = 0; x < size; x++) {
  for (let y = 0; y < size; y++) {
    for (let z = 0; z < size; z++) {
      const cube = new THREE.Mesh(geometry, transparentMaterial);
      const wireframe = new THREE.Mesh(geometry, wireframeMaterial);

      // 同じ位置に重ねて配置
      const boxGroup = new THREE.Group();
      boxGroup.add(cube);
      boxGroup.add(wireframe);

      // 位置調整（原点の正の方向に配置）
      boxGroup.position.set(
        (x + 1.0) * spacing,
        (y + 1.0) * spacing,
        (z + 1.0) * spacing
      );

      boardGroup.add(boxGroup);
    }
  }
}

scene.add(boardGroup);

// 初期配置（黒＝0x000000、白＝0xffffff）
createStone(1, 1, 1, 0x000000);
board[1][1][1] = 'black';
createStone(2, 2, 1, 0x000000);
board[2][2][1] = 'black';
createStone(2, 1, 2, 0x000000);
board[2][1][2] = 'black';
createStone(1, 2, 2, 0x000000);
board[1][2][2] = 'black';

createStone(1, 2, 1, 0xffffff);
board[1][2][1] = 'white';
createStone(2, 2, 2, 0xffffff);
board[2][2][2] = 'white';
createStone(1, 1, 2, 0xffffff);
board[1][1][2] = 'white';
createStone(2, 1, 1, 0xffffff);
board[2][1][1] = 'white';


// 軸の長さ
const axisLength = 5;

// X軸（赤）
const xAxisMaterial = new THREE.LineBasicMaterial({ color: 0xff0000 });
const xAxisGeometry = new THREE.BufferGeometry().setFromPoints([
  new THREE.Vector3(0, 0, 0),
  new THREE.Vector3(axisLength, 0, 0)
]);
const xAxis = new THREE.Line(xAxisGeometry, xAxisMaterial);
scene.add(xAxis);

// Y軸（緑）
const yAxisMaterial = new THREE.LineBasicMaterial({ color: 0x00ff00 });
const yAxisGeometry = new THREE.BufferGeometry().setFromPoints([
  new THREE.Vector3(0, 0, 0),
  new THREE.Vector3(0, axisLength, 0)
]);
const yAxis = new THREE.Line(yAxisGeometry, yAxisMaterial);
scene.add(yAxis);

// Z軸（青）
const zAxisMaterial = new THREE.LineBasicMaterial({ color: 0x0000ff });
const zAxisGeometry = new THREE.BufferGeometry().setFromPoints([
  new THREE.Vector3(0, 0, 0),
  new THREE.Vector3(0, 0, axisLength)
]);
const zAxis = new THREE.Line(zAxisGeometry, zAxisMaterial);
scene.add(zAxis);



  // 軸ラベル追加
  createAxisLabel('X', (4 + 0.5) * spacing, 0, 0);
createAxisLabel('Y', 0, (4 + 0.5) * spacing, 0);
createAxisLabel('Z', 0, 0, (4 + 0.5) * spacing);

updateStoneCountDisplay(); // ← 初期配置反映
  animate();
}

function createAxisLabel(text, x, y, z) {
  const div = document.createElement('div');
  div.className = 'label';
  div.textContent = text;
  const label = new CSS2DObject(div);
  label.position.set(x, y, z);
  scene.add(label);
}

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
  labelRenderer.render(scene, camera);
}

document.addEventListener('DOMContentLoaded', () => {
  const turnUI = document.getElementById('turn-selection');
  const blackButton = document.getElementById('black-button');
  const whiteButton = document.getElementById('white-button');

  if (blackButton && whiteButton && turnUI) {
    blackButton.addEventListener('click', () => {
      aiColor = 'white';
      firstPlayer = 'black';
      currentTurn = 'black';
      turnUI.style.display = 'none';
      gameStarted = true;
      showAllLegalMoves();

      setTimeout(() => {
       setupPointerListener();
      }, 100);

      if (currentTurn === aiColor) {
        handleAITurn();
      }
    });

    whiteButton.addEventListener('click', () => {
      aiColor = 'black';
      firstPlayer = 'white';
      currentTurn = 'black';
      turnUI.style.display = 'none';
      gameStarted = true;
      showAllLegalMoves();

       setTimeout(() => {
        setupPointerListener();
      }, 100);
      console.log("✅ 白選択: AIカラー=", aiColor, " 現在の手番=", currentTurn);

      if (currentTurn === aiColor) {
        console.log("✅ AI先手なので handleAITurn 呼び出し");
        handleAITurn();
      }
    });
  } else {
    console.error("❌ ボタンやUIが見つかりません");
  }
});


function createStone(x, y, z, color, isLastPlaced = false) {
  let finalColor = color;

  if (isLastPlaced) {
    // 黒ならダークレッド寄り、白ならピンク寄り
    finalColor = (color === 0x000000) ? 0x4B0000 : 0xAA6666;
  }

  const geometry = new THREE.SphereGeometry(stoneRadius, 32, 32);
  const material = new THREE.MeshStandardMaterial({ color: finalColor });
  const stone = new THREE.Mesh(geometry, material);
  stone.position.set(
    (x + 1.0) * spacing,
    (y + 1.0) * spacing,
    (z + 1.0) * spacing
  );
  scene.add(stone);

  const key = `${x},${y},${z}`;
  stoneMap.set(key, stone); // 管理用マップに記録
}

function revertPreviousRedStone(color) {
  if (!lastPlacedStone) return;

  const [x, y, z] = lastPlacedStone;
  const key = `${x},${y},${z}`;
  const mesh = stoneMap.get(key);
  if (mesh) {
    mesh.material.color.set(color);
  }
}

function setupPointerListener() {
  window.addEventListener('pointerdown', handlePointerDownOnce);
}

function handlePointerDownOnce(event) {
  if (!gameStarted || !firstPlayer) return;

  if (currentTurn === aiColor) return;


  const mouse = new THREE.Vector2();
  mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
  mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(mouse, camera);

  const intersects = raycaster.intersectObjects(boardGroup.children, true);
  if (intersects.length > 0) {
    const intersect = intersects[0];
    const point = intersect.object.parent.position;

    const x = Math.round(point.x / spacing) - 1;
    const y = Math.round(point.y / spacing) - 1;
    const z = Math.round(point.z / spacing) - 1;

    const key = `${x},${y},${z}`;
    if (placedStones.has(key)) return;
    if (!isLegalMove(board, x, y, z, currentTurn)) return;

    // 石を置く前に、前の赤い石を元の色に戻す
    if (lastPlacedStone) {
      const [lx, ly, lz] = lastPlacedStone;
      const prevColor = lastPlacedColor === 'black' ? 0x000000 : 0xffffff;
      revertPreviousRedStone(prevColor);
    }

    const color = currentTurn === 'black' ? 0x000000 : 0xffffff;
    createStone(x, y, z, color, false);

    board[x][y][z] = currentTurn;
    placedStones.add(key);

    moveHistory.push({ player: currentTurn, move: [x, y, z] });

    lastPlacedStone = [x, y, z];
    lastPlacedColor = currentTurn; // ←これを必ず追加！

    flipStones(x, y, z, currentTurn);
    currentTurn = currentTurn === 'black' ? 'white' : 'black';

    updateStoneCountDisplay();
    showAllLegalMoves();
    
    // ✅ プレイヤーのパスチェック（修正版）
  if (currentTurn !== aiColor) {
    console.log("🔍 プレイヤーターン後のチェック: currentTurn=", currentTurn);
    
    if (!hasAnyLegalMove(currentTurn)) {
      console.log("🟡 プレイヤーに合法手なし");
      const otherPlayer = currentTurn === 'black' ? 'white' : 'black';
      
      if (!hasAnyLegalMove(otherPlayer)) {
        console.log("🏁 両者合法手なし → ゲーム終了");
        checkGameEnd();
      } else {
        console.log("✅ showPassPopup呼び出し");
        showPassPopup(); // ← ここでプレイヤーのパス表示
      }
      return; // ← 重要: ここで処理を終了
    }
  }

    if (currentTurn === aiColor) {
      handleAITurn();
    }
  }
}



function clearLegalMoveMarkers() {
  const toRemove = [];
  scene.traverse(obj => {
    if (obj.userData && obj.userData.isLegalMoveMarker) {
      toRemove.push(obj);
    }
  });
  toRemove.forEach(obj => scene.remove(obj));
}


function showAllLegalMoves() {
  clearLegalMoveMarkers();
  if (currentTurn === aiColor) return;

  for (let x = 0; x < 4; x++) {
    for (let y = 0; y < 4; y++) {
      for (let z = 0; z < 4; z++) {
        const legal = isLegalMove(board, x, y, z, currentTurn);
        if (legal) {
          showLegalMoveIndicator(x, y, z);
        } 
        }
      }
    }
  }
const placedStones = new Set();

const directions = [];
for (let dx = -1; dx <= 1; dx++) {
  for (let dy = -1; dy <= 1; dy++) {
    for (let dz = -1; dz <= 1; dz++) {
      if (dx !== 0 || dy !== 0 || dz !== 0) {
        directions.push([dx, dy, dz]);
      }
    }
  }
}

function isLegalMove(board, x, y, z, currentTurn) {
  if (board[x][y][z] !== null) {
    return false;
  }

  const opponent = currentTurn === 'black' ? 'white' : 'black';
  let legal = false;

  for (const [dx, dy, dz] of directions) {
    let nx = x + dx;
    let ny = y + dy;
    let nz = z + dz;
    let count = 0;

    while (
      nx >= 0 && nx < 4 &&
      ny >= 0 && ny < 4 &&
      nz >= 0 && nz < 4 &&
      board[nx][ny][nz] === opponent
    ) {
      nx += dx;
      ny += dy;
      nz += dz;
      count++;
    }

    if (
      count > 0 &&
      nx >= 0 && nx < 4 &&
      ny >= 0 && ny < 4 &&
      nz >= 0 && nz < 4 &&
      board[nx][ny][nz] === currentTurn
    ) {
      legal = true;
      break;
    }
  }


  return legal;
}

function showLegalMoveIndicator(x, y, z) {
  const geometry = new THREE.SphereGeometry(stoneRadius * 0.6, 16, 16);
  const material = new THREE.MeshBasicMaterial({ color: 0xffff00 });
  const sphere = new THREE.Mesh(geometry, material);

  sphere.userData.isLegalMoveMarker = true;

  sphere.position.set(
    (x + 1.0) * spacing,
    (y + 1.0) * spacing,
    (z + 1.0) * spacing
  );

  sphere.name = 'legalMoveIndicator';
  scene.add(sphere);
}

function flipStones(x, y, z, turnColor) {
  const opponent = turnColor === 'black' ? 'white' : 'black';
  let flipped = false;

  for (const [dx, dy, dz] of directions) {
    const stonesToFlip = [];

    let nx = x + dx;
    let ny = y + dy;
    let nz = z + dz;

    while (
      nx >= 0 && nx < 4 &&
      ny >= 0 && ny < 4 &&
      nz >= 0 && nz < 4 &&
      board[nx][ny][nz] === opponent
    ) {
      stonesToFlip.push([nx, ny, nz]);
      nx += dx;
      ny += dy;
      nz += dz;
    }

    if (
      stonesToFlip.length > 0 &&
      nx >= 0 && nx < 4 &&
      ny >= 0 && ny < 4 &&
      nz >= 0 && nz < 4 &&
      board[nx][ny][nz] === turnColor
    ) {
      for (const [fx, fy, fz] of stonesToFlip) {
        board[fx][fy][fz] = turnColor;
        removeStoneAt(fx, fy, fz);
        const color = turnColor === 'black' ? 0x000000 : 0xffffff;
        createStone(fx, fy, fz, color);
        flipped = true;
      }
    }
  }

  if (flipped) {
    updateStoneCountDisplay();
  }
}


function removeStoneAt(x, y, z) {
  const targetPosition = new THREE.Vector3(
    (x + 1.0) * spacing,
    (y + 1.0) * spacing,
    (z + 1.0) * spacing
  );

  const toRemove = scene.children.find(obj =>
    obj instanceof THREE.Mesh &&
    obj.geometry.type === "SphereGeometry" &&
    obj.position.distanceTo(targetPosition) < 0.01 // 少し誤差許容
  );

  if (toRemove) {
    scene.remove(toRemove);
  }
}

function countStones() {
  let black = 0;
  let white = 0;
  for (let x = 0; x < size; x++) {
    for (let y = 0; y < size; y++) {
      for (let z = 0; z < size; z++) {
        if (board[x][y][z] === 'black') black++;
        if (board[x][y][z] === 'white') white++;
      }
    }
  }
  return { black, white };
}

function showGameResultUI(result) {
  // UIを作成
  const container = document.createElement('div');
  container.id = 'game-result-ui';
  container.style.position = 'absolute';
  container.style.top = '30%';
  container.style.left = '50%';
  container.style.transform = 'translate(-50%, -50%)';
  container.style.backgroundColor = 'white';
  container.style.padding = '20px';
  container.style.borderRadius = '10px';
  container.style.textAlign = 'center';
  container.style.boxShadow = '0 0 10px rgba(0, 0, 0, 0.3)';
  container.style.zIndex = '100';

  // ① 終了理由の文章（あれば表示）
  if (result.endReasonMessage) {
    const reason = document.createElement('p');
    reason.textContent = result.endReasonMessage;
    reason.style.marginBottom = "10px";
    container.appendChild(reason);
  }

  const text = document.createElement('p');
  text.textContent = `勝者: ${result.result}（黒: ${result.score.black} - 白: ${result.score.white}）`;
  container.appendChild(text);

  // 棋譜送信ボタン
const sendBtn = document.createElement('button');
sendBtn.textContent = '棋譜を送信';
sendBtn.style.margin = '10px';

sendBtn.addEventListener('click', () => {
  const kifuRef = ref(database, "kifu"); // "kifu" ノードに保存
  const newRef = push(kifuRef); // ユニークキーを自動生成
  set(newRef, result) // result は棋譜オブジェクト
    .then(() => {
      alert('棋譜を送信しました！');
      container.remove();
      showNewGameButton();
    })
    .catch((error) => {
      console.error("送信エラー:", error);
      alert("棋譜の送信に失敗しました。");
    });
});

container.appendChild(sendBtn);

  // 全体をbodyに追加
  document.body.appendChild(container);
}

function showNewGameButton() {
  const newGameContainer = document.createElement('div');
  newGameContainer.id = 'new-game-ui';
  newGameContainer.style.position = 'absolute';
  newGameContainer.style.top = '30%';
  newGameContainer.style.left = '50%';
  newGameContainer.style.transform = 'translate(-50%, -50%)';
  newGameContainer.style.backgroundColor = 'white';
  newGameContainer.style.padding = '20px';
  newGameContainer.style.borderRadius = '10px';
  newGameContainer.style.textAlign = 'center';
  newGameContainer.style.boxShadow = '0 0 10px rgba(0, 0, 0, 0.3)';
  newGameContainer.style.zIndex = '100';

  const restartBtn = document.createElement('button');
  restartBtn.textContent = '新しいゲーム';
  restartBtn.addEventListener('click', () => {
    location.reload(); // または任意の初期化処理
  });

  newGameContainer.appendChild(restartBtn);
  document.body.appendChild(newGameContainer);
}



function checkGameEnd() {
  if (!gameStarted) return;

  const totalCells = size * size * size;
  const boardFull = placedStones.size >= totalCells -8 ;
  const blackHasMove = hasAnyLegalMove('black');
  const whiteHasMove = hasAnyLegalMove('white');

  if (boardFull || (!blackHasMove && !whiteHasMove)) {
    const result = countStones();
    let winner = null;

    if (result.black > result.white) winner = 'black';
    else if (result.white > result.black) winner = 'white';
    else winner = 'draw';

    const formattedMoves = moveHistory.map((entry, i) => {
      if (entry.pass) {
        return {
          turn: i + 1,
          player: entry.player,
          pass: true
        };
      } else {
        const [x, y, z] = entry.move;
        return {
          turn: i + 1,
          player: entry.player,
          x: x + 1,
          y: y + 1,
          z: z + 1
        };
      }
    });

    // ここで終了理由を作る
    let endReasonMessage = "";
    if (boardFull) {
      endReasonMessage = "全てのマスが埋まったためゲーム終了です。\n";
    } else {
      const empty = totalCells - 8 - placedStones.size;
      endReasonMessage = `${empty}マス空いていますが、双方置けないためゲーム終了です。\n`;
    }

    const gameData = {
      first: firstPlayer,
      result: winner,
      score: result,
      moves: formattedMoves,
      endReasonMessage // ← 追加
    };

    console.log('🎯 ゲーム終了:', gameData);
    gameStarted = false;
    showGameResultUI(gameData);
  }
}


function hasAnyLegalMove(player) {
  for (let x = 0; x < size; x++) {
    for (let y = 0; y < size; y++) {
      for (let z = 0; z < size; z++) {
        if (isLegalMove(board, x, y, z, player)) return true;
      }
    }
  }
  return false;
}

function showPassPopup() {
  const passPopup = document.getElementById('pass-popup');
  const turnUI = document.getElementById('turn-selection');

  // ✅ デバッグ出力
  console.log('🟡 showPassPopup called');
  console.log('🔸 gameStarted:', gameStarted);
  console.log('🔸 firstPlayer:', firstPlayer);
  console.log('🔸 turnUI.style.display:', turnUI ? turnUI.style.display : 'null');

  // ✅ ゲームが開始していないなら表示しない
  if (gameStarted === false) {
    console.log('⛔ gameStarted is false → パスポップアップ非表示');
    return;
  }

  // ✅ プレイヤーが未選択なら表示しない
  if (!firstPlayer) {
    console.log('⛔ firstPlayer is falsy → パスポップアップ非表示');
    return;
  }

  // ✅ 手番選択UIがまだ表示中なら表示しない
  if (turnUI && turnUI.style.display !== 'none') {
    console.log('⛔ 手番選択UIが表示中 → パスポップアップ非表示');
    return;
  }

  // ✅ すべての条件を通過した場合のみ表示
  console.log('✅ 全ての条件OK → パスポップアップを表示');
  passPopup.style.display = 'block';
}


function hidePassPopup() {
  document.getElementById('pass-popup').style.display = 'none';
}

document.getElementById('pass-ok-button').addEventListener('click', () => {
  hidePassPopup();

  moveHistory.push({ player: currentTurn, pass: true });

  // 先に赤石を戻す（安全順）
  if (lastPlacedStone && lastPlacedColor) {
    const prevColor = lastPlacedColor === 'black' ? 0x000000 : 0xffffff;
    revertPreviousRedStone(prevColor);
  }

  // 手番交代
  currentTurn = currentTurn === 'black' ? 'white' : 'black';

  // ⭐ OK を押したこの瞬間にだけ AI を動かす
  if (waitingPassConfirm && currentTurn === aiColor) {
    waitingPassConfirm = false;
    handleAITurn();
  }

  // もし両者手なしなら終了
  if (!hasAnyLegalMove(currentTurn)) {
    checkGameEnd();
  }
});


function updateStoneCountDisplay() {
  const count = countStones();
  const display = document.getElementById('stone-count-display');
  if (display) {
    display.textContent = `黒: ${count.black} ／ 白: ${count.white}`;
  }
}

async function fetchAIMove(board, player) {
  console.log("🌐 fetchAIMove() 呼び出し: aiColor=", aiColor);
  try {
    const convertedBoard = convertBoardForAI(board);
    const response = await fetch('https://othello-ai-server-501i.onrender.com/api/ai_move', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        board: convertedBoard,
        player: player
      })
    });

    if (!response.ok) throw new Error(`status ${response.status}`);

    const data = await response.json();
    console.log('[AI応答詳細]', JSON.stringify(data, null, 2));
    console.log('[AI応答]', data);
    return data.move;
  } catch (error) {
    console.error('[fetchAIMove] エラー:', error);
    return null;
  }
}

// --- AI専用のパス通知ポップアップ ---
function showAIPassPopup(message) {
  // すでに同種のポップアップが存在する場合は削除
  const existingPopup = document.getElementById("ai-pass-popup");
  if (existingPopup) existingPopup.remove();

  // ポップアップ要素を作成
  const popup = document.createElement("div");
  popup.id = "ai-pass-popup";
  popup.textContent = message;
  popup.style.position = "fixed";
  popup.style.top = "50%";
  popup.style.left = "50%";
  popup.style.transform = "translate(-50%, -50%)";
  popup.style.background = "rgba(255, 80, 80, 0.9)";
  popup.style.color = "white";
  popup.style.padding = "20px 40px";
  popup.style.borderRadius = "12px";
  popup.style.fontSize = "20px";
  popup.style.fontWeight = "bold";
  popup.style.boxShadow = "0 0 15px rgba(0,0,0,0.3)";
  popup.style.zIndex = "9999";
  popup.style.opacity = "0";
  popup.style.transition = "opacity 0.3s ease";

  document.body.appendChild(popup);

  // 表示アニメーション
  requestAnimationFrame(() => {
    popup.style.opacity = "1";
  });

  // 1.5秒後に自動で消える
  setTimeout(() => {
    popup.style.opacity = "0";
    setTimeout(() => popup.remove(), 300);
  }, 1500);
}




/*async function handleAITurn() {
  if (currentTurn !== aiColor) {
    console.log("❌ handleAITurn: 呼び出されたが currentTurn ≠ aiColor");
    return;
  }

  console.log("🧠 AIターン開始: currentTurn =", currentTurn);

showAILoadingIndicator();
  
  // 盤情報を最新化（ビュー側も更新）
  updateStoneCountDisplay();
  showAllLegalMoves();

  // 少しだけ遅らせて非同期スコープで処理（UIが描画される余裕をつくる）
  setTimeout(async () => {
    // ① まず軽量チェック：明らかに置けないなら即パス処理
    if (!hasAnyLegalMove(aiColor)) {
      console.log("🧾 hasAnyLegalMove => false: AIは確実に置けない");
      // パス処理
      hideAILoadingIndicator();
      moveHistory.push({ player: aiColor, pass: true });
      // 前回赤膜の復元（lastPlacedColor を使うことを推奨）
      if (lastPlacedStone && lastPlacedColor) {
        const prevColor = lastPlacedColor === 'black' ? 0x000000 : 0xffffff;
        revertPreviousRedStone(prevColor);
      }

      showAIPassPopup("AIはパスしました");
      currentTurn = aiColor === 'black' ? 'white' : 'black';
      updateStoneCountDisplay();
      showAllLegalMoves();
      if (checkGameEnd()) return;
      // 次がAIなら再帰（遅延）
      if (currentTurn === aiColor) setTimeout(() => handleAITurn(), 800);
      return;
    }

    // ② hasAnyLegalMove が true の場合、fetchAIMove に頼る
    let aiMove = null;
    try {
      aiMove = await fetchAIMove(board, aiColor);
    } catch (err) {
      console.error("fetchAIMove が例外を投げました:", err);
      aiMove = null;
    }
    console.log("🤖 fetchAIMove の戻り =", aiMove);

    // ③ fetchAIMove が null の場合はフォールバック・再確認を行う
    if (aiMove == null) {
      console.warn("⚠️ fetchAIMove が null を返したため、フォールバックで合法手を再確認します");

      // フォールバック：自前で合法手リストを作る（generateLegalMoves は盤全探索して合法を返す関数）
      const fallbackMoves = generateLegalMoves(aiColor); // 例: [{x,y,z}, ...] を返すこと
      console.log("🧩 フォールバックで検出した合法手数 =", fallbackMoves.length);

      if (fallbackMoves.length === 0) {
        // 本当に置けない（fetchAIMove と整合）
        console.log("🚫 フォールバックでも合法手なし：AIパス確定");
       hideAILoadingIndicator();
        moveHistory.push({ player: aiColor, pass: true });
      if (lastPlacedStone && lastPlacedColor) {
        const prevColor = lastPlacedColor === 'black' ? 0x000000 : 0xffffff;
        revertPreviousRedStone(prevColor);
      }
        showAIPassPopup("AIはパスしました");
        currentTurn = aiColor === 'black' ? 'white' : 'black';
        updateStoneCountDisplay();
        showAllLegalMoves();
        if (checkGameEnd()) return;
        if (currentTurn === aiColor) setTimeout(() => handleAITurn(), 800);
        return;
      } else {
        // フォールバックで合法手があるが fetchAIMove が null: AI側の一時エラーの可能性
        console.warn("⚠️ fetchAIMove が null だがフォールバックでは手が存在 -> 1回だけリトライします");
        // 1回だけ短い遅延で再試行
        setTimeout(async () => {
          let retryMove = null;
          try {
            retryMove = await fetchAIMove(board, aiColor);
          } catch (err) {
            console.error("fetchAIMove retry で例外:", err);
            retryMove = null;
          }
          console.log("🔁 retry fetchAIMove の戻り =", retryMove);
          if (retryMove == null) {
            // 安全側：今回はパス扱い（無限ループ阻止のため）
            console.error("❌ retryでも取得できず：安全のため今回AIはパス扱いにします");
            aicannot = true;

            if (aicannot === true){
              let aiMove = chooseMoveMinOpponentLegal();
            if (aiMove) {
             hideAILoadingIndicator();
              performAIMoveAndContinue(aiMove);
            }
              else {
                hideAILoadingIndicator();
                moveHistory.push({ player: aiColor, pass: true });
                  if (lastPlacedStone && lastPlacedColor) {
                    const prevColor = lastPlacedColor === 'black' ? 0x000000 : 0xffffff;
                    revertPreviousRedStone(prevColor);
                  }
                showAIPassPopup("AIはパスしました");
                currentTurn = aiColor === 'black' ? 'white' : 'black';
                updateStoneCountDisplay();
                showAllLegalMoves();
                PassorNot();
                if (checkGameEnd()) return;
                if (currentTurn === aiColor) setTimeout(() => handleAITurn(), 800);
                return;
              }
              console.log("aaaa")
              PassorNot();
            }
          } else {
            // リトライ成功 -> 通常の着手処理へ
           hideAILoadingIndicator();
            performAIMoveAndContinue(retryMove);
            return;
          }
        }, 200); // 200ms の短い待ち
        return; // リトライブロックに処理を移す
      }
    }

    // ④ aiMove が存在する（通常ケース）なら着手処理
   hideAILoadingIndicator();
    performAIMoveAndContinue(aiMove);

    PassorNot();

  }, 0);
  
}*/

// 着手処理を分離すると見通しが良い
function performAIMoveAndContinue(aiMove) {
  hideAILoadingIndicator();
  const [x, y, z] = aiMove;
  const color = currentTurn === 'black' ? 0x000000 : 0xffffff;
  
  createStone(x, y, z, color, true);
  board[x][y][z] = currentTurn;
  placedStones.add(`${x},${y},${z}`);
  lastPlacedStone = [x, y, z];
  lastPlacedColor = currentTurn;
  console.log(currentTurn);
  console.log(lastPlacedColor);

  moveHistory.push({ player: currentTurn, move: [x, y, z] });
  flipStones(x, y, z, currentTurn);
  updateStoneCountDisplay();

  currentTurn = currentTurn === 'black' ? 'white' : 'black';
  
  showAllLegalMoves();
  if (checkGameEnd()) return;

  if (currentTurn === aiColor) {
    setTimeout(() => handleAITurn(), 800);
  }
}

function generateLegalMoves(color) {
  const legalMoves = [];

  for (let x = 0; x < 4; x++) {
    for (let y = 0; y < 4; y++) {
      for (let z = 0; z < 4; z++) {
        if (isLegalMove(board, x, y, z, color)) {
          legalMoves.push([x, y, z]);
        }
      }
    }
  }

  return legalMoves;
}


function convertBoardForAI(board) {
  return board.map(layer =>
    layer.map(row =>
      row.map(cell => {
        if (cell === 'black') return 1;
        if (cell === 'white') return -1;
        return 0; // 'empty' または null または undefined
      })
    )
  );
}

function PassorNot() {
  if (currentTurn !== aiColor) {
    const otherPlayer = currentTurn === 'black' ? 'white' : 'black';
    console.log(
      "currentTurn=",currentTurn,
       "aiColor=", aiColor,
       "hasAnyLegalMove(currentTurn)", hasAnyLegalMove(currentTurn),
       "hasAnyLegalMove(aiColor)", hasAnyLegalMove(aiColor), 
       "hasAnyLegalMove(othePlayer)", hasAnyLegalMove(otherPlayer),
       "aicannot=",aicannot,
       "gameStarted=",gameStarted);
    
    if (hasAnyLegalMove(currentTurn) === false && gameStarted === true) {
        if (hasAnyLegalMove(otherPlayer) === false) {
          console.log("checkgameend中");
            checkGameEnd();
        } else {
          console.log("showpasspopup中");
            showPassPopup();
        }
    }
  }
}  



/**
 * currentTurn の色で合法手を評価し、
 * 相手の合法手が最も少なくなる手を返す
 * 盤は変更せず、仮想盤でシミュレーション
 */
function chooseMoveMinOpponentLegal() {
  // ① 現在の手番の合法手を取得
  const legalMoves = generateLegalMoves(currentTurn);
  if (legalMoves.length === 0) return null; // 合法手なしなら null

  let bestMove = null;
  let minOpponentMoves = Infinity;

  // ② 各合法手についてシミュレーション
  for (const [x, y, z] of legalMoves) {
    // 仮想盤の作成（deep copy）
    const boardCopy = board.map(layer => layer.map(row => row.slice()));

    // 仮に置いて flip
    simulateMove(boardCopy, x, y, z, currentTurn);

    // ③ 相手色の合法手数を数える
    const opponent = currentTurn === 'black' ? 'white' : 'black';
    let opponentLegalCount = 0;
    for (let xi = 0; xi < 4; xi++) {
      for (let yi = 0; yi < 4; yi++) {
        for (let zi = 0; zi < 4; zi++) {
          if (isLegalMove(boardCopy, xi, yi, zi, opponent)) {
            opponentLegalCount++;
          }
        }
      }
    }

    // ④ 相手の合法手が最小のものを更新
    if (opponentLegalCount < minOpponentMoves) {
      minOpponentMoves = opponentLegalCount;
      bestMove = [x, y, z];
    }
  }

  return bestMove; // [x, y, z] または null
}

/**
 * 仮想盤で石を置き、flipする処理
 * 実際の盤には影響なし
 */
// ========================================
// AI思考中ローディング表示の制御関数
// ========================================
function showAILoadingIndicator() {
  if (document.getElementById('ai-loading-indicator')) return;

  const loadingDiv = document.createElement('div');
  loadingDiv.id = 'ai-loading-indicator';
  loadingDiv.innerHTML = `
    <div class="spinner"></div>
    <p>AI思考中...</p>
  `;
  
  loadingDiv.style.position = 'fixed';
  loadingDiv.style.top = '50%';
  loadingDiv.style.left = '50%';
  loadingDiv.style.transform = 'translate(-50%, -50%)';
  loadingDiv.style.backgroundColor = 'rgba(255, 255, 255, 0.95)';
  loadingDiv.style.padding = '30px 50px';
  loadingDiv.style.borderRadius = '15px';
  loadingDiv.style.boxShadow = '0 4px 20px rgba(0, 0, 0, 0.3)';
  loadingDiv.style.zIndex = '10000';
  loadingDiv.style.textAlign = 'center';
  loadingDiv.style.fontSize = '18px';
  loadingDiv.style.fontWeight = 'bold';
  loadingDiv.style.color = '#333';

  document.body.appendChild(loadingDiv);

  if (!document.getElementById('spinner-style')) {
    const style = document.createElement('style');
    style.id = 'spinner-style';
    style.textContent = `
      .spinner {
        width: 50px;
        height: 50px;
        border: 5px solid #f3f3f3;
        border-top: 5px solid #3498db;
        border-radius: 50%;
        animation: spin 1s linear infinite;
        margin: 0 auto 15px auto;
      }
      
      @keyframes spin {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
      }
    `;
    document.head.appendChild(style);
  }
}

function hideAILoadingIndicator() {
  const loadingDiv = document.getElementById('ai-loading-indicator');
  if (loadingDiv) {
    loadingDiv.remove();
  }
}



function simulateMove(boardCopy, x, y, z, turnColor) {
  const opponent = turnColor === 'black' ? 'white' : 'black';
  boardCopy[x][y][z] = turnColor;

  for (const [dx, dy, dz] of directions) {
    const stonesToFlip = [];
    let nx = x + dx;
    let ny = y + dy;
    let nz = z + dz;

    while (
      nx >= 0 && nx < 4 &&
      ny >= 0 && ny < 4 &&
      nz >= 0 && nz < 4 &&
      boardCopy[nx][ny][nz] === opponent
    ) {
      stonesToFlip.push([nx, ny, nz]);
      nx += dx; ny += dy; nz += dz;
    }

    if (
      stonesToFlip.length > 0 &&
      nx >= 0 && nx < 4 &&
      ny >= 0 && ny < 4 &&
      nz >= 0 && nz < 4 &&
      boardCopy[nx][ny][nz] === turnColor
    ) {
      // flip
      for (const [fx, fy, fz] of stonesToFlip) {
        boardCopy[fx][fy][fz] = turnColor;
      }
    }
  }
}

// ========================================
// v9 ミニマックスAI（深さ3）
// ========================================

// BPS評価パラメータ（v9のC++版と同じ）
const EVAL_PARAMS = {
  corner: 0.585,
  edge: 0.474,
  middle: 0.452,
  inner: 0.435,
  positionWeight: 0.30,
  mobilityWeight: 0.10,
  stoneWeight: 0.05,
  searchDepth: 5
};

// 位置判定関数
function isCornerPosition(x, y, z) {
  return (x === 0 || x === 3) && (y === 0 || y === 3) && (z === 0 || z === 3);
}

function isEdgePosition(x, y, z) {
  let edgeCount = 0;
  if (x === 0 || x === 3) edgeCount++;
  if (y === 0 || y === 3) edgeCount++;
  if (z === 0 || z === 3) edgeCount++;
  return edgeCount === 2 && !isCornerPosition(x, y, z);
}


// 石数をカウント
function countStonesInBoard(boardState) {
  let black = 0, white = 0;
  for (let x = 0; x < 4; x++) {
    for (let y = 0; y < 4; y++) {
      for (let z = 0; z < 4; z++) {
        if (boardState[x][y][z] === 'black') black++;
        if (boardState[x][y][z] === 'white') white++;
      }
    }
  }
  return { black, white };
}

// 合法手数をカウント
function countLegalMovesForPlayer(boardState, player) {
  let count = 0;
  for (let x = 0; x < 4; x++) {
    for (let y = 0; y < 4; y++) {
      for (let z = 0; z < 4; z++) {
        if (isLegalMove(boardState, x, y, z, player)) count++;
      }
    }
  }
  return count;
}

// 面の3つ目禁止ルールチェック
function isForbiddenThirdFace(boardState, x, y, z) {
  const faces = [
    [0, [1, 2]], [3, [1, 2]], // x面
    [0, [0, 2]], [3, [0, 2]], // y面
    [0, [0, 1]], [3, [0, 1]]  // z面
  ];
  
  for (let faceIdx = 0; faceIdx < 6; faceIdx++) {
    const fixedAxis = Math.floor(faceIdx / 2);
    const fixedValue = (faceIdx % 2 === 0) ? 0 : 3;
    
    let belongsToFace = false;
    if (fixedAxis === 0 && x === fixedValue) belongsToFace = true;
    if (fixedAxis === 1 && y === fixedValue) belongsToFace = true;
    if (fixedAxis === 2 && z === fixedValue) belongsToFace = true;
    
    if (!belongsToFace) continue;
    
    // Corner & Edge が埋まっているか
    let emptyCornerEdge = 0;
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) {
        let px, py, pz;
        if (fixedAxis === 0) { px = fixedValue; py = i; pz = j; }
        else if (fixedAxis === 1) { px = i; py = fixedValue; pz = j; }
        else { px = i; py = j; pz = fixedValue; }
        
        if ((isCornerPosition(px, py, pz) || isEdgePosition(px, py, pz)) && 
            boardState[px][py][pz] === null) {
          emptyCornerEdge++;
        }
      }
    }
    
    if (emptyCornerEdge > 0) continue;
    
    // Face 4マスのうち何個埋まっているか
    let filledFaces = 0;
    for (let i = 1; i <= 2; i++) {
      for (let j = 1; j <= 2; j++) {
        let px, py, pz;
        if (fixedAxis === 0) { px = fixedValue; py = i; pz = j; }
        else if (fixedAxis === 1) { px = i; py = fixedValue; pz = j; }
        else { px = i; py = j; pz = fixedValue; }
        
        if (boardState[px][py][pz] !== null) filledFaces++;
      }
    }
    
    if (filledFaces === 2) return true;
  }
  
  return false;
}

// 確定石をカウント（簡易版）
/*function countStableDiscs(boardState, player) {
  const stable = new Set();
  const corners = [
    [0,0,0],[3,0,0],[0,3,0],[0,0,3],[3,3,0],[3,0,3],[0,3,3],[3,3,3]
  ];
  
  for (const [cx, cy, cz] of corners) {
    if (boardState[cx][cy][cz] === player) {
      stable.add(`${cx},${cy},${cz}`);
    }
  }
  
  // Corner隣接石を追加
  let changed = true;
  let iterations = 0;
  while (changed && iterations < 20) {
    changed = false;
    iterations++;
    
    for (let x = 0; x < 4; x++) {
      for (let y = 0; y < 4; y++) {
        for (let z = 0; z < 4; z++) {
          if (boardState[x][y][z] !== player) continue;
          const key = `${x},${y},${z}`;
          if (stable.has(key)) continue;
          
          for (const [dx, dy, dz] of directions) {
            const nx = x + dx, ny = y + dy, nz = z + dz;
            if (nx >= 0 && nx < 4 && ny >= 0 && ny < 4 && nz >= 0 && nz < 4) {
              if (stable.has(`${nx},${ny},${nz}`)) {
                stable.add(key);
                changed = true;
                break;
              }
            }
          }
        }
      }
    }
  }
  
  return stable.size;
}*/

// 盤面のディープコピー
function copyBoard(boardState) {
  return boardState.map(layer => layer.map(row => row.slice()));
}

// ========================================
// v11_adhumanic AI実装
// ========================================

// 新規開拓Edge判定
function isNewFrontierEdge(boardState, x, y, z) {
  if (!isEdgePosition(x, y, z)) return false;
  
  // 12本の辺の定義
  const allEdges = [
    [[0,1,0],[0,2,0]], [[3,1,0],[3,2,0]], [[0,1,3],[0,2,3]], [[3,1,3],[3,2,3]],
    [[1,0,0],[2,0,0]], [[1,3,0],[2,3,0]], [[1,0,3],[2,0,3]], [[1,3,3],[2,3,3]],
    [[0,0,1],[0,0,2]], [[3,0,1],[3,0,2]], [[0,3,1],[0,3,2]], [[3,3,1],[3,3,2]]
  ];
  
  const corners = [
    [0,0,0],[3,0,0],[0,3,0],[0,0,3],[3,3,0],[3,0,3],[0,3,3],[3,3,3]
  ];
  
  // この Edgeが属する辺を探す
  let edgeLine = null;
  for (const edges of allEdges) {
    for (const [ex, ey, ez] of edges) {
      if (ex === x && ey === y && ez === z) {
        edgeLine = edges;
        break;
      }
    }
    if (edgeLine) break;
  }
  
  if (!edgeLine) return false;
  
  // Edge 2マスが両方空きか
  for (const [ex, ey, ez] of edgeLine) {
    if (boardState[ex][ey][ez] !== null) return false;
  }
  
  // 両端Cornerも空きか
  for (const [cx, cy, cz] of corners) {
    const dist = Math.abs(cx - x) + Math.abs(cy - y) + Math.abs(cz - z);
    if (dist === 2) { // Corner隣接
      if (boardState[cx][cy][cz] !== null) return false;
    }
  }
  
  return true; // 辺の4マス全て空き
}

// 危険なEdge判定（統合版）
function isDangerousEdge(boardState, x, y, z, player) {
  if (!isEdgePosition(x, y, z)) return false;
  
  const opponent = player === 'black' ? 'white' : 'black';
  const corners = [
    [0,0,0],[3,0,0],[0,3,0],[0,0,3],[3,3,0],[3,0,3],[0,3,3],[3,3,3]
  ];
  
  // 1. 新規開拓Edge
  if (isNewFrontierEdge(boardState, x, y, z)) return true;
  
  // 2. 相手のCorner隣接Edge
  for (const [cx, cy, cz] of corners) {
    if (boardState[cx][cy][cz] === opponent) {
      for (const [dx, dy, dz] of directions) {
        const nx = cx + dx, ny = cy + dy, nz = cz + dz;
        if (nx === x && ny === y && nz === z) return true;
      }
    }
  }
  
  // 3. 相手のEdgeの隣のEdge
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      for (let k = 0; k < 4; k++) {
        if (boardState[i][j][k] === opponent && isEdgePosition(i, j, k)) {
          for (const [dx, dy, dz] of directions) {
            const cx = i + dx, cy = j + dy, cz = k + dz;
            if (cx >= 0 && cx < 4 && cy >= 0 && cy < 4 && cz >= 0 && cz < 4 &&
                isCornerPosition(cx, cy, cz) && boardState[cx][cy][cz] === null) {
              for (const [dx2, dy2, dz2] of directions) {
                const ex = cx + dx2, ey = cy + dy2, ez = cz + dz2;
                if (ex === x && ey === y && ez === z) return true;
              }
            }
          }
        }
      }
    }
  }
  
  return false;
}

// Corner開放禁止（Faceから斜め1方向のCornerが空き）
function opensCorner(boardState, x, y, z) {
  if (!isFace(x, y, z)) return false;
  
  for (const dx of [-1, 1]) {
    for (const dy of [-1, 1]) {
      for (const dz of [-1, 1]) {
        const cx = (dx === -1) ? 0 : 3;
        const cy = (dy === -1) ? 0 : 3;
        const cz = (dz === -1) ? 0 : 3;
        
        const diffX = cx - x;
        const diffY = cy - y;
        const diffZ = cz - z;
        
        if (Math.abs(diffX) === 1 && Math.abs(diffY) === 1 && Math.abs(diffZ) === 1) {
          if (boardState[cx][cy][cz] === null) return true;
        }
      }
    }
  }
  return false;
}

// 自分専用マスをチェック
function getExclusiveMoves(boardState, player) {
  const exclusive = [];
  const myMoves = generateLegalMoves(player, boardState);
  const opponent = player === 'black' ? 'white' : 'black';
  const oppMoves = generateLegalMoves(opponent, boardState);
  
  for (const [mx, my, mz] of myMoves) {
    let isExclusive = true;
    for (const [ox, oy, oz] of oppMoves) {
      if (mx === ox && my === oy && mz === oz) {
        isExclusive = false;
        break;
      }
    }
    if (isExclusive) exclusive.push([mx, my, mz]);
  }
  return exclusive;
}

// この手を打つと自分専用マスを開放するか
function opensExclusiveMove(boardState, move, player) {
  const exclusiveBefore = getExclusiveMoves(boardState, player);
  
  const nextBoard = copyBoard(boardState);
  simulateMove(nextBoard, move[0], move[1], move[2], player);
  
  const opponent = player === 'black' ? 'white' : 'black';
  const oppMovesAfter = generateLegalMoves(opponent, nextBoard);
  
  for (const [ex, ey, ez] of exclusiveBefore) {
    for (const [ox, oy, oz] of oppMovesAfter) {
      if (ex === ox && ey === oy && ez === oz) return true;
    }
  }
  return false;
}

// isFace関数追加（既存のmain.jsに存在しない場合）
function isFace(x, y, z) {
  let edgeCount = 0;
  if (x === 0 || x === 3) edgeCount++;
  if (y === 0 || y === 3) edgeCount++;
  if (z === 0 || z === 3) edgeCount++;
  return edgeCount === 1 && !isCornerPosition(x, y, z) && !isEdgePosition(x, y, z);
}

// Face評価: 面完成4つ目
function getFaceCompletion4th(boardState, faceMoves, player) {
  const completion = [];
  
  for (const move of faceMoves) {
    for (let faceIdx = 0; faceIdx < 6; faceIdx++) {
      const fixedAxis = Math.floor(faceIdx / 2);
      const fixedValue = (faceIdx % 2 === 0) ? 0 : 3;
      
      let belongsToFace = false;
      if (fixedAxis === 0 && move[0] === fixedValue) belongsToFace = true;
      if (fixedAxis === 1 && move[1] === fixedValue) belongsToFace = true;
      if (fixedAxis === 2 && move[2] === fixedValue) belongsToFace = true;
      
      if (!belongsToFace) continue;
      
      // Corner & Edge 全埋まりチェック
      let allFilled = true;
      for (let i = 0; i < 4; i++) {
        for (let j = 0; j < 4; j++) {
          let px, py, pz;
          if (fixedAxis === 0) { px = fixedValue; py = i; pz = j; }
          else if (fixedAxis === 1) { px = i; py = fixedValue; pz = j; }
          else { px = i; py = j; pz = fixedValue; }
          
          if ((isCornerPosition(px, py, pz) || isEdgePosition(px, py, pz)) && 
              boardState[px][py][pz] === null) {
            allFilled = false;
            break;
          }
        }
        if (!allFilled) break;
      }
      
      if (!allFilled) continue;
      
      // Face 3/4埋まりチェック
      let filledFaces = 0;
      for (let i = 1; i <= 2; i++) {
        for (let j = 1; j <= 2; j++) {
          let px, py, pz;
          if (fixedAxis === 0) { px = fixedValue; py = i; pz = j; }
          else if (fixedAxis === 1) { px = i; py = fixedValue; pz = j; }
          else { px = i; py = j; pz = fixedValue; }
          
          if (boardState[px][py][pz] !== null) filledFaces++;
        }
      }
      
      if (filledFaces === 3) {
        completion.push(move);
        break;
      }
    }
  }
  
  return completion;
}

// Face評価: 確定石候補
function getFaceStableCandidate(boardState, faceMoves, player) {
  const candidates = [];
  
  for (const move of faceMoves) {
    let myCount = 0;
    for (const [dx, dy, dz] of directions) {
      const nx = move[0] + dx, ny = move[1] + dy, nz = move[2] + dz;
      if (nx >= 0 && nx < 4 && ny >= 0 && ny < 4 && nz >= 0 && nz < 4) {
        if (boardState[nx][ny][nz] === player &&
            (isEdgePosition(nx, ny, nz) || isCornerPosition(nx, ny, nz))) {
          myCount++;
        }
      }
    }
    
    if (myCount >= 3) candidates.push(move);
  }
  
  return candidates;
}

// 終盤完全読み切り（簡易版）
function endgameSearch(boardState, player) {
  const opponent = player === 'black' ? 'white' : 'black';

  function isBoardFull(board) {
    for (let x = 0; x < 4; x++) {
      for (let y = 0; y < 4; y++) {
        for (let z = 0; z < 4; z++) {
          if (board[x][y][z] === null) return false;
        }
      }
    }
    return true;
  }

  function finalResult(board, rootPlayer) {
    const s = countStonesInBoard(board);
    if (s.black > s.white) return rootPlayer === 'black' ? 1 : -1;
    if (s.white > s.black) return rootPlayer === 'white' ? 1 : -1;
    return 0; // draw
  }

  function solve(board, turn, root, alpha, beta) {
    const moves = generateLegalMoves(turn, board);
    const other = turn === 'black' ? 'white' : 'black';

    // --- 終局条件 ---
    if (isBoardFull(board)) {
      return { score: finalResult(board, root), move: null };
    }

    const oppMoves = generateLegalMoves(other, board);
    if (moves.length === 0 && oppMoves.length === 0) {
      return { score: finalResult(board, root), move: null };
    }

    // --- パス ---
    if (moves.length === 0) {
      return solve(board, other, root, alpha, beta);
    }

    let bestMove = moves[0];
    let bestScore = (turn === root) ? -9999 : 9999;

    for (const m of moves) {
      const b2 = copyBoard(board);
      simulateMove(b2, m[0], m[1], m[2], turn);

      const r = solve(b2, other, root, alpha, beta);
      const score = r.score;

      if (turn === root) {
        // maximize
        if (score > bestScore) {
          bestScore = score;
          bestMove = m;
        }
        alpha = Math.max(alpha, bestScore);
        if (alpha >= beta) break; // αβ枝刈り
      } else {
        // minimize
        if (score < bestScore) {
          bestScore = score;
          bestMove = m;
        }
        beta = Math.min(beta, bestScore);
        if (beta <= alpha) break;
      }
    }

    return { score: bestScore, move: bestMove };
  }

  const result = solve(boardState, player, player, -9999, 9999);
  return result.move;
}

// v11_adhumanic メイン関数
function selectMoveV11(boardState, player, depth = 0) {
  const opponent = player === 'black' ? 'white' : 'black';
  let legalMoves = generateLegalMoves(player, boardState);
  
  if (legalMoves.length === 0) return null;
  
  // 残りマス数
  let emptyCount = 0;
  for (let x = 0; x < 4; x++) {
    for (let y = 0; y < 4; y++) {
      for (let z = 0; z < 4; z++) {
        if (boardState[x][y][z] === null) emptyCount++;
      }
    }
  }
  
  // 終盤完全読み切り
  if (emptyCount <= 6 && depth === 0) {
    return endgameSearch(boardState, player);
  }
  
  // 深さ制限
  if (depth > 2) {
    return legalMoves[Math.floor(Math.random() * legalMoves.length)];
  }
  
  // 面の3つ目禁止で除外
  const safeMoves = legalMoves.filter(([x, y, z]) => !isForbiddenThirdFace(boardState, x, y, z));
  if (safeMoves.length > 0) legalMoves = safeMoves;
  
  // Corner最優先
  const cornerMoves = legalMoves.filter(([x, y, z]) => isCornerPosition(x, y, z));
  
  if (cornerMoves.length > 0) {
    let bestCorners = [];
    let minOppMoves = 1000;
    let minOpensExclusive = true;
    
    for (const move of cornerMoves) {
      const nextBoard = copyBoard(boardState);
      simulateMove(nextBoard, move[0], move[1], move[2], player);
      const oppMoves = countLegalMovesForPlayer(nextBoard, opponent);
      const opensExcl = opensExclusiveMove(boardState, move, player);
      
      if (!opensExcl && minOpensExclusive) {
        minOppMoves = oppMoves;
        minOpensExclusive = false;
        bestCorners = [move];
      } else if (opensExcl === minOpensExclusive) {
        if (oppMoves < minOppMoves) {
          minOppMoves = oppMoves;
          bestCorners = [move];
        } else if (oppMoves === minOppMoves) {
          bestCorners.push(move);
        }
      }
    }
    return bestCorners[Math.floor(Math.random() * bestCorners.length)];
  }
  
  // Edge判定
  const safeEdges = legalMoves.filter(([x, y, z]) =>
    isEdgePosition(x, y, z) && !isDangerousEdge(boardState, x, y, z, player)
  );
  
  if (safeEdges.length > 0) {
    return safeEdges[Math.floor(Math.random() * safeEdges.length)];
  }
  
  // Face評価
  let faceMoves = legalMoves.filter(([x, y, z]) => isFace(x, y, z));
  
  if (faceMoves.length > 0) {
    // 1. 面完成4つ目
    const completion = getFaceCompletion4th(boardState, faceMoves, player);
    if (completion.length > 0) {
      return completion[Math.floor(Math.random() * completion.length)];
    }
    
    // 2. 確定石候補
    const stableCandidate = getFaceStableCandidate(boardState, faceMoves, player);
    if (stableCandidate.length > 0) {
      return stableCandidate[Math.floor(Math.random() * stableCandidate.length)];
    }
    
    // 3. Corner開放禁止で除外
    const noCornerOpen = faceMoves.filter(([x, y, z]) => !opensCorner(boardState, x, y, z));
    if (noCornerOpen.length > 0) faceMoves = noCornerOpen;
    
    // 4-1: 相手合法手のFace割合最大
    let bestByOppFaceRatio = [];
    let maxOppFaceRatio = -1.0;
    
    for (const move of faceMoves) {
      const nextBoard = copyBoard(boardState);
      simulateMove(nextBoard, move[0], move[1], move[2], player);
      
      const oppMoves = generateLegalMoves(opponent, nextBoard);
      if (oppMoves.length === 0) continue;
      
      const oppFaceCount = oppMoves.filter(([ox, oy, oz]) => isFace(ox, oy, oz)).length;
      const ratio = oppFaceCount / oppMoves.length;
      
      if (ratio > maxOppFaceRatio) {
        maxOppFaceRatio = ratio;
        bestByOppFaceRatio = [move];
      } else if (ratio === maxOppFaceRatio) {
        bestByOppFaceRatio.push(move);
      }
    }
    
    if (bestByOppFaceRatio.length === 0) bestByOppFaceRatio = faceMoves;
    
    // 4-2: 所属面の埋まり割合最大
    let bestByFaceFilledRatio = [];
    let maxFilledRatio = -1.0;
    
    for (const move of bestByOppFaceRatio) {
      for (let faceIdx = 0; faceIdx < 6; faceIdx++) {
        const fixedAxis = Math.floor(faceIdx / 2);
        const fixedValue = (faceIdx % 2 === 0) ? 0 : 3;
        
        let belongsToFace = false;
        if (fixedAxis === 0 && move[0] === fixedValue) belongsToFace = true;
        if (fixedAxis === 1 && move[1] === fixedValue) belongsToFace = true;
        if (fixedAxis === 2 && move[2] === fixedValue) belongsToFace = true;
        
        if (!belongsToFace) continue;
        
        let filledCount = 0;
        for (let i = 0; i < 4; i++) {
          for (let j = 0; j < 4; j++) {
            let px, py, pz;
            if (fixedAxis === 0) { px = fixedValue; py = i; pz = j; }
            else if (fixedAxis === 1) { px = i; py = fixedValue; pz = j; }
            else { px = i; py = j; pz = fixedValue; }
            
            if (boardState[px][py][pz] !== null) filledCount++;
          }
        }
        
        const ratio = filledCount / 16.0;
        
        if (ratio > maxFilledRatio) {
          maxFilledRatio = ratio;
          bestByFaceFilledRatio = [move];
        } else if (ratio === maxFilledRatio) {
          bestByFaceFilledRatio.push(move);
        }
        
        break;
      }
    }
    
    if (bestByFaceFilledRatio.length === 0) bestByFaceFilledRatio = bestByOppFaceRatio;
    
    // 4-3: ランダム選択
    return bestByFaceFilledRatio[Math.floor(Math.random() * bestByFaceFilledRatio.length)];
  }
  
  // 最終手段
  return legalMoves[Math.floor(Math.random() * legalMoves.length)];
}

// v10_humanic の人間戦略AI
/*function selectMoveHumanic(boardState, player) {
  const opponent = player === 'black' ? 'white' : 'black';
  const legalMoves = generateLegalMoves(player, boardState);
  
  if (legalMoves.length === 0) return null;
  
  // 残りマス数を計算
  let emptyCount = 0;
  for (let x = 0; x < 4; x++) {
    for (let y = 0; y < 4; y++) {
      for (let z = 0; z < 4; z++) {
        if (boardState[x][y][z] === null) emptyCount++;
      }
    }
  }
  
  const endgameThreshold = 6;
  const isEndgame = emptyCount <= endgameThreshold;
  
  // 終盤：石数重視
  if (isEndgame) {
    let bestMoves = [];
    let bestScore = -1000;
    
    for (const [x, y, z] of legalMoves) {
      const boardCopy = copyBoard(boardState);
      simulateMove(boardCopy, x, y, z, player);
      const stones = countStonesInBoard(boardCopy);
      const score = player === 'black' ? stones.black : stones.white;
      
      if (score > bestScore) {
        bestScore = score;
        bestMoves = [[x, y, z]];
      } else if (score === bestScore) {
        bestMoves.push([x, y, z]);
      }
    }
    return bestMoves[Math.floor(Math.random() * bestMoves.length)];
  }
  
  // 面の3つ目禁止ルールで除外
  const safeMoves = legalMoves.filter(([x, y, z]) => !isForbiddenThirdFace(boardState, x, y, z));
  const filteredMoves = safeMoves.length > 0 ? safeMoves : legalMoves;
  
  // Corner最優先
  const cornerMoves = filteredMoves.filter(([x, y, z]) => isCornerPosition(x, y, z));
  
  if (cornerMoves.length > 0) {
    let bestCorners = [];
    let minOppMoves = 1000;
    
    for (const [x, y, z] of cornerMoves) {
      const boardCopy = copyBoard(boardState);
      simulateMove(boardCopy, x, y, z, player);
      const oppMoves = countLegalMovesForPlayer(boardCopy, opponent);
      
      if (oppMoves < minOppMoves) {
        minOppMoves = oppMoves;
        bestCorners = [[x, y, z]];
      } else if (oppMoves === minOppMoves) {
        bestCorners.push([x, y, z]);
      }
    }
    return bestCorners[Math.floor(Math.random() * bestCorners.length)];
  }
  
  // Edge判定（危険なEdge除外）
  const safeEdges = filteredMoves.filter(([x, y, z]) => 
    isEdgePosition(x, y, z) && !isDangerousEdge(boardState, x, y, z, player)
  );
  
  if (safeEdges.length > 0) {
    let bestEdges = [];
    let bestScore = -1000;
    
    for (const [x, y, z] of safeEdges) {
      const boardCopy = copyBoard(boardState);
      simulateMove(boardCopy, x, y, z, player);
      
      const myStable = countStableDiscs(boardCopy, player);
      const oppMoves = countLegalMovesForPlayer(boardCopy, opponent);
      const score = myStable * 10 - oppMoves * 2;
      
      if (score > bestScore) {
        bestScore = score;
        bestEdges = [[x, y, z]];
      } else if (score === bestScore) {
        bestEdges.push([x, y, z]);
      }
    }
    return bestEdges[Math.floor(Math.random() * bestEdges.length)];
  }
  
  // Face/Core：確定石重視
  let bestMoves = [];
  let bestScore = -1000;
  
  for (const [x, y, z] of filteredMoves) {
    const boardCopy = copyBoard(boardState);
    simulateMove(boardCopy, x, y, z, player);
    
    const myStable = countStableDiscs(boardCopy, player);
    const oppStable = countStableDiscs(boardCopy, opponent);
    const myMoves = countLegalMovesForPlayer(boardCopy, player);
    const oppMoves = countLegalMovesForPlayer(boardCopy, opponent);
    
    const score = (myStable - oppStable) * 100 + (myMoves - oppMoves) * 5;
    
    if (score > bestScore) {
      bestScore = score;
      bestMoves = [[x, y, z]];
    } else if (score === bestScore) {
      bestMoves.push([x, y, z]);
    }
  }
  
  if (bestMoves.length === 0) {
    return filteredMoves[Math.floor(Math.random() * filteredMoves.length)];
  }
  
  return bestMoves[Math.floor(Math.random() * bestMoves.length)];
}
*/



function handleAITurn() {
  if (currentTurn !== aiColor) return;

  console.log("🧠 AIターン開始:", aiColor);
  showAILoadingIndicator();

  setTimeout(() => {
    // ① 合法手がなければパス
// ① 合法手がなければパス
if (!hasAnyLegalMove(aiColor)) {
  hideAILoadingIndicator();
  console.log("🤖 AIの合法手なし");

  const other = aiColor === 'black' ? 'white' : 'black';

  // ⭐ 両者合法手なし → その場でゲーム終了
  if (!hasAnyLegalMove(other)) {
    console.log("🏁 両者合法手なし → ゲーム終了（AIパスポップアップなし）");
    checkGameEnd();
    return;
  }

  // ここに来た場合だけ「AIだけパス」
  console.log("🤖 AIはパス");
  moveHistory.push({ player: aiColor, pass: true });

  if (lastPlacedStone && lastPlacedColor) {
    const prevColor = lastPlacedColor === 'black' ? 0x000000 : 0xffffff;
    revertPreviousRedStone(prevColor);
  }

  showAIPassPopup("AIはパスしました");

  currentTurn = other;
  showAllLegalMoves();
  return;
}
      const move = selectMoveV11(board, aiColor);

    if (!move) {
      // 念のための保険
      hideAILoadingIndicator();
      currentTurn = aiColor === 'black' ? 'white' : 'black';
      showAllLegalMoves();
      return;
    }

    // ③ 着手
    const [x, y, z] = move;
    const color = aiColor === 'black' ? 0x000000 : 0xffffff;

    createStone(x, y, z, color, true);
    board[x][y][z] = aiColor;
    placedStones.add(`${x},${y},${z}`);

    lastPlacedStone = [x, y, z];
    lastPlacedColor = aiColor;

    moveHistory.push({ player: aiColor, move: [x, y, z] });

    flipStones(x, y, z, aiColor);
    updateStoneCountDisplay();

    currentTurn = aiColor === 'black' ? 'white' : 'black';

hideAILoadingIndicator();
showAllLegalMoves();

// 🔍 プレイヤーが合法手ゼロならパス処理
if (!hasAnyLegalMove(currentTurn)) {
  console.log("🟡 プレイヤーに合法手なし → パス");

  const other = currentTurn === 'black' ? 'white' : 'black';

  // もし両方なければ終了
  if (!hasAnyLegalMove(other)) {
    console.log("🏁 両者合法手なし → ゲーム終了");
    checkGameEnd();
    return;
  }
  waitingPassConfirm = true;
  // プレイヤーパス表示（あなたの環境に合わせて）
  showPassPopup();
  // 手番をAIに戻す
  //currentTurn = other;
  return;
}
checkGameEnd();
  }, 500);
}

