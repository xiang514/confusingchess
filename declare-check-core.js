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
    cloneGame,
    isInCheck,
    areRoyalsFacing,
    formatPoint,
    oppositeSide,
  } = Core;

  Core.createInitialGame = function createInitialGameWithDeclarations() {
    return ensureDeclarationFields(createInitialGame());
  };

  Core.cloneGame = function cloneGameWithDeclarations(game) {
    const cloned = cloneGame(game);
    return ensureDeclarationFields(cloned, game);
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
    const result = applyMove(game, from, to, options);
    if (!result.ok) {
      return result;
    }

    ensureDeclarationFields(result.game, { pendingCheckDeclaration: pending, lastCheckDeclaration: last });
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

    ensureDeclarationFields(result.game, { pendingCheckDeclaration: pending, lastCheckDeclaration: last });
    return resolveDeclarationResult(result, movingSide, pending);
  };

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

  function ensureDeclarationFields(game, source = {}) {
    game.pendingCheckDeclaration = normalizeDeclaration(source.pendingCheckDeclaration || game.pendingCheckDeclaration);
    game.lastCheckDeclaration = normalizeDeclaration(source.lastCheckDeclaration || game.lastCheckDeclaration);
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
})();
