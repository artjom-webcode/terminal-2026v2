// ==========================================
// 0. DOM
// ==========================================

const textFromPDF = document.querySelector(".text-from-pdf");
const saveBtn = document.querySelector(".save");
const ulTable = document.querySelector(".table");
const filterBtn = document.querySelector(".filter");
const allBtn = document.querySelector(".all");
const addDataBtn = document.querySelector(".add-data");
const closeModalBtn = document.querySelector(".close-modal");
const modal = document.querySelector(".modal");

// ==========================================
// 1. CONSTANTS
// ==========================================

// топливо в строках с температурой (например "5 95 EURO 12.5")
const TEMP_FUELS = [
  "95 EURO",
  "98 EURO",
  "DK SUV",
  "DK SUV F",
  "DK TAL KL1",
  "DK TAL KL2",
  "Petrooleum",
  "JET A-1",
  "HVO",
  "Gasoil 0.1",
];

// топливо в блоках резервуаров (с суффиксами B, D, C)
const BLOCK_FUELS = [
  "95 EURO B",
  "95 EURO D",
  "98 EURO D",
  "DK SUV F",
  "DK SUV C",
  "DK TAL KL1",
  "DK TAL KL2",
  "Petrooleum",
  "JET A-1",
  "HVO",
  "Gasoil 0.1",
];

// ==========================================
// 2. REGEX
// ==========================================

// экранируем спецсимволы, чтобы "JET A-1" и "Gasoil 0.1" искались буквально
const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// "a|b|c", длинные слова первыми: "DK SUV F" должно найтись раньше "DK SUV"
const anyOf = (words) =>
  [...words]
    .sort((a, b) => b.length - a.length)
    .map(escapeRegex)
    .join("|");

const RE = {
  // нормализация
  lineBreaks: /\r\n?/g,
  spaces: /[ \t\u00a0]+/g,

  // строка температуры: номер (1-24), топливо, температура
  tempLine: new RegExp(
    `(?<![\\d.,+-])([1-9]|1\\d|2[0-4]) (${anyOf(TEMP_FUELS)}) ([+-]?\\d+(?:[.,]\\d+)?)(?![\\d.,])`,
    "g",
  ),

  // блок резервуара
  tankBlock: /^(?=\d{3,4}\/\d{3,4} p15 )/m,
  tankNumber: /^(\d+) vcf/m,
  density: /p15 (\d\.\d{4})/,
  certificate: /p15 \d\.\d{4} (.+?) (\d{2}\.\d{2}\.\d{2})/,
  fuelSale: /^(AKC|KOM) fakt\./m,
  blockFuel: new RegExp(anyOf(BLOCK_FUELS)),
};

// ==========================================
// 3. TEXT HELPERS
// ==========================================

// единые переносы строк, одинарные пробелы, без пустых строк
function normalizeText(text) {
  return text
    .replace(RE.lineBreaks, "\n")
    .replace(RE.spaces, " ")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}

// вырезает строки с температурой, возвращает Map(номер -> температура) и остаток текста
function extractTemperatures(text) {
  const temps = new Map();

  const rest = text.replace(RE.tempLine, (_, num, _fuel, temp) => {
    temps.set(Number(num), Number(temp.replace(",", ".")));
    return "";
  });

  return { temps, text: normalizeText(rest) };
}

// ==========================================
// 4. TANK PARSING
// ==========================================

// режем текст на блоки, всё до первого блока выбрасываем
function splitTankBlocks(text) {
  return text
    .split(RE.tankBlock)
    .slice(1)
    .map((block) => block.trim());
}

// один блок текста -> один объект резервуара
function parseTankBlock(block) {
  const tank = block.match(RE.tankNumber)?.[1];
  const density = block.match(RE.density)?.[1];
  const [, certificate, certificateDate] = block.match(RE.certificate) ?? [];

  return {
    tank: tank ? Number(tank) : null,
    fuelName: block.match(RE.blockFuel)?.[0] ?? null,
    density: density ? Number(density) : null,
    certificate: certificate ?? "--",
    certificateDate: certificateDate ?? null,
    fuelSale: block.match(RE.fuelSale)?.[1] ?? null,
    text: block.replace(/\n/g, " "),
    info: "",
    show: false,
  };
}

// ==========================================
// 5. MAIN PARSER
// ==========================================

// текст из PDF -> массив объектов-резервуаров (уже с температурой)
function parseTanks(text) {
  const { temps, text: blocksText } = extractTemperatures(normalizeText(text));

  return splitTankBlocks(blocksText)
    .map(parseTankBlock)
    .map((tank) => ({ ...tank, temp: temps.get(tank.tank) ?? null }));
}

// ==========================================
// 6. STATE
// ==========================================

// все резервуары (из localStorage или пустой массив)
let tanksList = JSON.parse(localStorage.getItem("tanksData")) ?? [];

// включён ли фильтр "только отмеченные"
let isFiltered = localStorage.getItem("isFiltered") === "true";

// номера резервуаров, у которых открыта заметка
const openTanks = new Set();

// ==========================================
// 7. STORAGE
// ==========================================

