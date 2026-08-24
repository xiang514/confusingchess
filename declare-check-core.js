(function initDeclareCheckCorePatch() {
  "use strict";

  const Core = window.XiangqiCore;
  if (!Core || typeof Core.declareCheck === "function") {
    return;
  }

  const {
    ROWS,
    COLS,
    SIDES,
    SYMBOLS,
    createInitialGame,
    applyMove,
    applyHorseMount,
    getLegalMovesForPiece,
    cloneGame,
    isInCheck,
    areRoyalsFacing,
    formatPoint,
    oppositeSide,
  } = Core;

  Core.createInitialGame = function createInitialGameWithDeclarations() {
    return ensureRuleFields(createInitialGame());
  };

  Core.cloneGame = function cloneGameWithDeclarations(game) {
    const cloned = cloneGame(game);
    return ensureRuleFields(cloned, game);
  };

  Core.getLegalMovesForPiece = function getLegalMovesForPieceWithCavalryRetreat(gameOrBoard, row, col) {
    const moves = getLegalMovesForPiece(gameOrBoard, row, col);
    const board = Array.isArray(gameOrBoard) ? gameOrBoard : gameOrBoard.board;
    const piece = board[row] && board[row][col];
    if (!piece || piece.type !== "cavalry" || !isAcrossRiver(piece.side, row)) {
      return moves;
    }

    const known = new Set(moves.map((move) => `${move.row},${move.col}`));
    getFreeCavalryMoves(board, row, col, piece.side).forEach((move) => {
      const key = `${move.row},${move.col}`;
      if (!known.has(key)) {
        known.add(key);
        moves.push(move);
      }
    });
    return moves;
  };

  Core.declareCheck = function declareCheck(game, side = game.currentSide) {
    const nextGame = Core.cloneGame(game);
    if (nextGame.gameOver) {
      return { ok: false, error: "对局已经结束" };
    }

    if (side !== "red" && side !== "black") {
      return { ok: false, error: "声明方无效" };
    }

    if (side !== nextGame.currentSide) {
      return { ok: false, error: "只能在自己走子前声明将军" };
    }

    const declaration = {
      side,
      id: `${side}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    };
    nextGame.pendingCheckDeclaration = declaration;
    nextGame.lastCheckDeclaration = declaration;
    nextGame.status = `${SIDES[side].player} · ${SIDES[side].label}声明将军`;
    return { ok: true, game: nextGame, declaration };
  };

  Core.applyMove = function applyMoveWithDeclarations(game, from, to, options = {}) {
    const pending = normalizeDeclaration(game.pendingCheckDeclaration);
    const last = normalizeDeclaration(game.lastCheckDeclaration);
    const movingSide = game.currentSide;
    const context = getMoveContext(game, from, to);
    let result = applyMove(game, from, to, options);
    if (!result.ok && isExtraCavalryMove(game, from, to, options)) {
      result = applyExtraCavalryMove(game, from, to);
    }
    if (!result.ok) {
      return result;
    }

    ensureRuleFields(result.game, { pendingCheckDeclaration: pending, lastCheckDeclaration: last, sideAssignments: game.sideAssignments });
    applyPostMoveRules(result.game, context);
    return resolveDeclarationResult(result, movingSide, pending);
  };

  Core.applyHorseMount = function applyHorseMountWithDeclarations(game, horsePoint) {
    const pending = normalizeDeclaration(game.pendingCheckDeclaration);
    const last = normalizeDeclaration(game.lastCheckDeclaration);
    const movingSide = game.currentSide;
    const result = applyHorseMount(game, horsePoint);
    if (!result.ok) {
      return result;
    }

    ensureRuleFields(result.game, { pendingCheckDeclaration: pending, lastCheckDeclaration: last, sideAssignments: game.sideAssignments });
    return resolveDeclarationResult(result, movingSide, pending);
  };

  function getMoveContext(game, from, to) {
    const validFrom = normalizePoint(from);
    const validTo = normalizePoint(to);
    if (!validFrom || !validTo || !game || !game.board) {
      return null;
    }

    const piece = game.board[validFrom.row][validFrom.col];
    const target = game.board[validTo.row][validTo.col];
    return {
      from: validFrom,
      to: validTo,
      piece: piece ? { ...piece } : null,
      target: target ? { ...target } : null,
    };
  }

  function applyPostMoveRules(game, context) {
    if (!context || !context.piece) {
      return;
    }

    if (shouldRetireElephant(context)) {
      retireElephant(game, context);
    }
  }

  function shouldRetireElephant(context) {
    return Boolean(
      context.piece &&
      context.piece.type === "elephant" &&
      context.target &&
      context.target.side !== context.piece.side &&
      isAcrossRiver(context.piece.side, context.from.row),
    );
  }

  function retireElephant(game, context) {
    const elephant = game.board[context.to.row] && game.board[context.to.row][context.to.col];
    if (!elephant || elephant.id !== context.piece.id) {
      return;
    }

    const home = getPieceHome(context.piece);
    if (!home || game.board[home.row][home.col]) {
      appendToLatestMove(game, "，功成身退，出生位置被占暂留原位");
      return;
    }

    game.board[context.to.row][context.to.col] = null;
    elephant.home = home;
    delete elephant.stealthed;
    game.board[home.row][home.col] = elephant;
    if (game.lastMove) {
      game.lastMove.to = { ...home };
      game.lastMove.mode = "elephant-retire";
    }
    appendToLatestMove(game, `，功成身退闪回 ${formatPoint(home)}`);
  }

  function isExtraCavalryMove(game, from, to, options) {
    if (options && options.mode === "dongfeng") {
      return false;
    }

    const context = getMoveContext(game, from, to);
    if (!context || !context.piece || context.piece.type !== "cavalry") {
      return false;
    }

    if (context.piece.side !== game.currentSide || !isAcrossRiver(context.piece.side, context.from.row)) {
      return false;
    }

    return getFreeCavalryMoves(game.board, context.from.row, context.from.col, context.piece.side)
      .some((move) => move.row === context.to.row && move.col === context.to.col);
  }

  function applyExtraCavalryMove(game, from, to) {
    const nextGame = Core.cloneGame(game);
    const validFrom = normalizePoint(from);
    const validTo = normalizePoint(to);
    const piece = nextGame.board[validFrom.row][validFrom.col];
    const target = nextGame.board[validTo.row][validTo.col];
    const returningHome = staysOnOwnSide(piece.side, validTo.row);
    const captured = target || null;

    nextGame.board[validFrom.row][validFrom.col] = null;
    nextGame.board[validTo.row][validTo.col] = null;

    let movedPiece = { ...piece };
    let mode = "cavalry-retreat";
    let text = `${SYMBOLS[piece.side].cavalry} ${formatPoint(validFrom)} → ${formatPoint(validTo)}${captured ? ` 吃 ${SYMBOLS[captured.side][captured.type]}` : ""}`;
    let finalPoint = { ...validTo };
    if (returningHome) {
      movedPiece = createHorseFromCavalry(piece);
      const home = getPieceHome(movedPiece);
      const homeOpen = home && !nextGame.board[home.row][home.col];
      if (homeOpen) {
        nextGame.board[home.row][home.col] = movedPiece;
        finalPoint = { ...home };
      } else {
        nextGame.board[validTo.row][validTo.col] = movedPiece;
      }
      mode = "cavalry-return";
      text += `，退回己方半场，兵受军法处置，马${homeOpen ? `回归 ${formatPoint(home)}` : "暂留退回位置"}`;
    } else {
      nextGame.board[validTo.row][validTo.col] = movedPiece;
      text += "，过河骑兵后退";
    }

    nextGame.lastMove = {
      from: { ...validFrom },
      to: finalPoint,
      mode,
      pieceId: movedPiece.id,
      side: piece.side,
    };
    nextGame.specials[piece.side].lastPieceId = movedPiece.id;
    if (captured) {
      nextGame.captured[piece.side].push({ ...captured });
    }
    nextGame.moveLog.unshift({ side: piece.side, text });
    finishPatchedTurn(nextGame, piece.side, captured);
    return { ok: true, game: nextGame, captured };
  }

  function finishPatchedTurn(game, movingSide, captured) {
    if (captured && isRoyal(captured)) {
      game.gameOver = true;
      game.winner = movingSide;
      game.status = `${SIDES[movingSide].player} · ${SIDES[movingSide].label}获胜`;
      return;
    }

    if (areRoyalsFacing(game.board)) {
      const winner = oppositeSide(movingSide);
      game.gameOver = true;
      game.winner = winner;
      game.status = `${SIDES[movingSide].player}主动造成将帅碰面，${SIDES[winner].player}获胜`;
      return;
    }

    game.currentSide = oppositeSide(movingSide);
    refreshStatus(game, movingSide);
  }

  function resolveDeclarationResult(result, movingSide, pending) {
    const game = result.game;
    const declared = Boolean(pending && pending.side === movingSide);
    if (declared) {
      game.pendingCheckDeclaration = null;
    }

    if (result.captured && isRoyal(result.captured)) {
      return result;
    }

    if (game.gameOver) {
      return result;
    }

    const causedCheck = isInCheck(game, oppositeSide(movingSide));
    if (declared === causedCheck) {
      refreshStatus(game, movingSide);
      return result;
    }

    const removed = removeRandomOwnPiece(game.board, movingSide);
    if (!removed) {
      refreshStatus(game, movingSide);
      return result;
    }

    const reason = declared ? "误报将军" : "漏报将军";
    game.moveLog.unshift({
      side: movingSide,
      text: `${reason}，随机移除己方${SYMBOLS[removed.piece.side][removed.piece.type]} ${formatPoint(removed.point)}`,
    });

    if (isRoyal(removed.piece)) {
      const winner = oppositeSide(movingSide);
      game.gameOver = true;
      game.winner = winner;
      game.status = `${SIDES[movingSide].player}${reason}，${SIDES[winner].player}获胜`;
      return result;
    }

    refreshStatus(game, movingSide);
    return result;
  }

  function refreshStatus(game, movingSide) {
    if (game.gameOver) {
      return;
    }

    if (areRoyalsFacing(game.board)) {
      const winner = oppositeSide(movingSide);
      game.gameOver = true;
      game.winner = winner;
      game.status = `${SIDES[movingSide].player}主动造成将帅碰面，${SIDES[winner].player}获胜`;
      return;
    }

    const checked = isInCheck(game, game.currentSide);
    game.status = checked ? `${SIDES[game.currentSide].player} · ${SIDES[game.currentSide].label}被将军` : `${SIDES[game.currentSide].player}走棋`;
  }

  function ensureRuleFields(game, source = {}) {
    ensurePieceHomes(game);
    game.pendingCheckDeclaration = normalizeDeclaration(source.pendingCheckDeclaration || game.pendingCheckDeclaration);
    game.lastCheckDeclaration = normalizeDeclaration(source.lastCheckDeclaration || game.lastCheckDeclaration);
    game.sideAssignments = normalizeSideAssignments(source.sideAssignments || game.sideAssignments);
    return game;
  }

  function normalizeDeclaration(value) {
    if (!value || (value.side !== "red" && value.side !== "black")) {
      return null;
    }

    return {
      side: value.side,
      id: value.id ? String(value.id) : `${value.side}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    };
  }

  function removeRandomOwnPiece(board, side) {
    const candidates = [];
    for (let row = 0; row < ROWS; row += 1) {
      for (let col = 0; col < COLS; col += 1) {
        const piece = board[row][col];
        if (piece && piece.side === side) {
          candidates.push({ row, col, piece });
        }
      }
    }

    if (!candidates.length) {
      return null;
    }

    const selected = candidates[Math.floor(Math.random() * candidates.length)];
    board[selected.row][selected.col] = null;
    return {
      point: { row: selected.row, col: selected.col },
      piece: { ...selected.piece },
    };
  }

  function isRoyal(piece) {
    return piece && (piece.type === "king" || piece.type === "mountedKing");
  }

  function getFreeCavalryMoves(board, row, col, side) {
    const moves = [];
    getHorsePatterns().forEach(([dr, dc, blockRow, blockCol]) => {
      const nextRow = row + dr;
      const nextCol = col + dc;
      if (
        isInside(nextRow, nextCol) &&
        !board[row + blockRow][col + blockCol]
      ) {
        pushMoveIfAvailable(moves, board, nextRow, nextCol, side);
      }
    });

    [
      [side === "red" ? -1 : 1, 0],
      [side === "red" ? 1 : -1, 0],
      [0, -1],
      [0, 1],
    ].forEach(([dr, dc]) => {
      pushMoveIfAvailable(moves, board, row + dr, col + dc, side);
    });
    return moves;
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

  function createHorseFromCavalry(cavalry) {
    const home = getPieceHome({ ...cavalry, type: "horse", id: cavalry.horseId || cavalry.id });
    return {
      id: cavalry.horseId || `${cavalry.id}-horse`,
      side: cavalry.side,
      type: "horse",
      home,
    };
  }

  function ensurePieceHomes(game) {
    if (!game || !game.board) {
      return;
    }

    for (let row = 0; row < ROWS; row += 1) {
      for (let col = 0; col < COLS; col += 1) {
        const piece = game.board[row][col];
        if (!piece) {
          continue;
        }

        if (piece.type === "elephant" && !piece.home) {
          piece.home = inferElephantHome(piece) || { row, col };
        }
        if (piece.type === "horse" && !piece.home) {
          piece.home = inferHorseHome(piece) || { row, col };
        }
        if (piece.type === "cavalry" && !piece.horseHome) {
          piece.horseHome = inferHorseHome({ id: piece.horseId, side: piece.side, type: "horse" });
        }
      }
    }
  }

  function getPieceHome(piece) {
    const home = normalizePoint(piece && (piece.home || piece.horseHome));
    if (home) {
      return home;
    }
    if (piece && piece.type === "elephant") {
      return inferElephantHome(piece);
    }
    if (piece && (piece.type === "horse" || piece.type === "cavalry")) {
      return inferHorseHome({ id: piece.horseId || piece.id, side: piece.side, type: "horse" });
    }
    return null;
  }

  function inferElephantHome(piece) {
    const defaults = {
      "black-elephant-3": { row: 0, col: 2 },
      "black-elephant-7": { row: 0, col: 6 },
      "red-elephant-19": { row: 9, col: 2 },
      "red-elephant-23": { row: 9, col: 6 },
    };
    return normalizePoint(piece && defaults[piece.id]);
  }

  function inferHorseHome(piece) {
    const defaults = {
      "black-horse-2": { row: 0, col: 1 },
      "black-horse-8": { row: 0, col: 7 },
      "red-horse-18": { row: 9, col: 1 },
      "red-horse-24": { row: 9, col: 7 },
      "red-horse-19": { row: 9, col: 1 },
      "red-horse-25": { row: 9, col: 7 },
    };
    return normalizePoint(piece && defaults[piece.id]);
  }

  function normalizeSideAssignments(value) {
    if (!value || typeof value !== "object") {
      return null;
    }

    const assignments = {};
    Object.entries(value).forEach(([userId, side]) => {
      const normalizedUserId = String(userId || "").trim();
      if (normalizedUserId && (side === "red" || side === "black")) {
        assignments[normalizedUserId] = side;
      }
    });
    return Object.keys(assignments).length ? assignments : null;
  }

  function appendToLatestMove(game, text) {
    if (game.moveLog && game.moveLog[0]) {
      game.moveLog[0].text += text;
    }
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

  function staysOnOwnSide(side, row) {
    return side === "red" ? row >= 5 : row <= 4;
  }

  function isAcrossRiver(side, row) {
    return side === "red" ? row <= 4 : row >= 5;
  }
})();
