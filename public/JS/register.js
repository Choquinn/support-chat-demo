async function checkConnection() {
    const statusRes = await fetch("/status");
    const { status } = await statusRes.json();

    if (status === "conectado") {
        return; // para de checar
    }else {
        window.location.href = "/connect.html";
    }
}

async function checkPermission(perm) {

}

window.addEventListener("storage", (e) => {
  if (e.key === "token" && e.newValue === null) {
    // token removido em outra aba
    window.location.href = "/login.html";
  }
});

async function register() {
    const username = document.getElementById("username").value.trim();
    const number = document.getElementById("number").value.trim();
    const password = document.getElementById("password").value.trim();
    const checkboxes = document.querySelectorAll('input[name="role"]:checked');

    // Validação básica
    if (!username || !number || !password) {
        alert("Preencha todos os campos!");
        return;
    }

    // Converter os checkboxes em array de números
    const roles = Array.from(checkboxes).map(cb => Number(cb.value));

    if (roles.length === 0) {
        alert("Marque pelo menos uma área!");
        return;
    }

    // Validação do número (DDD + 9 dígitos)
    if (!/^[0-9]{11}$/.test(number)) {
        alert("Número inválido! Use o formato DDD + número (ex: 88999999999).");
        return;
    }

    try {
        const res = await fetch("/register", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username, number, password, role: roles })
        });

        const data = await res.json();

        if (data.success) {
            alert("✅ Conta criada com sucesso!");
            window.location.href = "login.html";
        } else {
            alert("❌ Erro ao registrar: " + (data.error || "Tente novamente."));
        }
    } catch (err) {
        alert("❌ Erro de conexão com o servidor.");
        console.error(err);
    }
}

