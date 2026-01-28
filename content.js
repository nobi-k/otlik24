// Контент-скрипт для расширения ОТКЛИК24

console.log("%c[ОТКЛИК24] Скрипт инициализирован", 'color: #8e44ad; font-weight: bold');

let isRunning = false;
let stats = { applied: 0, skipped: 0 };
let currentConfig = {
    dailyLimit: 50,
    blacklist: [],
    coverLetterText: ""
};

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "START_AUTOMATION") {
        if (isRunning) return;
        isRunning = true;
        currentConfig.dailyLimit = request.limit || 50;
        currentConfig.coverLetterText = request.text || "";
        currentConfig.blacklist = (request.blacklist || "").split(',').map(s => s.trim().toLowerCase()).filter(s => s);
        
        LOGGER.info(`Запуск. Лимит: ${currentConfig.dailyLimit}, ЧС: ${currentConfig.blacklist.length}`);
        runAutomation();
        sendResponse({ status: "started" });
    } else if (request.action === "STOP_AUTOMATION") {
        isRunning = false;
        sendResponse({ status: "stopped" });
    } else if (request.action === "PING") {
        sendResponse({ status: "alive", isRunning: isRunning });
    }
    return true; 
});

const LOGGER = {
    info: (msg) => { /* минимизировано */ },
    success: (msg) => console.log(`%c[ОТКЛИК24] ✅ ${msg}`, 'color: #00f5a0; font-weight: bold'),
    warn: (msg) => console.warn(`[ОТКЛИК24] ⚠️ ${msg}`),
    error: (msg, err) => console.error(`[ОТКЛИК24] ❌ ${msg}`, err || ''),
    stats: async (applied, skipped) => {
        const data = await chrome.storage.local.get(['daily_applied_count']);
        const newCount = (data.daily_applied_count || 0) + 1;
        await chrome.storage.local.set({ daily_applied_count: newCount });
        chrome.runtime.sendMessage({ action: "UPDATE_STATS", applied: newCount, skipped });
    }
};

const utils = {
    // Анти-бот задержка: случайное число от 1500 до 3500 мс
    humanWait: () => new Promise(res => setTimeout(res, 1500 + Math.random() * 2000)),
    wait: (ms) => new Promise(res => setTimeout(res, ms)),
    
    waitForElement: async (selector, timeout = 5000) => {
        const start = Date.now();
        while (Date.now() - start < timeout) {
            if (!isRunning) return null;
            const el = document.querySelector(selector);
            if (el && el.offsetParent !== null) return el;
            await new Promise(res => requestAnimationFrame(res));
        }
        return null;
    },

    triggerInputChange: (element, value) => {
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
        nativeInputValueSetter.call(element, value);
        element.dispatchEvent(new Event('input', { bubbles: true }));
    }
};

async function handleModal(vacancyId) {
    try {
        const modal = await utils.waitForElement('[data-qa="vacancy-response-submit-popup"], .bloko-modal-container', 4000);
        if (!modal) return false;

        // Детектор тестов
        const hasTest = document.body.innerText.includes('тестовое задание') || document.body.innerText.includes('пройти тест');
        if (hasTest) {
            LOGGER.warn(`Вакансия ${vacancyId} требует теста. Пропускаем.`);
            return false;
        }

        const addLetterBtn = document.querySelector('[data-qa="vacancy-response-letter-toggle"]') || 
                           Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('сопроводительное'));
        
        if (addLetterBtn) {
            addLetterBtn.click();
            await utils.wait(800);
        }

        const textarea = await utils.waitForElement('[data-qa="vacancy-response-popup-form-letter-input"], textarea', 3000);
        if (textarea) {
            utils.triggerInputChange(textarea, currentConfig.coverLetterText);
            await utils.wait(500);
        }

        const submitBtn = document.querySelector('[data-qa="vacancy-response-submit-popup"]') || 
                         Array.from(document.querySelectorAll('button.bloko-button_kind-primary')).find(b => b.innerText.includes('Откликнуться'));
        
        if (submitBtn && isRunning) {
            submitBtn.click();
            await utils.wait(1500);
            return true;
        }
    } catch (err) { LOGGER.error("Ошибка модалки", err); }
    return false;
}

async function runAutomation() {
    while (isRunning) {
        // Проверка дневного лимита
        const data = await chrome.storage.local.get(['daily_applied_count', 'responded_ids']);
        const dailyCount = data.daily_applied_count || 0;
        const responded = new Set(data.responded_ids || []);

        if (dailyCount >= currentConfig.dailyLimit) {
            LOGGER.warn(`Дневной лимит (${currentConfig.dailyLimit}) достигнут!`);
            isRunning = false;
            break;
        }

        let buttons = Array.from(document.querySelectorAll('[data-qa="vacancy-serp__vacancy_response"]'));
        if (buttons.length === 0) {
            buttons = Array.from(document.querySelectorAll('button, a')).filter(b => b.innerText?.includes('Откликнуться'));
        }

        for (const btn of buttons) {
            if (!isRunning) break;

            const vacancyContainer = btn.closest('[data-qa="vacancy-serp__vacancy"]');
            const title = vacancyContainer?.innerText.toLowerCase() || "";
            const vacancyId = btn.href?.match(/\/vacancy\/(\d+)/)?.[1] || btn.href;

            if (responded.has(vacancyId)) continue;

            // Проверка черного списка
            const isBlacklisted = currentConfig.blacklist.some(word => title.includes(word));
            if (isBlacklisted) {
                LOGGER.warn(`Пропуск (Черный список): ${vacancyId}`);
                stats.skipped++;
                continue;
            }

            // Подсветка
            if (vacancyContainer) vacancyContainer.style.border = "2px solid #e74c3c";
            
            btn.scrollIntoView({ behavior: 'smooth', block: 'center' });
            await utils.humanWait(); // Анти-бот задержка
            
            if (!isRunning) break;
            btn.click();

            const success = await handleModal(vacancyId);
            if (success) {
                LOGGER.success(`Отклик отправлен: ${vacancyId}`);
                responded.add(vacancyId);
                await chrome.storage.local.set({ responded_ids: [...responded] });
                await LOGGER.stats(stats.applied, stats.skipped);
            } else {
                stats.skipped++;
            }

            if (vacancyContainer) vacancyContainer.style.border = "none";
            await utils.humanWait();
        }

        if (!isRunning) break;

        const nextBtn = document.querySelector('[data-qa="pager-next"]') || document.querySelector('[data-qa="applicant-index-search-all-results-button"]');
        if (nextBtn) {
            nextBtn.click();
            await utils.wait(4000);
        } else {
            isRunning = false;
        }
    }
    isRunning = false;
    chrome.runtime.sendMessage({ action: "AUTOMATION_FINISHED" });
}
