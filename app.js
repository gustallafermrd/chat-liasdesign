import "./style.css";

let deferredPrompt = null;

window.addEventListener("beforeinstallprompt", (e) => {
	e.preventDefault();
	deferredPrompt = e;
	if (installBtn) installBtn.style.display = "flex";
});

if ("serviceWorker" in navigator) {
	window.addEventListener("load", async () => {
		try {
			const registration = await navigator.serviceWorker.register("/sw.js");
			registration.addEventListener("updatefound", () => {
				const newWorker = registration.installing;
				newWorker.addEventListener("statechange", () => {
					if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
						showToast("Nueva versión disponible. Recarga para actualizar.", "warning");
					}
				});
			});
		} catch (err) {
			console.error("SW registration failed:", err);
		}
	});
}

window.addEventListener("appinstalled", () => {
	deferredPrompt = null;
	showToast("¡App instalada correctamente!", "success");
});

const N8N_WEBHOOK_URL = "https://n8n.srv1334062.hstgr.cloud/webhook/chatbot";

const chatContainer = document.getElementById("chat-container");
const messageInput = document.getElementById("message-input");
const sendBtn = document.getElementById("send-btn");
const fileInput = document.getElementById("file-input");
const installBtn = document.getElementById("install-btn");

let isProcessing = false;
let typingIndicatorElement = null;
let lastFileName = null;

if (installBtn) {
	installBtn.addEventListener("click", async () => {
		if (!deferredPrompt) return;
		deferredPrompt.prompt();
		const { outcome } = await deferredPrompt.userChoice;
		if (outcome === "accepted") {
			showToast("¡App instalada!", "success");
		}
		deferredPrompt = null;
		installBtn.style.display = "none";
	});
}

async function init() {
	setupEventListeners();
	setupQuickActions();
	loadChatHistory();
	focusInput();
}

function setupQuickActions() {
	const quickButtons = document.querySelectorAll(".quick-action-btn");
	quickButtons.forEach((btn) => {
		btn.addEventListener("click", () => {
			const prompt = btn.dataset.prompt;
			messageInput.value = prompt;
			handleInput();
			triggerHaptic("light");
		});
	});
}

function getChatId() {
	let chatId = localStorage.getItem("chatId");
	if (!chatId) {
		chatId = "chat_" + Math.random().toString(36).substr(2, 9);
		localStorage.setItem("chatId", chatId);
	}
	return chatId;
}

function triggerHaptic(type = "light") {
	if (navigator.vibrate) {
		const patterns = {
			light: 10,
			medium: 20,
			heavy: 30,
			success: [30, 50, 30],
			error: [50, 100, 50],
		};
		navigator.vibrate(patterns[type] || patterns.light);
	}
}

function showToast(message, type = "success", duration = 3000) {
	let container = document.querySelector(".toast-container");
	if (!container) {
		container = document.createElement("div");
		container.className = "toast-container";
		document.body.appendChild(container);
	}

	const toast = document.createElement("div");
	toast.className = `toast ${type}`;

	const icon = type === "success" ? "✓" : type === "error" ? "✕" : "!";
	toast.innerHTML = `<span>${icon}</span><span>${message}</span>`;

	container.appendChild(toast);
	triggerHaptic(type === "success" ? "light" : "medium");

	setTimeout(() => {
		toast.classList.add("hiding");
		setTimeout(() => toast.remove(), 300);
	}, duration);
}

function getCurrentTime() {
	return new Date().toLocaleTimeString("es-ES", {
		hour: "2-digit",
		minute: "2-digit",
	});
}

function setupEventListeners() {
	messageInput.addEventListener("input", handleInput);
	fileInput.addEventListener("change", handleFileSelect);
	sendBtn.addEventListener("click", handleSend);

	messageInput.addEventListener("keydown", (e) => {
		if (e.key === "Enter" && !e.shiftKey) {
			e.preventDefault();
			handleSend();
		}
	});

	messageInput.addEventListener("paste", handlePaste);

	window.addEventListener("resize", () => {
		setTimeout(scrollToBottom, 100);
	});
}

function handleInput() {
	messageInput.style.height = "auto";
	messageInput.style.height = Math.min(messageInput.scrollHeight, 120) + "px";
	sendBtn.disabled = !messageInput.value.trim() && !fileInput.files.length;
}

function handlePaste(e) {
	const items = e.clipboardData?.items;
	if (items) {
		for (let item of items) {
			if (item.type.startsWith("image/")) {
				const file = item.getAsFile();
				if (file) {
					processImage(file);
				}
			}
		}
	}
}

function handleFileSelect() {
	if (fileInput.files.length > 0) {
		const file = fileInput.files[0];
		processImage(file);
		fileInput.value = "";
	}
}

function processImage(file) {
	if (!file.type.startsWith("image/")) {
		showToast("Por favor selecciona una imagen válida", "error");
		return;
	}

	const reader = new FileReader();
	reader.onload = (e) => {
		appendMessage("sender", "", e.target.result, true);
		sendToN8n(file);
	};
	reader.onerror = () => {
		showToast("Error al leer la imagen", "error");
	};
	reader.readAsDataURL(file);
}

