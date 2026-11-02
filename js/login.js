"use strict";

const supabaseClient = window.supabase?.createClient(
  document.body.dataset.supabaseUrl,
  document.body.dataset.supabaseKey
);
const loginForm = document.querySelector("#login-form");
const emailInput = document.querySelector("#login-email");
const passwordInput = document.querySelector("#login-password");
const loginSubmit = document.querySelector("#login-submit");
const signedInPanel = document.querySelector("#signed-in-panel");
const signedInEmail = document.querySelector("#signed-in-email");
const signedInAvatar = document.querySelector("#signed-in-avatar");
const statusElement = document.querySelector("#login-status");
const continueButton = document.querySelector("#continue-button");
const logoutButton = document.querySelector("#logout-button");
const returnTo = getReturnUrl();
let activeSession = null;

async function updateWordStateCount(session) {
  const userId = session.user.id;
  setStatus("Checking saved word records…");

  try {
    const { count, error } = await supabaseClient
      .from("user_word_state")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId);
    if (error) throw error;
    if (activeSession?.user.id !== userId) return;
    if (!Number.isInteger(count)) {
      throw new Error("Supabase did not return an exact row count.");
    }
    setStatus(`Saved word records: ${count.toLocaleString()}`);
  } catch (error) {
    if (activeSession?.user.id !== userId) return;
    const message = error instanceof Error ? error.message : String(error);
    setStatus(`Could not load saved word record count: ${message}`, true);
  }
}

function getReturnUrl() {
  const requested = new URLSearchParams(window.location.search).get("return");
  if (!requested) return new URL("../hsk/", window.location.href).href;

  try {
    const target = new URL(requested, window.location.origin);
    if (target.origin !== window.location.origin) {
      throw new Error("Return destination must stay on this site.");
    }
    return target.href;
  } catch (error) {
    statusElement.textContent = error instanceof Error
      ? `Invalid return destination: ${error.message}`
      : "Invalid return destination.";
    return new URL("../hsk/", window.location.href).href;
  }
}

function setStatus(message, isError = false) {
  statusElement.textContent = message;
  statusElement.classList.toggle("error", isError);
}

function showSession(session) {
  activeSession = session;
  const isSignedIn = Boolean(session);
  loginForm.hidden = isSignedIn;
  signedInPanel.hidden = !isSignedIn;
  if (isSignedIn) {
    signedInEmail.textContent = session.user.email;
    updateWordStateCount(session);
    const imageUrl = document.body.dataset.profileImage;
    signedInAvatar.hidden = true;
    if (imageUrl) {
      signedInAvatar.onload = () => {
        if (!activeSession) return;
        signedInAvatar.hidden = false;
      };
      signedInAvatar.onerror = () => {
        signedInAvatar.hidden = true;
      };
      signedInAvatar.src = imageUrl;
      if (signedInAvatar.complete && signedInAvatar.naturalWidth > 0) {
        signedInAvatar.hidden = false;
      }
    }
  } else {
    signedInAvatar.hidden = true;
    setStatus("Sign in to save and sync word status.");
  }
}

if (!supabaseClient) {
  setStatus("Supabase client failed to load. Check your connection and reload.", true);
} else {
  supabaseClient.auth.getSession().then(({ data, error }) => {
    if (error) throw error;
    showSession(data.session);
  }).catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    setStatus(`Could not check your account: ${message}`, true);
  });
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!supabaseClient) return;
  loginSubmit.disabled = true;
  setStatus("Signing in…");
  try {
    const { data, error } = await supabaseClient.auth.signInWithPassword({
      email: emailInput.value.trim(),
      password: passwordInput.value
    });
    if (error) throw error;
    if (!data.session) throw new Error("Sign-in completed without an active session.");
    window.location.replace(returnTo);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setStatus(`Sign-in failed: ${message}`, true);
  } finally {
    loginSubmit.disabled = false;
  }
});

continueButton.addEventListener("click", () => {
  window.location.assign(returnTo);
});

logoutButton.addEventListener("click", async () => {
  logoutButton.disabled = true;
  setStatus("Signing out…");
  try {
    const { error } = await supabaseClient.auth.signOut();
    if (error) throw error;
    showSession(null);
    passwordInput.value = "";
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setStatus(`Sign-out failed: ${message}`, true);
  } finally {
    logoutButton.disabled = false;
  }
});
