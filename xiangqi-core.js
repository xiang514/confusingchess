(function initXiangqiCore(root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.XiangqiCore = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : window, function createCore() {
  "use strict";

  const ROWS = 10;
  const COLS = 9;

  const SIDES = {
    red: {
      player: "玩家1",
      label: "红方",
      className: "red",
    },
    black: {
      player: "玩家2",
      label: "黑方",
      className: "black",
    },
  };

  const SYMBOLS = {
    red: {
      king: "帥",
      mountedKing: "驭帅",
      advisor: "仕",
      elephant: "相",
      horse: "傌",
      rook: "俥",
      cannon: "炮",
      soldier: "兵",
    },
    black: {
      king: "將",
      mountedKing: "驭将",
      advisor: "士",
      elephant: "象",
      horse: "馬",
      rook: "車",
      cannon: "砲",
      soldier: "卒",
    },
  };

  const PIECE_NAMES = {
    king: "将帅",
    mountedKing: "驭将帅",
    advisor: "士仕",
    elephant: "象相",
    horse: "马",
    rook: "车",
    cannon: "炮",
    soldier: "兵卒",
  };

  const FILE_NAMES = ["一", "二", "三", "四", "五", "六", "七", "八", "九"];

  function createInitialBoard() {
    const board = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
    let pieceId = 0;
    const set = (row, col, side, type) => {
      pieceId += 1;
      board[row][col] = { id: `${side}-${type}-${pieceId}`, side, type };
    };

    const backRank = ["rook", "horse", "elephant", "advisor", "king", "advisor", "elephant", "horse", "rook"];
    backRank.forEach((type, col) => set(0, col, "black", type));
    set(2, 1, "black", "cannon");
    set(2, 7, "black", "cannon");
    [0, 2, 4, 6, 8].forEach((col) => set(3, col, "black", "soldier"));

    backRank.forEach((type, col) => set(9, col, "red", type));
    set(7, 1, "red", "cannon");
    set(7, 7, "red", "cannon");
    [0, 2, 4, 6, 8].forEach((col) => set(6, col, "red", "soldier"));

    return board;
  }

  function createInitialGame() {
    return {
      board: createInitialBoard(),
      currentSide: "red",
      captured: {
        red: [],
        black: [],
      },
      moveLog: [],
      lastMove: null,
      gameOver: false,
      winner: null,
      status: "红方先行",
      specials: createInitialSpecials(),
    };
  }

  function createInitialSpecials() {
    return {
      red: { dongfengUsed: false },
      black: { dongfengUsed: false },
    };
  }

  function applyMove(game, from, to, options = {}) {
    const validFrom = normalizePoint(from);
    const validTo = normalizePoint(to);
    if (!validFrom || !validTo) {
      return { ok: false, error: "坐标无效" };
    }

    if (game.gameOver) {
      return { ok: false, error: "对局已经结束" };
    }

    const mode = options.mode || "normal";
    const nextGame = cloneGame(game);
    const piece = nextGame.board[validFrom.row][validFrom.col];
    if (!piece) {
      return { ok: false, error: "起点没有棋子" };
    }

    if (piece.side !== nextGame.currentSide) {
      return { ok: false, error: "还没轮到这方走棋" };
    }

    if (mode === "dongfeng") {
      return applyDongfengMove(nextGame, validFrom, validTo, piece);
    }

    const legalTarget = getLegalMovesForPiece(nextGame.board, validFrom.row, validFrom.col)
      .find((move) => move.row === validTo.row && move.col === validTo.col);
    if (!legalTarget) {
      return { ok: false, error: "不符合棋规" };
    }

    const captured = nextGame.board[validTo.row][validTo.col];
    nextGame.board[validTo.row][validTo.col] = piece;
    nextGame.board[validFrom.row][validFrom.col] = null;
    nextGame.lastMove = {
      from: { ...validFrom },
      to: { ...validTo },
    };

    if (captured) {
      nextGame.captured[piece.side].push({ ...captured });
    }

    nextGame.moveLog.unshift({
      side: piece.side,
      text: formatMove(piece, validFrom, validTo, captured),
    });

    return finishTurn(nextGame, piece.side, captured);
  }

  function applyDongfengMove(nextGame, from, to, piece) {
    if (piece.type !== "cannon") {
      return { ok: false, error: "只有炮可以改装为东风炮" };
    }

    if (!canUseDongfeng(nextGame, piece.side)) {
      return { ok: false, error: "本方本局已经使用过东风炮" };
    }

    const legalTarget = getDongfengTargets(nextGame, from.row, from.col)
      .find((move) => move.row === to.row && move.col === to.col);
    if (!legalTarget) {
      return { ok: false, error: "东风炮只能直线吃到目标，不能空走" };
    }

    const captured = nextGame.board[to.row][to.col];
    nextGame.board[from.row][from.col] = null;
    nextGame.board[to.row][to.col] = null;
    nextGame.specials[piece.side].dongfengUsed = true;
    nextGame.lastMove = {
      from: { ...from },
      to: { ...to },
      mode: "dongfeng",
    };
    nextGame.captured[piece.side].push({ ...captured });
    nextGame.moveLog.unshift({
      side: piece.side,
      text: `东风炮 ${formatPoint(from)} → ${formatPoint(to)} 吃 ${SYMBOLS[captured.side][captured.type]} 后报废`,
    });

    return finishTurn(nextGame, piece.side, captured);
  }

  function applyHorseMount(game, horsePoint) {
    const validHorse = normalizePoint(horsePoint);
    if (!validHorse) {
      return { ok: false, error: "坐标无效" };
    }

    if (game.gameOver) {
      return { ok: false, error: "对局已经结束" };
    }

    const nextGame = cloneGame(game);
    const side = nextGame.currentSide;
    if (!isInCheck(nextGame.board, side)) {
      return { ok: false, error: "只有被将军时才能翻身上马" };
    }

    const mountOption = getHorseMountOptions(nextGame, side)
      .find((option) => option.row === validHorse.row && option.col === validHorse.col);
    if (!mountOption) {
      return { ok: false, error: "这匹马不能接应将帅" };
    }

    const royal = nextGame.board[mountOption.king.row][mountOption.king.col];
    const horse = nextGame.board[validHorse.row][validHorse.col];
    nextGame.board[validHorse.row][validHorse.col] = {
      ...royal,
      type: "mountedKing",
      mountedHorseId: horse.id,
    };
    nextGame.board[mountOption.king.row][mountOption.king.col] = null;
    nextGame.lastMove = {
      from: { ...mountOption.king },
      to: { ...validHorse },
      mode: "mount",
    };
    nextGame.moveLog.unshift({
      side,
      text: `翻身上马 ${SYMBOLS[side].king} ${formatPoint(mountOption.king)} → ${formatPoint(validHorse)}`,
    });

    if (isInCheck(nextGame.board, side)) {
      return { ok: false, error: "上马后仍会被将军" };
    }

    return finishTurn(nextGame, side, null);
  }

  function finishTurn(nextGame, movingSide, captured) {
    if (captured && isRoyal(captured)) {
      nextGame.gameOver = true;
      nextGame.winner = movingSide;
      nextGame.status = `${SIDES[movingSide].player} · ${SIDES[movingSide].label}获胜`;
      return { ok: true, game: nextGame, captured };
    }

    if (areRoyalsFacing(nextGame.board)) {
      const winner = oppositeSide(movingSide);
      nextGame.gameOver = true;
      nextGame.winner = winner;
      nextGame.status = `${SIDES[movingSide].player}主动造成将帅碰面，${SIDES[winner].player}获胜`;
      return { ok: true, game: nextGame, captured };
    }

    nextGame.currentSide = oppositeSide(movingSide);
    const checked = isInCheck(nextGame.board, nextGame.currentSide);
    const hasMove = hasAnyLegalMove(nextGame, nextGame.currentSide);

    if (!hasMove) {
      nextGame.gameOver = true;
      nextGame.winner = movingSide;
      nextGame.status = checked
        ? `${SIDES[movingSide].player} 将死获胜`
        : `${SIDES[nextGame.currentSide].label}无棋可走，${SIDES[movingSide].player}获胜`;
    } else {
      nextGame.status = checked
        ? `${SIDES[nextGame.currentSide].player} · ${SIDES[nextGame.currentSide].label}被将军`
        : `${SIDES[nextGame.currentSide].player}走棋`;
    }

    return { ok: true, game: nextGame, captured };
  }

  function getLegalMovesForPiece(board, row, col) {
    const piece = board[row] && board[row][col];
    if (!piece) {
      return [];
    }

    return getPseudoMoves(board, row, col).filter((move) => {
      const nextBoard = cloneBoard(board);
      nextBoard[move.row][move.col] = nextBoard[row][col];
      nextBoard[row][col] = null;
      return !isInCheck(nextBoard, piece.side);
    });
  }

  function getPseudoMoves(board, row, col) {
    const piece = board[row] && board[row][col];
    if (!piece) {
      return [];
    }

    switch (piece.type) {
      case "king":
        return getKingMoves(board, row, col, piece.side);
      case "mountedKing":
        return getHorseMoves(board, row, col, piece.side);
      case "advisor":
        return getAdvisorMoves(board, row, col, piece.side);
      case "elephant":
        return getElephantMoves(board, row, col, piece.side);
      case "horse":
        return getHorseMoves(board, row, col, piece.side);
      case "rook":
        return getRookMoves(board, row, col, piece.side);
      case "cannon":
        return getCannonMoves(board, row, col, piece.side);
      case "soldier":
        return getSoldierMoves(board, row, col, piece.side);
      default:
        return [];
    }
  }

  function getKingMoves(board, row, col, side) {
    const moves = [];
    [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
    ].forEach(([dr, dc]) => {
      const nextRow = row + dr;
      const nextCol = col + dc;
      if (isInPalace(side, nextRow, nextCol)) {
        pushMoveIfAvailable(moves, board, nextRow, nextCol, side);
      }
    });

    return moves;
  }

  function getAdvisorMoves(board, row, col, side) {
    const moves = [];
    [
      [-1, -1],
      [-1, 1],
      [1, -1],
      [1, 1],
    ].forEach(([dr, dc]) => {
      const nextRow = row + dr;
      const nextCol = col + dc;
      if (isInPalace(side, nextRow, nextCol)) {
        pushMoveIfAvailable(moves, board, nextRow, nextCol, side);
      }
    });
    return moves;
  }

  function getElephantMoves(board, row, col, side) {
    const moves = [];
    [
      [-2, -2],
      [-2, 2],
      [2, -2],
      [2, 2],
    ].forEach(([dr, dc]) => {
      const nextRow = row + dr;
      const nextCol = col + dc;
      const eyeRow = row + dr / 2;
      const eyeCol = col + dc / 2;
      if (isInside(nextRow, nextCol) && !board[eyeRow][eyeCol]) {
        pushMoveIfAvailable(moves, board, nextRow, nextCol, side);
      }
    });
    return moves;
  }

  function getHorseMoves(board, row, col, side) {
    const moves = [];
    getHorsePatterns().forEach(([dr, dc, blockRow, blockCol]) => {
      const nextRow = row + dr;
      const nextCol = col + dc;
      if (
        isInside(nextRow, nextCol) &&
        staysOnOwnSide(side, nextRow) &&
        !board[row + blockRow][col + blockCol]
      ) {
        pushMoveIfAvailable(moves, board, nextRow, nextCol, side);
      }
    });
    return moves;
  }

  function getHorsePatterns() {
    return [
      [-2, -1, -1, 0],
      [-2, 1, -1, 0],
      [2, -1, 1, 0],
      [2, 1, 1, 0],
      [-1, -2, 0, -1],
      [1, -2, 0, -1],
      [-1, 2, 0, 1],
      [1, 2, 0, 1],
    ];
  }

  function getRookMoves(board, row, col, side) {
    return getLineMoves(board, row, col, side, false);
  }

  function getCannonMoves(board, row, col, side) {
    return getLineMoves(board, row, col, side, true);
  }

  function getLineMoves(board, row, col, side, cannonMode) {
    const moves = [];
    [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
    ].forEach(([dr, dc]) => {
      let nextRow = row + dr;
      let nextCol = col + dc;
      let hasScreen = false;

      while (isInside(nextRow, nextCol)) {
        const target = board[nextRow][nextCol];
        if (!cannonMode) {
          if (!pushLineMove(moves, target, nextRow, nextCol, side)) {
            break;
          }
        } else if (!hasScreen) {
          if (target) {
            hasScreen = true;
          } else {
            moves.push({ row: nextRow, col: nextCol, capture: false });
          }
        } else if (target) {
          if (target.side !== side) {
            moves.push({ row: nextRow, col: nextCol, capture: true });
          }
          break;
        }

        nextRow += dr;
        nextCol += dc;
      }
    });

    return moves;
  }

  function getDongfengTargets(game, row, col) {
    const board = game.board || game;
    const piece = board[row] && board[row][col];
    if (!piece || piece.type !== "cannon" || !canUseDongfeng(game, piece.side)) {
      return [];
    }

    const moves = [];
    [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
    ].forEach(([dr, dc]) => {
      let nextRow = row + dr;
      let nextCol = col + dc;

      while (isInside(nextRow, nextCol)) {
        const target = board[nextRow][nextCol];
        if (target) {
          if (target.side !== piece.side) {
            const nextBoard = cloneBoard(board);
            nextBoard[row][col] = null;
            nextBoard[nextRow][nextCol] = null;
            if (!isInCheck(nextBoard, piece.side)) {
              moves.push({ row: nextRow, col: nextCol, capture: true, mode: "dongfeng" });
            }
          }
          break;
        }

        nextRow += dr;
        nextCol += dc;
      }
    });

    return moves;
  }

  function getSoldierMoves(board, row, col, side) {
    const moves = [];
    const forward = side === "red" ? -1 : 1;
    pushMoveIfAvailable(moves, board, row + forward, col, side);

    if (hasCrossedRiver(side, row)) {
      pushMoveIfAvailable(moves, board, row, col - 1, side);
      pushMoveIfAvailable(moves, board, row, col + 1, side);
    }

    return moves;
  }

  function getHorseMountOptions(game, side = game.currentSide) {
    const board = game.board || game;
    if (!isInCheck(board, side)) {
      return [];
    }

    const king = findRoyal(board, side);
    if (!king) {
      return [];
    }

    const royal = board[king.row][king.col];
    if (!royal || royal.type !== "king") {
      return [];
    }

    const options = [];
    for (let row = 0; row < ROWS; row += 1) {
      for (let col = 0; col < COLS; col += 1) {
        const piece = board[row][col];
        if (!piece || piece.side !== side || piece.type !== "horse") {
          continue;
        }

        if (!canHorseReachPoint(board, row, col, king.row, king.col, side)) {
          continue;
        }

        const nextBoard = cloneBoard(board);
        nextBoard[row][col] = { ...royal, type: "mountedKing", mountedHorseId: piece.id };
        nextBoard[king.row][king.col] = null;
        if (!isInCheck(nextBoard, side)) {
          options.push({ row, col, king: { ...king }, mode: "mount" });
        }
      }
    }

    return options;
  }

  function canHorseReachPoint(board, row, col, targetRow, targetCol, side) {
    return getHorsePatterns().some(([dr, dc, blockRow, blockCol]) => {
      return (
        row + dr === targetRow &&
        col + dc === targetCol &&
        staysOnOwnSide(side, targetRow) &&
        !board[row + blockRow][col + blockCol]
      );
    });
  }

  function pushLineMove(moves, target, row, col, side) {
    if (!target) {
      moves.push({ row, col, capture: false });
      return true;
    }

    if (target.side !== side) {
      moves.push({ row, col, capture: true });
    }
    return false;
  }

  function pushMoveIfAvailable(moves, board, row, col, side) {
    if (!isInside(row, col)) {
      return;
    }
    const target = board[row][col];
    if (!target || target.side !== side) {
      moves.push({ row, col, capture: Boolean(target) });
    }
  }

  function isInCheck(board, side) {
    const king = findRoyal(board, side);
    if (!king) {
      return true;
    }

    const enemySide = oppositeSide(side);
    for (let row = 0; row < ROWS; row += 1) {
      for (let col = 0; col < COLS; col += 1) {
        const piece = board[row][col];
        if (!piece || piece.side !== enemySide) {
          continue;
        }

        const attacks = getPseudoMoves(board, row, col);
        if (attacks.some((move) => move.row === king.row && move.col === king.col)) {
          return true;
        }
      }
    }

    return false;
  }

  function hasAnyLegalMove(gameOrBoard, side) {
    const board = Array.isArray(gameOrBoard) ? gameOrBoard : gameOrBoard.board;
    const game = Array.isArray(gameOrBoard) ? { board, currentSide: side } : gameOrBoard;
    for (let row = 0; row < ROWS; row += 1) {
      for (let col = 0; col < COLS; col += 1) {
        const piece = board[row][col];
        if (piece && piece.side === side && getLegalMovesForPiece(board, row, col).length > 0) {
          return true;
        }
      }
    }
    if (hasAnyDongfengMove(game, side)) {
      return true;
    }
    return getHorseMountOptions(game, side).length > 0;
  }

  function hasAnyDongfengMove(game, side) {
    if (!canUseDongfeng(game, side)) {
      return false;
    }

    const board = game.board || game;
    for (let row = 0; row < ROWS; row += 1) {
      for (let col = 0; col < COLS; col += 1) {
        const piece = board[row][col];
        if (
          piece &&
          piece.side === side &&
          piece.type === "cannon" &&
          getDongfengTargets(game, row, col).length > 0
        ) {
          return true;
        }
      }
    }

    return false;
  }

  function findRoyal(board, side) {
    for (let row = 0; row < ROWS; row += 1) {
      for (let col = 0; col < COLS; col += 1) {
        const piece = board[row][col];
        if (piece && piece.side === side && isRoyal(piece)) {
          return { row, col };
        }
      }
    }
    return null;
  }

  function findKing(board, side) {
    return findRoyal(board, side);
  }

  function isRoyal(piece) {
    return piece && (piece.type === "king" || piece.type === "mountedKing");
  }

  function areRoyalsFacing(board) {
    const redKing = findRoyal(board, "red");
    const blackKing = findRoyal(board, "black");
    if (!redKing || !blackKing || redKing.col !== blackKing.col) {
      return false;
    }

    const start = Math.min(redKing.row, blackKing.row) + 1;
    const end = Math.max(redKing.row, blackKing.row);
    for (let row = start; row < end; row += 1) {
      if (board[row][redKing.col]) {
        return false;
      }
    }
    return true;
  }

  function canUseDongfeng(game, side = game.currentSide) {
    const specials = normalizeSpecials(game.specials);
    return (side === "red" || side === "black") && !specials[side].dongfengUsed;
  }

  function normalizePoint(point) {
    if (!point) {
      return null;
    }
    const row = Number(point.row);
    const col = Number(point.col);
    if (!Number.isInteger(row) || !Number.isInteger(col) || !isInside(row, col)) {
      return null;
    }
    return { row, col };
  }

  function isInside(row, col) {
    return row >= 0 && row < ROWS && col >= 0 && col < COLS;
  }

  function isInPalace(side, row, col) {
    if (col < 3 || col > 5) {
      return false;
    }
    return side === "red" ? row >= 7 && row <= 9 : row >= 0 && row <= 2;
  }

  function staysOnOwnSide(side, row) {
    return side === "red" ? row >= 5 : row <= 4;
  }

  function hasCrossedRiver(side, row) {
    return side === "red" ? row <= 4 : row >= 5;
  }

  function oppositeSide(side) {
    return side === "red" ? "black" : "red";
  }

  function cloneBoard(board) {
    return board.map((row) => row.map((piece) => (piece ? { ...piece } : null)));
  }

  function cloneMove(move) {
    if (!move) {
      return null;
    }
    return {
      from: { ...move.from },
      to: { ...move.to },
      mode: move.mode || null,
    };
  }

  function cloneGame(game) {
    return {
      board: cloneBoard(game.board),
      currentSide: game.currentSide,
      captured: {
        red: (game.captured && game.captured.red ? game.captured.red : []).map((piece) => ({ ...piece })),
        black: (game.captured && game.captured.black ? game.captured.black : []).map((piece) => ({ ...piece })),
      },
      moveLog: (game.moveLog || []).map((entry) => ({ ...entry })),
      lastMove: cloneMove(game.lastMove),
      gameOver: Boolean(game.gameOver),
      winner: game.winner || null,
      status: game.status || "",
      specials: normalizeSpecials(game.specials),
    };
  }

  function normalizeSpecials(specials) {
    return {
      red: { dongfengUsed: Boolean(specials && specials.red && specials.red.dongfengUsed) },
      black: { dongfengUsed: Boolean(specials && specials.black && specials.black.dongfengUsed) },
    };
  }

  function formatMove(piece, from, to, captured) {
    const symbol = SYMBOLS[piece.side][piece.type];
    const captureText = captured ? ` 吃 ${SYMBOLS[captured.side][captured.type]}` : "";
    return `${symbol} ${formatPoint(from)} → ${formatPoint(to)}${captureText}`;
  }

  function formatPoint(point) {
    return `${FILE_NAMES[point.col]}路${10 - point.row}`;
  }

  function getCellLabel(row, col, piece) {
    const point = formatPoint({ row, col });
    if (!piece) {
      return `${point} 空位`;
    }
    return `${point} ${SIDES[piece.side].label}${PIECE_NAMES[piece.type]}`;
  }

  return {
    ROWS,
    COLS,
    SIDES,
    SYMBOLS,
    PIECE_NAMES,
    FILE_NAMES,
    createInitialBoard,
    createInitialGame,
    applyMove,
    applyHorseMount,
    getLegalMovesForPiece,
    getDongfengTargets,
    getHorseMountOptions,
    canUseDongfeng,
    isInCheck,
    hasAnyLegalMove,
    areRoyalsFacing,
    cloneBoard,
    cloneGame,
    cloneMove,
    formatMove,
    formatPoint,
    getCellLabel,
    normalizePoint,
    oppositeSide,
  };
});
