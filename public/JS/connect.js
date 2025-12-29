async function waitForConnection() {
  const qrContainer = document.getElementById("qr");

  while (true) {
    try {
      // 1️⃣ Buscar status do bot
      const statusRes = await fetch("/status");
      const { status } = await statusRes.json();

      if (status === "conectado") {
        // Redireciona assim que estiver conectado
        window.location.href = "index.html";
        return;
      }

      // 2️⃣ Buscar QR code
      const qrRes = await fetch("/qr");
      if (qrRes.ok) {
        const { qr } = await qrRes.json();
        const qrImage = `https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(qr)}`;
        qrContainer.innerHTML = `<img src="${qrImage}" alt="QR Code">`;
      } else {
        qrContainer.innerHTML = "<p>QR ainda não disponível...</p>";
      }

    } catch (err) {
      console.error("Erro ao buscar status ou QR:", err);
    }

    // 3️⃣ Espera 2 segundos antes de checar novamente
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
}

// Inicia a função
waitForConnection();