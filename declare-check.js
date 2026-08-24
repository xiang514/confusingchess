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
  const resetButton = document.getElementById("resetBtn");
  if (!button || !explosion || typeof declareCheck !== "function") {
    return;
  }

  state.declareCheckAddonReady = true;
  state.lastSeenCheckDeclarationId = null;
  state.checkExplosionTimer = null;

  button.addEventListener("click", handleDeclareCheck);
  if (resetButton) {
    resetButton.addEventListener("click", interceptOnlineReset, true);
  }

  const originalRenderPanels = renderPanels;
  renderPanels = function renderPanelsWithDeclareCheck() {
    updateEffectiveConnectionSide();
    originalRenderPanels();
    renderDeclareCheckButton();
  };

  const originalApplyRemoteRoom = applyRemoteRoom;
  applyRemoteRoom = function applyRemoteRoomWithDeclareCheck(room) {
    const previousRevision = state.connection.revision;
    rememberDatabaseSide();
    originalApplyRemoteRoom(room);
    updateEffectiveConnectionSide();
    state.connection.players = summarizeMembers(state.connection.members || []);
    const nextRevision = Number((room && room.revision) || 0);
    syncCheckDeclarationAnimation(state.game, previousRevision > 0 && nextRevision !== previousRevision);
    renderDeclareCheckButton();
    renderBoardGrid();
    renderPanels();
    renderConnectionPanel();
  };

  const originalBuildUndoGame = buildUndoGame;
  buildUndoGame = function buildUndoGameWithDeclarationClear(previousGame, actorSide) {
    const undoGame = originalBuildUndoGame(previousGame, actorSide);
    undoGame.pendingCheckDeclaration = null;
    return undoGame;
  };

  const originalSummarizeMembers = summarizeMembers;
  summarizeMembers = function summarizeMembersWithSideAssignments(members) {
    state.connection.members = Array.isArray(members) ? members : [];
    const summary = {
      red: { connected: false, name: "" },
      black: { connected: false, name: "" },
    };
    state.connection.members.forEach((member) => {
      const side = getMemberEffectiveSide(member);
      if (side === "red" || side === "black") {
        const summarized = originalSummarizeMembers([member])[member.side] || { connected: true, name: member.display_name || "" };
        summary[side] = {
          ...summarized,
          connected: true,
          name: member.display_name || summarized.name || "",
          userId: member.user_id || "",
          dbSide: member.side || null,
        };
      }
    });
    return summary;
  };

  renderDeclareCheckButton();

  async function interceptOnlineReset(event) {
    if (!state.connection.connected) {
      return;
    }

    event.preventDefault();
    event.stopImmediatePropagation();
    await resetOnlineGameWithSideSwap();
  }

  async function resetOnlineGameWithSideSwap() {
    if (!state.connection.roomUuid) {
      state.notice = "尚未进入房间";
      renderPanels();
      return;
    }

    try {
      const members = await getRoomMembers();
      const nextGame = createInitialGame();
      nextGame.sideAssignments = buildSwappedSideAssignments(members);
      clearSelection();
      await saveRoomState(nextGame, [], "正在重新开始并换边");
    } catch (error) {
      handleOnlineError(error, "重新开始失败");
    }
  }

  async function getRoomMembers() {
    const { data, error } = await supabaseClient
      .from("chess_room_members")
      .select("side, display_name, user_id")
      .eq("room_id", state.connection.roomUuid);

    if (error) {
      throw error;
    }

    state.connection.members = data || [];
    return state.connection.members;
  }

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

  function rememberDatabaseSide() {
    if (!state.connection.dbSide && state.connection.side) {
      state.connection.dbSide = state.connection.side;
    }
  }

  function updateEffectiveConnectionSide() {
    if (!state.connection.connected) {
      return;
    }

    rememberDatabaseSide();
    state.connection.side = getEffectiveSide();
  }

  function getEffectiveSide() {
    const assignments = normalizeSideAssignments(state.game && state.game.sideAssignments);
    return assignments[state.connection.userId] || state.connection.dbSide || state.connection.side || null;
  }

  function getMemberEffectiveSide(member) {
    if (!member) {
      return null;
    }

    const assignments = normalizeSideAssignments(state.game && state.game.sideAssignments);
    return assignments[member.user_id] || member.side || null;
  }

  function buildSwappedSideAssignments(members) {
    const assignments = {};
    (members || []).forEach((member) => {
      if (!member || !member.user_id) {
        return;
      }

      const side = getMemberEffectiveSide(member) || member.side;
      if (side === "red" || side === "black") {
        assignments[member.user_id] = oppositeSide(side);
      }
    });
    return Object.keys(assignments).length ? assignments : null;
  }

  function normalizeSideAssignments(value) {
    if (!value || typeof value !== "object") {
      return {};
    }

    return Object.entries(value).reduce((assignments, [userId, side]) => {
      const normalizedUserId = String(userId || "").trim();
      if (normalizedUserId && (side === "red" || side === "black")) {
        assignments[normalizedUserId] = side;
      }
      return assignments;
    }, {});
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
