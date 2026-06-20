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
    stats: async () => {
        const newCount = await incrementDailyCount();
        chrome.runtime.sendMessage({ action: "UPDATE_STATS", applied: newCount, skipped: stats.skipped });
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
        const proto = element.tagName === 'TEXTAREA'
            ? window.HTMLTextAreaElement.prototype
            : window.HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto, 'value').set.call(element, value);
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
    },

    // Закрыть открытую модалку (чтобы не блокировала следующие клики)
    closeModal: () => {
        // HH Magritte: кнопка закрытия окна отклика = data-qa="response-popup-close"
        const closeEl = document.querySelector(
            '[data-qa="response-popup-close"], [data-qa="modal-close"], ' +
            '[data-qa="magritte-modal-close-button"], [data-qa="bloko-modal-close"], ' +
            '.bloko-modal-close, [role="dialog"] button[aria-label*="акрыть"]'
        );
        const closeBtn = closeEl ? (closeEl.closest('button,[role="button"]') || closeEl) : null;
        if (closeBtn) closeBtn.click();
        // Escape как надёжный запасной вариант (проверено на живом HH)
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }));
    }
};

// --- Дневной счётчик с авто-сбросом по дате ---------------------------------
async function getDailyCount() {
    const today = new Date().toISOString().split('T')[0];
    const data = await chrome.storage.local.get(['daily_applied_count', 'last_applied_date']);
    if (data.last_applied_date !== today) {
        await chrome.storage.local.set({ daily_applied_count: 0, last_applied_date: today });
        return 0;
    }
    return data.daily_applied_count || 0;
}

async function incrementDailyCount() {
    const today = new Date().toISOString().split('T')[0];
    const current = await getDailyCount();
    const newCount = current + 1;
    await chrome.storage.local.set({ daily_applied_count: newCount, last_applied_date: today });
    return newCount;
}

