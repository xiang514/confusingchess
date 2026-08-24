(function initDeclareCheckAddon() {
  "use strict";

  if (!window.XiangqiCore || typeof state === "undefined") {
    return;
  }

  if (Object.prototype.hasOwnProperty.call(state, "lastSeenCheckDeclarationId") || state.declareCheckAddonReady) {
    return;
  }

  const { SIDES, declareCheck } = window.XiangqiCore;
  const button = document.getElementById("declareCheckBtn");
  const explosion = document.getElementById("checkExplosion");
  if (!button || !explosion || typeof declareCheck !== "function") {
    return;
  }

  state.declareCheckAddonReady = true;
  state.lastSeenCheckDeclarationId = null;
  state.checkExplosionTimer = null;

  button.addEventListener("click", handleDeclareCheck);

  const originalRenderPanels = renderPanels;
  renderPanels = function renderPanelsWithDeclareCheck() {
    originalRenderPanels();
    renderDeclareCheckButton();
  };

  const originalApplyRemoteRoom = applyRemoteRoom;
  applyRemoteRoom = function applyRemoteRoomWithDeclareCheck(room) {
    const previousRevision = state.connection.revision;
    originalApplyRemoteRoom(room);
    const nextRevision = Number((room && room.revision) || 0);
    syncCheckDeclarationAnimation(state.game, previousRevision > 0 && nextRevision !== previousRevision);
    renderDeclareCheckButton();
  };

  const originalBuildUndoGame = buildUndoGame;
  buildUndoGame = function buildUndoGameWithDeclarationClear(previousGame, actorSide) {
    const undoGame = originalBuildUndoGame(previousGame, actorSide);
    undoGame.pendingCheckDeclaration = null;
    return undoGame;
  };

  renderDeclareCheckButton();

  async function handleDeclareCheck() {
    if (!canCurrentUserAct()) {
      state.notice = state.connection.connected ? "还没轮到你" : "现在不能声明";
      renderPanels();
      return;
    }

    const actorSide = getActorSide();
    const result = declareCheck(state.game, actorSide);
    if (!result.ok) {
      state.notice = result.error;
      renderPanels();
      return;
    }

    clearSelection();
    if (state.connection.connected) {
      await saveRoomState(result.game, state.history, "正在声明将军");
      return;
    }

    state.game = result.game;
    state.notice = "已声明将军，请走出真正的将军";
    syncCheckDeclarationAnimation(state.game, true);
    render();
  }

  function renderDeclareCheckButton() {
    const actorSide = getActorSide();
    const canAct = canCurrentUserAct();
    const checkDeclared = Boolean(
      actorSide &&
      state.game.pendingCheckDeclaration &&
      state.game.pendingCheckDeclaration.side === actorSide,
    );

    button.disabled = !canAct || !actorSide;
    button.classList.toggle("active", checkDeclared);
    button.title = checkDeclared ? "已声明将军，请走出真正的将军" : "走子前声明将军";
  }

  function syncCheckDeclarationAnimation(game, shouldAnimate) {
    const declaration = game && game.lastCheckDeclaration;
    if (!declaration || !declaration.id) {
      return;
    }

    const isNew = declaration.id !== state.lastSeenCheckDeclarationId;
    state.lastSeenCheckDeclarationId = declaration.id;
    if (!shouldAnimate || !isNew) {
      return;
    }

    if (!state.connection.connected || declaration.side !== state.connection.side) {
      showCheckExplosion();
    }
  }

  function showCheckExplosion() {
    window.clearTimeout(state.checkExplosionTimer);
    explosion.classList.remove("show");
    void explosion.offsetWidth;
    explosion.classList.add("show");
    state.checkExplosionTimer = window.setTimeout(() => {
      explosion.classList.remove("show");
    }, 500);
  }
})();
