async function checkConnection() {
    const statusRes = await fetch("/status");
    const { status } = await statusRes.json();

    if (status === "conectado") {
        return; // para de checar
    }else {
        window.location.href = "/connect.html";
    }
}

window.addEventListener("storage", (e) => {
  if (e.key === "token" && e.newValue === null) {
    // token removido em outra aba
    window.location.href = "/login.html";
  }
});

async function login() {
  const username = document.getElementById("username").value.trim();
  const number = document.getElementById("number").value.trim();
  const password = document.getElementById("password").value;
  const remember = document.getElementById("rememberMe").checked;

  if (!username || !number || !password) return alert("Preencha todos os campos");

  try {
    const res = await fetch("/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, number, password })
    });
    const data = await res.json();

    if (data.success && data.token) {
      // ✅ SALVA O TOKEN SEMPRE (para auto-login)
      localStorage.setItem("token", data.token);
      console.log("Token salvo:", data.token);
      window.location.href = "/index.html";
    } else {
      alert(data.error || "Falha no login");
    }
  } catch (err) {
    console.error("Erro no login:", err);
    alert("Erro de conexão com o servidor");
  }
}

// Auto-login ao abrir login.html
window.addEventListener("load", async () => {
  const token = localStorage.getItem("token") || sessionStorage.getItem("token");
  if (!token) return;

  try {
    const res = await fetch("/me", {
      headers: { "Authorization": "Bearer " + token }
    });
    if (res.ok) {
      const data = await res.json();
      console.log("Auto-login OK:", data.message);
      window.location.href = "/index.html";
    } else {
      localStorage.removeItem("token");
    }
  } catch (err) {
    console.error("Erro validando token:", err);
    localStorage.removeItem("token");
  }
});