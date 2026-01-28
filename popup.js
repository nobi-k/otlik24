document.addEventListener('DOMContentLoaded', async () => {
    // Безопасный поиск элементов
    const getEl = (id) => document.getElementById(id);
    
    const letterText = getEl('letterText');
    const startBtn = getEl('startBtn');
    const statusBadge = getEl('statusBadge');
    const dailyLimitInput = getEl('dailyLimit');
    const limitDisplay = getEl('limitDisplay');
    const blacklistInput = getEl('blacklist');
    const templateBtns = document.querySelectorAll('.template-btn');
    const exportBtn = getEl('exportBtn');
    const headerTitleArea = getEl('headerTitleArea');
    
    const statApplied = getEl('statApplied');
    const statSkipped = getEl('statSkipped');
    const statHistory = getEl('statHistory');

    const varStyles = getComputedStyle(document.documentElement);

    let isAutomationActive = false;
    let currentTemplateId = 0;
    let templates = ["", "", ""];

    try {
        // 1. Загружаем сохраненные данные
        const data = await chrome.storage.local.get([
            'hh_templates', 
            'hh_current_template_id', 
            'hh_daily_limit', 
            'hh_blacklist',
            'responded_ids',
            'daily_applied_count',
            'last_applied_date'
        ]);
        
        // Инициализация шаблонов
        if (data.hh_templates && Array.isArray(data.hh_templates)) {
            templates = data.hh_templates;
        } else {
            templates[0] = `Добрый день!\nЯ заинтересован(а) в этой позиции и уверен(а), что мой опыт и навыки соответствуют требованиям вакансии.\n\nС уважением, [Ваше имя]`;
        }
        
        currentTemplateId = data.hh_current_template_id || 0;
        updateTemplateUI(currentTemplateId);

        // Инициализация лимитов и черного списка
        if (dailyLimitInput) {
            dailyLimitInput.value = data.hh_daily_limit || 50;
            if (limitDisplay) limitDisplay.innerText = dailyLimitInput.value;
        }
        if (blacklistInput) blacklistInput.value = data.hh_blacklist || "";

        // Инициализация статистики
        if (data.responded_ids && statHistory) statHistory.innerText = data.responded_ids.length;
        
        const today = new Date().toISOString().split('T')[0];
        if (data.last_applied_date === today) {
            if (statApplied) statApplied.innerText = data.daily_applied_count || 0;
        } else {
            if (statApplied) statApplied.innerText = 0;
            chrome.storage.local.set({ daily_applied_count: 0, last_applied_date: today });
        }
    } catch (err) {
        console.error("Ошибка загрузки данных:", err);
    }

    // 2. Обработчики интерфейса
    dailyLimitInput.addEventListener('input', (e) => {
        limitDisplay.innerText = e.target.value;
    });

    templateBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            // Сохраняем текущий текст перед переключением
            templates[currentTemplateId] = letterText.value;
            
            currentTemplateId = parseInt(btn.dataset.id);
            updateTemplateUI(currentTemplateId);
        });
    });

    function updateTemplateUI(id) {
        templateBtns.forEach(b => b.classList.toggle('active', parseInt(b.dataset.id) === id));
        letterText.value = templates[id] || "";
    }

    // 3. Проверка текущей страницы
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const isHH = tab?.url?.includes('hh.ru');
    
    if (isHH) {
        try {
            const response = await chrome.tabs.sendMessage(tab.id, { action: "PING" });
            if (response?.status === "alive" && response.isRunning) setStopState();
        } catch (e) {
            console.warn("[ОТКЛИК24] Ошибка связи:", e);
            statusBadge.innerText = 'Обновите страницу';
            statusBadge.style.background = 'rgba(248, 81, 73, 0.1)'; // Мягкий красный фон
            statusBadge.style.color = '#f85149'; // Яркий красный текст
            statusBadge.style.borderColor = 'rgba(248, 81, 73, 0.4)';
            startBtn.disabled = true;
        }
    } else {
        statusBadge.innerText = 'Не на HH.ru';
        statusBadge.style.background = 'rgba(248, 81, 73, 0.1)';
        statusBadge.style.color = '#f85149';
        statusBadge.style.borderColor = 'rgba(248, 81, 73, 0.4)';
        startBtn.disabled = true;
    }

    // 4. Слушаем сообщения от контент-скрипта
    chrome.runtime.onMessage.addListener((message) => {
        if (message.action === "UPDATE_STATS") {
            statApplied.innerText = message.applied;
            statSkipped.innerText = message.skipped;
        } else if (message.action === "AUTOMATION_FINISHED") {
            setStartState();
        }
    });

    // 5. Логика кнопок
    startBtn.addEventListener('click', async () => {
        if (!isAutomationActive) {
            const text = letterText.value.trim();
            if (!text) {
                alert('Пожалуйста, введите текст сопроводительного письма');
                return;
            }

            // Сохраняем всё перед запуском
            templates[currentTemplateId] = text;
            const settings = {
                hh_templates: templates,
                hh_current_template_id: currentTemplateId,
                hh_daily_limit: parseInt(dailyLimitInput.value),
                hh_blacklist: blacklistInput.value
            };
            await chrome.storage.local.set(settings);
            
            try {
                await chrome.tabs.sendMessage(tab.id, { 
                    action: "START_AUTOMATION", 
                    text: templates[currentTemplateId],
                    limit: settings.hh_daily_limit,
                    blacklist: settings.hh_blacklist
                });
                setStopState();
            } catch (err) { console.error(err); }
        } else {
            try {
                await chrome.tabs.sendMessage(tab.id, { action: "STOP_AUTOMATION" });
                setStartState();
            } catch (err) { console.error(err); }
        }
    });

    exportBtn.addEventListener('click', async () => {
        const data = await chrome.storage.local.get(['responded_ids']);
        if (!data.responded_ids || data.responded_ids.length === 0) {
            alert('История пуста');
            return;
        }
        const csvContent = "data:text/csv;charset=utf-8,VacancyID\n" + data.responded_ids.join("\n");
        const encodedUri = encodeURI(csvContent);
        const link = document.createElement("a");
        link.setAttribute("href", encodedUri);
        link.setAttribute("download", `hh_history_${new Date().toLocaleDateString()}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    });

    if (headerTitleArea) {
        headerTitleArea.addEventListener('click', () => {
            chrome.tabs.create({ url: 'https://t.me/kopirajchu' });
        });
    }

    function setStopState() {
        isAutomationActive = true;
        startBtn.innerText = 'Остановить';
        startBtn.style.background = 'rgba(255, 255, 255, 0.05)';
        startBtn.style.color = varStyles.getPropertyValue('--text-muted').trim() || '#8b949e';
        startBtn.style.border = '1px solid var(--border-color)';
        startBtn.style.boxShadow = 'none';

        statusBadge.innerText = 'Активен';
        statusBadge.style.background = 'rgba(0, 245, 160, 0.1)';
        statusBadge.style.color = varStyles.getPropertyValue('--accent-color').trim() || '#00f5a0';
        statusBadge.style.borderColor = 'rgba(0, 245, 160, 0.4)';
    }

    function setStartState() {
        isAutomationActive = false;
        startBtn.innerText = 'Запустить автоотклик';
        startBtn.style.background = varStyles.getPropertyValue('--accent-color').trim() || '#00f5a0';
        startBtn.style.color = '#000';
        startBtn.style.border = 'none';
        startBtn.style.boxShadow = '0 4px 15px rgba(0, 245, 160, 0.2)';

        statusBadge.innerText = 'Готов';
        statusBadge.style.background = 'rgba(255, 255, 255, 0.05)';
        statusBadge.style.color = varStyles.getPropertyValue('--text-muted').trim() || '#8b949e';
        statusBadge.style.borderColor = varStyles.getPropertyValue('--border-color').trim() || '#30363d';
    }
});
