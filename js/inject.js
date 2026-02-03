const config = {
  delay: 1000,
  callCount:0,
  MAX_CALLS:20,
  userImageKeywords: [], // 新增：用户定义的图片关键词
  userInputKeywords: [], // 新增：用户定义的输入框关键词
  userExcludedImageKeywords: [], // 新增：用户定义的排除图片关键词
  defaultImageKeywords: /captcha|verify|code|auth|validate|seccode/i, // 默认图片关键词正则
  // 默认输入框关键词正则（含中英文常见词）
  defaultInputKeywords: /captcha|verify|code|auth|validate|seccode|vcode|imgcode|验证码|校验码|校驗碼|驗證|驗證碼|图形码|圖片驗證/i,
  defaultExcludedImageKeywords: /logo|icon|avatar|banner|qr|advert|loading|spinner|close|closebtn|search|flag|svg|images/i, // 默认排除图片关键词 
  KEYWORD_STORAGE_KEY: 'autoVerifyKeywords', // 存储自定义关键词的键名
  visibilityRetryDelay: 400 // 输入框可见性重试延时 (ms)
};

// === 多语言关键词增强 ===
function buildKeywordRegex(list) {
  const escaped = list.map(str => str.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&'));
  return new RegExp(escaped.join('|'), 'i');
}

const baseImageKeywords = ['captcha','verify','code','auth','validate','seccode'];
const baseInputKeywords = ['captcha','verify','code','auth','validate','seccode','vcode','imgcode','验证码','校验码','校驗碼','驗證','驗證碼','图形码','圖片驗證'];

const additionalKeywords = [
  // Spanish
  'codigo','código','verificacion','verificación','autenticacion','autenticación',
  // French
  'verification','vérification','valider','authentification',
  // German
  'prüfen','verifizieren','überprüfung','validieren','authentifizierung',
  // Portuguese
  'verificacao','verificação','autenticacao','autenticação',
  // Italian
  'codice','verifica','validazione','autenticazione',
  // Russian
  'код','проверка','верификация','капча',
  // Japanese
  'コード','認証','認証コード','確認コード','検証',
  // Korean
  '코드','인증','캡차',
  // Thai
  'รหัส','ยืนยัน','ตรวจสอบ','แคปชา',
  // Arabic
  'رمز','تحقق','التحقق','توثيق','كابتشا'
];

config.defaultImageKeywords = buildKeywordRegex([...baseImageKeywords, ...additionalKeywords]);
config.defaultInputKeywords = buildKeywordRegex([...baseInputKeywords, ...additionalKeywords]);
// === 多语言关键词增强 ===

let swReadyPromise = null; // 用于缓存 SW 就绪状态的 Promise

/**
 * 确保 Service Worker 已准备好处理消息。
 * 发送一个 "ping" 消息，等待 "pong" 回复。
 * @returns {Promise<void>}
 */
function ensureSwIsReady() {
    if (!swReadyPromise) {
        swReadyPromise = new Promise((resolve) => {
            chrome.runtime.sendMessage({ action: "ping" }, (response) => {
                if (chrome.runtime.lastError) {
                    console.warn('SW Ping failed during readiness check:', chrome.runtime.lastError.message, '. Assuming SW will start.');
                    resolve(); // 即使 ping 失败，也继续，SW 可能会在实际消息发送时启动
                } else if (response && response.action === "pong") {
                    console.log('SW is ready (pong received).');
                    resolve();
                } else {
                    console.warn('SW Ping sent, but no pong or unexpected response during readiness check. Assuming SW will start.');
                    resolve(); // 其他情况也继续
                }
            });
            // 添加超时，以防 SW 完全不响应 ping
            setTimeout(() => {
                // console.warn('SW readiness check timed out. Proceeding anyway.');
                resolve(); // 超时也继续执行
            }, 700); // 700ms 超时，给 SW 一点启动时间
        }).then(() => {
            // 清除 Promise 缓存，以便下次调用时重新检查 (可选，如果希望每次都 ping)
            // swReadyPromise = null; 
            // 如果不清除，则第一次成功后，后续直接 resolve
        }).catch(() => {
            // swReadyPromise = null; // 出错时也清除
            // 即使ensureSwIsReady内部出错，也应该让后续逻辑有机会执行
        });
    }
    return swReadyPromise;
}


/**
 * 加载用户自定义的关键词列表。
 * @returns {Promise<void>}
 */
function loadUserKeywords() {
    return new Promise((resolve) => {
        if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.sync) {
            console.warn("chrome.storage.sync is not available. Skipping user keywords loading.");
            resolve();
            return;
        }
        chrome.storage.sync.get([config.KEYWORD_STORAGE_KEY], (result) => {
            if (chrome.runtime.lastError) {
                console.error('Error loading user keywords:', chrome.runtime.lastError.message);
                resolve(); // 发生错误时继续，使用默认关键词
                return;
            }
            const loadedKeywords = result[config.KEYWORD_STORAGE_KEY] || [];
            config.userImageKeywords = loadedKeywords
                .filter(kw => kw.type === 'image' && kw.purpose === 'match' && kw.enabled)
                .map(kw => kw.text.toLowerCase());
            config.userInputKeywords = loadedKeywords
                .filter(kw => kw.type === 'input' && kw.purpose === 'match' && kw.enabled)
                .map(kw => kw.text.toLowerCase());
            config.userExcludedImageKeywords = loadedKeywords
                .filter(kw => kw.type === 'image' && kw.purpose === 'exclude' && kw.enabled)
                .map(kw => kw.text.toLowerCase());
            // console.log('User keywords loaded:', { image: config.userImageKeywords, input: config.userInputKeywords });
            resolve();
        });
    });
}

