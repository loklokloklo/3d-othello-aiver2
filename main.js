// main.js - カスタム戦略AI実装版
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
let isPassPopupVisible = false; // パスポップアップ表示中フラグ

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
for (let dx = -1; dx <= 1; dx++) {
  for (let dy = -1; dy <= 1; dy++) {
    for (let dz = -1; dz <= 1; dz++) {
      if (dx !== 0 || dy !== 0 || dz !== 0) {
        directions.push([dx, dy, dz]);
      }
    }
  }
}

// ========================================
// 初期盤面スナップショット（1手戻し用）
// ========================================
const INITIAL_BOARD_STATE = [
  [null, null, null, null],
  [null, null, null, null],
  [null, null, null, null],
  [null, null, null, null],
];

// ========================================
// 1手戻す機能
// ========================================

/**
 * 現在の board の深いコピーを返す
 */
function deepCopyBoard(src) {
  return src.map(layer => layer.map(row => row.slice()));
}

/**
 * 初期配置を反映した盤面を返す（8石を配置済み）
 */
function buildInitialBoard() {
  const b = [];
  for (let x = 0; x < size; x++) {
    b[x] = [];
    for (let y = 0; y < size; y++) {
      b[x][y] = new Array(size).fill(null);
    }
  }
  b[1][1][1] = 'black';
  b[2][2][1] = 'black';
  b[2][1][2] = 'black';
  b[1][2][2] = 'black';
  b[1][2][1] = 'white';
  b[2][2][2] = 'white';
  b[1][1][2] = 'white';
  b[2][1][1] = 'white';
  return b;
}

/**
 * 全ての石のメッシュをシーンから削除し、stoneMapをクリアする
 */
function removeAllStones() {
  const toRemove = [];
  scene.traverse(obj => {
    if (obj instanceof THREE.Mesh && obj.geometry.type === "SphereGeometry") {
      toRemove.push(obj);
    }
  });
  toRemove.forEach(obj => scene.remove(obj));
  stoneMap.clear();
}

/**
 * board 配列の内容に従って全ての石を再描画する
 */
function redrawAllStones() {
  removeAllStones();
  for (let x = 0; x < size; x++) {
    for (let y = 0; y < size; y++) {
      for (let z = 0; z < size; z++) {
        const cell = board[x][y][z];
        if (cell !== null) {
          const color = cell === 'black' ? 0x000000 : 0xffffff;
          createStone(x, y, z, color, false);
        }
      }
    }
  }
}

/**
 * 1手戻す（人間の最後の手 + その直後のAIの手 を取り消す）
 *
 * moveHistory の末尾を確認し、
 *   [AIの手] [人間の手]  という順（末尾=AI, その前=人間）であれば
 * その2手分を巻き戻す。
 *
 * パスが含まれる場合もケアする。
 */
function undoLastHumanMove() {
  if (!gameStarted) return;
  if (currentTurn === aiColor) return; // AI思考中は無効
  if (isPassPopupVisible) return;     // パスポップアップ表示中は外部ボタンから呼ばない

  undoCore();
}

/**
 * 実際の巻き戻し処理（パスポップアップ内のボタンからも呼べるコア）
 */
function undoCore() {
  const humanColor = aiColor === 'black' ? 'white' : 'black';

  let stepsToRemove = 0;
  const tmp = [...moveHistory];

  // 末尾がAIの手なら1手除去
  if (tmp.length > 0 && tmp[tmp.length - 1].player === aiColor) {
    stepsToRemove++;
    tmp.pop();
  }

  // その前が人間の手（パス含む）なら更に1手除去
  if (tmp.length > 0 && tmp[tmp.length - 1].player === humanColor) {
    stepsToRemove++;
    tmp.pop();
  }

  if (stepsToRemove === 0) {
    console.log('⚠️ 戻せる手がありません');
    return;
  }

  // ---- 棋譜から除去 ----
  moveHistory.splice(moveHistory.length - stepsToRemove, stepsToRemove);

  // ---- 盤面を棋譜から再構築 ----
  const rebuiltBoard = buildInitialBoard();
  for (const entry of moveHistory) {
    if (entry.pass) continue;
    const [mx, my, mz] = entry.move;
    simulateMoveOnBoard(rebuiltBoard, mx, my, mz, entry.player);
  }

  // board 配列を上書き
  for (let x = 0; x < size; x++) {
    for (let y = 0; y < size; y++) {
      for (let z = 0; z < size; z++) {
        board[x][y][z] = rebuiltBoard[x][y][z];
      }
    }
  }

  // placedStones を再構築（棋譜に記録された着手のみ）
  placedStones.clear();
  for (const entry of moveHistory) {
    if (entry.pass) continue;
    placedStones.add(`${entry.move[0]},${entry.move[1]},${entry.move[2]}`);
  }

  // lastPlacedStone / lastPlacedColor を更新
  const lastMove = moveHistory.filter(e => !e.pass).slice(-1)[0];
  if (lastMove) {
    lastPlacedStone = lastMove.move;
    lastPlacedColor = lastMove.player;
  } else {
    lastPlacedStone = null;
    lastPlacedColor = null;
  }

  // 現在のターンを人間に戻す
  currentTurn = humanColor;

  // waitingPassConfirm をリセット（パス待ち状態を解除）
  waitingPassConfirm = false;

  // ---- 3D表示を更新 ----
  redrawAllStones();
  updateStoneCountDisplay();
  showAllLegalMoves();

  console.log(`✅ 1手戻しました。棋譜残り: ${moveHistory.length}手`);
}

/**
 * simulateMove の盤面専用版（board 引数を直接操作）
 * 既存の simulateMove はグローバルな board を参照するため、
 * 任意の board 配列に対して動作する版を用意する
 */
