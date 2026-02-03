var $ = layui.$;
layui.use(['element', 'form'], function(){
    var element = layui.element;
    var form = layui.form;
    // 确保 element 初始化，以便 tab 切换正常工作
    element.init(); 
});

document.addEventListener('DOMContentLoaded', () => {
    const ruleListElement = document.getElementById('ruleList');
    const currentHostElement = document.getElementById('currentHost');
    const addCurrentBtn = document.getElementById('addCurrentAsBlacklist');
    const STORAGE_KEY = 'autoVerifyRules'; // 规则存储键
    let currentHost = null;
    let rules = []; // 用于缓存规则列表

    // 关键词管理相关 DOM 和变量
    const keywordListElement = document.getElementById('keywordList');
    const exportKeywordsBtn = document.getElementById('exportKeywords');
    const importKeywordsTriggerBtn = document.getElementById('importKeywordsTrigger');
    const importKeywordsFileInput = document.getElementById('importKeywordsFile');
    const KEYWORD_STORAGE_KEY = 'autoVerifyKeywords'; // 关键词存储键
    let keywords = []; // 用于缓存关键词列表

    let form = null; // Layui form 实例
    let layer = null; // Layui layer 实例

    layui.use(['form', 'layer', 'element'], function(){
        form = layui.form;
        layer = layui.layer;
        var element = layui.element; // 用于确保 Tab 初始化
        element.init(); // 初始化 Tab，确保切换等功能正常

        // 监听规则表单提交事件
        form.on('submit(addRule)', function(data){
            const newRule = data.field;
            addRule(newRule);
            return false; 
        });

        // 快速添加当前网站到黑名单 (规则)
        if (addCurrentBtn) {
            addCurrentBtn.addEventListener('click', () => {
                if (currentHost) {
                    const rule = { pattern: currentHost, type: 'blacklist', match: 'exact' };
                    addRule(rule);
                } else {
                    if (layer) layer.msg('无法获取当前网站域名', {icon: 2});
                }
            });
        }
        
        // 监听关键词表单提交事件
        form.on('submit(addKeyword)', function(data){
            const newKeywordData = data.field; // { keywordText: '...', keywordType: '...', keywordPurpose: '...' }
            if (!newKeywordData.keywordText || !newKeywordData.keywordText.trim()) {
                if (layer) layer.msg('关键词文本不能为空', {icon: 7});
                return false;
            }
            const keywordToAdd = {
                id: 'kw_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
                text: newKeywordData.keywordText.trim(),
                type: newKeywordData.keywordType,
                purpose: newKeywordData.keywordPurpose || 'match', // 确保有 purpose 字段，默认为 match
                enabled: true
            };
            addKeyword(keywordToAdd);
            // 清空表单
            const keywordFormElement = document.querySelector("form[lay-filter='keywordForm']");
            if (keywordFormElement) {
                keywordFormElement.reset();
            }
            form.render(null, 'keywordForm'); // 重新渲染表单，特别是 select
            return false; 
        });

        // 加载初始规则列表
        chrome.storage.sync.get([STORAGE_KEY], function(result) {
            if (chrome.runtime.lastError) {
                console.error(`Error getting initial rules:`, chrome.runtime.lastError);
                if (layer) layer.msg('加载规则失败', {icon: 2});
                return;
            }
            rules = result[STORAGE_KEY] || [];
            if (ruleListElement) {
                ruleListElement.innerHTML = ''; // 清空旧列表，避免重复添加
                rules.forEach((rule, index) => addRuleToUI(rule, index));
            }
            // console.log('Loaded rules:', rules);
        });

        // 加载初始关键词列表 (需要兼容旧的没有 purpose 的数据)
        chrome.storage.sync.get([KEYWORD_STORAGE_KEY], function(result) {
            if (chrome.runtime.lastError) {
                console.error(`Error getting initial keywords:`, chrome.runtime.lastError);
                if (layer) layer.msg('加载关键词失败', {icon: 2});
                return;
            }
            const loadedKeywords = result[KEYWORD_STORAGE_KEY] || [];
            keywords = loadedKeywords.map(kw => ({
                ...kw,
                purpose: kw.purpose || 'match' // 兼容旧数据，默认为 match
            }));
            if (keywordListElement) {
                keywordListElement.innerHTML = ''; // 清空旧列表
                keywords.forEach(kw => addKeywordToUI(kw));
            }
            // console.log('Loaded keywords:', keywords);
        });

        // 关键词导出
        if (exportKeywordsBtn) {
            exportKeywordsBtn.addEventListener('click', () => {
                exportData(keywords, 'autoverify_keywords.json');
            });
        }

        // 关键词导入触发
        if (importKeywordsTriggerBtn) {
            importKeywordsTriggerBtn.addEventListener('click', () => {
                if (importKeywordsFileInput) importKeywordsFileInput.click();
            });
        }

        // 关键词文件导入处理 (更新验证器)
        if (importKeywordsFileInput) {
            importKeywordsFileInput.addEventListener('change', (event) => {
                importData(event, KEYWORD_STORAGE_KEY, importedKws => {
                    keywords = importedKws.map(kw => ({ ...kw, purpose: kw.purpose || 'match' })); // 确保导入数据也有 purpose
                    if (keywordListElement) {
                        keywordListElement.innerHTML = ''; 
                        keywords.forEach(kw => addKeywordToUI(kw)); 
                    }
                    if (layer) layer.msg('关键词导入成功!', {icon: 1, time: 1500});
                }, newKeywords => { 
                    if (!Array.isArray(newKeywords)) return false;
                    return newKeywords.every(kw => 
                        kw && typeof kw.text === 'string' && 
                        typeof kw.id === 'string' && 
                        (kw.type === 'image' || kw.type === 'input') && 
                        (kw.purpose === 'match' || kw.purpose === 'exclude' || kw.purpose === undefined) && // 兼容旧数据
                        typeof kw.enabled === 'boolean'
                    );
                });
                importKeywordsFileInput.value = ''; 
            });
        }

        // >>> 新增：错误上报按钮事件绑定 <<<
        const reportErrorBtn = document.getElementById('reportErrorBtn');
        if (reportErrorBtn) {
            reportErrorBtn.addEventListener('click', () => {
                if (layer) layer.msg('正在提交错误示例...', {icon: 16, shade: 0.1, time: 0});
                chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
                    if (chrome.runtime.lastError || !tabs || tabs.length === 0) {
                        console.error('无法获取当前标签页:', chrome.runtime.lastError);
                        if (layer) layer.msg('提交失败: 无法获取当前标签页', {icon: 2});
                        return;
                    }
                    chrome.tabs.sendMessage(tabs[0].id, { action: 'reportError' }, function(response) {
                        if (layer) layer.closeAll('loading');
                        if (chrome.runtime.lastError) {
                            console.error('发送消息至内容脚本失败:', chrome.runtime.lastError);
                            if (layer) layer.msg('提交失败: 通讯错误', {icon: 2});
                            return;
                        }
                        if (response && response.status === 'ok') {
                            if (layer) layer.msg('已提交，感谢反馈!', {icon: 1});
                        } else {
                            if (layer) layer.msg('提交失败', {icon: 2});
                        }
                    });
                });
            });
        }
    }); // End layui.use

    // 获取当前标签页 host 并显示 (规则管理部分)
    if (currentHostElement) {
        chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
            if (chrome.runtime.lastError || !tabs || tabs.length === 0) {
                console.error("Error getting current tab:", chrome.runtime.lastError || "No active tab found");
                currentHostElement.textContent = '获取失败';
                if (addCurrentBtn) addCurrentBtn.disabled = true;
                return;
            }
            const currentTab = tabs[0];
            if (currentTab.url && (currentTab.url.startsWith('http:') || currentTab.url.startsWith('https:'))) {
                try {
                    const url = new URL(currentTab.url);
                    currentHost = url.hostname;
                    currentHostElement.textContent = currentHost;
                    if (addCurrentBtn) addCurrentBtn.disabled = false;
                } catch (e) {
                    console.error("Invalid URL:", currentTab.url, e);
                    currentHostElement.textContent = '无效 URL';
                    if (addCurrentBtn) addCurrentBtn.disabled = true;
                }
            } else {
                currentHostElement.textContent = '非网页标签页';
                if (addCurrentBtn) addCurrentBtn.disabled = true;
            }
        });
    }

    // --- 规则管理函数 ---
    function addRule(rule) {
        if (!rule.pattern || !rule.pattern.trim()) {
            if (layer) layer.msg('规则内容不能为空', {icon: 7});
            return;
        }
        rule.pattern = rule.pattern.trim();
        if (rule.match === 'regex') {
            try { new RegExp(rule.pattern); } catch (e) {
                if (layer) layer.msg('无效的正则表达式: ' + e.message, {icon: 2, time: 3000});
                return;
            }
        }
        const exists = rules.some(r => r.pattern === rule.pattern && r.type === rule.type && r.match === rule.match);
        if (exists) {
            if (layer) layer.msg('规则已存在', {icon: 5});
            return;
        }
        rules.push(rule);
        chrome.storage.sync.set({ [STORAGE_KEY]: rules }, function() {
            if (chrome.runtime.lastError) {
                console.error(`Error setting rules after adding:`, chrome.runtime.lastError);
                if (layer) layer.msg('添加规则失败', {icon: 2});
                rules.pop(); 
            } else {
                addRuleToUI(rule, rules.length - 1);
                if (layer) layer.msg('添加成功', {icon: 1, time: 1000});
                // console.log('Rule added:', rule, 'New rules:', rules);
            }
        });
    }

    function removeRule(index) {
        if (index < 0 || index >= rules.length) return;
        const removedRule = rules.splice(index, 1)[0];
        chrome.storage.sync.set({ [STORAGE_KEY]: rules }, function() {
            if (chrome.runtime.lastError) {
                console.error(`Error setting rules after removing:`, chrome.runtime.lastError);
                if (layer) layer.msg('删除规则失败', {icon: 2});
                rules.splice(index, 0, removedRule); 
            } else {
                const listItem = ruleListElement.querySelector(`li[data-index="${index}"]`);
                if (listItem) listItem.remove();
                const remainingItems = ruleListElement.querySelectorAll('li');
                remainingItems.forEach((item, newIndex) => item.setAttribute('data-index', newIndex));
                if (layer) layer.msg('删除成功', {icon: 1, time: 1000});
                // console.log('Rule removed:', removedRule, 'Remaining rules:', rules);
            }
        });
    }

    function addRuleToUI(rule, index) {
        if (!ruleListElement) return;
        const li = document.createElement('li');
        li.classList.add('rule-list-item');
        li.setAttribute('data-index', index);
        const patternSpan = document.createElement('span');
        patternSpan.classList.add('pattern');
        patternSpan.textContent = rule.pattern;
        li.appendChild(patternSpan);
        const tagsDiv = document.createElement('div');
        tagsDiv.classList.add('tags');
        const typeTag = document.createElement('span');
        typeTag.classList.add('layui-badge');
        typeTag.classList.add(rule.type === 'blacklist' ? 'layui-bg-black' : 'layui-bg-green');
        typeTag.textContent = rule.type === 'blacklist' ? '黑名单' : '白名单';
        tagsDiv.appendChild(typeTag);
        const matchTag = document.createElement('span');
        matchTag.classList.add('layui-badge');
        matchTag.classList.add(rule.match === 'regex' ? 'layui-bg-blue' : 'layui-bg-primary'); // layui-bg-primary for non-blue
        matchTag.textContent = rule.match === 'regex' ? '正则' : '精确';
        tagsDiv.appendChild(matchTag);
        li.appendChild(tagsDiv);
        const deleteButton = document.createElement('button');
        deleteButton.classList.add('layui-btn', 'layui-btn-xs', 'layui-btn-danger');
        deleteButton.textContent = '删除';
        deleteButton.style.marginLeft = '15px';
        deleteButton.addEventListener('click', () => removeRule(parseInt(li.getAttribute('data-index'))));
        li.appendChild(deleteButton);
        ruleListElement.appendChild(li);
    }

    // --- 关键词管理函数 ---
    function addKeyword(keyword) {
        // 检查重复时，需要考虑 purpose
        const exists = keywords.some(k => 
            k.text.toLowerCase() === keyword.text.toLowerCase() && 
            k.type === keyword.type &&
            k.purpose === keyword.purpose
        );
        if (exists) {
            if (layer) layer.msg('该类型和用途下此关键词已存在', {icon: 5});
            return;
        }
        keywords.push(keyword);
        saveKeywords(() => {
            addKeywordToUI(keyword);
            if (layer) layer.msg('关键词添加成功', {icon: 1, time: 1000});
        });
    }

    function removeKeyword(keywordId) {
        const index = keywords.findIndex(k => k.id === keywordId);
        if (index > -1) {
            keywords.splice(index, 1);
            saveKeywords(() => {
                const listItem = keywordListElement.querySelector(`li[data-id="${keywordId}"]`);
                if (listItem) listItem.remove();
                if (layer) layer.msg('关键词删除成功', {icon: 1, time: 1000});
            });
        }
    }
    
    function toggleKeywordStatus(keywordId) {
        const keyword = keywords.find(k => k.id === keywordId);
        if (keyword) {
            keyword.enabled = !keyword.enabled;
            saveKeywords(() => {
                const listItem = keywordListElement.querySelector(`li[data-id="${keywordId}"]`);
                if (listItem) {
                    const textSpan = listItem.querySelector('.pattern');
                    const statusBadge = listItem.querySelector('.keyword-status-badge');
                    if (textSpan) textSpan.style.textDecoration = keyword.enabled ? 'none' : 'line-through';
                    if (statusBadge) {
                        statusBadge.textContent = keyword.enabled ? '启用' : '禁用';
                        statusBadge.className = `layui-badge keyword-status-badge ${keyword.enabled ? 'layui-bg-green' : 'layui-bg-gray'}`;
                    }
                }
                 if (layer) layer.msg(keyword.enabled ? '关键词已启用' : '关键词已禁用', {icon: 1, time: 1000});
            });
        }
    }

    function saveKeywords(callback) {
        chrome.storage.sync.set({ [KEYWORD_STORAGE_KEY]: keywords }, function() {
            if (chrome.runtime.lastError) {
                console.error(`Error saving keywords:`, chrome.runtime.lastError);
                if (layer) layer.msg('保存关键词失败', {icon: 2});
            } else {
                // console.log('Keywords saved:', keywords);
                if (callback) callback();
            }
        });
    }

    function addKeywordToUI(keyword) {
        if (!keywordListElement) return;
        const li = document.createElement('li');
        li.classList.add('rule-list-item');
        li.setAttribute('data-id', keyword.id);

        const textSpan = document.createElement('span');
        textSpan.classList.add('pattern');
        textSpan.textContent = keyword.text;
        textSpan.style.textDecoration = keyword.enabled ? 'none' : 'line-through';
        li.appendChild(textSpan);

        const tagsDiv = document.createElement('div');
        tagsDiv.classList.add('tags');

        // 关键词类型标签
        const typeTag = document.createElement('span');
        typeTag.classList.add('layui-badge');
        typeTag.classList.add(keyword.type === 'image' ? 'layui-bg-cyan' : 'layui-bg-orange');
        typeTag.textContent = keyword.type === 'image' ? '图片' : '输入框';
        tagsDiv.appendChild(typeTag);

        // 新增：关键词用途标签
        const purposeTag = document.createElement('span');
        purposeTag.classList.add('layui-badge');
        if (keyword.purpose === 'exclude') {
            purposeTag.classList.add('layui-bg-red');
            purposeTag.textContent = '排除词';
        } else { // 默认为 match
            purposeTag.classList.add('layui-bg-blue');
            purposeTag.textContent = '匹配词';
        }
        tagsDiv.appendChild(purposeTag);

        // 状态标签 (启用/禁用)
        const statusBadge = document.createElement('span');
        statusBadge.classList.add('layui-badge', 'keyword-status-badge');
        statusBadge.textContent = keyword.enabled ? '启用' : '禁用';
        statusBadge.classList.add(keyword.enabled ? 'layui-bg-green' : 'layui-bg-gray');
        statusBadge.style.marginLeft = '5px';
        statusBadge.title = '点击切换状态 (启用/禁用)';
        statusBadge.addEventListener('click', () => toggleKeywordStatus(keyword.id));
        tagsDiv.appendChild(statusBadge);
        li.appendChild(tagsDiv);

        const deleteButton = document.createElement('button');
        deleteButton.classList.add('layui-btn', 'layui-btn-xs', 'layui-btn-danger');
        deleteButton.textContent = '删除';
        deleteButton.style.marginLeft = '15px';
        deleteButton.addEventListener('click', () => {
             if (layer) {
                layer.confirm('确定删除此关键词【' + keyword.text + '】吗？', {icon: 3, title:'删除确认'}, function(index){
                    removeKeyword(keyword.id);
                    layer.close(index);
                });
            } else if (confirm('确定删除此关键词【' + keyword.text + '】吗？')) {
                removeKeyword(keyword.id);
            }
        });
        li.appendChild(deleteButton);
        keywordListElement.appendChild(li);
    }

    // --- 通用导入/导出函数 ---
    function exportData(data, filename) {
        if (!data || data.length === 0) {
            if (layer) layer.msg('没有数据可导出', {icon: 5});
            return;
        }
        try {
            const jsonStr = JSON.stringify(data, null, 2);
            const blob = new Blob([jsonStr], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            if (layer) layer.msg('导出成功!', {icon: 1, time: 1500});
        } catch (e) {
            console.error("Error exporting data:", e);
            if (layer) layer.msg('导出失败', {icon: 2});
        }
    }
    
    function importData(event, storageKey, callback, validator) {
        const file = event.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = function(e) {
            try {
                const importedData = JSON.parse(e.target.result);
                if (validator && !validator(importedData)) {
                     if (layer) layer.alert('导入的文件格式不正确或数据无效。请确保是之前导出的JSON文件，且结构未被修改。', {icon: 2, area: '400px'});
                     return;
                }
                const dataToStore = importedData.map(kw => ({
                    ...kw,
                    id: kw.id || ('kw_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5)), 
                    purpose: kw.purpose || 'match' // 确保导入的旧数据有 purpose
                }));

                chrome.storage.sync.set({ [storageKey]: dataToStore }, function() {
                    if (chrome.runtime.lastError) {
                        console.error(`Error importing data to ${storageKey}:`, chrome.runtime.lastError);
                        if (layer) layer.msg('导入数据存储失败', {icon: 2});
                    } else {
                        if (callback) callback(dataToStore); 
                    }
                });
            } catch (err) {
                console.error('Error parsing imported JSON:', err);
                if (layer) layer.alert('导入失败：文件不是有效的 JSON 格式。\n' + err.message, {icon: 2});
            }
        };
        reader.readAsText(file);
    }
});