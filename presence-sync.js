"use strict";

(() => {
  const SUPABASE_URL = "https://ikuqyslgfbabixyitzws.supabase.co";
  const SUPABASE_KEY = "sb_publishable_6SYKOcW0fzIKUEMomMJ5iw_NtVm-GaY";
  const SIDES = {
    red: { label: "红方", nameId: "redName", metaId: "redMeta" },
    black: { label: "黑方", nameId: "blackName", metaId: "blackMeta" },
  };

  if (!window.supabase || window.__confusingChessPresenceSync) {
    return;
  }
  window.__confusingChessPresenceSync = true;

  const originalCreateClient = window.supabase.createClient.bind(window.supabase);
  const presenceByRoom = new Map();
  let latestPresence = {};

  window.supabase.createClient = (...args) => {
    const client = originalCreateClient(...args);
    const url = String(args[0] || "");
    if (url !== SUPABASE_URL) {
      return client;
    }
    return patchClient(client);
  };

  function patchClient(client) {
    if (client.__confusingChessPresencePatched) {
      return client;
    }

    const originalRpc = client.rpc.bind(client);
    const originalChannel = client.channel.bind(client);

    client.rpc = async (fn, params = {}, options) => {
      if (fn === "update_chess_room_state") {
        const roomId = params && params.target_room_id;
        const presence = presenceByRoom.get(roomId);
        if (roomId && presence && params.new_game_state) {
          params = {
            ...params,
            new_game_state: {
              ...params.new_game_state,
              seatPresence: normalizePresence(params.new_game_state.seatPresence || presence),
            },
          };
        }
        return originalRpc(fn, params, options);
      }

      if (fn === "join_chess_room") {
        const response = await originalRpc(fn, params, options);
        const seat = firstRow(response && response.data);
        if (!response.error && seat && seat.room_id && seat.side) {
          window.setTimeout(() => {
            syncSeatPresence(client, originalRpc, seat.room_id, seat.side, true).catch(() => {});
          }, 0);
        }
        return response;
      }

      if (fn === "leave_chess_room") {
        const roomId = params && params.target_room_id;
        await syncSeatPresenceByRoom(client, originalRpc, roomId, false).catch(() => {});
        return originalRpc(fn, params, options);
      }

      return originalRpc(fn, params, options);
    };

    client.channel = (...args) => {
      const channel = originalChannel(...args);
      const originalOn = channel.on.bind(channel);
      channel.on = (event, filter, callback) => {
        if (
          event === "postgres_changes" &&
          filter &&
          filter.table === "chess_rooms" &&
          typeof callback === "function"
        ) {
          return originalOn(event, filter, (payload) => {
            rememberPresence(payload && payload.new && payload.new.id, payload && payload.new && payload.new.game_state);
            const result = callback(payload);
            window.setTimeout(paintPresence, 0);
            return result;
          });
        }
        return originalOn(event, filter, callback);
      };
      return channel;
    };

    Object.defineProperty(client, "__confusingChessPresencePatched", {
      value: true,
      enumerable: false,
    });
    return client;
  }

  async function syncSeatPresenceByRoom(client, originalRpc, roomId, online) {
    if (!roomId) {
      return;
    }

    const session = await client.auth.getSession();
    const userId = session && session.data && session.data.session && session.data.session.user.id;
    if (!userId) {
      return;
    }

    const { data: members, error } = await client
      .from("chess_room_members")
      .select("side, display_name")
      .eq("room_id", roomId)
      .eq("user_id", userId)
      .limit(1);

    if (error || !members || !members[0]) {
      return;
    }

    await syncSeatPresence(client, originalRpc, roomId, members[0].side, online, members[0].display_name);
  }

  async function syncSeatPresence(client, originalRpc, roomId, side, online, displayName) {
    if (!roomId || !SIDES[side]) {
      return;
    }

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const { data: room, error } = await client
        .from("chess_rooms")
        .select("id, game_state, history, revision")
        .eq("id", roomId)
        .single();

      if (error || !room) {
        return;
      }

      const presence = normalizePresence(room.game_state && room.game_state.seatPresence);
      presence[side] = {
        online,
        name: cleanName(displayName || getInputName()),
        updatedAt: new Date().toISOString(),
      };
      rememberPresence(roomId, { seatPresence: presence });

      const { error: updateError } = await originalRpc("update_chess_room_state", {
        target_room_id: roomId,
        expected_revision: Number(room.revision || 0),
        new_game_state: {
          ...(room.game_state || {}),
          seatPresence: presence,
        },
        new_history: Array.isArray(room.history) ? room.history : [],
      });

      if (!updateError) {
        paintPresence();
        return;
      }

      if (!String(updateError.message || "").includes("revision_conflict") || attempt === 1) {
        return;
      }
    }
  }

  function rememberPresence(roomId, gameState) {
    const presence = normalizePresence(gameState && gameState.seatPresence);
    if (Object.keys(presence).length === 0) {
      return;
    }
    latestPresence = presence;
    if (roomId) {
      presenceByRoom.set(roomId, presence);
    }
  }

  function paintPresence() {
    const seatInfo = document.getElementById("seatInfo");
    const badge = document.getElementById("connectionBadge");
    const inRoom =
      (seatInfo && seatInfo.textContent.includes("你执")) ||
      (badge && badge.textContent.includes("已连接"));

    if (!inRoom) {
      return;
    }

    Object.entries(SIDES).forEach(([side, config]) => {
      const entry = latestPresence[side];
      if (!entry || typeof entry.online !== "boolean") {
        return;
      }

      const nameEl = document.getElementById(config.nameId);
      const metaEl = document.getElementById(config.metaId);
      if (!nameEl || !metaEl) {
        return;
      }

      const hadYou = metaEl.textContent.includes("你");
      const status = entry.online ? "已加入" : "已退出";
      const bits = [config.label, status];
      if (hadYou) {
        bits.push("你");
      }

      const currentName = nameEl.textContent.trim();
      if (entry.name && (!currentName || currentName === "玩家1" || currentName === "玩家2")) {
        nameEl.textContent = entry.name;
      }

      const nextMeta = bits.join(" · ");
      if (metaEl.textContent !== nextMeta) {
        metaEl.textContent = nextMeta;
      }
    });
  }

  function normalizePresence(value) {
    const result = {};
    Object.keys(SIDES).forEach((side) => {
      const entry = value && value[side];
      if (!entry || typeof entry !== "object" || typeof entry.online !== "boolean") {
        return;
      }
      result[side] = {
        online: entry.online,
        name: cleanName(entry.name || ""),
        updatedAt: String(entry.updatedAt || "").slice(0, 40),
      };
    });
    return result;
  }

  function cleanName(value) {
    return String(value || "")
      .normalize("NFKC")
      .trim()
      .replace(/\s+/g, "")
      .slice(0, 16);
  }

  function getInputName() {
    const input = document.getElementById("usernameInput");
    return cleanName(input && input.value) || "棋友";
  }

  function firstRow(data) {
    return Array.isArray(data) ? data[0] : data;
  }

  window.addEventListener("load", () => {
    const observer = new MutationObserver(() => window.setTimeout(paintPresence, 0));
    ["redMeta", "blackMeta", "seatInfo", "connectionBadge"].forEach((id) => {
      const element = document.getElementById(id);
      if (element) {
        observer.observe(element, { childList: true, characterData: true, subtree: true });
      }
    });
    paintPresence();
  });
})();