function simulateMoveOnBoard(boardState, x, y, z, turnColor) {
  const opponent = turnColor === 'black' ? 'white' : 'black';
  boardState[x][y][z] = turnColor;

  for (const [dx, dy, dz] of directions) {
    const stonesToFlip = [];
    let nx = x + dx;
    let ny = y + dy;
    let nz = z + dz;

    while (
      nx >= 0 && nx < 4 &&
      ny >= 0 && ny < 4 &&
      nz >= 0 && nz < 4 &&
      boardState[nx][ny][nz] === opponent
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
      boardState[nx][ny][nz] === turnColor
    ) {
      for (const [fx, fy, fz] of stonesToFlip) {
        boardState[fx][fy][fz] = turnColor;
      }
    }
  }
}

function init() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color('#ccffd0');

  camera = new THREE.PerspectiveCamera(
    45,
    window.innerWidth / window.innerHeight,
    0.1,
    1000
  );
  camera.position.set(10, 10, 10);
  camera.lookAt(0, 0, 0);

    // Renderer
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    document.body.appendChild(renderer.domElement);

    // CSS2DRenderer（ラベル用）
    labelRenderer = new CSS2DRenderer();
    labelRenderer.setSize(window.innerWidth, window.innerHeight);
    labelRenderer.domElement.style.position = 'absolute';
    labelRenderer.domElement.style.top = '0';
    labelRenderer.domElement.style.pointerEvents = 'none';
    document.body.appendChild(labelRenderer.domElement);

    // OrbitControls
    controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(3, 3, 3);
    controls.update();


  const ambientLight = new THREE.AmbientLight(0xffffff, 5);
  scene.add(ambientLight);

  const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
  directionalLight.position.set(10, 10, 10);
  scene.add(directionalLight);

  const axesHelper = new THREE.AxesHelper(10);
  scene.add(axesHelper);

  for (let x = 0; x < size; x++) {
    board[x] = [];
    for (let y = 0; y < size; y++) {
      board[x][y] = [];
      for (let z = 0; z < size; z++) {
        board[x][y][z] = null;
      }
    }
  }

  boardGroup = new THREE.Group();
  const geometry = new THREE.BoxGeometry(1, 1, 1);

  const transparentMaterial = new THREE.MeshBasicMaterial({
    color: 0x000000,
    transparent: true,
    opacity: 0
  });

  const wireframeMaterial = new THREE.MeshBasicMaterial({
    color: 0xaaaaaa,
    wireframe: true
  });

  for (let x = 0; x < size; x++) {
    for (let y = 0; y < size; y++) {
      for (let z = 0; z < size; z++) {
        const cube = new THREE.Mesh(geometry, transparentMaterial);
        const wireframe = new THREE.Mesh(geometry, wireframeMaterial);

        const boxGroup = new THREE.Group();
        boxGroup.add(cube);
        boxGroup.add(wireframe);

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

  const axisLength = 5;

  const xAxisMaterial = new THREE.LineBasicMaterial({ color: 0xff0000 });
  const xAxisGeometry = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(axisLength, 0, 0)
  ]);
  const xAxis = new THREE.Line(xAxisGeometry, xAxisMaterial);
  scene.add(xAxis);

  const yAxisMaterial = new THREE.LineBasicMaterial({ color: 0x00ff00 });
  const yAxisGeometry = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0, axisLength, 0)
  ]);
  const yAxis = new THREE.Line(yAxisGeometry, yAxisMaterial);
  scene.add(yAxis);

  const zAxisMaterial = new THREE.LineBasicMaterial({ color: 0x0000ff });
  const zAxisGeometry = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0, 0, axisLength)
  ]);
  const zAxis = new THREE.Line(zAxisGeometry, zAxisMaterial);
  scene.add(zAxis);

  createAxisLabel('X', (4 + 0.5) * spacing, 0, 0);
  createAxisLabel('Y', 0, (4 + 0.5) * spacing, 0);
  createAxisLabel('Z', 0, 0, (4 + 0.5) * spacing);

  updateStoneCountDisplay();
  animate();
}

function createAxisLabel(text, x, y, z) {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;

  const ctx = canvas.getContext('2d');

  // ★ 背景は何も描かない（完全透明）
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // 黒い文字のみ
  ctx.fillStyle = 'black';
  ctx.font = 'bold 40px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;

  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false // 他の物体に隠れにくくする（任意）
  });

  const sprite = new THREE.Sprite(material);
  sprite.position.set(x, y, z);
  sprite.scale.set(1.2, 1.2, 1.2);

  scene.add(sprite);
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

      if (currentTurn === aiColor) {
        handleAITurn();
      }
    });
  }

  // ========================================
  // 1手戻すボタンのイベントリスナー
  // ========================================
  const undoButton = document.getElementById('undo-button');
  if (undoButton) {
    undoButton.addEventListener('click', () => {
      if (!gameStarted) return;
      if (currentTurn === aiColor) return; // AI思考中は無効

      // 人間の手が1手でも記録されているか確認
      const humanColor = aiColor === 'black' ? 'white' : 'black';
      const humanMoves = moveHistory.filter(e => e.player === humanColor && !e.pass);
      if (humanMoves.length === 0) {
        console.log('⚠️ まだ戻せる人間の手がありません');
        return;
      }

      undoLastHumanMove();
    });
  }
});