function handleSend() {
	const text = messageInput.value.trim();
	if (text && !isProcessing) {
		isProcessing = true;
		appendMessage("sender", text);
		messageInput.value = "";
		messageInput.style.height = "auto";
		sendBtn.disabled = true;
		triggerHaptic("light");
		sendToN8nMessage(text);
	}
}

async function sendToN8nMessage(message) {
	showTypingIndicator();

	try {
		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), 30000);

		const formData = new FormData();
		formData.append("message", message);
		formData.append("chatId", getChatId());
		formData.append("type", "text");

		const response = await fetch(N8N_WEBHOOK_URL, {
			method: "POST",
			body: formData,
			signal: controller.signal,
		});

		clearTimeout(timeoutId);

		if (!response.ok) {
			throw new Error(`HTTP error! status: ${response.status}`);
		}

		const data = await response.json();
		removeTypingIndicator();

		if (data.fileName) lastFileName = data.fileName;

		if (data.copy) {
			appendN8nResponse(data.copy);
		} else if (data.response) {
			appendMessage("receiver", data.response);
		} else {
			appendN8nResponse(
				"¡Interesante! Cuéntame más sobre eso o comparte una imagen para generar un copy.",
			);
		}
	} catch (error) {
		console.error("Error connecting to n8n:", error);
		removeTypingIndicator();

		if (error.name === "AbortError") {
			appendMessage(
				"receiver",
				"La conexión está tardando demasiado. Por favor, intenta de nuevo.",
			);
			showToast("Tiempo de espera agotado", "error");
		} else {
			appendMessage(
				"receiver",
				"Hubo un error al conectar. Mostrando respuesta de demostración...",
			);
			setTimeout(() => {
				appendN8nResponse(
					"📝 **Propuesta de copy:**\n\n'Disfrutando de los mejores momentos. ✨ #Vibes #Photography #Moments'\n\n¿Te gusta esta opción?",
				);
			}, 1000);
		}
	} finally {
		isProcessing = false;
	}
}

function focusInput() {
	setTimeout(() => {
		messageInput.focus();
	}, 300);
}

function appendMessage(type, text, imageUrl = null, isUploading = false) {
	const group = document.createElement("div");
	group.className = `message-group ${type}`;
	group.setAttribute("role", "listitem");

	if (imageUrl) {
		const imgContainer = document.createElement("div");
		imgContainer.className = "message-image-container";

		if (isUploading) {
			const skeleton = document.createElement("div");
			skeleton.className = "image-skeleton";
			imgContainer.appendChild(skeleton);
		}

		const img = document.createElement("img");
		img.src = imageUrl;
		img.className = "message-image";
		img.alt = "Imagen compartida";
		img.loading = "lazy";

		if (isUploading) {
			img.style.opacity = "0";
			img.onload = () => {
				img.style.opacity = "1";
				img.style.transition = "opacity 0.3s ease";
				const skeleton = imgContainer.querySelector(".image-skeleton");
				if (skeleton) skeleton.remove();
			};
		}

		imgContainer.appendChild(img);
		group.appendChild(imgContainer);
	}

	if (text) {
		const bubble = document.createElement("div");
		bubble.className = "bubble";
		bubble.textContent = text;
		group.appendChild(bubble);
	}

	const timestamp = document.createElement("div");
	timestamp.className = "message-timestamp";
	timestamp.textContent = getCurrentTime();
	timestamp.setAttribute("aria-label", `Enviado a las ${getCurrentTime()}`);
	group.appendChild(timestamp);

	chatContainer.appendChild(group);
	scrollToBottom();
	saveChatHistory();

	return group;
}

function showTypingIndicator() {
	if (typingIndicatorElement) return;

	const group = document.createElement("div");
	group.className = "message-group receiver";
	group.id = "typing-indicator";

	const indicator = document.createElement("div");
	indicator.className = "typing-indicator";
	indicator.setAttribute("role", "status");
	indicator.setAttribute("aria-label", "Escribiendo...");
	indicator.innerHTML = "<span></span><span></span><span></span>";

	group.appendChild(indicator);
	chatContainer.appendChild(group);
	typingIndicatorElement = group;
	scrollToBottom();
}

function removeTypingIndicator() {
	if (typingIndicatorElement) {
		typingIndicatorElement.style.opacity = "0";
		typingIndicatorElement.style.transform = "translateY(10px)";
		typingIndicatorElement.style.transition = "all 0.2s ease";
		setTimeout(() => {
			typingIndicatorElement?.remove();
			typingIndicatorElement = null;
		}, 200);
	}
}

