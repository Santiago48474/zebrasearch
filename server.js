import express from "express";
import fetch from "node-fetch";
import "dotenv/config";

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static("public"));
app.use(express.json());

const SEARXNG_INSTANCES = [
"https://zebrasearxng.onrender.com",
  "https://searx.be",
  "https://priv.au",
  "https://search.inetol.net",
  "https://baresearch.org",
];

app.get("/api/search", async (req, res) => {
  const q = (req.query.q || "").trim();
  const start = parseInt(req.query.start || "1", 10);

  if (!q) {
    return res.status(400).json({ error: "Пустой запрос" });
  }

  const page = Math.floor((start - 1) / 10) + 1;
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

      if (!r.ok) {
        console.log(`[debug] ${instance} ответил статусом ${r.status}`);
        continue;
      }

      const data = await r.json();
      const results = data.results || [];

      if (results.length === 0) {
        console.log(`[debug] ${instance} вернул 0 результатов`);
        continue;
      }

      const items = results.slice(0, 10).map((item) => ({
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

      return res.json({
        items,
        searchInformation: { formattedTotalResults: null, formattedSearchTime: null },
      });
    } catch (err) {
      console.error(`Инстанс ${instance} не ответил:`, err.message);
    }
  }

  // Все инстансы не сработали
  res.json({ items: [], searchInformation: null });
});

// Достаёт токен vqd, нужный DuckDuckGo для запросов картинок
async function getVqd(query) {
  const r = await fetch(
    `https://duckduckgo.com/?q=${encodeURIComponent(query)}`,
    {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        "Accept-Language": "ru-RU,ru;q=0.9,en;q=0.8",
      },
    }
  );
  const html = await r.text();
  const match = html.match(/vqd=['"]?([\d-]+)['"]?/);
  return match ? match[1] : null;
}

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
            role: "system",
            content:
              "Ты дружелюбный помощник внутри поисковика ZebraSearch. Отвечай на русском языке, понятно и по делу.",
          },
          ...messages,
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
