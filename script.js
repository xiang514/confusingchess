"use strict";

const Core = window.XiangqiCore;
const {
  ROWS,
  COLS,
  SIDES,
  SYMBOLS,
  PIECE_NAMES,
  createInitialGame,
  applyMove,
  getLegalMovesForPiece,
  cloneGame,
  getCellLabel,
} = Core;

const STORAGE_KEYS = {
  roomId: "xiangqi.roomId",
  name: "xiangqi.name",
  accessKey: "xiangqi.accessKey",
  sessionId: "xiangqi.sessionId",
};

const elements = {
  board: document.getElementById("board"),
  canvas: document.getElementById("boardCanvas"),
  grid: document.getElementById("boardGrid"),
  redPlayer: document.getElementById("redPlayer"),
  blackPlayer: document.getElementById("blackPlayer"),
  redName: document.getElementById("redName"),
  blackName: document.getElementById("blackName"),
  redMeta: document.getElementById("redMeta"),
  blackMeta: document.getElementById("blackMeta"),
  turnTitle: document.getElementById("turnTitle"),
  gameStatus: document.getElementById("gameStatus"),
  redCaptured: document.getElementById("redCaptured"),
  blackCaptured: document.getElementById("blackCaptured"),
  moveLog: document.getElementById("moveLog"),
  moveCount: document.getElementById("moveCount"),
  resetBtn: document.getElementById("resetBtn"),
  undoBtn: document.getElementById("undoBtn"),
  connectForm: document.getElementById("connectForm"),
  nameInput: document.getElementById("nameInput"),
  roomInput: document.getElementById("roomInput"),
  accessKeyInput: document.getElementById("accessKeyInput"),
  connectBtn: document.getElementById("connectBtn"),
  disconnectBtn: document.getElementById("disconnectBtn"),
  copyLinkBtn: document.getElementById("copyLinkBtn"),
  connectionBadge: document.getElementById("connectionBadge"),
  seatInfo: document.getElementById("seatInfo"),
};

const state = {
  game: createInitialGame(),
  selected: null,
  legalTargets: [],
  history: [],
  notice: "",
  connection: {
    ws: null,
    connected: false,
    roomId: "",
    side: null,
    revision: 0,
    canUndo: false,
    players: {
      red: { connected: false, name: "" },
      black: { connected: false, name: "" },
    },
    status: "未连接",
    statusKind: "offline",
  },
};

initConnectionForm();
bindEvents();
render();

function initConnectionForm() {
  const params = new URLSearchParams(window.location.search);
  const roomId = params.get("room") || localStorage.getItem(STORAGE_KEYS.roomId) || "home";
  const name = localStorage.getItem(STORAGE_KEYS.name) || "";
  const accessKey = localStorage.getItem(STORAGE_KEYS.accessKey) || "";
  const sessionId = localStorage.getItem(STORAGE_KEYS.sessionId) || createSessionId();

  localStorage.setItem(STORAGE_KEYS.sessionId, sessionId);
  elements.roomInput.value = roomId;
  elements.nameInput.value = name;
  elements.accessKeyInput.value = accessKey;
  state.connection.roomId = roomId;
}

function bindEvents() {
  elements.connectForm.addEventListener("submit", connectOnline);
  elements.disconnectBtn.addEventListener("click", disconnectOnline);
  elements.copyLinkBtn.addEventListener("click", copyInviteLink);
  elements.resetBtn.addEventListener("click", resetGame);
  elements.undoBtn.addEventListener("click", undoMove);
  window.addEventListener("resize", drawBoard);
}

function render() {
  drawBoard();
  renderBoardGrid();
  renderPanels();
  renderConnectionPanel();
}