function createStone(x, y, z, color, isLastPlaced = false) {
  let finalColor = color;

  if (isLastPlaced) {
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
  stoneMap.set(key, stone);
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
    lastPlacedColor = currentTurn;

    flipStones(x, y, z, currentTurn);
    currentTurn = currentTurn === 'black' ? 'white' : 'black';

    updateStoneCountDisplay();
    showAllLegalMoves();

    if (currentTurn !== aiColor) {
      if (!hasAnyLegalMove(currentTurn)) {
        const otherPlayer = currentTurn === 'black' ? 'white' : 'black';

        if (!hasAnyLegalMove(otherPlayer)) {
          checkGameEnd();
        } else {
          showPassPopup();
        }
        return;
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
    obj.position.distanceTo(targetPosition) < 0.01
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

  if (result.endReasonMessage) {
    const reason = document.createElement('p');
    reason.textContent = result.endReasonMessage;
    reason.style.marginBottom = "10px";
    container.appendChild(reason);
  }

  const text = document.createElement('p');
  text.textContent = `勝者: ${result.result}（黒: ${result.score.black} - 白: ${result.score.white}）`;
  container.appendChild(text);

  const sendBtn = document.createElement('button');
  sendBtn.textContent = '棋譜を送信';
  sendBtn.style.margin = '10px';

  sendBtn.addEventListener('click', () => {
    const kifuRef = ref(database, "kifu");
    const newRef = push(kifuRef);
    set(newRef, result)
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
    location.reload();
  });

  newGameContainer.appendChild(restartBtn);
  document.body.appendChild(newGameContainer);
}

function checkGameEnd() {
  if (!gameStarted) return;

  const totalCells = size * size * size;
  const boardFull = placedStones.size >= totalCells - 8;
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
      endReasonMessage
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

  if (gameStarted === false) return;
  if (!firstPlayer) return;
  if (turnUI && turnUI.style.display !== 'none') return;

  isPassPopupVisible = true;
  passPopup.style.display = 'flex';

  // 画面上の「↩ 1手戻す」ボタンを無効化
  const undoBtn = document.getElementById('undo-button');
  if (undoBtn) undoBtn.disabled = true;
}

function hidePassPopup() {
  document.getElementById('pass-popup').style.display = 'none';
  isPassPopupVisible = false;

  // 画面上の「↩ 1手戻す」ボタンを再度有効化
  const undoBtn = document.getElementById('undo-button');
  if (undoBtn) undoBtn.disabled = false;
}

document.getElementById('pass-ok-button').addEventListener('click', () => {
  hidePassPopup();

  moveHistory.push({ player: currentTurn, pass: true });

  if (lastPlacedStone && lastPlacedColor) {
    const prevColor = lastPlacedColor === 'black' ? 0x000000 : 0xffffff;
    revertPreviousRedStone(prevColor);
  }

  currentTurn = currentTurn === 'black' ? 'white' : 'black';

  if (waitingPassConfirm && currentTurn === aiColor) {
    waitingPassConfirm = false;
    handleAITurn();
  }

  if (!hasAnyLegalMove(currentTurn)) {
    checkGameEnd();
  }
});

// パスポップアップ内の「1手戻す」ボタン
// パスポップアップが出ている = 「パス直前のAI手 + その前の人間手」を取り消したい
document.getElementById('pass-undo-button').addEventListener('click', () => {
  hidePassPopup();
  // パスはまだ棋譜に記録されていないので、そのまま undoCore を呼ぶ
  // → 末尾 = 直前のAI手、その前 = 直前の人間手 を削除してAI2手前に戻る
  undoCore();
});

function updateStoneCountDisplay() {
  const count = countStones();
  const display = document.getElementById('stone-count-display');
  if (display) {
    display.textContent = `黒: ${count.black} ／ 白: ${count.white}`;
  }
}

function showAIPassPopup(message) {
  const existingPopup = document.getElementById("ai-pass-popup");
  if (existingPopup) existingPopup.remove();

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

  requestAnimationFrame(() => {
    popup.style.opacity = "1";
  });

  setTimeout(() => {
    popup.style.opacity = "0";
    setTimeout(() => popup.remove(), 300);
  }, 1500);
}

function generateLegalMoves(color, boardState = board) {
  const legalMoves = [];

  for (let x = 0; x < 4; x++) {
    for (let y = 0; y < 4; y++) {
      for (let z = 0; z < 4; z++) {
        if (isLegalMove(boardState, x, y, z, color)) {
          legalMoves.push([x, y, z]);
        }
      }
    }
  }

  return legalMoves;
}

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
      nx += dx;
      ny += dy;
      nz += dz;
    }

    if (
      stonesToFlip.length > 0 &&
      nx >= 0 && nx < 4 &&
      ny >= 0 && ny < 4 &&
      nz >= 0 && nz < 4 &&
      boardCopy[nx][ny][nz] === turnColor
    ) {
      for (const [fx, fy, fz] of stonesToFlip) {
        boardCopy[fx][fy][fz] = turnColor;
      }
    }
  }
}

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

function isFace(x, y, z) {
  let edgeCount = 0;
  if (x === 0 || x === 3) edgeCount++;
  if (y === 0 || y === 3) edgeCount++;
  if (z === 0 || z === 3) edgeCount++;
  return edgeCount === 1 && !isCornerPosition(x, y, z) && !isEdgePosition(x, y, z);
}

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

function copyBoard(boardState) {
  return boardState.map(layer => layer.map(row => row.slice()));
}

function generateLegalMovesOn(boardState, color) {
  const legalMoves = [];

  for (let x = 0; x < 4; x++) {
    for (let y = 0; y < 4; y++) {
      for (let z = 0; z < 4; z++) {
        if (boardState[x][y][z] === null &&
          isLegalMove(boardState, x, y, z, color)) {
          legalMoves.push([x, y, z]);
        }
      }
    }
  }

  return legalMoves;
}