function appendN8nResponse(text) {
	const group = appendMessage("receiver", text);

	const actions = document.createElement("div");
	actions.className = "action-buttons";

	const likeBtn = document.createElement("button");
	likeBtn.className = "action-btn btn-like";
	likeBtn.innerHTML = "<span>Me gusta</span>";
	likeBtn.setAttribute("aria-label", "Me gusta este copy");
	likeBtn.onclick = () => handleAction("like", text, likeBtn, dislikeBtn);

	const dislikeBtn = document.createElement("button");
	dislikeBtn.className = "action-btn btn-dislike";
	dislikeBtn.innerHTML = "<span>No me gusta</span>";
	dislikeBtn.setAttribute("aria-label", "No me gusta este copy");
	dislikeBtn.onclick = () => handleAction("dislike", text, likeBtn, dislikeBtn);

	actions.appendChild(likeBtn);
	actions.appendChild(dislikeBtn);
	group.appendChild(actions);

	triggerHaptic("success");
	saveChatHistory();
}

async function handleAction(action, text, likeBtn, dislikeBtn) {
	likeBtn.disabled = true;
	dislikeBtn.disabled = true;

	if (action === "like") {
		likeBtn.style.opacity = "1";
		likeBtn.style.transform = "scale(1.05)";
		dislikeBtn.style.opacity = "0.4";
		showToast("¡Gracias por tu feedback!", "success");
		setTimeout(() => {
			appendMessage("sender", "¡Me encanta este copy! 🎉");
		}, 300);
		triggerHaptic("medium");
	} else {
		dislikeBtn.style.opacity = "1";
		dislikeBtn.style.transform = "scale(1.05)";
		likeBtn.style.opacity = "0.4";
		showToast("Generando nuevo copy...", "warning");
		triggerHaptic("medium");

		if (!lastFileName) {
			appendMessage("receiver", "No se encontró el archivo. Envía una nueva imagen.");
			return;
		}

		appendMessage("sender", "¿Puedes darme otra opción?");
		showTypingIndicator();

		try {
			const controller = new AbortController();
			const timeoutId = setTimeout(() => controller.abort(), 30000);

			const payload = {
				callback_query: {
					data: `NO|${lastFileName}`,
					message: { chat: { id: getChatId() } },
					from: { id: getChatId() },
					id: `cb_${Date.now()}`,
				},
			};

			const response = await fetch(N8N_WEBHOOK_URL, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(payload),
				signal: controller.signal,
			});

			clearTimeout(timeoutId);

			if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

			const data = await response.json();
			removeTypingIndicator();

			if (data.copy) {
				if (data.fileName) lastFileName = data.fileName;
				appendN8nResponse(data.copy);
			} else if (data.message) {
				appendMessage("receiver", data.message);
			} else {
				appendMessage("receiver", "No se pudo generar un nuevo copy. Intenta de nuevo.");
			}
		} catch (error) {
			console.error("Error regenerating copy:", error);
			removeTypingIndicator();
			if (error.name === "AbortError") {
				appendMessage("receiver", "La conexión está tardando demasiado. Intenta de nuevo.");
				showToast("Tiempo de espera agotado", "error");
			} else {
				appendMessage("receiver", "Hubo un error al generar un nuevo copy. Intenta de nuevo.");
				showToast("Error al regenerar", "error");
			}
		}
	}
}

async function sendToN8n(file) {
	isProcessing = true;
	showTypingIndicator();

	// 1. Convertimos el archivo a Base64
	const reader = new FileReader();
	reader.readAsDataURL(file);

	reader.onload = async () => {
		const base64Data = reader.result.split(",")[1]; // Extraemos solo el contenido base64

		// 2. Enviamos un JSON en lugar de FormData
		const payload = {
			imageData: base64Data, // El nombre exacto que espera tu n8n
			chatId: getChatId(),
			type: "image",
		};

		try {
			const response = await fetch(N8N_WEBHOOK_URL, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(payload),
			});

			if (!response.ok)
				throw new Error(`HTTP error! status: ${response.status}`);

			const data = await response.json();
			removeTypingIndicator();

			if (data.fileName) lastFileName = data.fileName;

			if (data.copy) {
				appendN8nResponse(data.copy);
			} else {
				appendMessage("receiver", "Imagen recibida y procesada. 🎨");
			}
		} catch (error) {
			console.error("Error connecting to n8n:", error);
			removeTypingIndicator();
			appendN8nResponse("Hubo un error al procesar la imagen.");
		} finally {
			isProcessing = false;
		}
	};
}

function scrollToBottom() {
	requestAnimationFrame(() => {
		chatContainer.scrollTo({
			top: chatContainer.scrollHeight,
			behavior: "smooth",
		});
	});
}

function saveChatHistory() {
	try {
		const messages = chatContainer.innerHTML;
		sessionStorage.setItem("chatHistory", messages);
	} catch (e) {
		console.warn("Could not save chat history");
	}
}

function loadChatHistory() {
	try {
		const history = sessionStorage.getItem("chatHistory");
		if (history) {
			// Optional: Show restore option
			// chatContainer.innerHTML = history;
		}
	} catch (e) {
		console.warn("Could not load chat history");
	}
}

init();