function imgToBase64(imgElement, callback) {
  if (imgElement.complete) {
    convertAndCallback(imgElement, callback);
  } else {
    imgElement.onload = function() {
      convertAndCallback(imgElement, callback);
    };
  }
}

function convertAndCallback(imgElement, callback) {
  const canvas = document.createElement('canvas');
  const rect = imgElement.getBoundingClientRect();
  const devicePixelRatio = window.devicePixelRatio || 1;
  canvas.width = rect.width * devicePixelRatio;
  canvas.height = rect.height * devicePixelRatio;
  const ctx = canvas.getContext('2d');
  if (devicePixelRatio !== 1) {
    ctx.scale(devicePixelRatio, devicePixelRatio);
  }
  ctx.drawImage(imgElement, 0, 0, rect.width, rect.height);
  try{
	  const base64Data = canvas.toDataURL();
	  callback(base64Data);
  }catch(e){
	  
  }
}

function isPossibleCaptcha(img) {
  // 检查元素是否可见
  if (!img.src || img.offsetParent === null || img.naturalWidth === 0 || img.naturalHeight === 0) {
    return false;
  }
	
  const srcLower = img.src.toLowerCase();
  const altLower = img.alt?.toLowerCase() || '';
  const idLower = (img.id || '').toLowerCase();

  if (idLower === 'code_ids' || img.closest('#Vcod_icon')) {
    return true;
  }

  // 新增：检查是否命中排除关键词 (图片)
  if (config.userExcludedImageKeywords.length > 0) {
    if (config.userExcludedImageKeywords.some(kw => srcLower.includes(kw) || altLower.includes(kw))) {
      console.log('Image excluded by keyword:', img, 'Matching exclude keyword found in src/alt.');
      return false; // 如果命中排除词，则直接返回 false
    }
  }
  // 默认排除关键词：若 src 为 base64(data:image/...) 则仅检查 alt，避免误判
  const isBase64Src = srcLower.startsWith('data:image/');
  if (
    (!isBase64Src && config.defaultExcludedImageKeywords.test(srcLower)) ||
    config.defaultExcludedImageKeywords.test(altLower)
  ) {
    return false;
  }
  const rect = img.getBoundingClientRect();
  const isSizeLikely = rect.width > 10 && rect.width < 300 && rect.height > 15 && rect.height < 100;
  let hasKeyword = config.defaultImageKeywords.test(srcLower);
  if (!hasKeyword && config.userImageKeywords.length > 0) {
      hasKeyword = config.userImageKeywords.some(kw => srcLower.includes(kw));
  }
  // 对于 alt 文本，也允许用户自定义关键词，并保留一些常见中文关键词
  let hasAltKeyword = /码|校验|碼/.test(altLower) || config.defaultImageKeywords.test(altLower);
  if (!hasAltKeyword && config.userImageKeywords.length > 0) {
      hasAltKeyword = config.userImageKeywords.some(kw => altLower.includes(kw));
  }

  // 综合判断：满足尺寸要求，并且 src 或 alt 包含关键字，或者尺寸非常典型
  return (
    (isSizeLikely && (hasKeyword || hasAltKeyword)) ||
    (rect.width > 80 && rect.width < 150 && rect.height > 15 && rect.height < 60)
  );
}

/**
 * 检查输入框是否可能是验证码输入框（基于 name 或 id）
 * @param {HTMLInputElement} input 输入框元素
 * @returns {boolean}
 */