async function handleModal(vacancyId) {
    try {
        const modal = await utils.waitForElement('[data-qa="vacancy-response-popup-form-letter-input"], [data-qa="vacancy-response-submit-popup"], [role="dialog"], .magritte-modal, .bloko-modal', 4000);
        if (!modal) return false;

        const modalRoot = modal.closest('[role="dialog"], .magritte-modal, .bloko-modal, [data-qa="bloko-modal"]') || document;
        const modalText = (modalRoot.innerText || "").toLowerCase();

        // Детектор тестов — ТОЛЬКО внутри модалки/страницы отклика, не по всей странице
        const onResponsePage = /\/applicant\/vacancy_response/.test(location.pathname);
        const hasTest =
            onResponsePage ||
            document.querySelector('[data-qa="task-body"]') ||
            document.querySelector('[data-qa="vacancy-response-test-name"]') ||
            modalText.includes('тестовое задание') ||
            modalText.includes('пройти тест') ||
            modalText.includes('дополнительные вопросы');

        if (hasTest) {
            LOGGER.warn(`Вакансия ${vacancyId} требует теста/доп.вопросов. Пропускаем.`);
            utils.closeModal();
            await utils.wait(500);
            return false;
        }

        // Сопроводительное письмо
        if (currentConfig.coverLetterText) {
            // HH Magritte: тумблер письма теперь data-qa="add-cover-letter"
            // (старый vacancy-response-letter-toggle оставлен как фолбэк)
            const addLetterBtn = document.querySelector('[data-qa="add-cover-letter"]') ||
                document.querySelector('[data-qa="vacancy-response-letter-toggle"]') ||
                Array.from(document.querySelectorAll('[role="dialog"] button, .magritte-modal button, button')).find(b => b.innerText.toLowerCase().includes('сопроводительное'));

            if (addLetterBtn && !document.querySelector('[data-qa="vacancy-response-popup-form-letter-input"]')) {
                addLetterBtn.click();
                await utils.wait(800);
            }

            const textarea = await utils.waitForElement('[data-qa="vacancy-response-popup-form-letter-input"], [role="dialog"] textarea, .magritte-modal textarea, .bloko-modal textarea', 3000);
            if (textarea) {
                utils.triggerInputChange(textarea, currentConfig.coverLetterText);
                await utils.wait(500);
            }
        }

        const submitBtn = document.querySelector('[data-qa="vacancy-response-submit-popup"]') ||
            Array.from(document.querySelectorAll('[role="dialog"] button, .magritte-modal button, .bloko-modal button')).find(b => b.innerText.includes('Откликнуться'));

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
        // Проверка дневного лимита (с авто-сбросом по дате)
        const dailyCount = await getDailyCount();
        const data = await chrome.storage.local.get(['responded_ids']);
        const responded = new Set(data.responded_ids || []);

        if (dailyCount >= currentConfig.dailyLimit) {
            LOGGER.warn(`Дневной лимит (${currentConfig.dailyLimit}) достигнут!`);
            isRunning = false;
            break;
        }

        let buttons = Array.from(document.querySelectorAll('[data-qa="vacancy-serp__vacancy_response"]'));
        if (buttons.length === 0) {
            buttons = Array.from(document.querySelectorAll('button, a')).filter(b => b.innerText?.trim() === 'Откликнуться');
        }
        // Пропускаем уже отправленные/неактивные
        buttons = buttons.filter(b => !b.disabled && !/отклик отправлен|резюме отправлено/i.test(b.innerText || ''));

        for (const btn of buttons) {
            if (!isRunning) break;

            // Лимит может быть достигнут в середине страницы
            if ((await getDailyCount()) >= currentConfig.dailyLimit) {
                LOGGER.warn(`Дневной лимит (${currentConfig.dailyLimit}) достигнут!`);
                isRunning = false;
                break;
            }

            const vacancyContainer = btn.closest('[data-qa="vacancy-serp__vacancy"]') || btn.closest('article');
            const title = vacancyContainer?.innerText.toLowerCase() || "";
            // HH (Magritte): кнопка отклика = ссылка вида
            // /applicant/vacancy_response?vacancyId=NNN — id берём из vacancyId,
            // запасной вариант — ссылка с заголовка карточки (/vacancy/NNN).
            const vacancyId =
                btn.href?.match(/[?&]vacancyId=(\d+)/)?.[1] ||
                vacancyContainer?.querySelector('a[href*="/vacancy/"]')?.href.match(/\/vacancy\/(\d+)/)?.[1] ||
                btn.href;

            if (responded.has(vacancyId)) continue;

            // Проверка черного списка
            const isBlacklisted = currentConfig.blacklist.some(word => title.includes(word));
            if (isBlacklisted) {
                LOGGER.warn(`Пропуск (Черный список): ${vacancyId}`);
                stats.skipped++;
                continue;
            }

            // Подсветка
            if (vacancyContainer) vacancyContainer.style.outline = "2px solid #e74c3c";

            btn.scrollIntoView({ behavior: 'smooth', block: 'center' });
            await utils.humanWait(); // Анти-бот задержка

            if (!isRunning) break;
            btn.click();

            // Подтверждение отклика на вакансию в другой стране (релокация)
            const reloc = await utils.waitForElement('[data-qa="relocation-warning-confirm"]', 1500);
            if (reloc) {
                reloc.click();
                await utils.wait(800);
            }

            const success = await handleModal(vacancyId);
            if (success) {
                LOGGER.success(`Отклик отправлен: ${vacancyId}`);
                responded.add(vacancyId);
                await chrome.storage.local.set({ responded_ids: [...responded] });
                await LOGGER.stats();
            } else {
                stats.skipped++;
                chrome.runtime.sendMessage({ action: "UPDATE_STATS", applied: dailyCount, skipped: stats.skipped });
            }

            if (vacancyContainer) vacancyContainer.style.outline = "none";
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
