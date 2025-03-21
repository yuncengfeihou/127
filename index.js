import { extension_settings, loadExtensionSettings } from "../../../extensions.js";
import { saveSettingsDebounced } from "../../../../script.js";
import { eventSource, event_types } from "../../../../script.js";

// 插件名称，与文件夹名一致
const extensionName = "prompt-exporter";
// 日志前缀，用于调试输出
const logPrefix = `[${extensionName}]`;
// 导出的JSON文件存储位置
let lastPromptStruct = null;
let exportCount = 0;

// 默认设置
const defaultSettings = {
    enabled: true,
    autoExport: false,
    debugMode: false,
    prettyPrint: true,  // 格式化JSON输出
    includeRawData: true // 包含原始数据
};

// 日志函数
function logDebug(...args) {
    if (extension_settings[extensionName]?.debugMode) {
        console.log(logPrefix, "(DEBUG)", ...args);
    }
}

function logInfo(...args) {
    console.log(logPrefix, ...args);
}

function logWarning(...args) {
    console.warn(logPrefix, ...args);
}

function logError(...args) {
    console.error(logPrefix, ...args);
}

// 安全地检查对象结构并输出详细信息
function safelyInspectObject(obj, path = '') {
    try {
        if (!obj) {
            logDebug(`${path || 'Object'} 为空或未定义`);
            return;
        }
        
        if (typeof obj !== 'object') {
            logDebug(`${path || 'Object'} 不是对象，而是 ${typeof obj}`);
            return;
        }
        
        // 检查主要属性
        const keys = Object.keys(obj);
        logDebug(`${path || 'Object'} 包含 ${keys.length} 个属性: ${keys.join(', ')}`);
        
        // 特别关注single_part_prompt_t结构
        if (obj.text) {
            logDebug(`${path}.text 是数组: ${Array.isArray(obj.text)}, 长度: ${Array.isArray(obj.text) ? obj.text.length : 'N/A'}`);
            if (Array.isArray(obj.text) && obj.text.length > 0) {
                const sample = obj.text[0];
                logDebug(`${path}.text[0] 示例: ${JSON.stringify(sample)}`);
            }
        }
        
        if (obj.additional_chat_log) {
            logDebug(`${path}.additional_chat_log 是数组: ${Array.isArray(obj.additional_chat_log)}, 长度: ${Array.isArray(obj.additional_chat_log) ? obj.additional_chat_log.length : 'N/A'}`);
        }
        
        if (obj.extension) {
            logDebug(`${path}.extension 是对象: ${typeof obj.extension === 'object'}, 键数: ${typeof obj.extension === 'object' ? Object.keys(obj.extension).length : 'N/A'}`);
        }
    } catch (error) {
        logError(`检查对象结构时出错: ${error.message}`);
    }
}

// 加载插件设置
function loadSettings() {
    logDebug('加载设置');
    extension_settings[extensionName] = extension_settings[extensionName] || {};
    if (Object.keys(extension_settings[extensionName]).length === 0) {
        Object.assign(extension_settings[extensionName], defaultSettings);
        saveSettingsDebounced();
    }

    $('#prompt_exporter_enabled').prop('checked', extension_settings[extensionName].enabled);
    $('#prompt_exporter_auto').prop('checked', extension_settings[extensionName].autoExport);
    $('#prompt_exporter_debug').prop('checked', extension_settings[extensionName].debugMode);
    $('#prompt_exporter_pretty').prop('checked', extension_settings[extensionName].prettyPrint);
    $('#prompt_exporter_raw').prop('checked', extension_settings[extensionName].includeRawData);
    
    logDebug('设置加载完成', extension_settings[extensionName]);
}