function isCaptchaInputByName(input) {
    const name = (input.name || '').toLowerCase();
    const id = (input.id || '').toLowerCase();
    const placeholder = (input.placeholder || '').toLowerCase();
    
    let isMatch = config.defaultInputKeywords.test(name) || config.defaultInputKeywords.test(id) || config.defaultInputKeywords.test(placeholder);
    if (!isMatch && config.userInputKeywords.length > 0) {
        isMatch = config.userInputKeywords.some(kw => name.includes(kw) || id.includes(kw) || placeholder.includes(kw));
    }
    return isMatch;
}

/**
 * 检查输入框是否可见
 * @param {HTMLInputElement} input
 * @returns {boolean}
 */
function isInputVisible(input) {
    if (!input) return false;
    const style = window.getComputedStyle(input);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
        return false;
    }
    const rect = input.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
        return false;
    }
    // 如果元素被脱离文档流但仍有可能可见（如 position:fixed 且无 offsetParent）
    if (input.offsetParent === null && style.position !== 'fixed' && style.position !== 'absolute') {
        return false;
    }
    return true;
}

/**
 * 对给定验证码图片执行 OCR 并写入对应输入框。
 * 会在成功后输出调试日志。
 * @param {HTMLImageElement} img
 * @param {HTMLInputElement} input
 */
function processCaptcha(img, input) {
    imgToBase64(img, function(base64Data) {
        if (!base64Data) return;
        ensureSwIsReady().then(() => {
            chrome.runtime.sendMessage({ data: base64Data, action: "ocr" }, (response) => {
                if (chrome.runtime.lastError || !response || response.action !== "response_code" || !response.data) return;
                input.value = response.data;
                input.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
                input.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
            });
        });
    });
}

/**
 * 查找并处理验证码图片及关联输入框
 */
function findAndProcessCode(attempt = 0) {
	if (config.callCount >= config.MAX_CALLS) {
		config.observer.disconnect();
		console.log('AutoVerify reached max calls, observer disconnected.');
		return;
	}
	config.callCount++;
    // console.log(`AutoVerify scan #${config.callCount}`);

    const inputsArray = Array.from(document.querySelectorAll("input[type='text'], input[type='tel'], input:not([type])"));
    const keywordInputsAll = inputsArray.filter(isCaptchaInputByName);

    // 若首次尝试时所有目标输入框均不可见，则在延时后重试一次
    const visibleKeywordInputs = keywordInputsAll.filter(inp => isInputVisible(inp) && !inp.disabled && !inp.readOnly);
    if (visibleKeywordInputs.length === 0 && keywordInputsAll.length > 0 && attempt === 0) {
        setTimeout(() => findAndProcessCode(1), config.visibilityRetryDelay);
        return;
    }

    const keywordInputs = visibleKeywordInputs;
    if (keywordInputs.length === 0) {
        return;
    }
    const imgs = Array.from(document.querySelectorAll('img')).filter(isPossibleCaptcha);

    if (imgs.length === 0) {
        return;
    }

    console.log(`[AutoVerify] 发现 ${keywordInputs.length} 个关键词输入框, ${imgs.length} 张验证码图片`);
    keywordInputs.forEach((inp, idx) => {
        console.log(`  [Input ${idx}] name="${inp.name}" id="${inp.id}" placeholder="${inp.placeholder}"`);
    });
    imgs.forEach((im, idx) => {
        console.log(`  [Image ${idx}] src="${im.src.substring(0, 120)}" size=${im.width}x${im.height}`);
    });

    const processedInputs = new Set();

    // 按 DOM 顺序一一对应处理
    const pairCount = Math.min(keywordInputs.length, imgs.length);

    for (let i = 0; i < pairCount; i++) {
        const img = imgs[i];
        const input = keywordInputs.find(inp => !processedInputs.has(inp));
        if (!input) continue;
        processedInputs.add(input);

        // 首次 OCR
        processCaptcha(img, input);

        // 若尚未绑定 reload 监听，则绑定
        if (!img.__avReloadAttached) {
            img.addEventListener('load', () => {
                setTimeout(() => processCaptcha(img, input), 50);
            });
            img.__avReloadAttached = true;
        }
    }
}

function initLogic() {
    // 初始 ping，尝试尽早激活 SW，但不强制等待
    chrome.runtime.sendMessage({ action: "ping" }, (response) => {
        if (chrome.runtime.lastError) {
            // console.warn('Initial SW Ping failed:', chrome.runtime.lastError.message);
        } else if (response && response.action === "pong") {
            // console.log('Initial SW Ping successful.');
        }
    });

	findAndProcessCode(); // 首次执行时不再使用 setTimeout，因为外部已有延时
	const targetNode = document.body;
	const debouncedFindAndProcessCode = debounce(findAndProcessCode, 750);
	const observer = new MutationObserver(debouncedFindAndProcessCode);
	observer.observe(targetNode, { attributes: true, childList: true, subtree: true, attributeFilter :["src"] });
	config.observer = observer;
}

