import express from "express";
import fetch from "node-fetch";
import "dotenv/config";

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static("public"));
app.use(express.json());

// Поиск через Wikipedia (официальный API, стабилен, не банит) + SearXNG как резерв
async function searchWikipedia(q, lang = "ru") {
  const url = `https://${lang}.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(
    q
  )}&format=json&srlimit=10&origin=*`;
  const r = await fetch(url, {
    headers: { "User-Agent": "ZebraSearch/1.0" },
  });
  if (!r.ok) return [];
  const data = await r.json();
  const results = data.query?.search || [];
  return results.map((item) => ({
    title: item.title,
    link: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(
      item.title.replace(/ /g, "_")
    )}`,
    snippet: item.snippet.replace(/<\/?span[^>]*>/g, ""),
    displayLink: `${lang}.wikipedia.org`,
    thumbnail: null,
  }));
}

const SEARXNG_INSTANCES = [
  "https://zebrasearxng.onrender.com",
  "https://searx.be",
  "https://priv.au",
];

async function searchSearXNG(q, page) {
  const headers = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    "Accept-Language": "ru-RU,ru;q=0.9,en;q=0.8",
  };

  for (const instance of SEARXNG_INSTANCES) {
    try {
      const url = `${instance}/search?q=${encodeURIComponent(
        q
      )}&format=json&pageno=${page}&language=ru`;
      const r = await fetch(url, { headers });
      if (!r.ok) continue;
      const data = await r.json();
      const results = data.results || [];
      if (results.length === 0) continue;

      return results.slice(0, 10).map((item) => ({
        title: item.title || "",
        link: item.url || "",
        snippet: item.content || "",
        displayLink: (() => {
          try {
            return new URL(item.url).hostname;
          } catch {
            return "";
          }
        })(),
        thumbnail: item.img_src || item.thumbnail || null,
      }));
    } catch (err) {
      console.error(`SearXNG ${instance} не ответил:`, err.message);
    }
  }
  return [];
}

app.get("/api/search", async (req, res) => {
  const q = (req.query.q || "").trim();
  const start = parseInt(req.query.start || "1", 10);

  if (!q) {
    return res.status(400).json({ error: "Пустой запрос" });
  }

  const page = Math.floor((start - 1) / 10) + 1;

  try {
    // Сначала пробуем SearXNG (даёт более широкий поиск по интернету)
    let items = await searchSearXNG(q, page);

    // Если SearXNG не дал результатов — подстраховываемся Wikipedia
    if (items.length === 0) {
      items = await searchWikipedia(q);
    }

    res.json({
      items,
      searchInformation: { formattedTotalResults: null, formattedSearchTime: null },
    });
  } catch (err) {
    console.error("Ошибка поиска:", err.message);
    res.status(500).json({ error: "Не удалось выполнить поиск" });
  }
});

app.get("/api/search/images", async (req, res) => {
  const q = (req.query.q || "").trim();
  if (!q) return res.status(400).json({ error: "Пустой запрос" });

  try {
    const vqd = await getVqd(q);
    if (!vqd) {
      return res.status(502).json({ error: "Не удалось получить токен поиска" });
    }

    const url = `https://duckduckgo.com/i.js?q=${encodeURIComponent(
      q
    )}&vqd=${vqd}`;

    const r = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        Referer: "https://duckduckgo.com/",
      },
    });

    if (!r.ok) {
      return res.status(502).json({ error: "DuckDuckGo не ответил" });
    }

    const data = await r.json();
    const items = (data.results || []).slice(0, 24).map((img) => ({
      title: img.title,
      image: img.image,
      thumbnail: img.thumbnail,
      source: img.url,
      width: img.width,
      height: img.height,
    }));

    res.json({ items });
  } catch (err) {
    console.error("Ошибка поиска картинок:", err.message);
    res.status(500).json({ error: "Не удалось выполнить поиск картинок" });
  }
});

// ===== Чат с Groq (с историей сообщений) =====
app.post("/api/chat", async (req, res) => {
  const messages = req.body.messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: "Пустая история сообщений" });
  }

  const groqKey = process.env.GROQ_API_KEY;
  if (!groqKey) {
    return res.status(500).json({ error: "GROQ_API_KEY не настроен в .env" });
  }

  // Если в последнем сообщении есть картинка — используем vision-модель
  const lastMsg = messages[messages.length - 1];
  const hasImage = lastMsg && lastMsg.image;

  const model = hasImage
    ? "meta-llama/llama-4-scout-17b-16e-instruct"
    : "llama-3.3-70b-versatile";

  // Формируем сообщения, преобразуя картинку в формат vision API
  const formattedMessages = messages.map((m, i) => {
    if (i === messages.length - 1 && m.image) {
      return {
        role: m.role,
        content: [
          { type: "text", text: m.content || "Что на этой картинке?" },
          { type: "image_url", image_url: { url: m.image } },
        ],
      };
    }
    return { role: m.role, content: m.content };
  });

  try {
    const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${groqKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.7,
        max_tokens: 2048,
        messages: [
          {
            role: "system",
            content:
              "Ты умный, эрудированный помощник внутри поисковика ZebraSearch. Отвечай на русском языке. Давай развёрнутые, содержательные и точные ответы, объясняй сложные темы понятно, приводи примеры где это уместно. Если вопрос простой — отвечай кратко, если сложный — не бойся дать подробное объяснение.",
          },
          ...formattedMessages,
        ],
      }),
    });

    const data = await r.json();

    if (data.error) {
      console.error("Ошибка Groq:", data.error.message);
      return res.status(502).json({ error: data.error.message });
    }

    const reply = data.choices?.[0]?.message?.content?.trim() || "";
    res.json({ reply });
  } catch (err) {
    console.error("Ошибка запроса к Groq:", err.message);
    res.status(500).json({ error: "Не удалось получить ответ" });
  }
});

// ===== Короткий AI-ответ под результатами поиска =====
app.get("/api/ai", async (req, res) => {
  const q = (req.query.q || "").trim();
  if (!q) return res.status(400).json({ error: "Пустой запрос" });

  const groqKey = process.env.GROQ_API_KEY;
  if (!groqKey) {
    return res.json({ answer: null });
  }

  try {
    const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${groqKey}`,
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: [
          {
            role: "user",
            content: `Кратко и по делу ответь на вопрос (2-4 предложения, на русском языке): ${q}`,
          },
        ],
      }),
    });

    const data = await r.json();

    if (data.error) {
      console.error("Ошибка Groq:", data.error.message);
      return res.json({ answer: null });
    }

    const answer = data.choices?.[0]?.message?.content?.trim() || null;
    res.json({ answer });
  } catch (err) {
    console.error("Ошибка запроса к Groq:", err.message);
    res.json({ answer: null });
  }
});

app.listen(PORT, () => {
  console.log(`ZebraSearch запущен: http://localhost:${PORT}`);
});
