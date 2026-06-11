import { registerUser, loginUser, onAuth } from "./firebase.js";

// ─── Redirect if already logged in ───────────────────────
onAuth((user) => {
  if (user) window.location.href = "app.html";
});

// ─── Tab switching ────────────────────────────────────────
const tabs       = document.querySelectorAll(".tab");
const nameField  = document.getElementById("register-name-field");
const submitBtn  = document.getElementById("submit-btn");
const btnText    = submitBtn.querySelector(".btn-text");
let   mode       = "login";

tabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    tabs.forEach((t) => t.classList.remove("active"));
    tab.classList.add("active");
    mode = tab.dataset.tab;
    const isRegister = mode === "register";
    nameField.classList.toggle("hidden", !isRegister);
    btnText.textContent = isRegister ? "Crear cuenta" : "Entrar";
    document.getElementById("password").autocomplete = isRegister
      ? "new-password"
      : "current-password";
    clearError();
  });
});

// ─── Form submit ──────────────────────────────────────────
document.getElementById("auth-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  clearError();

  const email    = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;
  const name     = document.getElementById("display-name").value.trim();

  if (!email || !password) return showError("Rellena todos los campos.");
  if (password.length < 6) return showError("La contraseña debe tener al menos 6 caracteres.");

  setLoading(true);

  try {
    if (mode === "register") {
      await registerUser(email, password, name || null);
    } else {
      await loginUser(email, password);
    }
    // onAuth redirect will fire
  } catch (err) {
    setLoading(false);
    showError(friendlyError(err.code));
  }
});

// ─── Helpers ──────────────────────────────────────────────

function showError(msg) {
  const el = document.getElementById("error-msg");
  el.textContent = msg;
  el.classList.remove("hidden");
}

function clearError() {
  document.getElementById("error-msg").classList.add("hidden");
}

function setLoading(on) {
  submitBtn.disabled = on;
  submitBtn.querySelector(".btn-text").classList.toggle("hidden", on);
  submitBtn.querySelector(".btn-spinner").classList.toggle("hidden", !on);
}

function friendlyError(code) {
  const map = {
    "auth/user-not-found":        "No existe ninguna cuenta con ese email.",
    "auth/wrong-password":        "Contraseña incorrecta.",
    "auth/email-already-in-use":  "Ya existe una cuenta con ese email.",
    "auth/invalid-email":         "El email no tiene un formato válido.",
    "auth/weak-password":         "La contraseña debe tener al menos 6 caracteres.",
    "auth/too-many-requests":     "Demasiados intentos. Espera un momento.",
    "auth/invalid-credential":    "Email o contraseña incorrectos.",
  };
  return map[code] || "Ha ocurrido un error. Inténtalo de nuevo.";
}