// ========================================
// カスタム戦略AI実装
// ========================================

// 辺パターン優先度（自分視点: 0=置く場所, 1=相手, 2=自分, -=空き）
const CORNER_EDGE_PATTERNS = [
  '0221', '0112', '0121', '0212', '0211', '0122', '0222',
  '012-', '021-', '022-', '011-', '01-1', '02-1', '01-2', '02-2',
  '0111', '0-12', '0-11', '0-22', '0-21', '01--', '02--',
  '0--1', '0--2', '0-1-', '0---', '0-2-'
];

const EDGE_PATTERNS_HIGH = [
  '1201', '1202', '2102', '2101', '2202', '2011',
  '-202', '-101', '201-', '2201', '1101', '20-1',
  '20--', '210-', '20-2', '220-'
];

// ★ 修正: 禁止パターンは11
const EDGE_PATTERNS_FORBIDDEN = [
  '2-0-', '-0--', '1-0-', '10--', '2-01', '-10-', '-20-',
  '10-1', '110-', '-201', '120-'
];

// 辺の12本を定義
const ALL_EDGES = [
  [[0, 1, 0], [0, 2, 0]], [[3, 1, 0], [3, 2, 0]], [[0, 1, 3], [0, 2, 3]], [[3, 1, 3], [3, 2, 3]],
  [[1, 0, 0], [2, 0, 0]], [[1, 3, 0], [2, 3, 0]], [[1, 0, 3], [2, 0, 3]], [[1, 3, 3], [2, 3, 3]],
  [[0, 0, 1], [0, 0, 2]], [[3, 0, 1], [3, 0, 2]], [[0, 3, 1], [0, 3, 2]], [[3, 3, 1], [3, 3, 2]]
];

const CORNERS = [
  [0, 0, 0], [3, 0, 0], [0, 3, 0], [0, 0, 3],
  [3, 3, 0], [3, 0, 3], [0, 3, 3], [3, 3, 3]
];

// 相手にCornerを取らせるかチェック
function opensCornerForOpponent(boardState, x, y, z, player) {
  const opponent = player === 'black' ? 'white' : 'black';
  const nextBoard = copyBoard(boardState);
  simulateMove(nextBoard, x, y, z, player);

  for (const [cx, cy, cz] of CORNERS) {
    if (nextBoard[cx][cy][cz] === null) {
      if (isLegalMove(nextBoard, cx, cy, cz, opponent)) {
        return true;
      }
    }
  }
  return false;
}

function matchesPattern(pattern, target) {
  if (pattern === target) return true;
  
  // 完全な左右反転
  const reversed = target.split('').reverse().join('');
  return pattern === reversed;
}

function getEdgePattern(boardState, move, player) {
  const [x, y, z] = move;
  const mySymbol = '2';
  const oppSymbol = '1';
  const emptySymbol = '-';

  for (const edgeLine of ALL_EDGES) {
    let foundMove = false;
    let moveIdx = -1;

    for (let i = 0; i < edgeLine.length; i++) {
      const [ex, ey, ez] = edgeLine[i];
      if (ex === x && ey === y && ez === z) {
        foundMove = true;
        moveIdx = i;
        break;
      }
    }

    if (!foundMove) continue;

    const adjacentCorners = [];
    
    for (let edgeIdx = 0; edgeIdx < edgeLine.length; edgeIdx++) {
      const [ex, ey, ez] = edgeLine[edgeIdx];
      
      for (const [cx, cy, cz] of CORNERS) {
        const dist = Math.abs(cx - ex) + Math.abs(cy - ey) + Math.abs(cz - ez);
        if (dist === 1) {
          adjacentCorners[edgeIdx] = [cx, cy, cz];
          break;
        }
      }
    }

    if (adjacentCorners.length !== 2) continue;

    const [c0, c1] = adjacentCorners;
    const [c0x, c0y, c0z] = c0;
    const [c1x, c1y, c1z] = c1;
    
    const c0Sum = c0x + c0y + c0z;
    const c1Sum = c1x + c1y + c1z;
    
    let firstCorner, secondCorner, firstEdge, secondEdge;
    
    if (c0Sum < c1Sum || (c0Sum === c1Sum && (c0x < c1x || (c0x === c1x && (c0y < c1y || (c0y === c1y && c0z < c1z)))))) {
      firstCorner = c0;
      secondCorner = c1;
      if (moveIdx === 0) {
        firstEdge = move;
        secondEdge = edgeLine[1];
      } else {
        firstEdge = edgeLine[0];
        secondEdge = move;
      }
    } else {
      firstCorner = c1;
      secondCorner = c0;
      if (moveIdx === 0) {
        firstEdge = edgeLine[1];
        secondEdge = move;
      } else {
        firstEdge = move;
        secondEdge = edgeLine[0];
      }
    }
    
    const pattern = [];
    
    const [fc_x, fc_y, fc_z] = firstCorner;
    const fcCell = boardState[fc_x][fc_y][fc_z];
    if (fcCell === player) pattern.push(mySymbol);
    else if (fcCell === null) pattern.push(emptySymbol);
    else pattern.push(oppSymbol);
    
    const [fe_x, fe_y, fe_z] = firstEdge;
    if (fe_x === x && fe_y === y && fe_z === z) {
      pattern.push('0');
    } else {
      const feCell = boardState[fe_x][fe_y][fe_z];
      if (feCell === player) pattern.push(mySymbol);
      else if (feCell === null) pattern.push(emptySymbol);
      else pattern.push(oppSymbol);
    }
    
    const [se_x, se_y, se_z] = secondEdge;
    if (se_x === x && se_y === y && se_z === z) {
      pattern.push('0');
    } else {
      const seCell = boardState[se_x][se_y][se_z];
      if (seCell === player) pattern.push(mySymbol);
      else if (seCell === null) pattern.push(emptySymbol);
      else pattern.push(oppSymbol);
    }
    
    const [sc_x, sc_y, sc_z] = secondCorner;
    const scCell = boardState[sc_x][sc_y][sc_z];
    if (scCell === player) pattern.push(mySymbol);
    else if (scCell === null) pattern.push(emptySymbol);
    else pattern.push(oppSymbol);

    const patternStr = pattern.join('');
    console.log(`  ✅ 最終パターン: "${patternStr}"`);
    return patternStr;
  }

  return null;
}

