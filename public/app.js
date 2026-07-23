const form = document.getElementById("searchForm");
const input = document.getElementById("query");
const statusEl = document.getElementById("status");
const resultsEl = document.getElementById("results");
const imageResultsEl = document.getElementById("imageResults");
const historyListEl = document.getElementById("historyList");
const favoritesListEl = document.getElementById("favoritesList");
const paginationEl = document.getElementById("pagination");
const themeBtn = document.getElementById("themeBtn");
const favBtn = document.getElementById("favBtn");
const tabs = document.querySelectorAll(".tab");
const chatSection = document.getElementById("chatSection");
const chatMessagesEl = document.getElementById("chatMessages");
const chatForm = document.getElementById("chatForm");
const chatInput = document.getElementById("chatInput");

let chatHistory = [];

let currentQuery = "";
let currentStart = 1;
let activeTab = "web";

// ===== Темы =====
const themes = ["theme-white", "theme-red", "theme-green", "theme-blue"];
function applyTheme(theme) {
  themes.forEach((t) => document.body.classList.remove(t));
  if (theme !== "theme-white") document.body.classList.add(theme);
  localStorage.setItem("zs_theme", theme);
}
themeBtn.addEventListener("click", () => {
  const current = localStorage.getItem("zs_theme") || "theme-white";
  const next = themes[(themes.indexOf(current) + 1) % themes.length];
  applyTheme(next);
});
applyTheme(localStorage.getItem("zs_theme") || "theme-white");

// ===== История и избранное (localStorage) =====
function getHistory() {
  return JSON.parse(localStorage.getItem("zs_history") || "[]");
}
function addToHistory(q) {
  let h = getHistory().filter((item) => item !== q);
  h.unshift(q);
  h = h.slice(0, 30);
  localStorage.setItem("zs_history", JSON.stringify(h));
}
function getFavorites() {
  return JSON.parse(localStorage.getItem("zs_favorites") || "[]");
}
function isFavorite(q) {
  return getFavorites().includes(q);
}
function toggleFavorite(q) {
  let f = getFavorites();
  if (f.includes(q)) {
    f = f.filter((item) => item !== q);
  } else {
    f.unshift(q);
  }
  localStorage.setItem("zs_favorites", JSON.stringify(f));
  updateFavButton();
}
function updateFavButton() {
  const q = input.value.trim();
  favBtn.classList.toggle("active", q && isFavorite(q));
}
favBtn.addEventListener("click", () => {
  const q = input.value.trim();
  if (!q) return;
  toggleFavorite(q);
});
input.addEventListener("input", updateFavButton);

function renderList(container, items, emptyText, onClear) {
  if (items.length === 0) {
    container.innerHTML = `<div class="empty-note">${emptyText}</div>`;
    return;
  }
  container.innerHTML = items
    .map(
      (q) => `
    <div class="side-item">
      <span data-q="${escapeAttr(q)}">${escapeHtml(q)}</span>
      <button data-remove="${escapeAttr(q)}">✕</button>
    </div>`
    )
    .join("");

  container.querySelectorAll("span[data-q]").forEach((el) => {
    el.addEventListener("click", () => {
      input.value = el.dataset.q;
      switchTab("web");
      form.requestSubmit();
    });
  });
  container.querySelectorAll("button[data-remove]").forEach((el) => {
    el.addEventListener("click", () => {
      onClear(el.dataset.remove);
      renderCurrentList();
    });
  });
}

function renderCurrentList() {
  if (activeTab === "history") {
    renderList(historyListEl, getHistory(), "История пуста", (q) => {
      const h = getHistory().filter((item) => item !== q);
      localStorage.setItem("zs_history", JSON.stringify(h));
    });
  }
  if (activeTab === "favorites") {
    renderList(favoritesListEl, getFavorites(), "Пока ничего не сохранено", (q) => {
      const f = getFavorites().filter((item) => item !== q);
      localStorage.setItem("zs_favorites", JSON.stringify(f));
    });
  }
}

// ===== Вкладки =====
function switchTab(tab) {
  activeTab = tab;
  tabs.forEach((t) => t.classList.toggle("active", t.dataset.tab === tab));

  resultsEl.hidden = tab !== "web";
  imageResultsEl.hidden = tab !== "images";
  historyListEl.hidden = tab !== "history";
  favoritesListEl.hidden = tab !== "favorites";
  chatSection.hidden = tab !== "chat";
  paginationEl.hidden = tab !== "web";
  statusEl.hidden = tab === "history" || tab === "favorites" || tab === "chat";
  document.getElementById("searchForm").hidden = tab === "chat";

  if (tab === "history" || tab === "favorites") {
    renderCurrentList();
  } else if (tab === "chat") {
    chatInput.focus();
  } else if (currentQuery) {
    doSearch();
  }
}
tabs.forEach((t) => t.addEventListener("click", () => switchTab(t.dataset.tab)));

// ===== Поиск =====
form.addEventListener("submit", (e) => {
  e.preventDefault();
  const q = input.value.trim();
  if (!q) return;
  currentQuery = q;
  currentStart = 1;
  addToHistory(q);
  updateFavButton();
  if (activeTab === "history" || activeTab === "favorites") switchTab("web");
  else doSearch();
});