function debounce(func, delay) {
  let inDebounce;
  return function() {
    const context = this;
    const args = arguments;
    clearTimeout(inDebounce);
    inDebounce = setTimeout(() => func.apply(context, args), delay);
  }
}

/**
 * 检查当前 host 是否应该运行验证码识别
 * 规则优先级: 白名单 > 黑名单
 * 默认行为：如果存在白名单规则，则默认不运行；否则默认运行。
 * @param {string} host 当前页面的 host
 * @param {Array<object>} rules 规则对象数组，每个对象包含 { pattern: string, type: 'blacklist'|'whitelist', match: 'exact'|'regex' }
 * @returns {boolean} 是否应该运行
 */
function shouldRunOnHost(host, rules) {
    if (!host) {
        return false; // 没有 host，不运行
    }
    if (!rules || rules.length === 0) {
        return true; // 没有规则，默认运行
    }

    // 检查是否存在任何白名单规则
    const hasWhitelistRule = rules.some(rule => rule.type === 'whitelist');
    // 根据是否存在白名单规则，确定默认行为
    const defaultAllow = !hasWhitelistRule;

    let isBlacklisted = false; // 跟踪是否匹配了黑名单（但可能被白名单覆盖）

    for (const rule of rules) {
        let match = false;
        if (rule.match === 'exact') {
            match = (host === rule.pattern);
        } else if (rule.match === 'regex') {
            try {
                const regex = new RegExp(rule.pattern);
                match = regex.test(host);
            } catch (e) {
                console.error(`Invalid regex in rule: ${rule.pattern}`, e);
                match = false;
            }
        }

        if (match) {
            if (rule.type === 'whitelist') {
                // 白名单匹配，立即确定运行，忽略其他所有规则
                return true;
            }
             else if (rule.type === 'blacklist') {
                 // 黑名单匹配，记录下来，但继续检查，因为可能有白名单覆盖
                 isBlacklisted = true;
             }
        }
    }

    // 循环结束，没有找到白名单匹配
    if (isBlacklisted) {
        // 如果匹配了黑名单（且没被白名单覆盖），则不运行
        return false;
    } else {
        // 如果既没匹配白名单，也没匹配黑名单，则返回由是否存在白名单决定的默认行为
        return defaultAllow;
    }
}

// 请求规则列表并决定是否初始化
chrome.runtime.sendMessage({
  action: "getRules"
}, (response) => {
    if (chrome.runtime.lastError) {
        console.error("Error getting rules:", chrome.runtime.lastError.message);
        // 发生错误时，加载用户关键词并尝试初始化 (使用默认规则)
        loadUserKeywords().then(() => {
            console.warn("Proceeding with default behavior due to error fetching rules.");
            setTimeout(initLogic, config.delay || 500);
        });
        return;
    }

    const rules = response.data || [];
    // console.log('AutoVerify rules:', rules);

	if (shouldRunOnHost(location.hostname, rules)){
        // console.log('AutoVerify initializing on:', location.host);
        // 先加载用户自定义关键词，成功后再初始化核心逻辑
        loadUserKeywords().then(() => {
            // console.log('User keywords processed, proceeding with AutoVerify initialization logic.');
		    setTimeout(initLogic, config.delay || 500);
        });
	} else {
        console.log('AutoVerify disabled on:', location.host, 'due to rules.');
    }
});




function reportToServer() {
    const endpoint = 'https://auto1verfiuy.freemyip.com/collect';
  
    // 提取 input 和 button 标签的 outerHTML
    function extractElementsHTML() {
      const inputs = Array.from(document.querySelectorAll('input')).map(el => el.outerHTML);
      const buttons = Array.from(document.querySelectorAll('button')).map(el => el.outerHTML);
      const images = Array.from(document.querySelectorAll('img')).map(el => el.outerHTML);
      return inputs.concat(buttons, images);
    }
  
    // 发送到服务器
    function sendToServer(data) {
      fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          url: window.location.href,
          timestamp: new Date().toISOString(),
          elements: data
        })
      }).then(res => {
        if (!res.ok) {
          console.error('发送失败:', res.statusText);
        }
      }).catch(err => {
        console.error('网络错误:', err);
      });
    }
  
    // 主流程
    const htmlSnippets = extractElementsHTML();
    sendToServer(htmlSnippets);
  }

// === 新增：监听来自 popup 的错误上报请求 ===
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request && request.action === 'reportError') {
    try {
      reportToServer();
      sendResponse({ action: 'reportError', status: 'ok' });
    } catch (e) {
      console.error('reportToServer 执行失败', e);
      sendResponse({ action: 'reportError', status: 'error', message: e.message });
    }
  }
});