function getSurroundingOccupancy(boardState, x, y, z, player) {
  let myCount = 0;
  let totalCount = 0;

  const faceAxis = (x === 0 || x === 3) ? 0 : (y === 0 || y === 3) ? 1 : (z === 0 || z === 3) ? 2 : -1;
  if (faceAxis === -1) return 0;

  const surroundingOffsets = [
    [-1, -1], [-1, 0], [-1, 1],
    [0, -1], [0, 1],
    [1, -1], [1, 0], [1, 1]
  ];

  for (const [dx, dy] of surroundingOffsets) {
    let nx, ny, nz;
    if (faceAxis === 0) {
      nx = x;
      ny = y + dx;
      nz = z + dy;
    } else if (faceAxis === 1) {
      nx = x + dx;
      ny = y;
      nz = z + dy;
    } else {
      nx = x + dx;
      ny = y + dy;
      nz = z;
    }

    if (nx >= 0 && nx < 4 && ny >= 0 && ny < 4 && nz >= 0 && nz < 4) {
      totalCount++;
      if (boardState[nx][ny][nz] === player) myCount++;
    }
  }

  return totalCount > 0 ? myCount / totalCount : 0;
}

function isForbiddenThirdFaceV2(boardState, x, y, z) {
  if (!isFace(x, y, z)) return false;

  for (let faceIdx = 0; faceIdx < 6; faceIdx++) {
    const fixedAxis = Math.floor(faceIdx / 2);
    const fixedValue = (faceIdx % 2 === 0) ? 0 : 3;

    let belongsToFace = false;
    if (fixedAxis === 0 && x === fixedValue) belongsToFace = true;
    if (fixedAxis === 1 && y === fixedValue) belongsToFace = true;
    if (fixedAxis === 2 && z === fixedValue) belongsToFace = true;

    if (!belongsToFace) continue;

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

function isFaceCompletion4thV2(boardState, x, y, z) {
  if (!isFace(x, y, z)) return false;

  for (let faceIdx = 0; faceIdx < 6; faceIdx++) {
    const fixedAxis = Math.floor(faceIdx / 2);
    const fixedValue = (faceIdx % 2 === 0) ? 0 : 3;

    let belongsToFace = false;
    if (fixedAxis === 0 && x === fixedValue) belongsToFace = true;
    if (fixedAxis === 1 && y === fixedValue) belongsToFace = true;
    if (fixedAxis === 2 && z === fixedValue) belongsToFace = true;

    if (!belongsToFace) continue;

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

    if (filledFaces === 3) return true;
  }

  return false;
}

function isExclusiveMove(boardState, move, player, afterMyMove) {
  const [x, y, z] = move;
  const opponent = player === 'black' ? 'white' : 'black';
  
  if (!isLegalMove(boardState, x, y, z, player)) return false;
  if (isLegalMove(boardState, x, y, z, opponent)) return false;
  
  if (isLegalMove(afterMyMove, x, y, z, opponent)) return false;
  
  const opponentMoves = generateLegalMovesOn(afterMyMove, opponent);
  
  if (opponentMoves.length === 0) {
    return isLegalMove(afterMyMove, x, y, z, player);
  }
  
  for (const oppMove of opponentMoves) {
    const afterOppBoard = copyBoard(afterMyMove);
    simulateMove(afterOppBoard, oppMove[0], oppMove[1], oppMove[2], opponent);
    
    if (!isLegalMove(afterOppBoard, x, y, z, player)) {
      return false;
    }
  }
  
  return true;
}

function filterByExclusiveRule(boardState, player, candidateMoves = null) {
  const myMoves = candidateMoves || generateLegalMovesOn(boardState, player);
  
  if (myMoves.length <= 1) {
    return myMoves;
  }
  
  const opponent = player === 'black' ? 'white' : 'black';
  const opponentMoves = generateLegalMovesOn(boardState, opponent);
  
  const sharedMoves = [];
  const exclusiveMovesList = [];
  
  for (const move of myMoves) {
    const isShared = opponentMoves.some(
      ([ox, oy, oz]) => ox === move[0] && oy === move[1] && oz === move[2]
    );
    
    if (isShared) {
      sharedMoves.push(move);
    } else {
      exclusiveMovesList.push(move);
    }
  }
  
  if (sharedMoves.length === 0 || exclusiveMovesList.length === 0) {
    return myMoves;
  }
  
  const safeMoves = [];
  
  for (const sharedMove of sharedMoves) {
    const [sx, sy, sz] = sharedMove;
    
    const afterSharedBoard = copyBoard(boardState);
    simulateMove(afterSharedBoard, sx, sy, sz, player);
    
    let isSafe = true;
    
    for (const [ex, ey, ez] of exclusiveMovesList) {
      if (isLegalMove(afterSharedBoard, ex, ey, ez, opponent)) {
        isSafe = false;
        break;
      }
      
      const oppMoves = generateLegalMovesOn(afterSharedBoard, opponent);
      for (const oppMove of oppMoves) {
        const afterOppBoard = copyBoard(afterSharedBoard);
        simulateMove(afterOppBoard, oppMove[0], oppMove[1], oppMove[2], opponent);
        
        if (!isLegalMove(afterOppBoard, ex, ey, ez, player)) {
          isSafe = false;
          break;
        }
      }
      
      if (!isSafe) break;
    }
    
    if (isSafe) {
      safeMoves.push(sharedMove);
    }
  }
  
  if (safeMoves.length > 0) {
    console.log(`✅ 専用マスルール適用: ${safeMoves.length}個の安全な共有マスを優先`);
    return safeMoves;
  }
  
  console.log(`⚠️ 専用マスルール: 安全な共有マスなし → 元の候補を使用`);
  return myMoves;
}


function isFaceThirdException(boardState, x, y, z, player) {
  if (!isFace(x, y, z)) return false;
  
  const opponent = player === 'black' ? 'white' : 'black';
  
  for (let faceIdx = 0; faceIdx < 6; faceIdx++) {
    const fixedAxis = Math.floor(faceIdx / 2);
    const fixedValue = (faceIdx % 2 === 0) ? 0 : 3;
    
    let belongsToFace = false;
    if (fixedAxis === 0 && x === fixedValue) belongsToFace = true;
    if (fixedAxis === 1 && y === fixedValue) belongsToFace = true;
    if (fixedAxis === 2 && z === fixedValue) belongsToFace = true;
    
    if (!belongsToFace) continue;
    
    const facePositions = [];
    for (let i = 1; i <= 2; i++) {
      for (let j = 1; j <= 2; j++) {
        let px, py, pz;
        if (fixedAxis === 0) { px = fixedValue; py = i; pz = j; }
        else if (fixedAxis === 1) { px = i; py = fixedValue; pz = j; }
        else { px = i; py = j; pz = fixedValue; }
        
        facePositions.push([px, py, pz]);
      }
    }
    
    let filledCount = 0;
    let lastEmptyPos = null;
    
    for (const [px, py, pz] of facePositions) {
      if (boardState[px][py][pz] !== null) {
        filledCount++;
      } else if (px === x && py === y && pz === z) {
        filledCount++;
      } else {
        lastEmptyPos = [px, py, pz];
      }
    }
    
    if (filledCount !== 3 || !lastEmptyPos) continue;
    
    const [lx, ly, lz] = lastEmptyPos;
    
    const afterMyMove = copyBoard(boardState);
    simulateMove(afterMyMove, x, y, z, player);
    
    if (isLegalMove(afterMyMove, lx, ly, lz, opponent)) {
      continue;
    }
    
    const opponentMoves = generateLegalMovesOn(afterMyMove, opponent);
    
    if (opponentMoves.length === 0) {
      if (isLegalMove(afterMyMove, lx, ly, lz, player)) {
        return true;
      }
      continue;
    }
    
    let allPathsValid = true;
    
    for (const oppMove of opponentMoves) {
      const afterOppBoard = copyBoard(afterMyMove);
      simulateMove(afterOppBoard, oppMove[0], oppMove[1], oppMove[2], opponent);
      
      if (!isLegalMove(afterOppBoard, lx, ly, lz, player)) {
        allPathsValid = false;
        break;
      }
    }
    
    if (allPathsValid) {
      return true;
    }
  }
  
  return false;
}

function isForbiddenThirdFaceV3(boardState, x, y, z, player) {
  if (!isForbiddenThirdFaceV2(boardState, x, y, z)) {
    return false;
  }
  
  if (isFaceThirdException(boardState, x, y, z, player)) {
    console.log(`✅ Face 3つ目例外許可: [${x},${y},${z}]`);
    return false;
  }
  
  return true;
}

function isFaceFirstOrSecond(boardState, x, y, z) {
  if (!isFace(x, y, z)) return false;

  for (let faceIdx = 0; faceIdx < 6; faceIdx++) {
    const fixedAxis = Math.floor(faceIdx / 2);
    const fixedValue = (faceIdx % 2 === 0) ? 0 : 3;

    let belongsToFace = false;
    if (fixedAxis === 0 && x === fixedValue) belongsToFace = true;
    if (fixedAxis === 1 && y === fixedValue) belongsToFace = true;
    if (fixedAxis === 2 && z === fixedValue) belongsToFace = true;

    if (!belongsToFace) continue;

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

    if (filledFaces === 0 || filledFaces === 1) return true;
  }

  return false;
}

// ========================================
// メインAI関数（完全条件分岐版）
// ========================================
function selectMoveCustom(boardState, player) {
  let legalMoves = generateLegalMoves(player, boardState);
  if (legalMoves.length === 0) return null;

  let emptyCount = 0;
  for (let x = 0; x < 4; x++) {
    for (let y = 0; y < 4; y++) {
      for (let z = 0; z < 4; z++) {
        if (boardState[x][y][z] === null) emptyCount++;
      }
    }
  }

  if (emptyCount <= 10) {
    console.log('🔍 完全読み切りモード（新ルール無効化）');
    const move = completeSearch(boardState, player);
    if (move) return move;
  }

  const originalLegalMoves = [...legalMoves];
  legalMoves = legalMoves.filter(([x, y, z]) => 
    !isForbiddenThirdFaceV3(boardState, x, y, z, player)
  );
  
  if (legalMoves.length === 0) {
    console.warn('⚠️ Face 3つ目除外で全滅 → 元の合法手を使用');
    legalMoves = originalLegalMoves;
  }

  const nonForbiddenMoves = legalMoves.filter(move => 
    !isForbiddenEdge(boardState, move, player)
  );
  const workingMoves = nonForbiddenMoves.length > 0 ? nonForbiddenMoves : legalMoves;

  const bestCorner = findBestCorner(boardState, workingMoves, player);
  if (bestCorner) return bestCorner;

  const bestSafeEdge = findBestSafeEdge(boardState, workingMoves, player);
  if (bestSafeEdge) return bestSafeEdge;

  const bestSafeFace = findBestSafeFace(boardState, workingMoves, player);
  if (bestSafeFace) return bestSafeFace;

  const bestDangerousFace = findBestDangerousFace(boardState, workingMoves, player);
  if (bestDangerousFace) return bestDangerousFace;

  const bestDangerousEdge = findBestDangerousEdge(boardState, workingMoves, player);
  if (bestDangerousEdge) return bestDangerousEdge;

  const otherMoves = workingMoves.filter(([x, y, z]) => 
    !isCornerPosition(x, y, z) && !isEdgePosition(x, y, z) && !isFace(x, y, z)
  );
  
  if (otherMoves.length > 0) {
    const filteredOther = filterByExclusiveRule(boardState, player, otherMoves);
    
    const scored = filteredOther.map(move => ({
      move,
      occupancy: getSurroundingOccupancy(boardState, move[0], move[1], move[2], player)
    }));
    scored.sort((a, b) => b.occupancy - a.occupancy);
    return scored[0].move;
  }

  return workingMoves[0];
}

function findBestCorner(boardState, moves, player) {
  const cornerMoves = moves.filter(([x, y, z]) => isCornerPosition(x, y, z));
  if (cornerMoves.length === 0) return null;

  for (const targetPattern of CORNER_EDGE_PATTERNS) {
    const matchingCorners = [];
    
    for (const move of cornerMoves) {
      const pattern = getEdgePattern(boardState, move, player);
      if (!pattern) continue;
      
      if (matchesPattern(pattern, targetPattern)) {
        if (!opensCornerForOpponent(boardState, move[0], move[1], move[2], player)) {
          matchingCorners.push(move);
        }
      }
    }
    
    if (matchingCorners.length > 0) {
      const filtered = filterByExclusiveRule(boardState, player, matchingCorners);
      return filtered[0];
    }
  }

  for (const targetPattern of CORNER_EDGE_PATTERNS) {
    const matchingCorners = [];
    
    for (const move of cornerMoves) {
      const pattern = getEdgePattern(boardState, move, player);
      if (!pattern) continue;
      
      if (matchesPattern(pattern, targetPattern)) {
        matchingCorners.push(move);
      }
    }
    
    if (matchingCorners.length > 0) {
      const filtered = filterByExclusiveRule(boardState, player, matchingCorners);
      return filtered[0];
    }
  }

  const filtered = filterByExclusiveRule(boardState, player, cornerMoves);
  return filtered[0];
}

function findBestSafeEdge(boardState, moves, player) {
  const edgeMoves = moves.filter(([x, y, z]) => isEdgePosition(x, y, z));
  const safeEdges = edgeMoves.filter(([x, y, z]) => !opensCornerForOpponent(boardState, x, y, z, player));
  
  if (safeEdges.length === 0) return null;

  for (const targetPattern of EDGE_PATTERNS_HIGH) {
    const matchingEdges = [];
    
    for (const move of safeEdges) {
      const pattern = getEdgePattern(boardState, move, player);
      if (!pattern) continue;
      
      if (matchesPattern(pattern, targetPattern)) {
        matchingEdges.push(move);
      }
    }
    
    if (matchingEdges.length > 0) {
      const filtered = filterByExclusiveRule(boardState, player, matchingEdges);
      return filtered[0];
    }
  }

  const filtered = filterByExclusiveRule(boardState, player, safeEdges);
  return filtered[0];
}

function findBestSafeFace(boardState, moves, player) {
  const faceMoves = moves.filter(([x, y, z]) => isFace(x, y, z));
  const safeFaces = faceMoves.filter(([x, y, z]) => !opensCornerForOpponent(boardState, x, y, z, player));
  
  if (safeFaces.length === 0) return null;

  const completion4th = safeFaces.filter(([x, y, z]) => 
    isFaceCompletion4thV2(boardState, x, y, z)
  );
  if (completion4th.length > 0) {
    const filtered = filterByExclusiveRule(boardState, player, completion4th);
    return filtered[0];
  }

  const firstOrSecond = safeFaces.filter(([x, y, z]) => isFaceFirstOrSecond(boardState, x, y, z));
  if (firstOrSecond.length > 0) {
    const filtered = filterByExclusiveRule(boardState, player, firstOrSecond);
    
    const scored = filtered.map(move => ({
      move,
      occupancy: getSurroundingOccupancy(boardState, move[0], move[1], move[2], player)
    }));
    scored.sort((a, b) => b.occupancy - a.occupancy);
    return scored[0].move;
  }

  const filtered = filterByExclusiveRule(boardState, player, safeFaces);
  
  const scored = filtered.map(move => ({
    move,
    occupancy: getSurroundingOccupancy(boardState, move[0], move[1], move[2], player)
  }));
  scored.sort((a, b) => b.occupancy - a.occupancy);
  return scored[0].move;
}

function findBestDangerousFace(boardState, moves, player) {
  const faceMoves = moves.filter(([x, y, z]) => isFace(x, y, z));
  
  if (faceMoves.length === 0) return null;

  const filtered = filterByExclusiveRule(boardState, player, faceMoves);
  
  const scored = filtered.map(move => ({
    move,
    occupancy: getSurroundingOccupancy(boardState, move[0], move[1], move[2], player)
  }));
  scored.sort((a, b) => b.occupancy - a.occupancy);
  return scored[0].move;
}

function findBestDangerousEdge(boardState, moves, player) {
  const edgeMoves = moves.filter(([x, y, z]) => isEdgePosition(x, y, z));
  
  if (edgeMoves.length === 0) return null;

  for (const targetPattern of EDGE_PATTERNS_HIGH) {
    const matchingEdges = [];
    
    for (const move of edgeMoves) {
      const pattern = getEdgePattern(boardState, move, player);
      if (!pattern) continue;
      
      if (matchesPattern(pattern, targetPattern)) {
        matchingEdges.push(move);
      }
    }
    
    if (matchingEdges.length > 0) {
      const filtered = filterByExclusiveRule(boardState, player, matchingEdges);
      return filtered[0];
    }
  }

  const filtered = filterByExclusiveRule(boardState, player, edgeMoves);
  return filtered[0];
}

function isForbiddenEdge(boardState, move, player) {
  const [x, y, z] = move;
  
  if (!isEdgePosition(x, y, z)) {
    console.log(`⚪ [${x},${y},${z}] はEdgeではない`);
    return false;
  }
  
  const pattern = getEdgePattern(boardState, move, player);
  console.log(`🔍 [${x},${y},${z}] のパターン: "${pattern}"`);
  
  if (!pattern) {
    console.log(`⚠️ [${x},${y},${z}] パターン取得失敗`);
    return false;
  }
  
  for (const forbiddenPattern of EDGE_PATTERNS_FORBIDDEN) {
    const matches = matchesPattern(pattern, forbiddenPattern);
    if (matches) {
      console.log(`🚫 禁止Edge検出: [${x},${y},${z}] パターン="${pattern}" 禁止="${forbiddenPattern}"`);
      return true;
    }
  }
  
  console.log(`✅ [${x},${y},${z}] パターン="${pattern}" は禁止されていない`);
  return false;
}

function completeSearch(boardState, player) {
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
    if (s.black > s.white) return rootPlayer === 'black' ? 10000 : -10000;
    if (s.white > s.black) return rootPlayer === 'white' ? 10000 : -10000;
    return 0;
  }

  function solve(board, turn, root, alpha, beta, depth) {
    if (depth > 20) return { score: 0, move: null };
    
    const moves = generateLegalMovesOn(board, turn);
    const other = turn === 'black' ? 'white' : 'black';

    if (isBoardFull(board)) {
      return { score: finalResult(board, root), move: null };
    }

    const oppMoves = generateLegalMovesOn(board, other);
    if (moves.length === 0 && oppMoves.length === 0) {
      return { score: finalResult(board, root), move: null };
    }

    if (moves.length === 0) {
      return solve(board, other, root, alpha, beta, depth + 1);
    }

    let bestMove = moves[0];
    let bestScore = (turn === root) ? -99999 : 99999;

    for (const m of moves) {
      const b2 = copyBoard(board);
      simulateMove(b2, m[0], m[1], m[2], turn);

      const r = solve(b2, other, root, alpha, beta, depth + 1);
      const score = r.score;

      if (turn === root) {
        if (score > bestScore) {
          bestScore = score;
          bestMove = m;
        }
        alpha = Math.max(alpha, bestScore);
        if (alpha >= beta) break;
      } else {
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

  const result = solve(boardState, player, player, -99999, 99999, 0);
  return result.move;
}

function canDeferToMove(boardState, highPriorityMove, lowPriorityMove, player) {
  const opponent = player === 'black' ? 'white' : 'black';

  const nextBoard = copyBoard(boardState);
  simulateMove(nextBoard, lowPriorityMove[0], lowPriorityMove[1], lowPriorityMove[2], player);

  const oppMoves = generateLegalMovesOn(nextBoard, opponent);
  for (const oppMove of oppMoves) {
    if (oppMove[0] === lowPriorityMove[0] && 
        oppMove[1] === lowPriorityMove[1] && 
        oppMove[2] === lowPriorityMove[2]) {
      return false;
    }
  }

  for (const oppMove of oppMoves) {
    const afterOppBoard = copyBoard(nextBoard);
    simulateMove(afterOppBoard, oppMove[0], oppMove[1], oppMove[2], opponent);

    if (!isLegalMove(afterOppBoard, highPriorityMove[0], highPriorityMove[1], highPriorityMove[2], player)) {
      return false;
    }
  }

  return true;
}




function handleAITurn() {
  if (currentTurn !== aiColor) return;

  showAILoadingIndicator();

  setTimeout(() => {
    if (!hasAnyLegalMove(aiColor)) {
      hideAILoadingIndicator();

      const other = aiColor === 'black' ? 'white' : 'black';

      if (!hasAnyLegalMove(other)) {
        checkGameEnd();
        return;
      }

      if (lastPlacedStone && lastPlacedColor) {
        const prevColor = lastPlacedColor === 'black' ? 0x000000 : 0xffffff;
        revertPreviousRedStone(prevColor);
      }

      moveHistory.push({ player: aiColor, pass: true });
      showAIPassPopup("AIはパスしました");

      currentTurn = other;
      showAllLegalMoves();
      return;
    }

    const move = selectMoveCustom(board, aiColor);

    if (!move) {
      hideAILoadingIndicator();
      currentTurn = aiColor === 'black' ? 'white' : 'black';
      showAllLegalMoves();
      return;
    }

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

    if (!hasAnyLegalMove(currentTurn)) {
      const other = currentTurn === 'black' ? 'white' : 'black';

      if (!hasAnyLegalMove(other)) {
        checkGameEnd();
        return;
      }

      waitingPassConfirm = true;
      showPassPopup();
      return;
    }

    checkGameEnd();
  }, 500);
}