async function doSearch() {
  if (activeTab === "images") return doImageSearch();

  resultsEl.innerHTML = "";
  paginationEl.innerHTML = "";
  statusEl.textContent = "Ищу...";
  fetchAiAnswer(currentQuery);

  try {
    const res = await fetch(
      `/api/search?q=${encodeURIComponent(currentQuery)}&start=${currentStart}`
    );
    const data = await res.json();

    if (data.error) {
      statusEl.textContent = "Ошибка: " + data.error;
      return;
    }
    if (!data.items || data.items.length === 0) {
      statusEl.textContent = "Ничего не найдено";
      return;
    }

    statusEl.textContent = "";
    renderResults(data.items);
    renderPagination();
  } catch (err) {
    statusEl.textContent = "Не удалось выполнить поиск";
    console.error(err);
  }
}

async function doImageSearch() {
  imageResultsEl.innerHTML = "";
  statusEl.textContent = "Ищу картинки...";

  try {
    const res = await fetch(`/api/search/images?q=${encodeURIComponent(currentQuery)}`);
    const data = await res.json();

    if (data.error) {
      statusEl.textContent = "Ошибка: " + data.error;
      return;
    }
    if (!data.items || data.items.length === 0) {
      statusEl.textContent = "Ничего не найдено";
      return;
    }

    statusEl.textContent = "";
    imageResultsEl.innerHTML = data.items
      .map(
        (img) => `
      <a class="image-card" href="${escapeAttr(img.source)}" target="_blank" rel="noopener noreferrer">
        <img src="${escapeAttr(img.thumbnail || img.image)}" alt="${escapeAttr(img.title || "")}" loading="lazy" />
      </a>`
      )
      .join("");
  } catch (err) {
    statusEl.textContent = "Не удалось выполнить поиск картинок";
    console.error(err);
  }
}

async function fetchAiAnswer(q) {
  const aiEl = document.getElementById("aiAnswer");
  aiEl.hidden = true;
  aiEl.innerHTML = "";
  try {
    const res = await fetch(`/api/ai?q=${encodeURIComponent(q)}`);
    const data = await res.json();
    if (data.answer) {
      aiEl.hidden = false;
      aiEl.innerHTML = `
        <div class="ai-answer-label">AI-ответ</div>
        <div class="ai-answer-text">${escapeHtml(data.answer)}</div>
      `;
    }
  } catch (err) {
    console.error("AI-ответ недоступен:", err);
  }
}

function renderResults(items) {
  resultsEl.innerHTML = items
    .map(
      (item) => `
    <a class="result-card" href="${escapeAttr(item.link)}" target="_blank" rel="noopener noreferrer">
      ${
        item.thumbnail
          ? `<img class="result-thumb" src="${escapeAttr(item.thumbnail)}" alt="" loading="lazy" />`
          : ""
      }
      <div class="result-body">
        <div class="result-link">${escapeHtml(item.displayLink || "")}</div>
        <div class="result-title">${escapeHtml(item.title || "")}</div>
        <div class="result-snippet">${escapeHtml(item.snippet || "")}</div>
      </div>
    </a>
  `
    )
    .join("");
}

function renderPagination() {
  paginationEl.innerHTML = "";
  if (currentStart > 1) {
    const prevBtn = document.createElement("button");
    prevBtn.className = "page-btn";
    prevBtn.textContent = "← Назад";
    prevBtn.onclick = () => {
      currentStart = Math.max(1, currentStart - 10);
      doSearch();
      window.scrollTo({ top: 0, behavior: "smooth" });
    };
    paginationEl.appendChild(prevBtn);
  }
  const nextBtn = document.createElement("button");
  nextBtn.className = "page-btn";
  nextBtn.textContent = "Далее →";
  nextBtn.onclick = () => {
    currentStart += 10;
    doSearch();
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  paginationEl.appendChild(nextBtn);
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}
function escapeAttr(str) {
  return escapeHtml(str).replace(/"/g, "&quot;");
}

// ===== Чат =====
function renderChat() {
  chatMessagesEl.innerHTML = chatHistory
    .map(
      (m) =>
        `<div class="chat-msg ${m.role}">${escapeHtml(m.content)}</div>`
    )
    .join("");
  chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
}

chatForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = chatInput.value.trim();
  if (!text) return;

  chatHistory.push({ role: "user", content: text });
  chatInput.value = "";
  renderChat();

  const loadingEl = document.createElement("div");
  loadingEl.className = "chat-msg assistant loading";
  loadingEl.textContent = "Печатает...";
  chatMessagesEl.appendChild(loadingEl);
  chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: chatHistory }),
    });
    const data = await res.json();

    loadingEl.remove();

    if (data.error) {
      chatHistory.push({ role: "assistant", content: "Ошибка: " + data.error });
    } else {
      chatHistory.push({ role: "assistant", content: data.reply });
    }
    renderChat();
  } catch (err) {
    loadingEl.remove();
    chatHistory.push({ role: "assistant", content: "Не удалось получить ответ." });
    renderChat();
    console.error(err);
  }
});
