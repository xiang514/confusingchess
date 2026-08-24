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
      cavalry: "骑兵",
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
      cavalry: "骑兵",
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
    cavalry: "骑兵",
    rook: "车",
    cannon: "炮",
    soldier: "兵卒",
  };

  const FILE_NAMES = ["一", "二", "三", "四", "五", "六", "七", "八", "九"];

  function createInitialBoard() {
    const board = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
    const soldiers = {
      red: [],
      black: [],
    };
    let pieceId = 0;
    const set = (row, col, side, type) => {
      pieceId += 1;
      const piece = { id: `${side}-${type}-${pieceId}`, side, type };
      if (type === "horse") {
        piece.home = { row, col };
      }
      board[row][col] = piece;
      if (type === "soldier") {
        soldiers[side].push(piece);
      }
      return piece;
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

    markRandomFlatFooted(soldiers.red);
    markRandomFlatFooted(soldiers.black);

    return board;
  }

  function markRandomFlatFooted(pieces) {
    if (!pieces.length) {
      return;
    }
    const index = Math.floor(Math.random() * pieces.length);
    pieces[index].flatFooted = true;
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
      red: { dongfengUsed: false, lastPieceId: null, undoUsed: 0 },
      black: { dongfengUsed: false, lastPieceId: null, undoUsed: 0 },
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

    const legalTarget = getLegalMovesForPiece(nextGame, validFrom.row, validFrom.col)
      .find((move) => move.row === validTo.row && move.col === validTo.col);
    if (!legalTarget) {
      return { ok: false, error: "不符合棋规" };
    }

    const moveResult = applyStandardMoveToBoard(nextGame, validFrom, validTo, piece, legalTarget);
    if (!moveResult.ok) {
      return { ok: false, error: moveResult.error };
    }

    nextGame.lastMove = {
      from: { ...validFrom },
      to: { ...validTo },
      mode: moveResult.mode,
      pieceId: moveResult.movedPiece.id,
      side: piece.side,
    };
    nextGame.specials[piece.side].lastPieceId = moveResult.movedPiece.id;

    if (moveResult.captured) {
      nextGame.captured[piece.side].push({ ...moveResult.captured });
    }

    nextGame.moveLog.unshift({
      side: piece.side,
      text: moveResult.text,
    });

    return finishTurn(nextGame, piece.side, moveResult.captured);
  }

  function applyStandardMoveToBoard(game, from, to, piece, legalTarget) {
    const target = game.board[to.row][to.col];

    if (legalTarget.combine) {
      const cavalry = createCavalry(piece, target);
      game.board[to.row][to.col] = cavalry;
      game.board[from.row][from.col] = null;
      return {
        ok: true,
        mode: "combine",
        movedPiece: cavalry,
        captured: null,
        text: `${SYMBOLS[piece.side][piece.type]} ${formatPoint(from)} → ${formatPoint(to)} 与 ${SYMBOLS[target.side][target.type]} 合成骑兵`,
      };
    }

    if (target && shouldCaptureCavalryAsHorse(target, to.row, piece)) {
      const deadSoldier = createDeadSoldierFromCavalry(target);
      const movedPiece = prepareMovedPiece(piece, to.row);
      game.board[to.row][to.col] = movedPiece;
      game.board[from.row][from.col] = null;
      const recoveredPoint = placeRecoveredHorseRandomly(game.board, target, piece.side);
      return {
        ok: true,
        mode: "recover-horse",
        movedPiece,
        captured: deadSoldier,
        text: recoveredPoint
          ? `${SYMBOLS[piece.side][piece.type]} ${formatPoint(from)} → ${formatPoint(to)} 吃 骑兵，缴获马随机出现在 ${formatPoint(recoveredPoint)}`
          : `${SYMBOLS[piece.side][piece.type]} ${formatPoint(from)} → ${formatPoint(to)} 吃 骑兵，缴获马暂无空位落子`,
      };
    }

    if (target && shouldCavalryHorseEscape(game.board, target, to, from, true)) {
      const escapedHorse = createEscapedHorse(target);
      const deadSoldier = createDeadSoldierFromCavalry(target);
      const escapeHome = getCavalryEscapeHome(game.board, target, to, from, true);
      const movedPiece = prepareMovedPiece(piece, to.row);
      game.board[to.row][to.col] = movedPiece;
      game.board[from.row][from.col] = null;
      game.board[escapeHome.row][escapeHome.col] = escapedHorse;
      return {
        ok: true,
        mode: "cavalry-escape",
        movedPiece,
        captured: deadSoldier,
        text: `${SYMBOLS[piece.side][piece.type]} ${formatPoint(from)} → ${formatPoint(to)} 吃 骑兵，兵卒阵亡，马逃回初始位置`,
      };
    }

    const captured = target || null;
    const movedPiece = prepareMovedPiece(piece, to.row);
    game.board[to.row][to.col] = movedPiece;
    game.board[from.row][from.col] = null;
    return {
      ok: true,
      mode: null,
      movedPiece,
      captured,
      text: formatMove(movedPiece, from, to, captured),
    };
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

    const capturedTarget = nextGame.board[to.row][to.col];
    const shouldRecoverHorse = shouldCaptureCavalryAsHorse(capturedTarget, to.row, piece);
    const escapeHome = shouldRecoverHorse
      ? null
      : getCavalryEscapeHome(nextGame.board, capturedTarget, to, from, false);
    const escapedHorse = escapeHome ? createEscapedHorse(capturedTarget) : null;
    const captured = shouldRecoverHorse || escapedHorse ? createDeadSoldierFromCavalry(capturedTarget) : capturedTarget;

    nextGame.board[from.row][from.col] = null;
    nextGame.board[to.row][to.col] = null;
    const recoveredPoint = shouldRecoverHorse
      ? placeRecoveredHorseRandomly(nextGame.board, capturedTarget, piece.side)
      : null;
    if (escapedHorse) {
      nextGame.board[escapeHome.row][escapeHome.col] = escapedHorse;
    }
    nextGame.specials[piece.side].dongfengUsed = true;
    nextGame.specials[piece.side].lastPieceId = piece.id;
    nextGame.lastMove = {
      from: { ...from },
      to: { ...to },
      mode: "dongfeng",
      pieceId: piece.id,
      side: piece.side,
    };
    nextGame.captured[piece.side].push({ ...captured });
    nextGame.moveLog.unshift({
      side: piece.side,
      text: shouldRecoverHorse
        ? recoveredPoint
          ? `东风炮 ${formatPoint(from)} → ${formatPoint(to)} 吃 骑兵后报废，缴获马随机出现在 ${formatPoint(recoveredPoint)}`
          : `东风炮 ${formatPoint(from)} → ${formatPoint(to)} 吃 骑兵后报废，缴获马暂无空位落子`
        : escapedHorse
          ? `东风炮 ${formatPoint(from)} → ${formatPoint(to)} 吃 骑兵后报废，兵卒阵亡，马逃回初始位置`
        : `东风炮 ${formatPoint(from)} → ${formatPoint(to)} 吃 ${SYMBOLS[captured.side][captured.type]} 后报废`,
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
    if (!isInCheck(nextGame, side)) {
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
      pieceId: royal.id,
      side,
    };
    nextGame.specials[side].lastPieceId = royal.id;
    nextGame.moveLog.unshift({
      side,
      text: `翻身上马 ${SYMBOLS[side].king} ${formatPoint(mountOption.king)} → ${formatPoint(validHorse)}`,
    });

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
    const checked = isInCheck(nextGame, nextGame.currentSide);
    nextGame.status = checked
      ? `${SIDES[nextGame.currentSide].player} · ${SIDES[nextGame.currentSide].label}被将军`
      : `${SIDES[nextGame.currentSide].player}走棋`;

    return { ok: true, game: nextGame, captured };
  }

  function getLegalMovesForPiece(gameOrBoard, row, col) {
    const game = Array.isArray(gameOrBoard) ? null : gameOrBoard;
    const board = game ? game.board : gameOrBoard;
    const piece = board[row] && board[row][col];
    if (!piece) {
      return [];
    }

    if (isFlatFootedBlocked(game, piece)) {
      return [];
    }

    return getPlayerMoves(board, row, col);
  }

  function getPlayerMoves(board, row, col) {
    const piece = board[row] && board[row][col];
    if (!piece) {
      return [];
    }

    const moves = getPseudoMoves(board, row, col);
    if (piece.type === "horse") {
      moves.push(...getHorseCombineMoves(board, row, col, piece.side));
    }
    return moves;
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
      case "cavalry":
        return getCavalryMoves(board, row, col, piece.side);
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
    const piece = board[row] && board[row][col];
    if (isElephantStealthed(piece, row)) {
      return getStealthedElephantMoves(board, row, col, side);
    }

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

  function getStealthedElephantMoves(board, row, col, side) {
    const moves = [];
    [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
    ].forEach(([dr, dc]) => {
      pushMoveIfAvailable(moves, board, row + dr, col + dc, side);
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

  function getHorseCombineMoves(board, row, col, side) {
    const moves = [];
    getHorsePatterns().forEach(([dr, dc, blockRow, blockCol]) => {
      const nextRow = row + dr;
      const nextCol = col + dc;
      if (
        isInside(nextRow, nextCol) &&
        staysOnOwnSide(side, nextRow) &&
        !board[row + blockRow][col + blockCol]
      ) {
        const target = board[nextRow][nextCol];
        if (target && target.side === side && target.type === "soldier") {
          moves.push({ row: nextRow, col: nextCol, capture: false, combine: true });
        }
      }
    });
    return moves;
  }

  function getCavalryMoves(board, row, col, side) {
    const moves = [];
    getHorsePatterns().forEach(([dr, dc, blockRow, blockCol]) => {
      const nextRow = row + dr;
      const nextCol = col + dc;
      if (
        isInside(nextRow, nextCol) &&
        isForwardOrSideways(side, row, nextRow) &&
        !board[row + blockRow][col + blockCol]
      ) {
        pushMoveIfAvailable(moves, board, nextRow, nextCol, side);
      }
    });

    const forward = side === "red" ? -1 : 1;
    [
      [forward, 0],
      [0, -1],
      [0, 1],
    ].forEach(([dr, dc]) => {
      pushMoveIfAvailable(moves, board, row + dr, col + dc, side);
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
            moves.push({ row: nextRow, col: nextCol, capture: true, mode: "dongfeng" });
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
    if (!isInCheck(game, side)) {
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

        options.push({ row, col, king: { ...king }, mode: "mount" });
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

  function createCavalry(horse, soldier) {
    return {
      id: `${horse.id}+${soldier.id}`,
      side: horse.side,
      type: "cavalry",
      horseId: horse.id,
      soldierId: soldier.id,
      horseHome: clonePoint(horse.home || inferHorseHome(horse)),
    };
  }

  function prepareMovedPiece(piece, targetRow) {
    const movedPiece = { ...piece };
    if (movedPiece.type === "elephant") {
      if (isElephantStealthed(movedPiece, targetRow)) {
        movedPiece.stealthed = true;
      } else {
        delete movedPiece.stealthed;
      }
    }
    return movedPiece;
  }

  function shouldCaptureCavalryAsHorse(target, targetRow, movingPiece) {
    return Boolean(
      target &&
      movingPiece &&
      target.type === "cavalry" &&
      target.side !== movingPiece.side &&
      isAcrossRiver(target.side, targetRow),
    );
  }

  function shouldCavalryHorseEscape(board, target, targetPoint, sourcePoint, targetOccupiedAfterCapture) {
    return Boolean(getCavalryEscapeHome(board, target, targetPoint, sourcePoint, targetOccupiedAfterCapture));
  }

  function getCavalryEscapeHome(board, target, targetPoint, sourcePoint, targetOccupiedAfterCapture) {
    if (!target || target.type !== "cavalry" || isAcrossRiver(target.side, targetPoint.row)) {
      return null;
    }

    const home = clonePoint(target.horseHome || inferHorseHome({ id: target.horseId, side: target.side, type: "horse" }));
    if (!home || !isInside(home.row, home.col)) {
      return null;
    }

    if (targetOccupiedAfterCapture && home.row === targetPoint.row && home.col === targetPoint.col) {
      return null;
    }

    const occupant = board[home.row] && board[home.row][home.col];
    if (!occupant || (home.row === sourcePoint.row && home.col === sourcePoint.col)) {
      return home;
    }

    return null;
  }

  function placeRecoveredHorseRandomly(board, cavalry, capturingSide) {
    const point = getRandomEmptyPointForSide(board, capturingSide);
    if (!point) {
      return null;
    }

    const horse = createRecoveredHorse(cavalry, capturingSide);
    horse.home = { ...point };
    board[point.row][point.col] = horse;
    return point;
  }

  function getRandomEmptyPointForSide(board, side) {
    const points = [];
    for (let row = 0; row < ROWS; row += 1) {
      if (!staysOnOwnSide(side, row)) {
        continue;
      }
      for (let col = 0; col < COLS; col += 1) {
        if (!board[row][col]) {
          points.push({ row, col });
        }
      }
    }

    if (!points.length) {
      return null;
    }

    return points[Math.floor(Math.random() * points.length)];
  }

  function createRecoveredHorse(cavalry, capturingSide) {
    return {
      id: `${capturingSide}-captured-${cavalry.horseId || cavalry.id}`,
      side: capturingSide,
      type: "horse",
      recoveredFrom: cavalry.side,
    };
  }

  function createEscapedHorse(cavalry) {
    const home = clonePoint(cavalry.horseHome || inferHorseHome({ id: cavalry.horseId, side: cavalry.side, type: "horse" }));
    return {
      id: cavalry.horseId || `${cavalry.id}-horse`,
      side: cavalry.side,
      type: "horse",
      home,
    };
  }

  function createDeadSoldierFromCavalry(cavalry) {
    return {
      id: cavalry.soldierId || `${cavalry.id}-soldier`,
      side: cavalry.side,
      type: "soldier",
    };
  }

  function inferHorseHome(piece) {
    if (!piece || piece.type !== "horse" || !piece.id) {
      return null;
    }

    const defaults = {
      "black-horse-2": { row: 0, col: 1 },
      "black-horse-8": { row: 0, col: 7 },
      "red-horse-19": { row: 9, col: 1 },
      "red-horse-25": { row: 9, col: 7 },
    };
    return clonePoint(defaults[piece.id]);
  }

  function clonePoint(point) {
    if (!point) {
      return null;
    }
    const row = Number(point.row);
    const col = Number(point.col);
    if (!Number.isInteger(row) || !Number.isInteger(col)) {
      return null;
    }
    return { row, col };
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

  function isInCheck(gameOrBoard, side) {
    const game = Array.isArray(gameOrBoard) ? null : gameOrBoard;
    const board = game ? game.board : gameOrBoard;
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

        if (isFlatFootedBlocked(game, piece)) {
          continue;
        }

        const attacks = getPseudoMoves(board, row, col);
        if (attacks.some((move) => move.row === king.row && move.col === king.col)) {
          return true;
        }

        if (isDongfengLineThreat(game, board, row, col, king, piece)) {
          return true;
        }
      }
    }

    return false;
  }

  function isDongfengLineThreat(game, board, row, col, target, piece) {
    if (!game || !game.specials || !piece || piece.type !== "cannon" || !canUseDongfeng(game, piece.side)) {
      return false;
    }

    if (row !== target.row && col !== target.col) {
      return false;
    }

    const rowStep = row === target.row ? 0 : target.row > row ? 1 : -1;
    const colStep = col === target.col ? 0 : target.col > col ? 1 : -1;
    let nextRow = row + rowStep;
    let nextCol = col + colStep;

    while (nextRow !== target.row || nextCol !== target.col) {
      if (board[nextRow][nextCol]) {
        return false;
      }
      nextRow += rowStep;
      nextCol += colStep;
    }

    return true;
  }

  function hasAnyLegalMove(gameOrBoard, side) {
    const board = Array.isArray(gameOrBoard) ? gameOrBoard : gameOrBoard.board;
    const game = Array.isArray(gameOrBoard) ? { board, currentSide: side } : gameOrBoard;
    for (let row = 0; row < ROWS; row += 1) {
      for (let col = 0; col < COLS; col += 1) {
        const piece = board[row][col];
        if (piece && piece.side === side && getLegalMovesForPiece(game, row, col).length > 0) {
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

  function isFlatFootedBlocked(game, piece) {
    if (!game || !piece || piece.type !== "soldier" || !piece.flatFooted) {
      return false;
    }
    const specials = normalizeSpecials(game.specials);
    return specials[piece.side].lastPieceId === piece.id;
  }

  function isElephantStealthed(piece, row) {
    return Boolean(piece && piece.type === "elephant" && isAcrossRiver(piece.side, row));
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

  function isAcrossRiver(side, row) {
    return hasCrossedRiver(side, row);
  }

  function isForwardOrSideways(side, fromRow, toRow) {
    return side === "red" ? toRow <= fromRow : toRow >= fromRow;
  }

  function oppositeSide(side) {
    return side === "red" ? "black" : "red";
  }

  function cloneBoard(board) {
    return board.map((row) => row.map((piece) => (piece ? clonePiece(piece) : null)));
  }

  function clonePiece(piece) {
    return {
      ...piece,
      home: clonePoint(piece.home),
      horseHome: clonePoint(piece.horseHome),
    };
  }

  function cloneMove(move) {
    if (!move) {
      return null;
    }
    return {
      from: { ...move.from },
      to: { ...move.to },
      mode: move.mode || null,
      pieceId: move.pieceId || null,
      side: move.side || null,
    };
  }

  function cloneGame(game) {
    return {
      board: cloneBoard(game.board),
      currentSide: game.currentSide,
      captured: {
        red: (game.captured && game.captured.red ? game.captured.red : []).map((piece) => clonePiece(piece)),
        black: (game.captured && game.captured.black ? game.captured.black : []).map((piece) => clonePiece(piece)),
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
      red: {
        dongfengUsed: Boolean(specials && specials.red && specials.red.dongfengUsed),
        lastPieceId: specials && specials.red ? specials.red.lastPieceId || null : null,
        undoUsed: normalizeUndoCount(specials && specials.red && specials.red.undoUsed),
      },
      black: {
        dongfengUsed: Boolean(specials && specials.black && specials.black.dongfengUsed),
        lastPieceId: specials && specials.black ? specials.black.lastPieceId || null : null,
        undoUsed: normalizeUndoCount(specials && specials.black && specials.black.undoUsed),
      },
    };
  }

  function normalizeUndoCount(value) {
    const count = Number(value || 0);
    if (!Number.isFinite(count) || count < 0) {
      return 0;
    }
    return Math.min(3, Math.floor(count));
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
    const status = [];
    if (isElephantStealthed(piece, row)) {
      status.push("潜伏");
    }
    if (piece.flatFooted) {
      status.push("扁平足");
    }
    const statusText = status.length ? ` · ${status.join(" · ")}` : "";
    return `${point} ${SIDES[piece.side].label}${PIECE_NAMES[piece.type]}${statusText}`;
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
    isElephantStealthed,
    normalizePoint,
    oppositeSide,
  };
});
