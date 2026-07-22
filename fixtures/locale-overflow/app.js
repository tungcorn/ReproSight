const dict = {
  en: {
    aboutTitle: "About highlights",
    h1: "Deterministic evidence first",
    h1d: "Geometry before model guesses",
    h2: "Isolated worktree repair",
    h2d: "Original checkout stays clean",
    h3: "Human approval required",
    h3d: "No autonomous merge",
  },
  vi: {
    aboutTitle: "Điểm nổi bật",
    h1: "Bằng chứng xác định trước mọi suy luận",
    h1d: "Hình học trước khi mô hình đoán",
    h2: "Sửa chữa trong worktree cô lập hoàn toàn",
    h2d: "Checkout gốc luôn giữ nguyên",
    h3: "Bắt buộc có phê duyệt của con người",
    h3d: "Không tự merge",
  },
};

function applyLocale(locale) {
  const table = dict[locale] || dict.en;
  document.documentElement.lang = locale;
  document.documentElement.setAttribute("data-locale", locale);
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const key = el.getAttribute("data-i18n");
    if (key && table[key]) el.textContent = table[key];
  });
}

document.getElementById("lang-toggle")?.addEventListener("click", () => {
  const cur = document.documentElement.getAttribute("data-locale") || "en";
  applyLocale(cur === "en" ? "vi" : "en");
});

document.getElementById("theme-toggle")?.addEventListener("click", () => {
  const cur = document.documentElement.getAttribute("data-theme") || "dark";
  document.documentElement.setAttribute(
    "data-theme",
    cur === "dark" ? "light" : "dark",
  );
});

// honor query or initial
const params = new URLSearchParams(location.search);
if (params.get("lang") === "vi") applyLocale("vi");