function drawBoard() {
  const rect = elements.board.getBoundingClientRect();
  const width = rect.width;
  const height = rect.height;
  if (!width || !height) {
    return;
  }

  const dpr = window.devicePixelRatio || 1;
  elements.canvas.width = Math.round(width * dpr);
  elements.canvas.height = Math.round(height * dpr);
  elements.canvas.style.width = `${width}px`;
  elements.canvas.style.height = `${height}px`;

  const ctx = elements.canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);

  const cellW = width / COLS;
  const cellH = height / ROWS;
  const x = (col) => cellW * (col + 0.5);
  const y = (row) => cellH * (row + 0.5);

  ctx.strokeStyle = "#5f321b";
  ctx.lineWidth = Math.max(1.25, width * 0.0024);
  ctx.lineCap = "round";

  for (let row = 0; row < ROWS; row += 1) {
    drawLine(ctx, x(0), y(row), x(8), y(row));
  }

  for (let col = 0; col < COLS; col += 1) {
    if (col === 0 || col === COLS - 1) {
      drawLine(ctx, x(col), y(0), x(col), y(9));
    } else {
      drawLine(ctx, x(col), y(0), x(col), y(4));
      drawLine(ctx, x(col), y(5), x(col), y(9));
    }
  }

  ctx.lineWidth = Math.max(1.4, width * 0.003);
  drawLine(ctx, x(3), y(0), x(5), y(2));
  drawLine(ctx, x(5), y(0), x(3), y(2));
  drawLine(ctx, x(3), y(7), x(5), y(9));
  drawLine(ctx, x(5), y(7), x(3), y(9));

  ctx.save();
  ctx.fillStyle = "rgba(82, 45, 22, 0.24)";
  ctx.font = `700 ${Math.max(18, width * 0.045)}px "STKaiti", "Kaiti SC", "KaiTi", serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("楚河", x(2.2), (y(4) + y(5)) / 2);
  ctx.fillText("漢界", x(5.8), (y(4) + y(5)) / 2);
  ctx.restore();
}

function drawLine(ctx, x1, y1, x2, y2) {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

function renderBoardGrid() {
  elements.grid.innerHTML = "";
  const targetSet = new Map(state.legalTargets.map((target) => [`${target.row},${target.col}`, target]));
  const game = state.game;

  for (let row = 0; row < ROWS; row += 1) {
    for (let col = 0; col < COLS; col += 1) {
      const cell = document.createElement("button");
      const key = `${row},${col}`;
      const piece = game.board[row][col];
      const target = targetSet.get(key);
      cell.type = "button";
      cell.className = "cell";
      cell.dataset.row = String(row);
      cell.dataset.col = String(col);
      cell.setAttribute("aria-label", getCellLabel(row, col, piece));

      if (state.selected && state.selected.row === row && state.selected.col === col) {
        cell.classList.add("selected");
      }

      if (target) {
        cell.classList.add(target.capture ? "target-capture" : "target-empty");
      }

      if (game.lastMove) {
        if (game.lastMove.from.row === row && game.lastMove.from.col === col) {
          cell.classList.add("last-from");
        }
        if (game.lastMove.to.row === row && game.lastMove.to.col === col) {
          cell.classList.add("last-to");
        }
      }

      if (piece) {
        const pieceEl = document.createElement("span");
        pieceEl.className = `piece ${piece.side}`;
        pieceEl.textContent = SYMBOLS[piece.side][piece.type];
        pieceEl.title = `${SIDES[piece.side].label}${PIECE_NAMES[piece.type]}`;
        cell.appendChild(pieceEl);
      }

      cell.addEventListener("click", () => handleCellClick(row, col));
      elements.grid.appendChild(cell);
    }
  }
}

function renderPanels() {
  const game = state.game;
  const currentSide = SIDES[game.currentSide];

  if (state.connection.connected && state.connection.side) {
    elements.turnTitle.textContent = game.gameOver
      ? "对局结束"
      : game.currentSide === state.connection.side
        ? "轮到你"
        : `等待${SIDES[game.currentSide].label}`;
  } else {
    elements.turnTitle.textContent = game.gameOver
      ? "对局结束"
      : `${currentSide.player} · ${currentSide.label}`;
  }

  elements.gameStatus.textContent = state.notice || game.status;

  elements.redPlayer.classList.toggle("active", game.currentSide === "red" && !game.gameOver);
  elements.blackPlayer.classList.toggle("active", game.currentSide === "black" && !game.gameOver);
  elements.redPlayer.classList.toggle("you", state.connection.side === "red");
  elements.blackPlayer.classList.toggle("you", state.connection.side === "black");

  renderPlayerLabel("red");
  renderPlayerLabel("black");
  renderCaptured(elements.redCaptured, game.captured.red);
  renderCaptured(elements.blackCaptured, game.captured.black);

  elements.moveCount.textContent = `${game.moveLog.length} 手`;
  elements.moveLog.innerHTML = "";
  game.moveLog.forEach((entry) => {
    const item = document.createElement("li");
    const sideSpan = document.createElement("span");
    sideSpan.className = `side-${entry.side}`;
    sideSpan.textContent = entry.side === "red" ? "红" : "黑";
    item.append(sideSpan, document.createTextNode(` ${entry.text}`));
    elements.moveLog.appendChild(item);
  });

  elements.undoBtn.disabled = state.connection.connected
    ? !state.connection.canUndo
    : state.history.length === 0;
}

function renderPlayerLabel(side) {
  const player = state.connection.players[side];
  const nameEl = side === "red" ? elements.redName : elements.blackName;
  const metaEl = side === "red" ? elements.redMeta : elements.blackMeta;
  const defaultName = side === "red" ? "玩家1" : "玩家2";
  const bits = [SIDES[side].label];

  if (state.connection.connected) {
    bits.push(player.connected ? "在线" : "离线");
    if (state.connection.side === side) {
      bits.push("你");
    }
  }

  nameEl.textContent = player.name || defaultName;
  metaEl.textContent = bits.join(" · ");
}

function renderConnectionPanel() {
  const connection = state.connection;
  elements.connectionBadge.textContent = connection.status;
  elements.connectionBadge.className = `connection-badge ${connection.statusKind}`;

  const seatText = connection.connected && connection.side
    ? `${connection.roomId} · 你执${SIDES[connection.side].label}`
    : `${elements.roomInput.value.trim() || "home"} · 本机对弈`;
  elements.seatInfo.textContent = seatText;

  elements.connectBtn.disabled = connection.connected && connection.statusKind === "online";
  elements.disconnectBtn.disabled = !connection.ws;
}

function renderCaptured(container, pieces) {
  container.innerHTML = "";
  if (!pieces.length) {
    const empty = document.createElement("span");
    empty.className = "empty-captures";
    empty.textContent = "暂无";
    container.appendChild(empty);
    return;
  }

  pieces.forEach((piece) => {
    const pieceEl = document.createElement("span");
    pieceEl.className = `captured-piece ${piece.side}`;
    pieceEl.textContent = SYMBOLS[piece.side][piece.type];
    pieceEl.title = `${SIDES[piece.side].label}${PIECE_NAMES[piece.type]}`;
    container.appendChild(pieceEl);
  });
}

function handleCellClick(row, col) {
  const game = state.game;
  if (game.gameOver) {
    return;
  }

  const piece = game.board[row][col];
  if (state.selected) {
    const target = state.legalTargets.find((move) => move.row === row && move.col === col);
    if (target) {
      requestMove(state.selected, target);
      return;
    }

    if (piece && canControlPiece(piece)) {
      selectPiece(row, col);
      return;
    }

    clearSelection();
    render();
    return;
  }

  if (piece && canControlPiece(piece)) {
    selectPiece(row, col);
    return;
  }

  if (state.connection.connected && piece && piece.side !== state.connection.side) {
    state.notice = "只能移动自己一方的棋子";
    renderPanels();
  }
}

function canControlPiece(piece) {
  if (piece.side !== state.game.currentSide) {
    return false;
  }
  return !state.connection.connected || piece.side === state.connection.side;
}

function selectPiece(row, col) {
  const piece = state.game.board[row][col];
  const moves = getLegalMovesForPiece(state.game.board, row, col);
  state.selected = { row, col };
  state.legalTargets = moves;
  state.notice = moves.length
    ? `${SIDES[piece.side].label}选择 ${SYMBOLS[piece.side][piece.type]}`
    : `${SYMBOLS[piece.side][piece.type]} 暂无合法走法`;
  render();
}

function clearSelection() {
  state.selected = null;
  state.legalTargets = [];
  state.notice = "";
}

function requestMove(from, to) {
  if (state.connection.connected) {
    sendOnline({
      type: "move",
      from,
      to: { row: to.row, col: to.col },
      revision: state.connection.revision,
    });
    clearSelection();
    state.notice = "正在同步棋局";
    render();
    return;
  }

  state.history.push(cloneGame(state.game));
  const result = applyMove(state.game, from, to);
  if (result.ok) {
    state.game = result.game;
    clearSelection();
  } else {
    state.history.pop();
    state.notice = result.error;
  }
  render();
}

function undoMove() {
  if (state.connection.connected) {
    sendOnline({ type: "undo" });
    return;
  }

  const snapshot = state.history.pop();
  if (!snapshot) {
    return;
  }

  state.game = snapshot;
  clearSelection();
  render();
}

function resetGame() {
  if (state.connection.connected) {
    sendOnline({ type: "reset" });
    return;
  }

  state.game = createInitialGame();
  state.history = [];
  clearSelection();
  render();
}

function connectOnline(event) {
  event.preventDefault();
  const roomId = cleanRoomId(elements.roomInput.value);
  const accessKey = elements.accessKeyInput.value.trim();
  const name = elements.nameInput.value.trim();

  if (!accessKey) {
    setConnectionStatus("缺少口令", "error");
    return;
  }

  localStorage.setItem(STORAGE_KEYS.roomId, roomId);
  localStorage.setItem(STORAGE_KEYS.accessKey, accessKey);
  localStorage.setItem(STORAGE_KEYS.name, name);
  state.connection.roomId = roomId;
  state.notice = "";

  if (state.connection.ws) {
    state.connection.ws.close();
  }

  const ws = new WebSocket(getWebSocketUrl());
  state.connection.ws = ws;
  setConnectionStatus("连接中", "pending");

  ws.addEventListener("open", () => {
    sendOnline({
      type: "join",
      roomId,
      accessKey,
      name,
      sessionId: localStorage.getItem(STORAGE_KEYS.sessionId),
    });
  });

  ws.addEventListener("message", (messageEvent) => {
    let message;
    try {
      message = JSON.parse(messageEvent.data);
    } catch {
      setConnectionStatus("消息错误", "error");
      return;
    }
    handleServerMessage(message);
  });

  ws.addEventListener("close", () => {
    state.connection.ws = null;
    state.connection.connected = false;
    state.connection.side = null;
    state.connection.canUndo = false;
    setConnectionStatus("已断开", "offline");
  });

  ws.addEventListener("error", () => {
    setConnectionStatus("连接失败", "error");
  });
}

function disconnectOnline() {
  if (state.connection.ws) {
    state.connection.ws.close();
  }
  state.connection.ws = null;
  state.connection.connected = false;
  state.connection.side = null;
  state.connection.canUndo = false;
  setConnectionStatus("未连接", "offline");
}

function handleServerMessage(message) {
  if (message.type === "error") {
    state.notice = message.message;
    setConnectionStatus("操作失败", "error");
    render();
    return;
  }

  if (message.type !== "state") {
    return;
  }

  state.game = message.game;
  state.history = [];
  state.selected = null;
  state.legalTargets = [];
  state.notice = "";
  state.connection.connected = true;
  state.connection.roomId = message.roomId;
  state.connection.revision = message.revision;
  state.connection.canUndo = Boolean(message.canUndo);
  state.connection.players = message.players;
  state.connection.side = message.you.side;
  localStorage.setItem(STORAGE_KEYS.sessionId, message.you.sessionId);
  setConnectionStatus("已连接", "online");
  render();
}

function sendOnline(payload) {
  const ws = state.connection.ws;
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    setConnectionStatus("未连接", "offline");
    return;
  }
  ws.send(JSON.stringify(payload));
}

async function copyInviteLink() {
  const roomId = cleanRoomId(elements.roomInput.value);
  const inviteUrl = new URL(window.location.href);
  inviteUrl.searchParams.set("room", roomId);

  try {
    await navigator.clipboard.writeText(inviteUrl.toString());
    state.notice = "房间链接已复制";
  } catch {
    state.notice = inviteUrl.toString();
  }
  renderPanels();
}

function setConnectionStatus(status, kind) {
  state.connection.status = status;
  state.connection.statusKind = kind;
  renderConnectionPanel();
}

function getWebSocketUrl() {
  if (window.location.protocol === "https:") {
    return `wss://${window.location.host}/ws`;
  }
  if (window.location.host) {
    return `ws://${window.location.host}/ws`;
  }
  return "ws://localhost:3000/ws";
}

function cleanRoomId(value) {
  const roomId = String(value || "home")
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .slice(0, 32);
  return roomId || "home";
}

function createSessionId() {
  if (window.crypto && window.crypto.randomUUID) {
    return window.crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