function saveTanks() {
  localStorage.setItem("tanksData", JSON.stringify(tanksList));
}

function saveFilter() {
  localStorage.setItem("isFiltered", isFiltered);
}

// ==========================================
// 8. RENDER
// ==========================================

// HTML одной карточки резервуара
function tankTemplate(el) {
  return `
    <li class="tank ${el.show ? "tank--active" : ""} ${openTanks.has(el.tank) ? "tank--open" : ""}">
      <input class="tank__show" type="checkbox" data-tank="${el.tank}" ${el.show ? "checked" : ""}>
      <h3 class="tank__nr">${el.tank}</h3>
      <p class="tank__name">${el.fuelName ?? "—"}</p>
      <p class="tank__density">${el.density || "—"}</p>
      <p class="tank__sert">${el.certificate ?? "—"}</p>
      <p class="tank__date">${el.certificateDate ?? "—"}</p>
      <p class="temperature">
        ${el.temp ?? "—"}
        <i class="ri-celsius-line"></i>
      </p>
      <textarea class="tank__info" data-tank="${el.tank}" placeholder="Заметка...">${el.info}</textarea>
    </li>`;
}

// рисуем список с учётом фильтра
function render() {
  const items = isFiltered ? tanksList.filter((t) => t.show) : tanksList;

  ulTable.innerHTML = items.map(tankTemplate).join("");

  // подсвечиваем активную кнопку
  filterBtn.classList.toggle("active", isFiltered);
  allBtn.classList.toggle("active", !isFiltered);
}

// ==========================================
// 9. HELPERS
// ==========================================

// находим резервуар в массиве по номеру
const findTank = (num) => tanksList.find((t) => t.tank === Number(num));

// ==========================================
// 10. EVENTS
// ==========================================

// «Сохранить»: парсим текст, переносим старые info и show
saveBtn.addEventListener("click", () => {
  const parsed = parseTanks(textFromPDF.value);

  // не затираем старые данные пустым результатом
  if (!parsed.length) return;

  // старые данные по номеру резервуара
  const oldData = new Map(tanksList.map((t) => [t.tank, t]));

  tanksList = parsed.map((t) => ({
    ...t,
    info: oldData.get(t.tank)?.info ?? "",
    show: oldData.get(t.tank)?.show ?? false,
  }));

  saveTanks();
  render();
});

// заметка: пишем текст в объект и сохраняем (без перерисовки, чтобы не сбивать курсор)
ulTable.addEventListener("input", (e) => {
  if (!e.target.classList.contains("tank__info")) return;

  const tank = findTank(e.target.dataset.tank);
  if (!tank) return;

  tank.info = e.target.value;
  saveTanks();
});

// ЕДИНСТВЕННЫЙ обработчик кликов по списку
ulTable.addEventListener("click", (e) => {
  const tankEl = e.target.closest(".tank");
  if (!tankEl) return;

  // клик по заметке не трогаем, чтобы не мешать вводу
  if (e.target.closest(".tank__info")) return;

  const checkbox = tankEl.querySelector(".tank__show");
  const tank = findTank(checkbox.dataset.tank);
  if (!tank) return;

  // клик по номеру: открыть/закрыть заметку, выбор не меняем
  if (e.target.closest(".tank__nr")) {
    const isOpen = tankEl.classList.toggle("tank--open");
    if (isOpen) openTanks.add(tank.tank);
    else openTanks.delete(tank.tank);
    return;
  }

  // клик по остальной карточке: переключаем выбор
  if (e.target !== checkbox) checkbox.checked = !checkbox.checked;

  tank.show = checkbox.checked;
  tankEl.classList.toggle("tank--active", tank.show);
  saveTanks();

  // в режиме фильтра снятая карточка сразу исчезает
  if (isFiltered) render();
});

allBtn.addEventListener("click", () => {
  isFiltered = false;
  saveFilter();
  render();
});

filterBtn.addEventListener("click", () => {
  isFiltered = true;
  saveFilter();
  render();
});

addDataBtn.addEventListener("click", () => {
  modal.classList.add("modal-open");
});

closeModalBtn.addEventListener("click", () => {
  modal.classList.remove("modal-open");
});

// ==========================================
// 11. INIT
// ==========================================

render();

// =============================================
// NOTES
// =============================================
const notesBtn = document.querySelector(".notesBtn");
const notesBlock = document.querySelector(".notes");
const notesArea = document.querySelector(".notes__area");

// Functions
function leaveNotesOpenIfNotEmpty() {
  if (notesArea.value) {
    notesBlock.classList.add("notes--open");
  }
}
function takeNoteFromLocalAndShow() {
  notesArea.value = localStorage.getItem("notesText") ?? "";
}

// EventListeners
notesBtn.addEventListener("click", () => {
  notesBlock.classList.toggle("notes--open");
});

notesArea.addEventListener("input", () => {
  const textInTextArea = notesArea.value;

  localStorage.setItem("notesText", textInTextArea);
});

takeNoteFromLocalAndShow();
leaveNotesOpenIfNotEmpty();