// 创建下载链接
function createDownloadLink(data, fileName) {
    try {
        logDebug('创建下载链接', fileName);
        const spacing = extension_settings[extensionName].prettyPrint ? 2 : 0;
        const jsonString = JSON.stringify(data, null, spacing);
        const blob = new Blob([jsonString], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        
        // 创建下载链接
        const downloadLink = document.createElement('a');
        downloadLink.href = url;
        downloadLink.download = fileName;
        document.body.appendChild(downloadLink);
        downloadLink.click();
        document.body.removeChild(downloadLink);
        URL.revokeObjectURL(url);
        
        // 更新状态信息
        $('#prompt_exporter_status span').text(`上次导出: ${new Date().toLocaleString()}`);
        
        logInfo('文件下载链接已创建', fileName);
        toastr.success(`Prompt结构已导出: ${fileName}`, '导出成功');
        return true;
    } catch (error) {
        logError('创建下载链接失败', error);
        toastr.error(`导出失败: ${error.message}`, '错误');
        return false;
    }
}

// 导出Prompt结构
function exportPromptStruct() {
    try {
        if (!lastPromptStruct) {
            logWarning('没有可用的Prompt结构数据');
            toastr.warning('没有可用的Prompt结构数据，请先发送一条消息', '警告');
            return false;
        }
        
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const fileName = `prompt_struct_${exportCount}_${timestamp}.json`;
        exportCount++;
        
        return createDownloadLink(lastPromptStruct, fileName);
    } catch (error) {
        logError('导出Prompt结构失败', error);
        toastr.error(`导出失败: ${error.message}`, '错误');
        return false;
    }
}

// 深拷贝函数，避免循环引用问题
function safeDeepCopy(obj) {
    try {
        // 使用更安全的方法处理循环引用和特殊对象
        const seen = new WeakMap();
        
        const replacer = (key, value) => {
            // 处理特殊对象类型
            if (value instanceof Map) {
                return { 
                    __type: 'Map', 
                    data: Array.from(value.entries()) 
                };
            }
            if (value instanceof Set) {
                return { 
                    __type: 'Set', 
                    data: Array.from(value) 
                };
            }
            if (value instanceof RegExp) {
                return { 
                    __type: 'RegExp', 
                    source: value.source, 
                    flags: value.flags 
                };
            }
            if (value instanceof Date) {
                return { 
                    __type: 'Date', 
                    iso: value.toISOString() 
                };
            }
            if (typeof value === 'function') {
                return { 
                    __type: 'Function', 
                    name: value.name || 'anonymous' 
                };
            }
            if (value instanceof Error) {
                return { 
                    __type: 'Error', 
                    message: value.message, 
                    stack: value.stack 
                };
            }
            
            // 处理对象和数组的循环引用
            if (typeof value === 'object' && value !== null) {
                if (seen.has(value)) {
                    return { __type: 'Circular', id: '[循环引用]' };
                }
                seen.set(value, true);
            }
            
            return value;
        };
        
        return JSON.parse(JSON.stringify(obj, replacer));
    } catch (error) {
        logError('深拷贝过程中出错:', error);
        // 尝试使用更简单的方法
        try {
            // 排除可能导致循环引用的字段
            const sanitized = { ...obj };
            return sanitized;
        } catch (fallbackError) {
            logError('备用深拷贝也失败:', fallbackError);
            return { error: '无法安全复制对象', message: error.message };
        }
    }
}

// 验证prompt_struct结构是否完整
function validatePromptStruct(prompt_struct) {
    if (!prompt_struct) return false;
    
    const requiredProps = ['char_prompt', 'user_prompt', 'world_prompt', 'chat_log'];
    const missingProps = requiredProps.filter(prop => !prompt_struct.hasOwnProperty(prop));
    
    if (missingProps.length > 0) {
        logWarning(`Prompt结构缺少必要属性: ${missingProps.join(', ')}`);
        return false;
    }
    
    // 检查single_part_prompt_t结构
    const singlePartPrompts = [
        { name: 'char_prompt', obj: prompt_struct.char_prompt },
        { name: 'user_prompt', obj: prompt_struct.user_prompt },
        { name: 'world_prompt', obj: prompt_struct.world_prompt }
    ];
    
    for (const { name, obj } of singlePartPrompts) {
        if (!obj || typeof obj !== 'object') {
            logWarning(`${name} 不是有效对象`);
            return false;
        }
        
        if (!Array.isArray(obj.text)) {
            logWarning(`${name}.text 不是数组`);
            return false;
        }
        
        if (!Array.isArray(obj.additional_chat_log)) {
            logWarning(`${name}.additional_chat_log 不是数组`);
            return false;
        }
        
        if (typeof obj.extension !== 'object') {
            logWarning(`${name}.extension 不是对象`);
            return false;
        }
    }
    
    return true;
}

// 监听事件：CHAT_COMPLETION_PROMPT_READY
function handlePromptReady(promptStruct) {
    try {
        if (!extension_settings[extensionName].enabled) {
            logDebug('插件已禁用，不处理prompt');
            return;
        }
        
        logInfo('捕获到Prompt结构');
        
        // 检查prompt_struct结构
        if (!promptStruct) {
            logWarning('收到的promptStruct为null或undefined');
            return;
        }
        
        // 记录原始数据结构以用于调试
        if (extension_settings[extensionName].debugMode) {
            logDebug('PromptStruct基本属性:', Object.keys(promptStruct));
            
            // 检查主要组件
            safelyInspectObject(promptStruct.char_prompt, 'char_prompt');
            safelyInspectObject(promptStruct.user_prompt, 'user_prompt');
            safelyInspectObject(promptStruct.world_prompt, 'world_prompt');
            
            // 检查plugin_prompts
            if (promptStruct.plugin_prompts) {
                const pluginKeys = Object.keys(promptStruct.plugin_prompts);
                logDebug(`plugin_prompts包含${pluginKeys.length}个插件: ${pluginKeys.join(', ')}`);
                
                for (const key of pluginKeys) {
                    safelyInspectObject(promptStruct.plugin_prompts[key], `plugin_prompts.${key}`);
                }
            }
            
            // 检查other_chars_prompt
            if (promptStruct.other_chars_prompt) {
                const charKeys = Object.keys(promptStruct.other_chars_prompt);
                logDebug(`other_chars_prompt包含${charKeys.length}个角色: ${charKeys.join(', ')}`);
                
                for (const key of charKeys) {
                    safelyInspectObject(promptStruct.other_chars_prompt[key], `other_chars_prompt.${key}`);
                }
            }
        }
        
        // 深拷贝结构以防止修改原始数据
        const promptStructCopy = safeDeepCopy(promptStruct);
        
        // 验证结构完整性
        if (!validatePromptStruct(promptStructCopy)) {
            logWarning('Prompt结构验证失败，尝试修复...');
            
            // 尝试修复缺失的结构
            if (!promptStructCopy.char_prompt || typeof promptStructCopy.char_prompt !== 'object') {
                promptStructCopy.char_prompt = { text: [], additional_chat_log: [], extension: {} };
            }
            
            if (!promptStructCopy.user_prompt || typeof promptStructCopy.user_prompt !== 'object') {
                promptStructCopy.user_prompt = { text: [], additional_chat_log: [], extension: {} };
            }
            
            if (!promptStructCopy.world_prompt || typeof promptStructCopy.world_prompt !== 'object') {
                promptStructCopy.world_prompt = { text: [], additional_chat_log: [], extension: {} };
            }
            
            // 确保text, additional_chat_log和extension存在
            ['char_prompt', 'user_prompt', 'world_prompt'].forEach(prop => {
                if (!Array.isArray(promptStructCopy[prop].text)) {
                    promptStructCopy[prop].text = [];
                }
                
                if (!Array.isArray(promptStructCopy[prop].additional_chat_log)) {
                    promptStructCopy[prop].additional_chat_log = [];
                }
                
                if (typeof promptStructCopy[prop].extension !== 'object') {
                    promptStructCopy[prop].extension = {};
                }
            });
        }
        
        // 如果用户需要原始数据
        if (extension_settings[extensionName].includeRawData) {
            // 提取聊天内容转换成适合查看的格式
            const chatContent = (promptStructCopy.chat_log || []).map(entry => ({
                role: entry.role,
                content: entry.content
            }));
            
            promptStructCopy._raw_chat = chatContent;
        }
        
        // 保存处理后的prompt结构
        lastPromptStruct = promptStructCopy;
        
        logInfo('已保存最新的Prompt结构数据');
        
        // 如果启用了自动导出，则自动下载文件
        if (extension_settings[extensionName].autoExport) {
            logDebug('自动导出模式已启用，自动导出Prompt结构');
            exportPromptStruct();
        }
    } catch (error) {
        logError('处理Prompt结构失败', error);
        toastr.error(`处理Prompt失败: ${error.message}`, '错误');
    }
}

// 注册插件UI
jQuery(async () => {
    try {
        logInfo('初始化Prompt结构导出器插件');
        
        // 创建插件UI
        const settingsHtml = `
        <div class="prompt-exporter-settings">
            <div class="inline-drawer">
                <div class="inline-drawer-toggle inline-drawer-header">
                    <b>Prompt结构导出器</b>
                    <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
                </div>
                <div class="inline-drawer-content">
                    <div class="flex-container">
                        <label class="checkbox_label" for="prompt_exporter_enabled">
                            <input id="prompt_exporter_enabled" type="checkbox" />
                            <span>启用插件</span>
                        </label>
                    </div>
                    <div class="flex-container">
                        <label class="checkbox_label" for="prompt_exporter_auto">
                            <input id="prompt_exporter_auto" type="checkbox" />
                            <span>自动导出(每次消息自动下载)</span>
                        </label>
                    </div>
                    <div class="flex-container">
                        <label class="checkbox_label" for="prompt_exporter_debug">
                            <input id="prompt_exporter_debug" type="checkbox" />
                            <span>调试模式</span>
                        </label>
                    </div>
                    <div class="flex-container">
                        <label class="checkbox_label" for="prompt_exporter_pretty">
                            <input id="prompt_exporter_pretty" type="checkbox" />
                            <span>格式化JSON</span>
                        </label>
                    </div>
                    <div class="flex-container">
                        <label class="checkbox_label" for="prompt_exporter_raw">
                            <input id="prompt_exporter_raw" type="checkbox" />
                            <span>包含原始聊天数据</span>
                        </label>
                    </div>
                    <div class="flex-container mt-2">
                        <input id="prompt_exporter_button" class="menu_button" type="button" value="导出最新Prompt结构" />
                    </div>
                    <div class="flex-container" id="prompt_exporter_status">
                        <span>上次导出: 未导出</span>
                    </div>
                    <hr class="sysHR" />
                </div>
            </div>
        </div>`;
        
        // 添加插件UI到设置面板
        $("#extensions_settings").append(settingsHtml);
        
        // 绑定事件处理函数
        $('#prompt_exporter_enabled').on('change', function() {
            extension_settings[extensionName].enabled = !!$(this).prop('checked');
            logInfo(`插件已${extension_settings[extensionName].enabled ? '启用' : '禁用'}`);
            saveSettingsDebounced();
        });
        
        $('#prompt_exporter_auto').on('change', function() {
            extension_settings[extensionName].autoExport = !!$(this).prop('checked');
            logInfo(`自动导出模式已${extension_settings[extensionName].autoExport ? '启用' : '禁用'}`);
            saveSettingsDebounced();
        });
        
        $('#prompt_exporter_debug').on('change', function() {
            extension_settings[extensionName].debugMode = !!$(this).prop('checked');
            logInfo(`调试模式已${extension_settings[extensionName].debugMode ? '启用' : '禁用'}`);
            saveSettingsDebounced();
        });
        
        $('#prompt_exporter_pretty').on('change', function() {
            extension_settings[extensionName].prettyPrint = !!$(this).prop('checked');
            logInfo(`格式化JSON已${extension_settings[extensionName].prettyPrint ? '启用' : '禁用'}`);
            saveSettingsDebounced();
        });
        
        $('#prompt_exporter_raw').on('change', function() {
            extension_settings[extensionName].includeRawData = !!$(this).prop('checked');
            logInfo(`包含原始数据已${extension_settings[extensionName].includeRawData ? '启用' : '禁用'}`);
            saveSettingsDebounced();
        });
        
        $('#prompt_exporter_button').on('click', function() {
            logDebug('点击导出按钮');
            exportPromptStruct();
        });
        
        // 监听SillyTavern事件
        logDebug('注册事件监听器');
        eventSource.on(event_types.CHAT_COMPLETION_PROMPT_READY, handlePromptReady);
        
        // 加载设置
        loadSettings();
        
        logInfo('插件初始化完成');
    } catch (error) {
        logError('插件初始化失败', error);
    }
});
