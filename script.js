"use strict";

const SUPABASE_URL = "https://ikuqyslgfbabixyitzws.supabase.co";
const SUPABASE_KEY = "sb_publishable_6SYKOcW0fzIKUEMomMJ5iw_NtVm-GaY";

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

const supabaseClient = window.supabase
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY)
  : null;

const STORAGE_KEYS = {
  roomId: "xiangqi.roomId",
  name: "xiangqi.name",
  email: "xiangqi.email",
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
  signupBtn: document.getElementById("signupBtn"),
  nameInput: document.getElementById("nameInput"),
  emailInput: document.getElementById("emailInput"),
  passwordInput: document.getElementById("passwordInput"),
  roomInput: document.getElementById("roomInput"),
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
    channel: null,
    connected: false,
    busy: false,
    roomId: "",
    roomUuid: null,
    userId: null,
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
restoreSession();
render();

function initConnectionForm() {
  const params = new URLSearchParams(window.location.search);
  const roomId = params.get("room") || localStorage.getItem(STORAGE_KEYS.roomId) || "home";
  const name = localStorage.getItem(STORAGE_KEYS.name) || "";
  const email = localStorage.getItem(STORAGE_KEYS.email) || "";

  elements.roomInput.value = roomId;
  elements.nameInput.value = name;
  elements.emailInput.value = email;
  state.connection.roomId = roomId;
}

function bindEvents() {
  elements.connectForm.addEventListener("submit", connectOnline);
  elements.signupBtn.addEventListener("click", registerAccount);
  elements.disconnectBtn.addEventListener("click", disconnectOnline);
  elements.copyLinkBtn.addEventListener("click", copyInviteLink);
  elements.resetBtn.addEventListener("click", resetGame);
  elements.undoBtn.addEventListener("click", undoMove);
  window.addEventListener("resize", drawBoard);
}

async function restoreSession() {
  if (!supabaseClient) {
    setConnectionStatus("联机组件未加载", "error");
    return;
  }

  const { data } = await supabaseClient.auth.getSession();
  const user = data.session && data.session.user;
  if (user) {
    state.connection.userId = user.id;
    setConnectionStatus("已登录", "pending");
  }
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
    ? !state.connection.canUndo || state.connection.busy
    : state.history.length === 0;
}

function renderPlayerLabel(side) {
  const player = state.connection.players[side];
  const nameEl = side === "red" ? elements.redName : elements.blackName;
  const metaEl = side === "red" ? elements.redMeta : elements.blackMeta;
  const defaultName = side === "red" ? "玩家1" : "玩家2";
  const bits = [SIDES[side].label];

  if (state.connection.connected) {
    bits.push(player.connected ? "已加入" : "空位");
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

  let seatText = `${elements.roomInput.value.trim() || "home"} · 本机对弈`;
  if (connection.connected && connection.side) {
    seatText = `${connection.roomId} · 你执${SIDES[connection.side].label}`;
  } else if (connection.userId) {
    seatText = `${elements.roomInput.value.trim() || "home"} · 已登录`;
  }
  elements.seatInfo.textContent = seatText;

  elements.signupBtn.disabled = connection.busy || connection.connected;
  elements.connectBtn.disabled = connection.busy || (connection.connected && connection.statusKind === "online");
  elements.disconnectBtn.disabled = connection.busy || (!connection.connected && !connection.userId);
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
  if (game.gameOver || state.connection.busy) {
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

async function requestMove(from, to) {
  if (state.connection.connected) {
    if (!state.connection.roomUuid || !state.connection.side) {
      state.notice = "尚未进入房间";
      renderPanels();
      return;
    }

    if (state.game.currentSide !== state.connection.side) {
      state.notice = "还没轮到你";
      renderPanels();
      return;
    }

    const previousGame = cloneGame(state.game);
    const result = applyMove(state.game, from, to);
    if (!result.ok) {
      state.notice = result.error;
      render();
      return;
    }

    clearSelection();
    await saveRoomState(result.game, [...state.history, previousGame], "正在同步棋局");
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

async function undoMove() {
  if (state.connection.connected) {
    const previousGame = state.history[state.history.length - 1];
    if (!previousGame) {
      state.notice = "没有可悔的棋";
      renderPanels();
      return;
    }
    await saveRoomState(previousGame, state.history.slice(0, -1), "正在悔棋");
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

async function resetGame() {
  if (state.connection.connected) {
    await saveRoomState(createInitialGame(), [], "正在重新开始");
    return;
  }

  state.game = createInitialGame();
  state.history = [];
  clearSelection();
  render();
}

async function connectOnline(event) {
  event.preventDefault();
  if (!supabaseClient) {
    setConnectionStatus("联机组件未加载", "error");
    return;
  }

  const authValues = getAuthValues();
  if (!authValues) {
    return;
  }

  setBusy(true);
  setConnectionStatus("登录中", "pending");
  try {
    const { data, error } = await supabaseClient.auth.signInWithPassword({
      email: authValues.email,
      password: authValues.password,
    });
    if (error) {
      throw error;
    }

    state.connection.userId = data.user.id;
    persistForm(authValues);
    await enterRoom(authValues);
  } catch (error) {
    handleOnlineError(error, "登录失败，请检查邮箱和密码");
  } finally {
    setBusy(false);
  }
}

async function registerAccount() {
  if (!supabaseClient) {
    setConnectionStatus("联机组件未加载", "error");
    return;
  }

  const authValues = getAuthValues();
  if (!authValues) {
    return;
  }

  setBusy(true);
  setConnectionStatus("注册中", "pending");
  try {
    const { data, error } = await supabaseClient.auth.signUp({
      email: authValues.email,
      password: authValues.password,
      options: {
        data: {
          display_name: authValues.name,
        },
      },
    });
    if (error) {
      throw error;
    }

    persistForm(authValues);
    if (data.session && data.user) {
      state.connection.userId = data.user.id;
      await enterRoom(authValues);
      return;
    }

    state.notice = "注册成功，请先去邮箱确认账号，再回来点击进入";
    setConnectionStatus("等待邮箱确认", "pending");
    render();
  } catch (error) {
    handleOnlineError(error, "注册失败");
  } finally {
    setBusy(false);
  }
}

async function enterRoom(authValues) {
  const roomId = cleanRoomId(authValues.roomId);
  setConnectionStatus("进入房间中", "pending");

  const { data, error } = await supabaseClient.rpc("join_chess_room", {
    requested_room_slug: roomId,
    player_name: authValues.name,
  });
  if (error) {
    throw error;
  }

  const seat = firstRow(data);
  if (!seat || !seat.room_id || !seat.side) {
    throw new Error("房间返回数据异常");
  }

  state.connection.connected = true;
  state.connection.roomId = roomId;
  state.connection.roomUuid = seat.room_id;
  state.connection.side = seat.side;
  state.notice = "";

  await stopRealtime();
  await refreshRoom();
  await refreshMembers();
  startRealtime(seat.room_id);
  setConnectionStatus("已连接", "online");

  if (!state.game || !state.game.board) {
    await saveRoomState(createInitialGame(), [], "初始化棋局");
  }
  render();
}

async function disconnectOnline() {
  setBusy(true);
  try {
    await stopRealtime();
    if (supabaseClient) {
      await supabaseClient.auth.signOut();
    }
  } finally {
    state.connection.connected = false;
    state.connection.userId = null;
    state.connection.side = null;
    state.connection.roomUuid = null;
    state.connection.canUndo = false;
    state.connection.players = {
      red: { connected: false, name: "" },
      black: { connected: false, name: "" },
    };
    setConnectionStatus("未连接", "offline");
    setBusy(false);
    render();
  }
}

async function saveRoomState(game, history, pendingText) {
  if (!state.connection.roomUuid) {
    state.notice = "尚未进入房间";
    renderPanels();
    return;
  }

  setBusy(true);
  state.notice = pendingText;
  render();

  try {
    const { data, error } = await supabaseClient.rpc("update_chess_room_state", {
      target_room_id: state.connection.roomUuid,
      expected_revision: state.connection.revision,
      new_game_state: game,
      new_history: history,
    });
    if (error) {
      throw error;
    }

    applyRemoteRoom(firstRow(data) || data);
    setConnectionStatus("已连接", "online");
  } catch (error) {
    handleOnlineError(error, "同步失败");
    await refreshRoom();
  } finally {
    setBusy(false);
  }
}

function startRealtime(roomUuid) {
  if (!supabaseClient) {
    return;
  }

  state.connection.channel = supabaseClient
    .channel(`chess-room-${roomUuid}`)
    .on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: "chess_rooms",
        filter: `id=eq.${roomUuid}`,
      },
      (payload) => {
        applyRemoteRoom(payload.new);
      },
    )
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "chess_room_members",
        filter: `room_id=eq.${roomUuid}`,
      },
      () => {
        refreshMembers();
      },
    )
    .subscribe((status) => {
      if (status === "SUBSCRIBED" && state.connection.connected) {
        setConnectionStatus("已连接", "online");
      }
    });
}

async function stopRealtime() {
  if (supabaseClient && state.connection.channel) {
    await supabaseClient.removeChannel(state.connection.channel);
  }
  state.connection.channel = null;
}

async function refreshRoom() {
  if (!state.connection.roomUuid) {
    return;
  }

  const { data, error } = await supabaseClient
    .from("chess_rooms")
    .select("id, slug, game_state, history, revision")
    .eq("id", state.connection.roomUuid)
    .single();

  if (error) {
    throw error;
  }

  applyRemoteRoom(data);
}

async function refreshMembers() {
  if (!state.connection.roomUuid) {
    return;
  }

  const { data, error } = await supabaseClient
    .from("chess_room_members")
    .select("side, display_name, user_id")
    .eq("room_id", state.connection.roomUuid);

  if (error) {
    throw error;
  }

  state.connection.players = summarizeMembers(data || []);
  renderPanels();
}

function applyRemoteRoom(room) {
  if (!room) {
    return;
  }

  state.game = normalizeGame(room.game_state);
  state.history = Array.isArray(room.history) ? room.history : [];
  state.connection.revision = Number(room.revision || 0);
  state.connection.canUndo = state.history.length > 0;
  state.selected = null;
  state.legalTargets = [];
  state.notice = "";
  render();
}

function normalizeGame(value) {
  if (value && Array.isArray(value.board) && value.board.length === ROWS) {
    return value;
  }
  return createInitialGame();
}

function summarizeMembers(members) {
  return {
    red: summarizeMember(members.find((member) => member.side === "red")),
    black: summarizeMember(members.find((member) => member.side === "black")),
  };
}

function summarizeMember(member) {
  if (!member) {
    return { connected: false, name: "" };
  }
  return {
    connected: true,
    name: member.display_name || "",
  };
}

function getAuthValues() {
  const email = elements.emailInput.value.trim();
  const password = elements.passwordInput.value;
  const name = elements.nameInput.value.trim().slice(0, 16) || "棋友";
  const roomId = cleanRoomId(elements.roomInput.value);

  if (!email || !email.includes("@")) {
    state.notice = "请填写邮箱";
    setConnectionStatus("缺少邮箱", "error");
    render();
    return null;
  }

  if (password.length < 6) {
    state.notice = "密码至少 6 位";
    setConnectionStatus("密码太短", "error");
    render();
    return null;
  }

  return { email, password, name, roomId };
}

function persistForm(values) {
  localStorage.setItem(STORAGE_KEYS.roomId, values.roomId);
  localStorage.setItem(STORAGE_KEYS.name, values.name);
  localStorage.setItem(STORAGE_KEYS.email, values.email);
  state.connection.roomId = values.roomId;
}

function handleOnlineError(error, fallbackMessage) {
  const message = getErrorMessage(error, fallbackMessage);
  state.notice = message;
  setConnectionStatus("操作失败", "error");
  render();
}

function getErrorMessage(error, fallbackMessage) {
  const rawMessage = String((error && error.message) || fallbackMessage || "操作失败");

  if (rawMessage.includes("Invalid login credentials")) {
    return "登录失败，请检查邮箱和密码；还没有账号请先注册";
  }

  if (rawMessage.includes("Email not confirmed")) {
    return "邮箱还没有确认，请先打开验证邮件";
  }

  if (rawMessage.includes("room_full")) {
    return "这个房间已经有两名玩家";
  }

  if (rawMessage.includes("not_room_member")) {
    return "你不是这个房间的玩家";
  }

  if (rawMessage.includes("revision_conflict")) {
    return "棋局刚刚更新，请重新走这一步";
  }

  if (rawMessage.includes("Could not find the function")) {
    return "Supabase 数据库还没有初始化，请先执行 supabase-schema.sql";
  }

  return rawMessage || fallbackMessage;
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

function firstRow(data) {
  return Array.isArray(data) ? data[0] : data;
}

function setBusy(isBusy) {
  state.connection.busy = isBusy;
  renderConnectionPanel();
}

function setConnectionStatus(status, kind) {
  state.connection.status = status;
  state.connection.statusKind = kind;
  renderConnectionPanel();
}

function cleanRoomId(value) {
  const roomId = String(value || "home")
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .slice(0, 32);
  return roomId || "home";
}
