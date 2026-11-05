"use strict";

window.createUserWordState = function createUserWordState(supabaseClient) {
  const states = new Map();
  const pendingWrites = new Map();
  let currentUserId = null;
  let ready = false;
  let loadingPromise = null;
  let generation = 0;

  function get(wId) {
    return states.get(String(wId)) ?? { saved: false, known: false };
  }

  function describeError(error, operation) {
    if (error instanceof Error) return error;
    if (!error || typeof error !== "object") {
      return new Error(`${operation} failed: ${String(error)}`);
    }

    const parts = [];
    if (typeof error.message === "string" && error.message) parts.push(error.message);
    if (typeof error.code === "string" && error.code) parts.push(`code ${error.code}`);
    if (typeof error.details === "string" && error.details) parts.push(error.details);
    if (typeof error.hint === "string" && error.hint) parts.push(`Hint: ${error.hint}`);
    return new Error(`${operation} failed: ${parts.join(" — ") || JSON.stringify(error)}`);
  }

  async function load(session) {
    const userId = session?.user?.id ?? null;
    if (userId === currentUserId && (ready || loadingPromise)) {
      return loadingPromise ?? undefined;
    }

    currentUserId = userId;
    ready = false;
    states.clear();
    const loadGeneration = ++generation;
    if (!userId) {
      ready = true;
      loadingPromise = null;
      return;
    }
    if (!supabaseClient) {
      loadingPromise = null;
      throw new Error("Supabase client is unavailable.");
    }

    loadingPromise = (async () => {
      const { data, error } = await supabaseClient
        .from("user_word_state")
        .select("w_id,saved,known")
        .eq("user_id", userId);
      if (error) throw describeError(error, "Loading user_word_state");
      if (!Array.isArray(data)) {
        throw new Error("Supabase returned an invalid user_word_state response.");
      }
      if (loadGeneration !== generation) return;

      for (const row of data) {
        const wId = String(row.w_id ?? "");
        if (!wId) {
          throw new Error("A user_word_state row has no w_id.");
        }
        states.set(wId, {
          saved: row.saved === true,
          known: row.known === true
        });
      }
      ready = true;
    })();

    try {
      await loadingPromise;
    } catch (error) {
      if (loadGeneration === generation) {
        ready = false;
        states.clear();
      }
      throw describeError(error, "Loading user_word_state");
    } finally {
      if (loadGeneration === generation) loadingPromise = null;
    }
  }

  function toggle(wId, field) {
    const normalizedWId = String(wId ?? "").trim();
    if (!normalizedWId) throw new Error("Cannot update a word without w_id.");
    if (field !== "saved" && field !== "known") {
      throw new Error(`Unsupported word state field: ${field}.`);
    }
    if (!supabaseClient || !currentUserId || !ready) {
      throw new Error("Sign in and load your word state before updating it.");
    }

    const userId = currentUserId;
    const previousState = get(normalizedWId);
    const previousValue = previousState[field];
    const nextValue = !previousValue;
    states.set(normalizedWId, { ...previousState, [field]: nextValue });

    const queueKey = `${userId}\u0000${normalizedWId}`;
    const previousWrite = pendingWrites.get(queueKey) ?? Promise.resolve();
    const write = previousWrite.catch(() => {}).then(async () => {
      const latestState = get(normalizedWId);
      const { error } = await supabaseClient
        .from("user_word_state")
        .upsert({
          user_id: userId,
          w_id: normalizedWId,
          saved: latestState.saved,
          known: latestState.known,
          ...(field === "saved" ? { updated_at: new Date().toISOString() } : {})
        }, { onConflict: "user_id,w_id" });
      if (error) throw describeError(error, "Saving user_word_state");
    }).catch((error) => {
      if (currentUserId === userId && get(normalizedWId)[field] === nextValue) {
        states.set(normalizedWId, { ...get(normalizedWId), [field]: previousValue });
      }
      throw describeError(error, "Saving user_word_state");
    });

    pendingWrites.set(queueKey, write);
    write.finally(() => {
      if (pendingWrites.get(queueKey) === write) pendingWrites.delete(queueKey);
    }).catch(() => {});
    return write;
  }

  return {
    get ready() {
      return ready;
    },
    get userId() {
      return currentUserId;
    },
    states,
    get,
    load,
    toggle
  };
};
